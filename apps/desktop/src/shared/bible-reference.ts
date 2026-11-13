import type { components } from './api/openapi';
import type { BibleBook } from './ipc-contract';

// Finding a book, and reading a typed reference ("jn 3:16-18", "Juan 3:16",
// "1 cor 13", "ps 23"), against the books of the translation on this laptop.
// Pure: the books come from the laptop's own copy, so this works offline.

type BibleBookCode = components['schemas']['BibleBookCode'];

/**
 * Common short forms, keyed by the USFM book code, so they work whatever
 * language a translation names its books in. Written normalised (see
 * `normalise`): lower case, no spaces or dots. A book's own name, its USFM
 * code, and any prefix of either are matched without being listed here.
 */
export const BOOK_ABBREVIATIONS: Partial<
  Record<BibleBookCode, readonly string[]>
> = {
  GEN: ['gn', 'gen'],
  EXO: ['ex', 'exo', 'exod'],
  LEV: ['lv', 'lev'],
  NUM: ['nm', 'nb', 'num'],
  DEU: ['dt', 'deut'],
  JOS: ['josh'],
  JDG: ['jg', 'jdg', 'judg'],
  RUT: ['ru', 'rth'],
  '1SA': ['1sa', '1sam', '1sm'],
  '2SA': ['2sa', '2sam', '2sm'],
  '1KI': ['1kg', '1kgs'],
  '2KI': ['2kg', '2kgs'],
  '1CH': ['1chr', '1chron'],
  '2CH': ['2chr', '2chron'],
  NEH: ['ne', 'neh'],
  EST: ['es', 'esth'],
  JOB: ['jb'],
  PSA: ['ps', 'pss', 'psm', 'psalm'],
  PRO: ['pr', 'prv', 'prov'],
  ECC: ['ec', 'eccl', 'qoh'],
  SNG: ['sg', 'sos', 'song', 'songofsongs', 'songofsolomon', 'canticles'],
  ISA: ['is', 'isa'],
  JER: ['jr', 'jer'],
  LAM: ['la', 'lam'],
  EZK: ['ezek'],
  DAN: ['dn'],
  HOS: ['ho'],
  JOL: ['jl'],
  AMO: ['am'],
  OBA: ['ob', 'obad'],
  JON: ['jnh'],
  MIC: ['mi'],
  NAM: ['na', 'nah'],
  HAB: ['hb'],
  ZEP: ['zeph'],
  HAG: ['hg'],
  ZEC: ['zc', 'zech'],
  MAL: ['ml'],
  MAT: ['mt', 'matt'],
  MRK: ['mk', 'mar'],
  LUK: ['lk'],
  JHN: ['jn', 'joh'],
  ACT: ['ac'],
  ROM: ['ro', 'rm'],
  '1CO': ['1cor'],
  '2CO': ['2cor'],
  GAL: ['ga'],
  EPH: ['ephes'],
  PHP: ['pp', 'phil'],
  '1TH': ['1thes', '1thess'],
  '2TH': ['2thes', '2thess'],
  '1TI': ['1tim'],
  '2TI': ['2tim'],
  TIT: ['ti'],
  PHM: ['phlm', 'philem'],
  JAS: ['jm'],
  '1PE': ['1pet', '1pt'],
  '2PE': ['2pet', '2pt'],
  '1JN': ['1jo', '1jhn'],
  '2JN': ['2jo', '2jhn'],
  '3JN': ['3jo', '3jhn'],
  JUD: ['jude'],
  REV: ['re', 'rv'],
};

/** Lower case, without accents, spaces or punctuation; "I John" → "1john". */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^(iii|ii|i)\s+(?=\p{L})/u, (numeral) =>
      String(numeral.trim().length),
    )
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** How well a book matches what was typed; lower is better, null is none. */
function rank(book: BibleBook, typed: string): number | null {
  const name = normalise(book.name);
  const code = book.code.toLowerCase();
  const abbreviations =
    BOOK_ABBREVIATIONS[book.code as BibleBookCode] ?? ([] as const);
  if (name === typed || code === typed || abbreviations.includes(typed)) {
    return 0;
  }
  if (name.startsWith(typed)) return 1;
  // A later word of the name: "salmo" finds "Mga Salmo".
  const words = book.name.split(/\s+/).map(normalise).slice(1);
  if (words.some((word) => word.startsWith(typed))) return 2;
  if (abbreviations.some((abbreviation) => abbreviation.startsWith(typed))) {
    return 3;
  }
  if (code.startsWith(typed)) return 4;
  return null;
}

