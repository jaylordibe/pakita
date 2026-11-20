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

// A new song from pasted lyrics: paste → preview → editor → saved to the
// church's server, the way an operator does it.

test.describe.configure({ mode: 'serial' });

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

const LYRICS = [
  '[Verse 1]',
  'Line one',
  'Line two',
  'Line three',
  'Line four',
  'Line five',
  'Line six',
  '',
  '[Chorus]',
  'Sing the chorus',
  'Sing it again',
  '',
  '[Verse 2]',
  'Second verse',
  '',
  '[Chorus]',
  '',
  'CCLI Song # 1234567',
].join('\r\n');

async function putOnClipboard(text: string): Promise<void> {
  await application.evaluate(
    ({ clipboard }, value) => clipboard.writeText(value),
    text,
  );
}

test.beforeAll(async () => {
  api = await startTestApi();
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-paste-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('signs in', async () => {
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
});

test('pastes lyrics with the keyboard and with the button', async () => {
  await operator.getByTestId('new-song').click();
  const text = operator.getByTestId('lyrics-paste-text');
  await expect(text).toBeFocused();

  await putOnClipboard(LYRICS);
  await operator.keyboard.press('ControlOrMeta+V');
  await expect(text).toHaveValue(LYRICS.replaceAll('\r\n', '\n'));

  await text.fill('');
  await expect(operator.getByTestId('lyrics-paste-continue')).toBeDisabled();
  await operator.getByTestId('lyrics-paste-clipboard').click();
  await expect(text).toHaveValue(LYRICS.replaceAll('\r\n', '\n'));
});

test('previews sections and slides, and recounts them by slide size', async () => {
  const summary = operator.getByTestId('lyrics-paste-summary');
  // Verse 1 takes two slides; the chorus is sung twice from one section.
  await expect(summary).toHaveText('3 sections · 5 slides live');
  await expect(operator.getByTestId('lyrics-paste-entry-3')).toContainText(
    'Chorussung again',
  );
  await expect(operator.getByTestId('lyrics-paste-notices')).toContainText(
    'CCLI Song # 1234567',
  );

  await operator.getByTestId('lines-per-slide-6').check();
  await expect(summary).toHaveText('3 sections · 4 slides live');
  await operator.getByTestId('lines-per-slide-2').check();
  await expect(summary).toHaveText('3 sections · 6 slides live');
  await operator.getByTestId('lines-per-slide-4').check();
  await expect(summary).toHaveText('3 sections · 5 slides live');
});

test('opens the editor with what was read, and saves to this church', async () => {
  await operator.getByTestId('lyrics-paste-continue').click();
  // One card per time a section is sung.
  for (const position of [0, 1, 2, 3]) {
    await expect(
      operator.getByTestId(`section-card-${position}`),
    ).toBeVisible();
  }
  await expect(operator.getByTestId('section-card-4')).toHaveCount(0);

  await operator.getByTestId('song-title').fill('Pasted Song');
  await operator.getByTestId('section-label-0').fill('Opening verse');
  await operator.getByTestId('song-save').click();
  await expect(operator.getByTestId('library-song-Pasted Song')).toBeVisible();

  const songs = await api.request<{
    data: Array<{
      title: string;
      sections: Array<{ id: string; label: string; lyrics: string }>;
      arrangements: Array<{ isDefault: boolean; sectionIds: string[] }>;
    }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/songs`);
  const saved = songs.data.find((song) => song.title === 'Pasted Song')!;
  expect(
    saved.sections.map(({ label, lyrics }) => ({ label, lyrics })),
  ).toEqual([
    {
      label: 'Opening verse',
      lyrics:
        'Line one\nLine two\nLine three\nLine four\n\nLine five\nLine six',
    },
    { label: 'Chorus', lyrics: 'Sing the chorus\nSing it again' },
    { label: 'Verse 2', lyrics: 'Second verse' },
  ]);
  const labelOf = (id: string) =>
    saved.sections.find((section) => section.id === id)?.label;
  expect(
    saved.arrangements
      .find((entry) => entry.isDefault)!
      .sectionIds.map(labelOf),
  ).toEqual(['Opening verse', 'Chorus', 'Verse 2', 'Chorus']);
});

test('still starts a blank song', async () => {
  await operator.getByTestId('new-song').click();
  await operator.getByTestId('song-start-blank').click();
  await expect(operator.getByTestId('section-lyrics-0')).toHaveValue('');
  await expect(operator.getByTestId('song-title')).toHaveValue('');
});

test('keeps the stanza breaks a web page shows but its text copy loses', async () => {
  // Shaped like Google's lyrics panel: a block per stanza, spaced by style
  // alone, so the plain-text copy runs every line together.
  const stanzas = [
    ['First verse, line one', 'First verse, line two'],
    ['Chorus line one', 'Chorus line two'],
    ['Second verse, line one', 'Second verse, line two'],
    ['Chorus line one', 'Chorus line two'],
  ];
  const html = `<meta charset='utf-8'>${stanzas
    .map(
      (lines) =>
        `<div class="ujudUb" style="margin-bottom: 12px">${lines
          .map((line) => `<span>${line}</span>`)
          .join('<br aria-hidden="true">')}</div>`,
    )
    .join('')}`;
  await application.evaluate(
    ({ clipboard, ClipboardItem }, copy) =>
      clipboard.write([
        new ClipboardItem({ 'text/plain': copy.text, 'text/html': copy.html }),
      ]),
    { text: stanzas.flat().join('\n'), html },
  );
  const expected = stanzas.map((lines) => lines.join('\n')).join('\n\n');

  await operator.getByTestId('new-song').click();
  const text = operator.getByTestId('lyrics-paste-text');
  await expect(text).toBeFocused();
  await operator.keyboard.press('ControlOrMeta+V');
  await expect(text).toHaveValue(expected);
  await expect(operator.getByTestId('lyrics-paste-summary')).toHaveText(
    '3 sections · 4 slides live',
  );

  await text.fill('');
  await operator.getByTestId('lyrics-paste-clipboard').click();
  await expect(text).toHaveValue(expected);
});
