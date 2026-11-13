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

// Phase 2's acceptance flow, end to end against a real API:
// create a song → save it to the API → synchronise it to the desktop →
// disconnect → present it on the projector, also after a restart offline.

test.describe.configure({ mode: 'serial' });

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

test.beforeAll(async () => {
  api = await startTestApi();
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-slice-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('connects, signs in and opens its only church without asking', async () => {
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );

  const health = await operator.evaluate(() =>
    window.pakita.database.getHealth(),
  );
  expect(health).toMatchObject({ journalMode: 'wal' });
  expect(health?.schemaVersion).toBe(health?.latestSchemaVersion);

  // The library's list column runs the window's full height, as the sidebar
  // does, however little it holds.
  const heights = await operator.evaluate(() => ({
    sidebar: document.querySelector('.sidebar')!.getBoundingClientRect().height,
    list: document.querySelector('.panel-list')!.getBoundingClientRect().height,
  }));
  expect(heights.list).toBeCloseTo(heights.sidebar, 0);
});

test('creates a song, saved to the API and synchronised back', async () => {
  await operator.getByTestId('new-song').click();
  await operator.getByTestId('song-title').fill('Amazing Grace');
  await operator.getByTestId('song-artist').fill('John Newton');
  await operator.getByTestId('section-label-0').fill('Verse 1');
  await operator
    .getByTestId('section-lyrics-0')
    .fill('Amazing grace, how sweet the sound\n\nThat saved a wretch like me');
  await operator.getByTestId('song-save').click();

  await expect(
    operator.getByTestId('library-song-Amazing Grace'),
  ).toBeVisible();
  const songs = await api.request<{ data: Array<{ title: string }> }>(
    'GET',
    `/api/workspaces/${api.workspace.id}/songs`,
  );
  expect(songs.data.map((song) => song.title)).toEqual(['Amazing Grace']);
});

test('presents the song on the projector', async () => {
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByTestId('go-live').click();

  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText(
    'Amazing grace, how sweet the sound',
  );
  await operator.keyboard.press('ArrowRight');
  await expect(projector.locator('#slide')).toHaveText(
    'That saved a wretch like me',
  );
  await operator.getByTestId('live-blackout').click();
  await expect(projector.locator('#stage')).toHaveClass(/is-dark/);
  await operator.getByTestId('live-blackout').click();
  await expect(projector.locator('#stage')).not.toHaveClass(/is-dark/);
});

test('leaves the projector alone when only a display’s work area changes', async () => {
  // Going full screen hides a menu bar, which macOS reports as a display
  // change. Re-placing the window on it toggled full screen again: an
  // endless loop that froze the whole computer.
  const placementCalls = await application.evaluate(
    ({ BrowserWindow, screen }) => {
      const projector = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === 'Pakita — projector',
      )!;
      let calls = 0;
      const count =
        <Args extends unknown[]>(original: (...args: Args) => void) =>
        (...args: Args) => {
          calls += 1;
          original(...args);
        };
      projector.setFullScreen = count(projector.setFullScreen.bind(projector));
      projector.setBounds = count(projector.setBounds.bind(projector));
      for (const display of screen.getAllDisplays()) {
        screen.emit('display-metrics-changed', {}, display, ['workArea']);
      }
      return calls;
    },
  );
  expect(placementCalls).toBe(0);
});

test('keeps the presentation in the operator’s hands', async () => {
  const projector = await findProjector(application);
  const slide = projector.locator('#slide');
  await expect(slide).toHaveText('That saved a wretch like me');

  // Presenter keys drive the slides even with a drop-down focused, and the
  // drop-down does not change.
  const arrangement = operator.getByTestId('arrangement-select');
  const arrangementBefore = await arrangement.inputValue();
  await arrangement.focus();
  await operator.keyboard.press('ArrowLeft');
  await expect(slide).toHaveText('Amazing grace, how sweet the sound');
  expect(await arrangement.inputValue()).toBe(arrangementBefore);
  await operator.keyboard.press('ArrowRight');
  await expect(slide).toHaveText('That saved a wretch like me');

  // Choosing a display, then Automatic, never leaves the projector dark.
  const displays = operator.getByTestId('display-select');
  const firstDisplay = await displays
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await displays.selectOption(firstDisplay!);
  await displays.selectOption('');
  await expect(operator.getByTestId('projector-status')).not.toContainText(
    'disconnected',
  );
  const state = await operator.evaluate(() => window.pakita.live.getState());
  expect(state.projector).not.toBe('display-missing');

  // Another screen never takes the live controls away.
  // Asked for, the list shows even with one church (it is also where a
  // new church is created).
  await operator.getByRole('button', { name: 'Change church' }).click();
  await expect(
    operator.getByTestId(`workspace-${api.workspace.slug}`),
  ).toBeVisible();
  await expect(operator.getByTestId('live-next')).toBeVisible();
  await operator.getByTestId('live-previous').click();
  await expect(slide).toHaveText('Amazing grace, how sweet the sound');
  await operator.getByTestId('live-next').click();
  await expect(slide).toHaveText('That saved a wretch like me');
  await operator.getByRole('button', { name: 'Back to the library' }).click();
  await expect(operator.getByTestId('library-search')).toBeVisible();
});

test('a synchronisation never replaces what is on the projector', async () => {
  const projector = await findProjector(application);
  const [song] = (
    await api.request<{ data: Array<{ id: string }> }>(
      'GET',
      `/api/workspaces/${api.workspace.id}/songs`,
    )
  ).data;
  await api.request(
    'PATCH',
    `/api/workspaces/${api.workspace.id}/songs/${song!.id}`,
    {
      sections: [
        {
          key: 'v',
          kind: 'verse',
          label: 'Verse 1',
          lyrics: 'Edited on the server',
        },
      ],
    },
  );
  await operator.getByTestId('sync-now').click();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );

  // Still the deck taken when the presentation started.
  await expect(projector.locator('#slide')).toHaveText(
    'That saved a wretch like me',
  );
  const state = await operator.evaluate(() => window.pakita.live.getState());
  expect(state.slides.map((slide) => slide.text)).toEqual([
    'Amazing grace, how sweet the sound',
    'That saved a wretch like me',
  ]);

  // Starting the song again takes the synchronised content.
  await operator.getByTestId('live-stop').click();
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByTestId('go-live').click();
  await expect((await findProjector(application)).locator('#slide')).toHaveText(
    'Edited on the server',
  );
  await operator.getByTestId('live-stop').click();
});

test('presents offline, and again after restarting offline', async () => {
  await api.stop();

  await operator.getByTestId('sync-now').click();
  await expect(operator.getByTestId('sync-status')).toContainText('Offline');
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByTestId('go-live').click();
  await expect((await findProjector(application)).locator('#slide')).toHaveText(
    'Edited on the server',
  );

  // Restart with no server: the app opens straight into the library.
  await application.close();
  ({ application, operator } = await launchApp(userDataDirectory));
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByTestId('go-live').click();
  await expect((await findProjector(application)).locator('#slide')).toHaveText(
    'Edited on the server',
  );
});
