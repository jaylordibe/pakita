import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp } from './support/launch';
import { startTestApi, type TestApi } from './support/test-api';

// Without email, a church server gets its people this way: the administrator
// (who belongs to no church, and works on the Server screen) creates an
// account and passes on a one-time password; the person signs in, must choose
// their own, and joins a church with an invitation code a church owner passed
// on — or the church's owner creates the account, already in the church. The
// administrator also starts churches, naming their owners.

test.describe.configure({ mode: 'serial' });

const NEW_EMAIL = `newcomer-${process.pid}@example.org`;
const MEMBER_EMAIL = `member-${process.pid}@example.org`;
const ENGINEER_EMAIL = `engineer-${process.pid}@example.org`;
const OWN_PASSWORD = 'my-own-password-7';

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;
let temporaryPassword: string;

async function signIn(identifier: string, password: string): Promise<void> {
  await operator.getByTestId('sign-in-identifier').fill(identifier);
  await operator.getByTestId('sign-in-password').fill(password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(): Promise<void> {
  await operator.getByRole('button', { name: 'Sign out' }).click();
  await expect(operator.getByTestId('sign-in-identifier')).toBeVisible();
}

test.beforeAll(async () => {
  api = await startTestApi();
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-accounts-'));
  ({ application, operator } = await launchApp(userDataDirectory));
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

async function choosePassword(temporary: string): Promise<void> {
  await operator.getByTestId('change-password-current').fill(temporary);
  await operator.getByTestId('change-password-new').fill(OWN_PASSWORD);
  await operator.getByTestId('change-password-confirmation').fill(OWN_PASSWORD);
  await operator.getByTestId('change-password-submit').click();
}

test('the administrator lands on the Server screen, never the church list', async () => {
  await signIn(api.administrator.identifier, api.administrator.password);
  await expect(operator.getByTestId('tab-churches')).toBeVisible();
  await expect(
    operator.getByTestId(`church-${api.workspace.slug}`),
  ).toBeVisible();
  await expect(operator.getByTestId('invitation-code')).toHaveCount(0);
  await expect(operator.getByTestId('sync-status')).toHaveCount(0);
});

test('the administrator creates an account and is shown its one-time password', async () => {
  await operator.getByTestId('tab-people').click();

  await operator.getByTestId('account-new').click();
  await operator.getByTestId('account-first-name').fill('Nora');
  await operator.getByTestId('account-last-name').fill('Newcomer');
  await operator.getByTestId('account-email').fill(NEW_EMAIL);
  await operator.getByTestId('account-create').click();

  temporaryPassword = (await operator
    .getByTestId('issued-secret')
    .textContent())!.trim();
  expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  await operator.getByTestId('issued-done').click();
  await expect(operator.getByTestId(`account-${NEW_EMAIL}`)).toBeVisible();
  await signOut();
});

test('a church member sees no People tab', async () => {
  await signIn(api.owner.identifier, api.owner.password);
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
  await expect(operator.getByTestId('tab-members')).toBeVisible();
  await expect(operator.getByTestId('tab-people')).toHaveCount(0);
});

let invitationCode: string;

test('the church owner invites the new account and is shown a code', async () => {
  await operator.getByTestId('tab-members').click();
  await operator.getByTestId('invite-identifier').fill(NEW_EMAIL);
  // The least privileged role is preselected, never the owner's own.
  await expect(
    operator.getByTestId('invite-role').locator('option:checked'),
  ).toHaveText('staff');
  await operator.getByTestId('invite-create').click();
  invitationCode = (await operator
    .getByTestId('issued-secret')
    .textContent())!.trim();
  expect(invitationCode.length).toBeGreaterThanOrEqual(20);
  await operator.getByTestId('issued-done').click();
  await expect(operator.getByText('Nora Newcomer')).toBeVisible();
  await signOut();
});

test('the new person must choose their own password before anything else', async () => {
  await signIn(NEW_EMAIL, temporaryPassword);
  await choosePassword(temporaryPassword);

  // The administrator's password no longer signs in.
  await expect(operator.getByTestId('invitation-code')).toBeVisible();
  const refused = await fetch(`${api.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: NEW_EMAIL,
      password: temporaryPassword,
    }),
  });
  expect(refused.status).toBe(401);
});

test('joins the church with the invitation code', async () => {
  await operator.getByTestId('invitation-code').fill(invitationCode);
  await operator.getByTestId('invitation-join').click();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
  const members = await api.request<{
    data: Array<{ user: { email: string } | null }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/memberships`);
  expect(members.data.map((member) => member.user?.email)).toContain(NEW_EMAIL);
});

test("the church's owner creates an account, which arrives already in the church", async () => {
  await signOut();
  await signIn(api.owner.identifier, api.owner.password);
  await operator.getByTestId('tab-members').click();
  await operator.getByTestId('member-first-name').fill('Ruth');
  await operator.getByTestId('member-last-name').fill('Member');
  await operator.getByTestId('member-email').fill(MEMBER_EMAIL);
  // The least privileged role is preselected.
  await expect(
    operator.getByTestId('member-role').locator('option:checked'),
  ).toHaveText('staff');
  await operator.getByTestId('member-create').click();
  const memberPassword = (await operator
    .getByTestId('issued-secret')
    .textContent())!.trim();
  expect(memberPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  await operator.getByTestId('issued-done').click();
  await signOut();

  await signIn(MEMBER_EMAIL, memberPassword);
  await choosePassword(memberPassword);
  // No invitation code: the church opens straight away.
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
  await expect(operator.getByTestId('tab-members')).toHaveCount(0);
  await signOut();
});

test('the administrator starts a church, naming its owner, and later replaces the owner', async () => {
  await signIn(api.administrator.identifier, api.administrator.password);
  await operator.getByTestId('church-new').click();
  await operator.getByTestId('church-name').fill('Grace Church East');
  await operator.getByTestId('church-owner-email').fill(api.owner.identifier);
  await operator.getByTestId('church-create').click();
  await expect(operator.getByTestId('church-notice')).toContainText(
    `${api.owner.identifier} owns it`,
  );
  await expect(operator.getByTestId('church-grace-church-east')).toBeVisible();

  await operator.getByTestId('church-new-owner').fill(NEW_EMAIL);
  await operator.getByTestId('church-replace-owner').click();
  await expect(operator.getByTestId('church-notice')).toContainText(
    `${NEW_EMAIL} now owns Grace Church East`,
  );

  const churches = await api.adminRequest<{
    data: Array<{ id: string; slug: string }>;
  }>('GET', '/api/workspaces?perPage=100');
  const east = churches.data.find(
    (church) => church.slug === 'grace-church-east',
  );
  const members = await api.adminRequest<{
    data: Array<{ user: { email: string }; role: { name: string } }>;
  }>('GET', `/api/workspaces/${east!.id}/memberships`);
  expect(
    members.data.map((member) => [member.user.email, member.role.name]),
  ).toEqual(
    expect.arrayContaining([
      [NEW_EMAIL, 'workspace_owner'],
      [api.owner.identifier, 'workspace_admin'],
    ]),
  );
  // The administrator joined neither church.
  expect(
    members.data.some(
      (member) => member.user.email === api.administrator.identifier,
    ),
  ).toBe(false);
  await signOut();
});

test('platform staff without administration see what their role is for, and no church', async () => {
  const engineer = await api.adminRequest<{ id: string }>(
    'POST',
    '/api/users',
    {
      email: ENGINEER_EMAIL,
      firstName: 'Eli',
      lastName: 'Engineer',
      password: 'first-password-1',
    },
  );
  const roles = await api.adminRequest<{
    data: Array<{ id: string; name: string }>;
  }>('GET', '/api/roles?scope=platform&perPage=100');
  await api.adminRequest('POST', `/api/users/${engineer.id}/roles`, {
    roleId: roles.data.find((role) => role.name === 'platform_engineer')!.id,
  });

  await signIn(ENGINEER_EMAIL, 'first-password-1');
  await choosePassword('first-password-1');
  await expect(operator.getByTestId('server-staff-note')).toBeVisible();
  await expect(operator.getByTestId('tab-churches')).toHaveCount(0);
  await expect(operator.getByTestId('invitation-code')).toHaveCount(0);
});