/**
 * The books matching what was typed, best first; books that match equally
 * well keep the translation's order. Nothing typed matches every book.
 */
export function findBooks<Book extends BibleBook>(
  books: readonly Book[],
  typed: string,
): Book[] {
  const wanted = normalise(typed);
  if (!wanted) return [...books];
  return books
    .map((book, index) => ({ book, index, score: rank(book, wanted) }))
    .filter(
      (candidate): candidate is typeof candidate & { score: number } =>
        candidate.score !== null,
    )
    .sort(
      (first, second) =>
        first.score - second.score || first.index - second.index,
    )
    .map((candidate) => candidate.book);
}

export interface BibleReference<Book extends BibleBook = BibleBook> {
  readonly book: Book;
  readonly chapter: number;
  /** Absent for a whole chapter. */
  readonly startVerse?: number;
  /** Absent for a single verse. */
  readonly endVerse?: number;
}

export type ReferenceReading<Book extends BibleBook = BibleBook> =
  | { readonly isFound: true; readonly reference: BibleReference<Book> }
  | { readonly isFound: false; readonly problem: string };

/** Book, then chapter, then `:` or `.` and a verse, then `-` and a last verse. */
const REFERENCE =
  /^(?<book>.*?\D)\s*(?<chapter>\d+)(?:\s*[:.]\s*(?<start>\d+)(?:\s*[-–—]\s*(?<end>\d+))?)?$/u;

/**
 * Reads a typed reference against the translation's books. A book alone
 * means its first chapter. A book name typed only in part must point to one
 * book ("jo 3" could be Job, Joel, John or Jonah, so it asks for more).
 */
export function readReference<Book extends BibleBook>(
  books: readonly Book[],
  input: string,
): ReferenceReading<Book> {
  const text = input.trim();
  if (!text) return { isFound: false, problem: 'Type a reference.' };
  const parts = REFERENCE.exec(text)?.groups;
  const bookText = (parts?.['book'] ?? text).trim();

  const wanted = normalise(bookText);
  const scored = books
    .map((book) => ({ book, score: rank(book, wanted) }))
    .filter(
      (candidate): candidate is { book: Book; score: number } =>
        candidate.score !== null,
    );
  const best = Math.min(...scored.map((candidate) => candidate.score));
  const matches = scored
    .filter((candidate) => candidate.score === best)
    .map((candidate) => candidate.book);
  const [book] = matches;
  if (!wanted || !book) {
    return { isFound: false, problem: `No book called “${bookText}”.` };
  }
  if (matches.length > 1) {
    const names = matches.slice(0, 4).map((match) => match.name);
    const more = matches.length > 4 ? '…' : '';
    return {
      isFound: false,
      problem: `“${bookText}” could be ${names.join(', ')}${more}. Type more of the name.`,
    };
  }

  const chapter = parts ? Number(parts['chapter']) : 1;
  if (chapter < 1 || chapter > book.chapterCount) {
    return {
      isFound: false,
      problem: `${book.name} has ${book.chapterCount} chapter${book.chapterCount === 1 ? '' : 's'}.`,
    };
  }
  const startVerse = parts?.['start'] ? Number(parts['start']) : undefined;
  const endVerse = parts?.['end'] ? Number(parts['end']) : undefined;
  if (startVerse !== undefined && startVerse < 1) {
    return { isFound: false, problem: 'Verses start at 1.' };
  }
  if (
    startVerse !== undefined &&
    endVerse !== undefined &&
    endVerse < startVerse
  ) {
    return {
      isFound: false,
      problem: `The last verse comes before the first (${startVerse}–${endVerse}).`,
    };
  }
  return {
    isFound: true,
    reference: {
      book,
      chapter,
      ...(startVerse === undefined ? {} : { startVerse }),
      ...(endVerse === undefined || endVerse === startVerse
        ? {}
        : { endVerse }),
    },
  };
}
