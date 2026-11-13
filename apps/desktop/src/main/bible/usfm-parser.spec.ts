import { describe, expect, it } from 'vitest';

import { parseUsfmBook, UsfmError } from './usfm-parser';

const JOHN = String.raw`\id JHN 43-JHN-web.sfm World English Bible (WEB)
\ide UTF-8
\h John
\toc1 The Good News According to John
\toc2 John
\mt2 The Good News According to
\mt1 John
\c 3
\s1 Jesus and Nicodemus
\p
\v 1 Now there was a man of the Pharisees named Nicodemus, a ruler of the Jews.
\v 16 \wj For God so loved the world,\wj* that he gave his only born\f + \fr 3:16 \ft The phrase “only born” is from the Greek word “μονογενη”.\f* Son,
\q1 that whoever believes in him should not perish,
\q2 but have eternal life.
\v 17 For God didn’t send his Son\x - \xo 3:17 \xt Luke 9:56\x* into the world to judge the world.
\c 4
\p
\v 1-2 Therefore when the Lord knew, \w Jesus|strong="G2424"\w* himself didn’t baptize,
`;

describe('parseUsfmBook', () => {
  it('reads book, name, chapters and verses', () => {
    const book = parseUsfmBook(JOHN);
    expect(book.code).toBe('JHN');
    expect(book.name).toBe('John');
    expect(book.chapters.map((chapter) => chapter.number)).toEqual([3, 4]);
    expect(book.chapters[0]?.verses.map((verse) => verse.number)).toEqual([
      1, 16, 17,
    ]);
  });

  it('keeps poetry in the verse and drops notes, cross references and headings', () => {
    const verses = parseUsfmBook(JOHN).chapters[0]!.verses;
    expect(verses[1]?.text).toBe(
      'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.',
    );
    expect(verses[2]?.text).toBe(
      'For God didn’t send his Son into the world to judge the world.',
    );
    expect(JSON.stringify(verses)).not.toContain('Nicodemus</');
    expect(JSON.stringify(verses)).not.toContain('Jesus and Nicodemus');
  });

  it('keeps a word but not its attributes, and numbers a verse range by its start', () => {
    const verse = parseUsfmBook(JOHN).chapters[1]!.verses[0]!;
    expect(verse.number).toBe(1);
    expect(verse.text).toBe(
      'Therefore when the Lord knew, Jesus himself didn’t baptize,',
    );
  });

  it('drops alternate numbering, milestones and empty markers, and keeps an unknown character marker’s text', () => {
    const book = parseUsfmBook(String.raw`\id GEN
\c 1
\p
\v 1 \vp 1a\vp* In the \ndx beginning\ndx* \qt-s |who="God"\*God\qt-e\* created\ts\* the \zz heavens\zz* and the earth.
\ca 2\ca*
\v 2 \va 3\va*The earth was formless.`);
    expect(book.chapters[0]!.verses).toEqual([
      {
        number: 1,
        text: 'In the beginning God created the heavens and the earth.',
      },
      { number: 2, text: 'The earth was formless.' },
    ]);
  });

  it('refuses a file without a book id or with a verse before any chapter', () => {
    expect(() => parseUsfmBook('\\c 1\n\\v 1 x')).toThrow(UsfmError);
    expect(() => parseUsfmBook('\\id GEN\n\\v 1 x')).toThrow(UsfmError);
  });
});
