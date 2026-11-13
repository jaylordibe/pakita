import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { BibleStore, toSearchQuery } from './bible-store';
import { migrateDatabase } from './migrations';

const content = (id: string, hash = 'hash-1') => ({
  translation: {
    id,
    code: 'WEB',
    name: 'World English Bible',
    languageCode: 'en',
    attribution: 'World English Bible (public domain)',
    isPublished: true,
    contentHash: hash,
    verseCount: 4,
  },
  books: [
    { code: 'GEN', name: 'Genesis', position: 0 },
    { code: 'JHN', name: 'John', position: 42 },
  ],
  verses: [
    {
      bookCode: 'GEN',
      chapter: 1,
      verse: 1,
      text: 'In the beginning, God created the heavens and the earth.',
    },
    {
      bookCode: 'JHN',
      chapter: 3,
      verse: 16,
      text: 'For God so loved the world,',
    },
    {
      bookCode: 'JHN',
      chapter: 3,
      verse: 17,
      text: 'For God didn’t send his Son into the world to judge the world,',
    },
    {
      bookCode: 'JHN',
      chapter: 4,
      verse: 1,
      text: 'Therefore when the Lord knew',
    },
  ],
});

describe('BibleStore', () => {
  let store: BibleStore;

  beforeEach(() => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    migrateDatabase(database);
    store = new BibleStore(database);
  });

  it('stores a translation with its books, chapters and verses', () => {
    store.replaceTranslation(content('web'));
    expect(store.listTranslations()).toEqual([
      expect.objectContaining({ id: 'web', code: 'WEB', verseCount: 4 }),
    ]);
    expect(store.listBooks('web')).toEqual([
      { code: 'GEN', name: 'Genesis', position: 0, chapterCount: 1 },
      { code: 'JHN', name: 'John', position: 42, chapterCount: 4 },
    ]);
  });

  it('returns a passage across chapters within one book', () => {
    store.replaceTranslation(content('web'));
    expect(
      store
        .getPassage(
          'web',
          'JHN',
          { chapter: 3, verse: 17 },
          { chapter: 4, verse: 1 },
        )
        .map((verse) => `${verse.chapter}:${verse.verse}`),
    ).toEqual(['3:17', '4:1']);
  });

  it('searches every word, the last as a prefix, ignoring accents', () => {
    store.replaceTranslation(content('web'));
    expect(
      store.search('web', 'god world').map((result) => result.verse),
    ).toEqual([16, 17]);
    expect(
      store.search('web', 'begin').map((result) => result.bookName),
    ).toEqual(['Genesis']);
    expect(store.search('web', 'wórld judge')).toHaveLength(1);
    expect(store.search('web', '"OR NEAR(*')).toEqual([]);
  });

  it('replaces a translation whole, and removes it with its index', () => {
    store.replaceTranslation(content('web'));
    store.replaceTranslation({
      ...content('web', 'hash-2'),
      verses: content('web').verses.slice(0, 1),
    });
    expect(store.listTranslations()[0]?.contentHash).toBe('hash-2');
    expect(store.search('web', 'loved')).toEqual([]);

    // A second translation keeps its own index entries throughout.
    store.replaceTranslation({
      ...content('kjv'),
      translation: { ...content('kjv').translation, code: 'KJV' },
    });
    store.removeTranslation('web');
    expect(store.search('kjv', 'loved').map((result) => result.verse)).toEqual([
      16,
    ]);
    expect(
      store.listTranslations().map((translation) => translation.id),
    ).toEqual(['kjv']);
    expect(store.listBooks('web')).toEqual([]);
    expect(store.search('web', 'beginning')).toEqual([]);
  });
});

describe('toSearchQuery', () => {
  it('quotes every word and makes the last a prefix', () => {
    expect(toSearchQuery('God  so lov')).toBe('"god" "so" "lov"*');
    expect(toSearchQuery('   ')).toBeNull();
    expect(toSearchQuery('NEAR(") OR *')).toBe('"near" "or"*');
  });
});
