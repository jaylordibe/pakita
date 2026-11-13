import { describe, expect, it, vi } from 'vitest';

import type { BibleContent } from '../api/api-schemas';
import { bibleContentHash } from '../bible/bible-content-hash';
import { BibleIntegrityError, syncBibleTranslations } from './bible-sync';

const verses = [
  {
    bookCode: 'JHN',
    chapter: 3,
    verse: 16,
    text: 'For God so loved the world,',
  },
];
const HASH = bibleContentHash(verses);

const summary = (id: string, contentHash: string | null = HASH) => ({
  id,
  code: id.toUpperCase(),
  name: `Translation ${id}`,
  languageCode: 'en',
  attribution: 'Public domain',
  isPublished: contentHash !== null,
  contentHash,
  verseCount: verses.length,
});

const contentOf = (id: string, text = verses[0]!.text): BibleContent => ({
  translation: summary(id),
  books: [{ code: 'JHN', name: 'John', position: 42 }],
  verses: [{ ...verses[0]!, text }],
});

function databaseHolding(stored: Array<{ id: string; contentHash: string }>) {
  return {
    listBibleTranslations: vi.fn(async () =>
      stored.map((translation) => ({
        ...summary(translation.id),
        contentHash: translation.contentHash,
      })),
    ),
    replaceBibleTranslation: vi.fn(async () => undefined),
    removeBibleTranslation: vi.fn(async () => undefined),
  };
}

describe('syncBibleTranslations', () => {
  it('downloads what the laptop lacks, keeps what it has, removes what the server dropped', async () => {
    const database = databaseHolding([
      { id: 'kept', contentHash: HASH },
      { id: 'dropped', contentHash: HASH },
    ]);
    const downloadContent = vi.fn(async (id: string) => contentOf(id));
    await syncBibleTranslations({
      listTranslations: async () => [
        summary('kept'),
        summary('new'),
        summary('draft', null),
      ],
      downloadContent,
      database,
      rejectedContent: new Set(),
    });
    expect(downloadContent.mock.calls).toEqual([['new']]);
    expect(database.replaceBibleTranslation).toHaveBeenCalledWith(
      contentOf('new'),
    );
    expect(database.removeBibleTranslation.mock.calls).toEqual([['dropped']]);
  });

  it('never stores content that does not match the published hash, and still syncs the rest', async () => {
    const database = databaseHolding([]);
    const rejectedContent = new Set<string>();
    const downloadContent = vi.fn(async (id: string) =>
      id === 'tampered'
        ? contentOf(id, 'For God so hated the world,')
        : contentOf(id),
    );
    const sync = () =>
      syncBibleTranslations({
        listTranslations: async () => [summary('tampered'), summary('good')],
        downloadContent,
        database,
        rejectedContent,
      });
    await expect(sync()).rejects.toBeInstanceOf(BibleIntegrityError);
    // The same bad copy is not downloaded again, and still reported.
    database.listBibleTranslations.mockResolvedValue([
      { ...summary('good'), contentHash: HASH },
    ]);
    await expect(sync()).rejects.toBeInstanceOf(BibleIntegrityError);
    expect(downloadContent.mock.calls).toEqual([['tampered'], ['good']]);
    expect(database.replaceBibleTranslation.mock.calls).toEqual([
      [contentOf('good')],
    ]);
  });
});
