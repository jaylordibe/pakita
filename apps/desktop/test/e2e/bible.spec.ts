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

// Phase 3's acceptance flow against a real API: the server's administrator
// imports a USFM folder on the Server screen → it is published → it
// synchronises to a church's laptop → the operator finds a passage and
// presents it, also offline after a restart.

test.describe.configure({ mode: 'serial' });

const FIXTURE = resolve(__dirname, '../fixtures/usfm');

let api: TestApi;
let userDataDirectory: string;
let application: ElectronApplication;
let operator: Page;

test.beforeAll(async () => {
  api = await startTestApi();
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-bible-'));
  ({ application, operator } = await launchApp(userDataDirectory));
});

test.afterAll(async () => {
  await application?.close();
  await api?.dispose();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

async function signIn(identifier: string, password: string): Promise<void> {
  await operator.getByTestId('sign-in-identifier').fill(identifier);
  await operator.getByTestId('sign-in-password').fill(password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
}

test('the administrator opens the Bible on the Server screen, with nothing published', async () => {
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await signIn(api.administrator.identifier, api.administrator.password);
  await operator.getByTestId('tab-bible').click();
  await expect(
    operator.getByText('No translation is published yet.'),
  ).toBeVisible();
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
  // The fixture's copr.htm, laid out as eBible.org's, fills in every detail.
  await expect(operator.getByTestId('bible-import-suggested')).toBeVisible();
  await expect(operator.getByTestId('bible-import-code')).toHaveValue('WEB');
  await expect(operator.getByTestId('bible-import-name')).toHaveValue(
    'World English Bible',
  );
  await expect(operator.getByTestId('bible-import-language')).toHaveValue('en');
  await expect(operator.getByTestId('bible-import-attribution')).toHaveValue(
    'World English Bible (Public Domain)',
  );
  await expect(operator.getByTestId('bible-import-licence')).toHaveValue(
    'Public Domain',
  );
  await expect(operator.getByTestId('bible-import-source')).toHaveValue(
    'https://ebible.org/web',
  );
  await operator.getByTestId('bible-import-submit').click();

  await expect(operator.getByTestId('bible-imported')).toContainText(
    'World English Bible is imported and published.',
  );
  await expect(operator.getByTestId('server-bible-WEB')).toContainText(
    'World English Bible',
  );
  // The new translation opens straight away, selected in the list.
  await expect(operator.getByTestId('server-bible-title')).toHaveText(
    'World English Bible',
  );
  await expect(
    operator.getByTestId('server-bible-WEB').getByRole('button'),
  ).toHaveAttribute('aria-current', 'true');
  await expect(operator.getByTestId('server-bible-details')).toContainText(
    'https://ebible.org/web',
  );
  const published = await api.request<
    Array<{ code: string; isPublished: boolean; verseCount: number }>
  >('GET', '/api/bible-translations');
  expect(published).toEqual([
    expect.objectContaining({ code: 'WEB', isPublished: true, verseCount: 6 }),
  ]);
});

test('says when the short name is already published, before and after submitting', async () => {
  await operator.getByTestId('bible-import-open').click();
  await expect(operator.getByTestId('bible-imported')).toHaveCount(0);
  await operator.getByTestId('bible-import-choose').click();
  await expect(operator.getByTestId('bible-import-code-taken')).toContainText(
    'WEB is already published.',
  );
  await operator.getByTestId('bible-import-submit').click();
  const error = operator.getByTestId('bible-import-error');
  await expect(error).toContainText(
    'A translation with the short name WEB is already published.',
  );
  await expect(error).toBeInViewport();

  // Asking to import again, with the form open, starts a fresh form.
  await operator.getByTestId('bible-import-open').click();
  await expect(operator.getByTestId('bible-import-preview')).toHaveCount(0);
  await expect(operator.getByTestId('bible-import-error')).toHaveCount(0);
  await operator.getByRole('button', { name: 'Close' }).click();

  // Choosing a translation in the list opens it.
  await expect(operator.getByTestId('server-bible-title')).toHaveCount(0);
  await operator.getByTestId('server-bible-WEB').getByRole('button').click();
  await expect(operator.getByTestId('server-bible-title')).toHaveText(
    'World English Bible',
  );
  await expect(operator.getByTestId('server-bible-details')).toContainText(
    'Public Domain',
  );
});

test("arrives on a church's laptop with the next synchronisation", async () => {
  await operator.getByTestId('sign-out').click();
  await signIn(api.owner.identifier, api.owner.password);
  // The owner's only church opens without asking.
  await expect(operator.getByTestId('sync-status')).toContainText(
    'Synchronised',
  );
  await operator.getByTestId('tab-bible').click();
  await expect(operator.getByTestId('bible-translation')).toContainText(
    'WEB — World English Bible',
  );
  // Importing is the administrator's, on the Server screen.
  await expect(operator.getByTestId('bible-import-open')).toHaveCount(0);
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
    'John 3:16 · World English Bible (Public Domain)',
  );
  await operator.keyboard.press('ArrowRight');
  await expect(projector.locator('#caption')).toHaveText(
    'John 3:17 · World English Bible (Public Domain)',
  );
  await operator.getByTestId('live-stop').click();
});

test('goes to a typed reference and selects its verses', async () => {
  const reference = operator.getByTestId('bible-reference');
  await reference.fill('jo 3');
  await reference.press('Enter');
  // Only Job, Joel, Jonah or John could start "jo"; this Bible has John alone.
  await expect(operator.getByRole('heading', { level: 2 })).toHaveText(
    'John 3',
  );
  await expect(reference).toHaveValue('');

  await reference.fill('gen 1:9');
  await reference.press('Enter');
  await expect(operator.getByTestId('bible-reference-problem')).toHaveText(
    'Genesis 1 has 2 verses.',
  );

  await reference.fill('hezekiah 1');
  await reference.press('Enter');
  await expect(operator.getByTestId('bible-reference-problem')).toHaveText(
    'No book called “hezekiah”.',
  );

  await reference.fill('jn 3:16-17');
  await expect(operator.getByTestId('bible-reference-preview')).toHaveText(
    'Enter opens John 3:16–17',
  );
  await reference.press('Enter');
  await expect(operator.getByRole('heading', { level: 2 })).toHaveText(
    'John 3:16–17',
  );
  await expect(operator.getByTestId('bible-verse-16')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(operator.getByTestId('bible-verse-17')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(reference).toHaveValue('');
});

test('finds a book by typing part of it, and a chapter by its number', async () => {
  const book = operator.getByTestId('bible-book');
  await book.click();
  await book.fill('gen');
  await expect(
    operator.locator('[data-testid^="bible-book-option-"]'),
  ).toHaveText(['Genesis']);
  await book.press('Enter');
  await expect(book).toHaveValue('Genesis');

  const chapter = operator.getByTestId('bible-chapter');
  await chapter.fill('2');
  await chapter.press('Enter');
  await expect(operator.getByRole('heading', { level: 2 })).toHaveText(
    'Genesis 2',
  );
  // A chapter the book does not have puts back the current one.
  await chapter.fill('9');
  await chapter.press('Enter');
  await expect(chapter).toHaveValue('2');

  // Leaving the field without choosing keeps the book.
  await book.click();
  await book.fill('xyz');
  await expect(operator.getByText('No book matches.')).toBeVisible();
  await book.press('Escape');
  await expect(book).toHaveValue('Genesis');
});

test('puts a double-clicked verse live, with Go live in reach after scrolling', async () => {
  await operator.getByTestId('bible-reference').fill('jn 3');
  await operator.getByTestId('bible-reference').press('Enter');

  // This test Bible's chapters are two verses long; room below them stands in
  // for a long chapter.
  const content = operator.locator('.panel-content');
  await operator
    .locator('.verses')
    .evaluate((list) => (list.style.paddingBottom = '3000px'));
  // Scrolled to the bottom, the passage head (and Go live) is still on screen.
  await content.evaluate((element) =>
    element.scrollTo(0, element.scrollHeight),
  );
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000);
  await expect(operator.getByTestId('bible-go-live')).toBeInViewport();
  await operator
    .locator('.verses')
    .evaluate((list) => (list.style.paddingBottom = ''));

  await operator.getByTestId('bible-verse-16').dblclick();
  const projector = await findProjector(application);
  await expect(projector.locator('#caption')).toHaveText(
    'John 3:16 · World English Bible (Public Domain)',
  );
  // One verse goes live with its whole chapter, so Next carries on reading;
  // the Bible page follows the verse on the projector.
  await expect(operator.getByTestId('bible-verse-16')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(operator.getByTestId('live-previous')).toBeDisabled();
  await operator.getByTestId('live-next').click();
  await expect(projector.locator('#caption')).toHaveText(
    'John 3:17 · World English Bible (Public Domain)',
  );
  await expect(operator.getByTestId('bible-verse-17')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(operator.getByTestId('bible-verse-16')).not.toHaveAttribute(
    'aria-current',
  );
  // The chapter's last verse: nothing follows.
  await expect(operator.getByTestId('live-next')).toBeDisabled();
  await expect(operator.getByTestId('live-previous')).toBeEnabled();
  await operator.getByTestId('live-stop').click();
  await expect(operator.getByTestId('bible-verse-17')).not.toHaveAttribute(
    'aria-current',
  );
});

test('presents from the laptop’s copy after a restart with the server down', async () => {
  await application.close();
  await api.stop();
  ({ application, operator } = await launchApp(userDataDirectory));

  await operator.getByTestId('tab-bible').click();
  await operator.getByTestId('bible-book').click();
  await operator.getByTestId('bible-book').fill('jn');
  await operator.getByTestId('bible-book').press('Enter');
  await operator.getByTestId('bible-chapter').fill('4');
  await operator.getByTestId('bible-chapter').press('Enter');
  await operator.getByTestId('bible-verse-1').click();
  await operator.getByTestId('bible-go-live').click();

  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText(
    '1 Therefore when the Lord knew that the Pharisees had heard',
  );
  await operator.getByTestId('live-stop').click();
});
