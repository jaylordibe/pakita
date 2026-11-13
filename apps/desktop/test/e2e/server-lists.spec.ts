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

// The Server screen's lists (People, Churches) are searched and paged on the
// server: a server may hold thousands of accounts, so the app never loads them
// all to filter a copy.

test.describe.configure({ mode: 'serial' });

/** One more than a page (50) holds, with the administrator and the owner. */
const EXTRA_ACCOUNTS = 50;

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

test.beforeAll(async () => {
  api = await startTestApi();
  for (let index = 1; index <= EXTRA_ACCOUNTS; index += 1) {
    const number = String(index).padStart(2, '0');
    await api.adminRequest('POST', '/api/users', {
      email: `paged-${number}-${process.pid}@example.org`,
      firstName: 'Pat',
      lastName: `Paged${number}`,
      password: 'first-password-1',
    });
  }
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-server-lists-'));
  ({ application, operator } = await launchApp(userDataDirectory));
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator
    .getByTestId('sign-in-identifier')
    .fill(api.administrator.identifier);
  await operator
    .getByTestId('sign-in-password')
    .fill(api.administrator.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await expect(operator.getByTestId('tab-churches')).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

const accountRows = () =>
  operator.locator('[data-testid^="account-"].list-item');

test('People shows a page of accounts at a time, and more on request', async () => {
  await operator.getByTestId('tab-people').click();
  await expect(accountRows()).toHaveCount(50);
  await operator.getByTestId('accounts-show-more').click();
  await expect(accountRows()).toHaveCount(EXTRA_ACCOUNTS + 2);
  await expect(operator.getByTestId('accounts-show-more')).toHaveCount(0);
});

test('People searches the server, every word in any order', async () => {
  await operator.getByLabel('Search people').fill('paged37 pat');
  await expect(accountRows()).toHaveCount(1);
  await expect(accountRows()).toContainText('Pat Paged37');

  await operator.getByLabel('Search people').fill('nobody-by-this-name');
  await expect(operator.getByText('Nobody matches.')).toBeVisible();
  await expect(accountRows()).toHaveCount(0);
});

test('Churches searches the server too', async () => {
  await operator.getByTestId('tab-churches').click();
  const church = operator.getByTestId(`church-${api.workspace.slug}`);
  await expect(church).toBeVisible();

  await operator.getByLabel('Search churches').fill('no-such-church');
  await expect(operator.getByText('No church matches.')).toBeVisible();
  await expect(church).toHaveCount(0);

  await operator.getByLabel('Search churches').fill(api.workspace.name);
  await expect(church).toBeVisible();
});
