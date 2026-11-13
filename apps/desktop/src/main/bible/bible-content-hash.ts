import { createHash } from 'node:crypto';

export interface CanonicalVerse {
  readonly bookCode: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

/**
 * The SHA-256 a published translation is identified by. The contract is
 * stated once, beside the API's implementation
 * (apps/api/src/common/util/bible-content-hash.util.ts); both sides are tested
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
