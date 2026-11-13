import { describe, expect, it } from 'vitest';

import { bibleBookCodeValues } from './api/enums';
import {
  BOOK_ABBREVIATIONS,
  findBooks,
  normalise,
  readReference,
} from './bible-reference';

const book = (code: string, name: string, chapterCount: number) => ({
  code,
  name,
  chapterCount,
});

const ENGLISH = [
  book('GEN', 'Genesis', 50),
  book('JOB', 'Job', 42),
  book('PSA', 'Psalms', 150),
  book('JOL', 'Joel', 3),
  book('JON', 'Jonah', 4),
  book('MAT', 'Matthew', 28),
  book('JHN', 'John', 21),
  book('1CO', '1 Corinthians', 16),
  book('1JN', '1 John', 5),
  book('2JN', '2 John', 1),
];

// Book names as a Cebuano translation gives them.
const CEBUANO = [
  book('PSA', 'Mga Salmo', 150),
  book('JHN', 'Juan', 21),
  book('1JN', '1 Juan', 5),
];

const found = (input: string, books = ENGLISH) => {
  const reading = readReference(books, input);
  if (!reading.isFound) throw new Error(reading.problem);
  const { book: match, ...rest } = reading.reference;
  return { code: match.code, ...rest };
};
const problem = (input: string, books = ENGLISH) => {
  const reading = readReference(books, input);
  return reading.isFound ? null : reading.problem;
};

describe('normalise', () => {
  it('drops case, accents, spaces and dots, and reads a Roman numeral', () => {
    expect(normalise(' 1 Cor. ')).toBe('1cor');
    expect(normalise('Éxodo')).toBe('exodo');
    expect(normalise('II Kings')).toBe('2kings');
    expect(normalise('I John')).toBe('1john');
  });
});

describe('BOOK_ABBREVIATIONS', () => {
  it('names only USFM books, written normalised', () => {
    for (const [code, abbreviations] of Object.entries(BOOK_ABBREVIATIONS)) {
      expect(bibleBookCodeValues).toContain(code);
      for (const abbreviation of abbreviations) {
        expect(normalise(abbreviation)).toBe(abbreviation);
      }
    }
  });

  it('gives no short form to two books, nor one that is another book’s code', () => {
    const owner = new Map<string, string>();
    for (const code of bibleBookCodeValues) owner.set(code.toLowerCase(), code);
    for (const [code, abbreviations] of Object.entries(BOOK_ABBREVIATIONS)) {
      for (const abbreviation of abbreviations) {
        const existing = owner.get(abbreviation);
        expect({ abbreviation, owner: existing ?? code }).toEqual({
          abbreviation,
          owner: code,
        });
        owner.set(abbreviation, code);
      }
    }
  });
});

describe('findBooks', () => {
  it('lists every book when nothing is typed', () => {
    expect(findBooks(ENGLISH, '  ')).toHaveLength(ENGLISH.length);
  });

  it('puts an exact short form first, then names that start with the text', () => {
    expect(findBooks(ENGLISH, 'jo').map((match) => match.code)).toEqual([
      'JOB',
      'JOL',
      'JON',
      'JHN',
      '1JN',
      '2JN',
    ]);
    expect(findBooks(ENGLISH, 'jn')[0]?.code).toBe('JHN');
    expect(findBooks(ENGLISH, 'ps')[0]?.code).toBe('PSA');
  });

  it('finds a later word of a name, and a short form in any language', () => {
    expect(findBooks(CEBUANO, 'salmo').map((match) => match.code)).toEqual([
      'PSA',
    ]);
    expect(findBooks(CEBUANO, 'jn')[0]?.code).toBe('JHN');
  });
});

describe('readReference', () => {
  it('reads a book, chapter, verse and range', () => {
    expect(found('jn 3:16-18')).toEqual({
      code: 'JHN',
      chapter: 3,
      startVerse: 16,
      endVerse: 18,
    });
    expect(found('John 3:16')).toEqual({
      code: 'JHN',
      chapter: 3,
      startVerse: 16,
    });
    expect(found('Ps. 23')).toEqual({ code: 'PSA', chapter: 23 });
    expect(found('1 cor 13:4–7')).toEqual({
      code: '1CO',
      chapter: 13,
      startVerse: 4,
      endVerse: 7,
    });
    expect(found('1jn3.1')).toEqual({ code: '1JN', chapter: 3, startVerse: 1 });
    expect(found('I John 1')).toEqual({ code: '1JN', chapter: 1 });
  });

  it('opens a book named alone at its first chapter', () => {
    expect(found('matthew')).toEqual({ code: 'MAT', chapter: 1 });
    expect(found('2 jn')).toEqual({ code: '2JN', chapter: 1 });
  });

  it('reads book names in the translation’s language', () => {
    expect(found('Juan 3:16', CEBUANO)).toEqual({
      code: 'JHN',
      chapter: 3,
      startVerse: 16,
    });
    expect(found('salmo 23', CEBUANO)).toEqual({ code: 'PSA', chapter: 23 });
  });

  it('treats a single-verse range as one verse', () => {
    expect(found('jn 3:16-16')).toEqual({
      code: 'JHN',
      chapter: 3,
      startVerse: 16,
    });
  });

  it('says what is wrong', () => {
    expect(problem('')).toBe('Type a reference.');
    expect(problem('hezekiah 1')).toBe('No book called “hezekiah”.');
    expect(problem('jo 3')).toBe(
      '“jo” could be Job, Joel, Jonah, John. Type more of the name.',
    );
    expect(problem('jn 22')).toBe('John has 21 chapters.');
    expect(problem('2 jn 2')).toBe('2 John has 1 chapter.');
    expect(problem('jn 3:18-16')).toBe(
      'The last verse comes before the first (18–16).',
    );
    expect(problem('jn 3:0')).toBe('Verses start at 1.');
  });
});
