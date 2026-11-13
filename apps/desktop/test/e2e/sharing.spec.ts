import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import Database from 'better-sqlite3';
import { globSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp } from './support/launch';
import { startTestApi, type TestApi } from './support/test-api';

// Phase 5 against a real API: copying a song to another branch, and
// downloading a church's content again without losing the current copy.

test.describe.configure({ mode: 'serial' });

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;
let branchId: string;

test.beforeAll(async () => {
  api = await startTestApi();
  const branch = await api.request<{ id: string }>('POST', '/api/workspaces', {
    name: 'Grace Church North',
    slug: `grace-north-${process.pid}`,
  });
  branchId = branch.id;
  await api.request('POST', `/api/workspaces/${api.workspace.id}/songs`, {
    title: 'Amazing Grace',
    sections: [
      { key: 'v1', kind: 'verse', label: 'Verse 1', lyrics: 'Amazing grace' },
    ],
  });
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-sharing-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('copies a song to another branch', async () => {
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await operator.getByTestId(`workspace-${api.workspace.slug}`).click();

  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator
    .getByTestId('copy-to-workspace')
    .selectOption({ label: 'Grace Church North' });
  await expect(operator.getByRole('status')).toContainText(
    'Copied to Grace Church North',
  );
  const copies = await api.request<{ data: Array<{ title: string }> }>(
    'GET',
    `/api/workspaces/${branchId}/songs`,
  );
  expect(copies.data.map((song) => song.title)).toEqual(['Amazing Grace']);
});

test('downloads everything again: the library stays, and a stray copy goes', async () => {
  // A row the server's history does not contain, as a damaged copy might.
  const [databasePath] = globSync(
    join(userDataDirectory, 'accounts', '*', 'pakita.sqlite'),
  );
  const database = new Database(databasePath!);
  database
    .prepare(
      `INSERT INTO songs (id, workspace_id, sync_version, title, artist, is_archived, search_text, payload)
       VALUES ('stray', ?, 1, 'Stray Song', NULL, 0, 'stray song', '{}')`,
    )
    .run(api.workspace.id);
  database.close();
  await operator.getByTestId('library-search').fill('s');
  await operator.getByTestId('library-search').fill('');
  await expect(operator.getByTestId('library-song-Stray Song')).toBeVisible();

  await operator.getByTestId('sync-rebuild').click();
  await expect(operator.getByTestId('library-song-Stray Song')).toHaveCount(0);
  await expect(
    operator.getByTestId('library-song-Amazing Grace'),
  ).toBeVisible();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
});
