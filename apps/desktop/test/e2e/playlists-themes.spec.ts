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
  // The owner's only church opens without asking.
  await expect(
    operator.getByTestId('library-song-Be Thou My Vision'),
  ).toBeVisible();
});

test('offers no Bible import inside a church', async () => {
  // Importing is the server administrator's, on the Server screen; a church
  // owner is never offered it.
  await operator.getByTestId('tab-bible').click();
  await expect(operator.getByTestId('bible-empty')).toBeVisible();
  await expect(operator.getByTestId('bible-import-open')).toHaveCount(0);
});

test('creates the church’s default theme, previewed as it will look', async () => {
  await operator.getByTestId('tab-themes').click();
  await operator.getByTestId('theme-new').click();
  await operator.getByTestId('theme-name').fill('Evening');
  await operator.getByTestId('theme-background-gradient').check();
  await operator.getByTestId('theme-gradient').selectOption('ocean');
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
});

test('reorders the playlist by dragging, or with the step buttons', async () => {
  const workspaceUrl = `/api/workspaces/${api.workspace.id}`;
  const serverOrder = async () => {
    const playlists = await api.request<{
      data: Array<{ id: string; name: string }>;
    }>('GET', `${workspaceUrl}/playlists`);
    const { id } = playlists.data.find(
      (entry) => entry.name === 'Sunday service',
    )!;
    const playlist = await api.request<{
      items: Array<{ position: number; songId: string | null }>;
    }>('GET', `${workspaceUrl}/playlists/${id}`);
    return [...playlist.items]
      .sort((first, second) => first.position - second.position)
      .map((item) => item.songId);
  };
  const songs = await api.request<{
    data: Array<{ id: string; title: string }>;
  }>('GET', `${workspaceUrl}/songs`);
  const amazingGrace = songs.data.find(
    (entry) => entry.title === 'Amazing Grace',
  )!.id;

  // Drag the second entry's grip onto the top half of the first.
  await operator
    .getByTestId('playlist-entry-grip-1')
    .dragTo(operator.getByTestId('playlist-entry-0'), {
      targetPosition: { x: 40, y: 4 },
    });
  await expect(operator.getByTestId('playlist-entry-1')).toContainText(
    'Amazing Grace',
  );

  // Straight away, while that save may still be in flight, the step button
  // moves it back; focus follows the entry it moved, and both saves land.
  const moveUp = operator
    .getByTestId('playlist-entry-1')
    .getByRole('button', { name: 'Move up' });
  await moveUp.focus();
  await operator.keyboard.press('Enter');
  await expect(operator.getByTestId('playlist-entry-0')).toContainText(
    'Amazing Grace',
  );
  await expect(
    operator
      .getByTestId('playlist-entry-0')
      .getByRole('button', { name: 'Move down' }),
  ).toBeFocused();
  await expect.poll(serverOrder).toEqual([amazingGrace, expect.any(String)]);
  await expect(operator.getByRole('alert')).toHaveCount(0);

  // One drag on its own reaches the server too.
  await operator
    .getByTestId('playlist-entry-grip-1')
    .dragTo(operator.getByTestId('playlist-entry-0'), {
      targetPosition: { x: 40, y: 4 },
    });
  await expect.poll(serverOrder).toEqual([expect.any(String), amazingGrace]);
  await operator
    .getByTestId('playlist-entry-0')
    .getByRole('button', { name: 'Move down' })
    .click();
  await expect.poll(serverOrder).toEqual([amazingGrace, expect.any(String)]);
});

