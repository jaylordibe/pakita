import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  readUsfmFolder,
  type TranslationUploader,
  uploadTranslation,
} from './bible-import';

const FIXTURE = join(__dirname, '../../../test/fixtures/usfm');

const input = {
  code: 'WEB',
  name: 'World English Bible',
  languageCode: 'en',
  licence: 'Public domain',
  attribution: 'World English Bible (public domain)',
  sourceUrl: null,
};

describe('readUsfmFolder', () => {
  it('reads the books in canonical order and leaves front matter out', async () => {
    const folder = await readUsfmFolder(FIXTURE);
    expect(folder.books.map((book) => [book.code, book.name])).toEqual([
      ['GEN', 'Genesis'],
      ['JHN', 'John'],
    ]);
    expect(folder.verseCount).toBe(6);
    expect(folder.skippedCodes).toEqual(['FRT']);
    expect(folder.books[0]?.chapters[0]?.verses[0]?.text).toBe(
      'In the beginning, God created the heavens and the earth.',
    );
  });

  it('refuses a folder with no USFM, and a book given twice', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pakita-usfm-'));
    await expect(readUsfmFolder(empty)).rejects.toThrow(/no USFM files/);

    const twice = mkdtempSync(join(tmpdir(), 'pakita-usfm-'));
    for (const name of ['a.usfm', 'b.usfm']) {
      writeFileSync(
        join(twice, name),
        '\\id JHN\n\\c 1\n\\v 1 In the beginning',
      );
    }
    await expect(readUsfmFolder(twice)).rejects.toThrow(/more than one file/);
  });
});

function fakeUploader(failOnChapter?: number): TranslationUploader & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deleteLeftoverDraft: vi.fn(async (code: string) => {
      calls.push(`clear ${code}`);
    }),
    createDraft: vi.fn(async () => {
      calls.push('create');
      return 'draft-1';
    }),
    putChapter: vi.fn(async (_id, bookCode, chapter) => {
      if (chapter === failOnChapter) throw new Error('refused');
      calls.push(`${bookCode} ${chapter}`);
    }),
    publish: vi.fn(async () => {
      calls.push('publish');
    }),
    deleteDraft: vi.fn(async () => {
      calls.push('delete');
    }),
  };
}

describe('uploadTranslation', () => {
  it('sends every chapter in order, reporting progress, then publishes', async () => {
    const uploader = fakeUploader();
    const progress = vi.fn();
    await uploadTranslation(
      uploader,
      input,
      await readUsfmFolder(FIXTURE),
      progress,
    );
    expect(uploader.calls).toEqual([
      'clear WEB',
      'create',
      'GEN 1',
      'GEN 2',
      'JHN 3',
      'JHN 4',
      'publish',
    ]);
    expect(progress).toHaveBeenLastCalledWith({
      done: 4,
      total: 4,
      bookName: 'John',
    });
  });

  it('deletes the draft when a chapter is refused', async () => {
    const uploader = fakeUploader(3);
    await expect(
      uploadTranslation(
        uploader,
        input,
        await readUsfmFolder(FIXTURE),
        () => {},
      ),
    ).rejects.toThrow('refused');
    expect(uploader.calls).toEqual([
      'clear WEB',
      'create',
      'GEN 1',
      'GEN 2',
      'delete',
    ]);
  });

  it('never deletes once publishing was asked for', async () => {
    const uploader = fakeUploader();
    vi.mocked(uploader.publish).mockRejectedValueOnce(new Error('timed out'));
    await expect(
      uploadTranslation(
        uploader,
        input,
        await readUsfmFolder(FIXTURE),
        () => {},
      ),
    ).rejects.toThrow('timed out');
    expect(uploader.deleteDraft).not.toHaveBeenCalled();
  });
});
