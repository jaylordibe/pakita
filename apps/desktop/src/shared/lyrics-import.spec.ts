import { describe, expect, it } from 'vitest';

import {
  importLyrics,
  isMetadataLine,
  longLinesOf,
  normalizeLyrics,
  paginate,
  stanzaBreaksFromHtml,
  parseHeader,
} from './lyrics-import';
import { splitIntoSlides } from './slides';

const four = { linesPerSlide: 4 };

/** The song as the projector would show it: [label, slides] in sung order. */
function sung(text: string, options = four) {
  const result = importLyrics(text, options);
  return result.sequence.map((key) => {
    const section = result.sections.find((candidate) => candidate.key === key)!;
    return [section.label, splitIntoSlides(section.lyrics)] as const;
  });
}

describe('parseHeader', () => {
  it.each([
    ['[Verse 1]', 'verse', 'Verse 1'],
    ['VERSE 1', 'verse', 'Verse 1'],
    ['Verse 1:', 'verse', 'Verse 1'],
    ['verse', 'verse', 'Verse'],
    ['[Chorus]', 'chorus', 'Chorus'],
    ['(Chorus)', 'chorus', 'Chorus'],
    ['Bridge:', 'bridge', 'Bridge'],
    ['Intro', 'intro', 'Intro'],
    ['[Outro]', 'outro', 'Outro'],
    ['Pre-Chorus', 'custom', 'Pre-Chorus'],
    ['[PreChorus]', 'custom', 'Pre-Chorus'],
    ['pre chorus:', 'custom', 'Pre-Chorus'],
    ['Refrain', 'custom', 'Refrain'],
    ['[Tag]', 'custom', 'Tag'],
    ['Instrumental', 'custom', 'Instrumental'],
    ['[V1]', 'verse', 'Verse 1'],
    ['C:', 'chorus', 'Chorus'],
  ])('reads %s', (line, kind, label) => {
    expect(parseHeader(line)).toMatchObject({ kind, label, times: 1 });
  });

  it.each([
    ['Chorus x2', 2],
    ['[Chorus x3]', 3],
    ['Chorus (x2)', 2],
    ['Chorus 2x', 2],
    ['Chorus ×2', 2],
  ])('reads how often %s is sung', (line, times) => {
    expect(parseHeader(line)).toMatchObject({ label: 'Chorus', times });
  });

  it('keeps lyrics written after the colon', () => {
    expect(parseHeader('Chorus: Holy, holy, holy')).toMatchObject({
      label: 'Chorus',
      firstLine: 'Holy, holy, holy',
    });
  });

  it.each([
    'Chorus of angels singing',
    'The bridge between us',
    'Verse by verse we read',
    'C',
    'B 2',
    'V',
    'Intro to Your love',
    '[Holy]',
  ])('does not take the lyric %s for a heading', (line) => {
    expect(parseHeader(line)).toBeNull();
  });
});

describe('normalizeLyrics', () => {
  it('normalises line endings, trims lines and keeps one blank line', () => {
    expect(
      normalizeLyrics('\uFEFF  \r\nLine one  \r\n\r\n\r\n\rLine\u200B two\n\n'),
    ).toEqual(['Line one', '', 'Line two']);
  });

  it('keeps punctuation, case and every script as written', () => {
    const lines = [
      'Dakilang pag-ibig, ‘di ko maunawaan!',
      '주 하나님 지으신 모든 세계',
      'Ô Dieu, que ta grâce est grande…',
      'Святий, святий, святий',
    ];
    expect(normalizeLyrics(lines.join('\n'))).toEqual(lines);
  });

  it('joins a decomposed accent into one letter', () => {
    expect(normalizeLyrics('gra\u0301ce')).toEqual(['gráce']);
  });
});

describe('paginate', () => {
  const lines = ['1', '2', '3', '4', '5', '6'];

  it.each([
    [2, ['1\n2', '3\n4', '5\n6']],
    [3, ['1\n2\n3', '4\n5\n6']],
    [4, ['1\n2\n3\n4', '5\n6']],
    [6, ['1\n2\n3\n4\n5\n6']],
  ])('cuts six lines into slides of %i', (size, slides) => {
    expect(splitIntoSlides(paginate(lines, size))).toEqual(slides);
  });

  it('keeps a short section on one slide', () => {
    expect(paginate(['a', 'b'], 4)).toBe('a\nb');
  });

  it('keeps the breaks the lyrics already have', () => {
    expect(splitIntoSlides(paginate(['a', 'b', '', 'c'], 4))).toEqual([
      'a\nb',
      'c',
    ]);
  });

  it('never makes an empty slide', () => {
    expect(paginate(['', 'a', '', '', 'b', ''], 2)).toBe('a\n\nb');
    expect(paginate([], 4)).toBe('');
  });
});

