import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findProjector, launchApp } from './support/launch';
import { startTestApi, type TestApi } from './support/test-api';

// Phase 4's acceptance flow against a real API: a theme and a playlist made
// on the laptop, the playlist's readiness, and the playlist presented as one
// themed deck.

test.describe.configure({ mode: 'serial' });

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

const song = (title: string, lyrics: string) => ({
  title,
  sections: [{ key: 'v1', kind: 'verse', label: 'Verse 1', lyrics }],
});

test.beforeAll(async () => {
  api = await startTestApi();
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-playlists-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('signs in with two songs in the library', async () => {
  const songsUrl = `/api/workspaces/${api.workspace.id}/songs`;
  await api.request('POST', songsUrl, song('Amazing Grace', 'Amazing grace'));
  await api.request('POST', songsUrl, song('Be Thou My Vision', 'Be thou'));

  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await operator.getByTestId(`workspace-${api.workspace.slug}`).click();
  await expect(
    operator.getByTestId('library-song-Be Thou My Vision'),
  ).toBeVisible();
});

test('creates the church’s default theme, previewed as it will look', async () => {
  await operator.getByTestId('tab-themes').click();
  await operator.getByTestId('theme-new').click();
  await operator.getByTestId('theme-name').fill('Evening');
  await operator.getByTestId('theme-background').selectOption('ocean');
  await operator.getByTestId('theme-font').selectOption('serif');
  await operator.getByTestId('theme-default').check();
  await expect(operator.getByTestId('theme-preview')).toHaveCSS(
    'font-family',
    /Merriweather/,
  );
  await operator.getByTestId('theme-save').click();
  await expect(operator.getByTestId('theme-Evening')).toContainText(
    '(default)',
  );
});

test('plans a playlist from the library and shows what is ready', async () => {
  await operator.getByTestId('tab-playlists').click();
  await operator.getByTestId('playlist-new-name').fill('Sunday service');
  await operator.getByTestId('playlist-create').click();
  await expect(operator.getByTestId('playlist-name')).toHaveValue(
    'Sunday service',
  );

  await operator.getByTestId('tab-songs').click();
  for (const title of ['Amazing Grace', 'Be Thou My Vision']) {
    await operator.getByTestId(`library-song-${title}`).click();
    await operator.getByTestId('add-to-playlist').selectOption({
      label: 'Sunday service',
    });
    await expect(operator.getByRole('status')).toContainText(
      'Added to Sunday service',
    );
  }

  await operator.getByTestId('tab-playlists').click();
  await operator.getByTestId('playlist-Sunday service').click();
  await expect(operator.getByTestId('playlist-readiness')).toHaveText(
    '2 of 2 ready on this laptop',
  );

  // A song deleted on the server leaves its entry not ready on the laptop.
  const songs = await api.request<{
    data: Array<{ id: string; title: string }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/songs`);
  const removed = songs.data.find(
    (entry) => entry.title === 'Be Thou My Vision',
  )!;
  await api.request(
    'DELETE',
    `/api/workspaces/${api.workspace.id}/songs/${removed.id}`,
  );
  await operator.getByTestId('sync-now').click();
  await expect(operator.getByTestId('playlist-readiness')).toHaveText(
    '1 of 2 ready on this laptop',
  );
  await expect(operator.getByTestId('playlist-entry-1')).toContainText(
    'not on this laptop',
  );
});

test('presents the playlist with the default theme', async () => {
  await operator.getByTestId('playlist-present').click();
  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText('Amazing grace');
  await expect(projector.locator('#stage')).toHaveCSS(
    'background-image',
    /linear-gradient/,
  );
  await expect(projector.locator('#stage')).toHaveCSS(
    'font-family',
    /Merriweather/,
  );
  // The font itself loaded from the app (no network, within the CSP).
  const loadedFaces = await projector.evaluate(async () =>
    (await document.fonts.load('600 32px Merriweather')).map(
      (face) => `${face.family} ${face.status}`,
    ),
  );
  expect(loadedFaces).toContain('Merriweather loaded');
  await operator.getByTestId('live-stop').click();
});
