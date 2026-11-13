import { createHash } from 'node:crypto';

export interface CanonicalVerse {
  readonly bookCode: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

/**
 * The SHA-256 a published Bible translation is identified by, and that a
 * desktop recomputes after downloading it.
 *
 * The contract: the verses IN CANONICAL ORDER (book position, then chapter,
 * then verse), each written as `BOOK\tCHAPTER\tVERSE\tTEXT\n` in UTF-8, hashed
 * as one stream; lower-case hex. The desktop implements the same function
 * (apps/desktop/src/main/bible/bible-content-hash.ts); both are tested
 * against the same vector.
 */
export function bibleContentHash(
  versesInOrder: Iterable<CanonicalVerse>,
): string {
  const hash = createHash('sha256');
  for (const verse of versesInOrder) {
    hash.update(
      `${verse.bookCode}\t${verse.chapter}\t${verse.verse}\t${verse.text}\n`,
      'utf8',
    );
  }
  return hash.digest('hex');
}