describe('importLyrics', () => {
  it('reads labelled sections, keeping a long verse as one section', () => {
    const text = [
      '[Verse 1]',
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      '',
      '[Chorus]',
      'Sing',
      'Praise',
    ].join('\n');
    expect(sung(text)).toEqual([
      ['Verse 1', ['One\nTwo\nThree\nFour', 'Five\nSix']],
      ['Chorus', ['Sing\nPraise']],
    ]);
    expect(importLyrics(text, four).sections).toHaveLength(2);
  });

  it('sings a chorus again where an empty heading names it', () => {
    const text = [
      'Verse 1:',
      'First verse',
      '',
      'Chorus:',
      'The chorus',
      '',
      'Verse 2:',
      'Second verse',
      '',
      'Chorus',
      '',
      'Bridge:',
      'The bridge',
      '',
      '[Chorus x2]',
    ].join('\n');
    const result = importLyrics(text, four);
    expect(result.sections.map((section) => section.label)).toEqual([
      'Verse 1',
      'Chorus',
      'Verse 2',
      'Bridge',
    ]);
    expect(sung(text).map(([label]) => label)).toEqual([
      'Verse 1',
      'Chorus',
      'Verse 2',
      'Chorus',
      'Bridge',
      'Chorus',
      'Chorus',
    ]);
  });

  it('links a chorus written out again in full', () => {
    const text =
      '[Chorus]\nSame\nWords\n\n[Verse]\nOther\n\n[Chorus]\nSame\nWords';
    const result = importLyrics(text, four);
    expect(result.sections).toHaveLength(2);
    expect(result.sequence).toEqual(['paste-1', 'paste-2', 'paste-1']);
  });

  it('turns unlabelled stanzas into verses, and a repeated one into the chorus', () => {
    const text =
      'Verse one a\nVerse one b\n\nChorus a\nChorus b\n\nVerse two\n\nChorus a\nChorus b';
    const result = importLyrics(text, four);
    expect(result.sections.map(({ kind, label }) => [kind, label])).toEqual([
      ['verse', 'Verse'],
      ['chorus', 'Chorus'],
      ['verse', 'Verse'],
    ]);
    expect(result.sequence).toEqual([
      'paste-1',
      'paste-2',
      'paste-3',
      'paste-2',
    ]);
  });

  it('keeps lyrics before the first heading', () => {
    expect(
      sung('Opening line\n\n[Chorus]\nSing').map(([label]) => label),
    ).toEqual(['Verse', 'Chorus']);
  });

  it('sets aside credit lines at the start and end, and says so', () => {
    const text = [
      'Words and Music by Someone',
      '',
      'Real lyric',
      '© 2020 Some Publishing',
      'CCLI Song # 12345',
    ].join('\n');
    const result = importLyrics(text, four);
    expect(result.sections.map((section) => section.lyrics)).toEqual([
      'Real lyric',
    ]);
    expect(result.notices).toEqual([
      { reason: 'metadata', text: 'Words and Music by Someone' },
      { reason: 'metadata', text: '© 2020 Some Publishing' },
      { reason: 'metadata', text: 'CCLI Song # 12345' },
    ]);
  });

  it('keeps credit lines as lyrics when asked', () => {
    const result = importLyrics('Real lyric\n© 2020 Someone', {
      ...four,
      keepsMetadata: true,
    });
    expect(result.notices).toEqual([]);
    expect(result.sections[0]!.lyrics).toBe('Real lyric\n© 2020 Someone');
  });

  it("sets aside a lyrics site's suggested songs, up to the next blank line", () => {
    const text = [
      '[Chorus]',
      'One way, Jesus',
      'You might also like',
      'Christ Is Mine Forevermore',
      'Planetshakers',
      '',
      '[Bridge]',
      'You are the Way',
    ].join('\n');
    const result = importLyrics(text, four);
    expect(result.sections.map((section) => section.lyrics)).toEqual([
      'One way, Jesus',
      'You are the Way',
    ]);
    expect(result.notices.map((notice) => notice.text)).toEqual([
      'You might also like',
      'Christ Is Mine Forevermore',
      'Planetshakers',
    ]);
  });

  it('keeps a lyric the suggestions were stuck to, and stops at a heading', () => {
    const text = [
      '[Chorus]',
      'That I could live forYou might also like',
      'Some Other Song',
      '[Bridge]',
      'You are the Way',
    ].join('\n');
    const result = importLyrics(text, four);
    expect(result.sections.map((section) => section.lyrics)).toEqual([
      'That I could live for',
      'You are the Way',
    ]);
    expect(result.notices.map((notice) => notice.text)).toEqual([
      'You might also like',
      'Some Other Song',
    ]);
  });

  it('keeps a lyric that only ends with the same words', () => {
    const result = importLyrics('All the songs you might also like', four);
    expect(result.notices).toEqual([]);
  });

  it('does not set aside a credit-like line in the middle of the song', () => {
    const result = importLyrics('First\n\nWritten by His hand\n\nLast', four);
    expect(result.notices).toEqual([]);
    expect(result.sections).toHaveLength(3);
  });

  it('lists a heading with no lyrics instead of dropping it', () => {
    const result = importLyrics(
      '[Intro]\n\n[Verse]\nWords\n\n[Instrumental]',
      four,
    );
    expect(result.sections.map((section) => section.label)).toEqual(['Verse']);
    expect(result.notices).toEqual([
      { reason: 'no-lyrics', text: 'Intro' },
      { reason: 'no-lyrics', text: 'Instrumental' },
    ]);
  });

  it.each(['', '   ', '\n\n\r\n', '[Chorus]'])(
    'makes no sections from %j',
    (text) => {
      expect(importLyrics(text, four).sections).toEqual([]);
    },
  );

  it('loses no word of the paste', () => {
    const text = '[Verse 1]\nA b c\nd e f\ng\nh\ni\n\n[Chorus]\nj k\nl';
    const words = (value: string) => value.split(/\s+/u).filter(Boolean);
    const lyrics = importLyrics(text, { linesPerSlide: 2 })
      .sections.map((section) => section.lyrics)
      .join('\n');
    expect(words(lyrics)).toEqual(words(text.replace(/\[[^\]]+\]/gu, '')));
  });

  it('gives the same result every time', () => {
    const text = '[Verse]\na\nb\nc\n\n[Chorus]\nd\n\nChorus';
    expect(importLyrics(text, four)).toEqual(importLyrics(text, four));
  });
});

