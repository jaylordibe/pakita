import type Database from 'better-sqlite3';

import type { BibleContent } from '../api/api-schemas';

export interface StoredBibleTranslation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly languageCode: string;
  readonly attribution: string;
  readonly contentHash: string;
  readonly verseCount: number;
}

export interface StoredBibleBook {
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly chapterCount: number;
}

export interface StoredBibleVerse {
  readonly bookCode: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

export interface BibleSearchResult extends StoredBibleVerse {
  readonly bookName: string;
}

/** A passage is at most this many verses: a reading, not a book. */
export const MAX_PASSAGE_VERSES = 200;
const MAX_SEARCH_RESULTS = 50;

/**
 * Turns what the operator typed into a safe FTS5 query: every word must
 * appear, and the last may be a prefix ("lov" finds "loved"). Words are
 * quoted, so nothing typed is ever read as FTS syntax.
 */
export function toSearchQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .match(/[\p{L}\p{N}']+/gu)
    ?.slice(0, 12);
  if (!words || words.length === 0) return null;
  return words
    .map((word, index) => {
      const quoted = `"${word.replace(/"/g, '')}"`;
      return index === words.length - 1 ? `${quoted}*` : quoted;
    })
    .join(' ');
}

/**
 * The laptop's Bible translations: each one replaced whole, in one
 * transaction, after its hash was verified, so a translation is either
 * completely present or not at all.
 */
export class BibleStore {
  constructor(private readonly database: Database.Database) {}

  listTranslations(): StoredBibleTranslation[] {
    return this.database
      .prepare(
        `SELECT id, code, name, language_code AS languageCode, attribution,
                content_hash AS contentHash, verse_count AS verseCount
         FROM bible_translations ORDER BY name COLLATE NOCASE`,
      )
      .all() as StoredBibleTranslation[];
  }

  replaceTranslation(content: BibleContent): void {
    const { translation } = content;
    const chapterCounts = new Map<string, number>();
    for (const verse of content.verses) {
      chapterCounts.set(
        verse.bookCode,
        Math.max(chapterCounts.get(verse.bookCode) ?? 0, verse.chapter),
      );
    }
    this.database.transaction(() => {
      this.removeFromSearchIndex(translation.id);
      this.database
        .prepare('DELETE FROM bible_translations WHERE id = ?')
        .run(translation.id);
      this.database
        .prepare(
          `INSERT INTO bible_translations
             (id, code, name, language_code, attribution, content_hash, verse_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          translation.id,
          translation.code,
          translation.name,
          translation.languageCode,
          translation.attribution,
          translation.contentHash,
          content.verses.length,
        );
      const insertBook = this.database.prepare(
        `INSERT INTO bible_books (translation_id, code, name, position, chapter_count)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const book of content.books) {
        const chapterCount = chapterCounts.get(book.code);
        if (chapterCount) {
          insertBook.run(
            translation.id,
            book.code,
            book.name,
            book.position,
            chapterCount,
          );
        }
      }
      const insertVerse = this.database.prepare(
        `INSERT INTO bible_verses (translation_id, book_code, chapter, verse, text)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const verse of content.verses) {
        insertVerse.run(
          translation.id,
          verse.bookCode,
          verse.chapter,
          verse.verse,
          verse.text,
        );
      }
      this.database
        .prepare(
          `INSERT INTO bible_verses_search (rowid, text)
           SELECT rowid, text FROM bible_verses WHERE translation_id = ?`,
        )
        .run(translation.id);
    })();
  }

  removeTranslation(translationId: string): void {
    this.database.transaction(() => {
      this.removeFromSearchIndex(translationId);
      this.database
        .prepare('DELETE FROM bible_translations WHERE id = ?')
        .run(translationId);
    })();
  }

  listBooks(translationId: string): StoredBibleBook[] {
    return this.database
      .prepare(
        `SELECT code, name, position, chapter_count AS chapterCount
         FROM bible_books WHERE translation_id = ? ORDER BY position`,
      )
      .all(translationId) as StoredBibleBook[];
  }

  /** The verses from `start` to `end` (inclusive) within one book. */
  getPassage(
    translationId: string,
    bookCode: string,
    start: { chapter: number; verse: number },
    end: { chapter: number; verse: number },
  ): StoredBibleVerse[] {
    return this.database
      .prepare(
        `SELECT book_code AS bookCode, chapter, verse, text FROM bible_verses
         WHERE translation_id = @translationId AND book_code = @bookCode
           AND (chapter > @startChapter OR (chapter = @startChapter AND verse >= @startVerse))
           AND (chapter < @endChapter OR (chapter = @endChapter AND verse <= @endVerse))
         ORDER BY chapter, verse
         LIMIT ${MAX_PASSAGE_VERSES}`,
      )
      .all({
        translationId,
        bookCode,
        startChapter: start.chapter,
        startVerse: start.verse,
        endChapter: end.chapter,
        endVerse: end.verse,
      }) as StoredBibleVerse[];
  }

  search(translationId: string, input: string): BibleSearchResult[] {
    const query = toSearchQuery(input);
    if (!query) return [];
    return this.database
      .prepare(
        `SELECT verses.book_code AS bookCode, verses.chapter, verses.verse,
                verses.text, books.name AS bookName
         FROM bible_verses_search
         JOIN bible_verses AS verses ON verses.rowid = bible_verses_search.rowid
         JOIN bible_books AS books
           ON books.translation_id = verses.translation_id AND books.code = verses.book_code
         WHERE bible_verses_search MATCH ? AND verses.translation_id = ?
         ORDER BY books.position, verses.chapter, verses.verse
         LIMIT ${MAX_SEARCH_RESULTS}`,
      )
      .all(query, translationId) as BibleSearchResult[];
  }

  // The index mirrors bible_verses (an external-content table): a
  // translation's rows leave the index while their text is still there to
  // say which terms to remove, before the rows themselves are deleted.
  private removeFromSearchIndex(translationId: string): void {
    this.database
      .prepare(
        `INSERT INTO bible_verses_search (bible_verses_search, rowid, text)
         SELECT 'delete', rowid, text FROM bible_verses WHERE translation_id = ?`,
      )
      .run(translationId);
  }
}
