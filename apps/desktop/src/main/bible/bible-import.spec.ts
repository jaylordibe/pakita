import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { apiConstraints } from '../../shared/api/constraints';
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

  it('refuses, before uploading, a verse longer than the server accepts', async () => {
    const maxLength = apiConstraints.BibleVerseInputDto.text.maxLength;
    const folder = mkdtempSync(join(tmpdir(), 'pakita-usfm-'));
    writeFileSync(
      join(folder, 'esg.usfm'),
      `\\id ESG\n\\c 8\n\\v 12 Short.\n\\v 13 ${'x'.repeat(maxLength + 1)}`,
    );
    await expect(readUsfmFolder(folder)).rejects.toThrow(
      `esg.usfm: ESG 8:13 is ${(maxLength + 1).toLocaleString('en')} characters long`,
    );

    // As long as the limit is fine, measured as the server stores it.
    writeFileSync(
      join(folder, 'esg.usfm'),
      `\\id ESG\n\\c 8\n\\v 13 ${'x'.repeat(maxLength)}   \n`,
    );
    await expect(readUsfmFolder(folder)).resolves.toMatchObject({
      verseCount: 1,
    });
  });

  it('refuses a verse numbered above what the server accepts', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'pakita-usfm-'));
    writeFileSync(
      join(folder, 'psa.usfm'),
      `\\id PSA\n\\c 1\n\\v ${apiConstraints.BibleVerseInputDto.number.maximum + 1} Too far.`,
    );
    await expect(readUsfmFolder(folder)).rejects.toThrow(
      /PSA 1:\d+ is numbered above/,
    );
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
    ).rejects.toThrow('John 3: refused');
    expect(uploader.calls).toEqual([
      'clear WEB',
      'create',
      'GEN 1',
      'GEN 2',
      'delete',
    ]);
  });

  it('says plainly when the short name is already published', async () => {
    const uploader = fakeUploader();
    uploader.createDraft = vi.fn(async () => {
      throw Object.assign(new Error('Code already in use'), {
        errorCode: 'UNIQUE_CONSTRAINT_VIOLATION',
      });
    });
    await expect(
      uploadTranslation(
        uploader,
        input,
        await readUsfmFolder(FIXTURE),
        () => {},
      ),
    ).rejects.toThrow(
      'A translation with the short name WEB is already published. Give this one another short name to import it as well.',
    );
    expect(uploader.putChapter).not.toHaveBeenCalled();
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