describe('isMetadataLine', () => {
  it.each([
    '© 2020',
    'Copyright 1999',
    'CCLI License 1',
    'Lyrics by A',
    'Words & Music by B',
  ])('recognises %s', (line) => expect(isMetadataLine(line)).toBe(true));
  it.each(['Copy the love', 'Music fills the air'])('leaves %s', (line) =>
    expect(isMetadataLine(line)).toBe(false),
  );
});

describe('longLinesOf', () => {
  it('flags lines that may wrap, counting characters not bytes', () => {
    const long = 'This line is certainly longer than forty characters';
    expect(longLinesOf(`Short\n${long}`)).toEqual([long]);
    expect(longLinesOf('주'.repeat(40))).toEqual([]);
  });
});

describe('stanzaBreaksFromHtml', () => {
  const plain = 'Line one\r\nLine two\r\nLine three\r\nLine four';

  it('adds the stanza breaks the HTML has, keeping the plain words', () => {
    expect(
      stanzaBreaksFromHtml(
        plain,
        '\n\nLine  one\nLine two\n\n\n\nLine three\nLine four\n\n',
      ),
    ).toBe('Line one\nLine two\n\nLine three\nLine four');
  });

  it('keeps a blank line made by two line breaks inside one block', () => {
    expect(
      stanzaBreaksFromHtml(
        plain,
        'Line one\nLine two\n\nLine three\nLine four',
      ),
    ).toBe('Line one\nLine two\n\nLine three\nLine four');
  });

  it('pastes the plain text when it already has a blank line', () => {
    expect(
      stanzaBreaksFromHtml('Line one\n\nLine two', 'Line one\n\nLine two'),
    ).toBeNull();
  });

  it('pastes the plain text when the HTML has no breaks', () => {
    expect(
      stanzaBreaksFromHtml(plain, 'Line one\nLine two\nLine three\nLine four'),
    ).toBeNull();
  });

  it('pastes the plain text when any line differs from the HTML', () => {
    expect(
      stanzaBreaksFromHtml(plain, 'Line one\nLine two\n\nLine 3\nLine four'),
    ).toBeNull();
    expect(
      stanzaBreaksFromHtml(plain, 'Line one\nLine two\n\nLine three'),
    ).toBeNull();
  });

  it('pastes the plain text when every block is a single line', () => {
    expect(
      stanzaBreaksFromHtml(
        plain,
        'Line one\n\nLine two\n\nLine three\n\nLine four',
      ),
    ).toBeNull();
  });
});
