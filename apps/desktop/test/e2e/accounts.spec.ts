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
// creates an account in the app and passes on a one-time password; the person
// signs in, must choose their own, and joins a church with an invitation code
// a church owner passed on.

test.describe.configure({ mode: 'serial' });

const NEW_EMAIL = `newcomer-${process.pid}@example.org`;
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

test('the administrator creates an account and is shown its one-time password', async () => {
  await signIn(api.administrator.identifier, api.administrator.password);
  // The platform administrator sees every church; with only one on the
  // server, it opens without asking.
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
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
  await operator.getByTestId('change-password-current').fill(temporaryPassword);
  await operator.getByTestId('change-password-new').fill(OWN_PASSWORD);
  await operator.getByTestId('change-password-confirmation').fill(OWN_PASSWORD);
  await operator.getByTestId('change-password-submit').click();

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