test('marks an entry whose song was deleted as not ready', async () => {
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

test('switches the theme while live, on the same slide, until Stop', async () => {
  await api.request('POST', `/api/workspaces/${api.workspace.id}/themes`, {
    name: 'Plain',
    background: 'solid',
    backgroundColor: '#102030',
    textColor: '#ffffff',
    font: 'sans',
    textScale: 100,
    textAlign: 'center',
    isDefault: false,
  });
  await operator.getByTestId('sync-now').click();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );

  await operator.getByTestId('playlist-present').click();
  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText('Amazing grace');
  const themeSelect = operator.getByTestId('live-theme-select');
  // The playlist's theme (the church default) is the one on screen.
  await expect(themeSelect.locator('option:checked')).toHaveText('Evening');

  await themeSelect.selectOption({ label: 'Plain' });
  await expect(projector.locator('#stage')).toHaveCSS(
    'background-color',
    'rgb(16, 32, 48)',
  );
  await expect(projector.locator('#stage')).toHaveCSS('font-family', /Inter/);
  // The same slide: switching a theme never moves the presentation.
  await expect(projector.locator('#slide')).toHaveText('Amazing grace');
  // The presenter keys work the presentation, never the theme.
  await operator.keyboard.press('b');
  await expect(projector.locator('#stage')).toHaveClass(/is-dark/);
  await operator.keyboard.press('b');
  await expect(projector.locator('#stage')).not.toHaveClass(/is-dark/);
  await expect(themeSelect.locator('option:checked')).toHaveText('Plain');

  // Until Stop: presenting again uses the playlist's own theme.
  await operator.getByTestId('live-stop').click();
  await operator.getByTestId('playlist-present').click();
  // Stop closed the projector window; going live opens a new one.
  const reopened = await findProjector(application);
  await expect(reopened.locator('#stage')).toHaveCSS(
    'background-image',
    /linear-gradient/,
  );
  await expect(
    operator.getByTestId('live-theme-select').locator('option:checked'),
  ).toHaveText('Evening');
  await operator.getByTestId('live-stop').click();
});

/** The labels of a saved song's default order, as the server holds it. */
async function savedOrder(title: string): Promise<Array<string | undefined>> {
  const songs = await api.request<{
    data: Array<{
      title: string;
      sections: Array<{ id: string; label: string }>;
      arrangements: Array<{ isDefault: boolean; sectionIds: string[] }>;
    }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/songs`);
  const saved = songs.data.find((entry) => entry.title === title)!;
  const labelOf = (id: string) =>
    saved.sections.find((section) => section.id === id)?.label;
  return saved.arrangements
    .find((entry) => entry.isDefault)!
    .sectionIds.map(labelOf);
}

test('reorders a song by dragging its section cards', async () => {
  await operator.getByTestId('tab-songs').click();
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByRole('button', { name: 'Edit', exact: true }).click();
  await operator.getByRole('button', { name: 'Add section' }).click();
  // A new section is named after its kind, with no number…
  await expect(operator.getByTestId('section-label-1')).toHaveValue('Verse');
  // …and that name follows its kind…
  await operator.getByTestId('section-kind-1').selectOption('chorus');
  await expect(operator.getByTestId('section-label-1')).toHaveValue('Chorus');
  // …until the person names it; then a change of kind keeps the name.
  await operator.getByTestId('section-label-1').fill('Chorus 1');
  await operator.getByTestId('section-kind-1').selectOption('bridge');
  await expect(operator.getByTestId('section-label-1')).toHaveValue('Chorus 1');
  await operator.getByTestId('section-kind-1').selectOption('chorus');
  await operator.getByTestId('section-lyrics-1').fill('My chains are gone');
  await expect(operator.getByTestId('section-card-1')).toContainText('Chorus');

  // Drop the Chorus card on the left half of Verse 1.
  await operator
    .getByTestId('section-card-1')
    .dragTo(operator.getByTestId('section-card-0'), {
      targetPosition: { x: 4, y: 20 },
    });
  await expect(operator.getByTestId('section-card-0')).toContainText('Chorus');
  await operator.getByTestId('song-save').click();

  await expect
    .poll(() => savedOrder('Amazing Grace'))
    .toEqual(['Chorus 1', 'Verse 1']);
});

test('sings a section again as a linked copy, and removes one', async () => {
  await api.request(
    'POST',
    `/api/workspaces/${api.workspace.id}/songs`,
    song('Holy, Holy, Holy', 'Holy, holy, holy'),
  );
  await operator.getByRole('button', { name: 'Sync now' }).click();
  await operator.getByTestId('library-song-Holy, Holy, Holy').click();
  await operator.getByRole('button', { name: 'Edit', exact: true }).click();
  await operator.getByRole('button', { name: 'Add section' }).click();
  await operator.getByTestId('section-lyrics-1').fill('Lord God Almighty');

  // The new section is the one being edited, with its slides previewed.
  await expect(operator.getByTestId('section-card-1')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(operator.getByTestId('section-lyrics-0')).toBeHidden();
  await expect(
    operator.locator('.preview .slide').filter({ visible: true }),
  ).toHaveText(/Lord God Almighty/);

  // Move the new Verse before Verse 1 with its card's step button.
  await expect(operator.getByTestId('section-label-1')).toHaveValue('Verse');
  await operator.getByTestId('section-card-1').hover();
  await operator.getByRole('button', { name: 'Move Verse earlier' }).click();
  await expect(operator.getByTestId('section-card-0')).toContainText(
    'Lord God Almighty',
  );

  // Repeat Verse 1: a second card, linked to the same lyrics.
  await operator.getByTestId('section-card-1').click();
  await operator.getByTestId('section-repeat').click();
  await expect(operator.getByTestId('section-card-2')).toContainText('Verse 1');
  await expect(operator.getByTestId('section-card-2')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await operator.getByTestId('section-lyrics-1').fill('Holy, holy, holy!');
  await expect(operator.getByTestId('section-card-1')).toContainText(
    'Holy, holy, holy!',
  );

  // Removing one of its two cards keeps the section…
  await operator.getByTestId('section-remove').click();
  await expect(operator.getByTestId('section-card-2')).toHaveCount(0);
  // …but removing the new Verse's only card asks before deleting it.
  await operator.getByTestId('section-card-0').click();
  await operator.getByTestId('section-remove').click();
  await expect(operator.getByTestId('section-delete-confirm')).toBeVisible();
  await operator.getByRole('button', { name: 'Keep' }).click();
  await expect(operator.getByTestId('section-card-0')).toContainText(
    'Lord God Almighty',
  );

  // "All lyrics" shows every section once.
  await operator.getByTestId('section-view-toggle').click();
  await expect(operator.getByTestId('section-lyrics-0')).toBeVisible();
  await expect(operator.getByTestId('section-lyrics-1')).toBeVisible();
  await operator.getByTestId('section-card-1').click();
  await operator.getByTestId('section-view-toggle').click();

  // Sing Verse 1 twice more, save, and the server holds that order.
  await operator.getByTestId('section-repeat').click();
  await operator.getByTestId('song-save').click();
  await expect
    .poll(() => savedOrder('Holy, Holy, Holy'))
    .toEqual(['Verse', 'Verse 1', 'Verse 1']);
});

test('adds a new section straight after the selected card', async () => {
  await operator.getByTestId('library-song-Holy, Holy, Holy').click();
  await operator.getByRole('button', { name: 'Edit', exact: true }).click();
  await operator.getByTestId('section-card-0').click();
  await operator.getByRole('button', { name: 'Add section' }).click();

  await expect(operator.getByTestId('section-card-1')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(operator.getByTestId('section-card-1')).toContainText(
    'No lyrics yet',
  );
  await expect(operator.getByTestId('section-card-2')).toContainText('Verse 1');
  await expect(operator.getByTestId('section-card-3')).toContainText('Verse 1');
  await operator.getByRole('button', { name: 'Cancel' }).click();
});
