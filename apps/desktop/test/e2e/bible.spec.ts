import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { findProjector, launchApp } from './support/launch';
import { startTestApi, type TestApi } from './support/test-api';

// Phase 3's acceptance flow against a real API: an administrator imports a
// USFM folder → it is published → it synchronises to the laptop → the
// operator finds a passage and presents it, also offline after a restart.

test.describe.configure({ mode: 'serial' });

const FIXTURE = resolve(__dirname, '../fixtures/usfm');

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

test.beforeAll(async () => {
  api = await startTestApi({ isOwnerPlatformAdmin: true });
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-bible-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('signs in and shows that the laptop has no Bible yet', async () => {
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  // The owner's only church opens without asking.
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
  await operator.getByTestId('tab-bible').click();
  await expect(operator.getByTestId('bible-empty')).toBeVisible();
});

test('imports a USFM folder, publishes it and synchronises it', async () => {
  // The folder dialog is the operating system's; answer it with the fixture.
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [folder],
    })) as typeof dialog.showOpenDialog;
  }, FIXTURE);

  await operator.getByTestId('bible-import-open').click();
  await operator.getByTestId('bible-import-choose').click();
  await expect(operator.getByTestId('bible-import-preview')).toContainText(
    '2 books (Genesis to John), 6 verses — left out: FRT',
  );
  await operator.getByTestId('bible-import-code').fill('WEB');
  await operator.getByTestId('bible-import-name').fill('World English Bible');
  await operator
    .getByTestId('bible-import-attribution')
    .fill('World English Bible (public domain)');
  await operator.getByTestId('bible-import-licence').fill('Public domain');
  await operator.getByTestId('bible-import-submit').click();

  await expect(operator.getByTestId('bible-translation')).toContainText(
    'WEB — World English Bible',
  );
  const published = await api.request<
    Array<{ code: string; isPublished: boolean; verseCount: number }>
  >('GET', '/api/bible-translations');
  expect(published).toEqual([
    expect.objectContaining({ code: 'WEB', isPublished: true, verseCount: 6 }),
  ]);
});

test('finds a passage and presents it with its reference', async () => {
  await expect(operator.getByTestId('bible-verse-1')).toContainText(
    'In the beginning, God created the heavens and the earth.',
  );
  await operator.getByTestId('bible-search').fill('so lov');
  await operator.getByTestId('bible-result-JHN-3-16').click();
  await operator.getByTestId('bible-verse-17').click({ modifiers: ['Shift'] });
  await expect(operator.getByRole('heading', { level: 2 })).toHaveText(
    'John 3:16–17',
  );
  await operator.getByTestId('bible-go-live').click();

  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText(
    '16 For God so loved the world, that he gave his one and only Son,',
  );
  await expect(projector.locator('#caption')).toHaveText(
    'John 3:16 · World English Bible (public domain)',
  );
  await operator.keyboard.press('ArrowRight');
  await expect(projector.locator('#caption')).toHaveText(
    'John 3:17 · World English Bible (public domain)',
  );
  await operator.getByTestId('live-stop').click();
});

test('presents from the laptop’s copy after a restart with the server down', async () => {
  await application.close();
  await api.stop();
  ({ application, operator } = await launchApp(userDataDirectory));

  await operator.getByTestId('tab-bible').click();
  await operator.getByTestId('bible-book').selectOption('JHN');
  await operator.getByTestId('bible-chapter').selectOption('4');
  await operator.getByTestId('bible-verse-1').click();
  await operator.getByTestId('bible-go-live').click();

  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText(
    '1 Therefore when the Lord knew that the Pharisees had heard',
  );
  await operator.getByTestId('live-stop').click();
});
