import { describe, expect, it } from 'vitest';

import {
  buildPassageSlides,
  buildSongSlides,
  formatReference,
  type Song,
  splitIntoSlides,
} from './slides';

const song: Song = {
  id: 'song',
  workspaceId: 'workspace',
  title: 'Amazing Grace',
  artist: null,
  isArchived: false,
  syncVersion: 1,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
  sections: [
    {
      id: 'verse',
      kind: 'verse',
      label: 'Verse 1',
      lyrics: 'Line one\nLine two\n\nLine three',
      position: 0,
    },
    {
      id: 'chorus',
      kind: 'chorus',
      label: 'Chorus',
      lyrics: 'Chorus line',
      position: 1,
    },
  ],
  arrangements: [
    {
      id: 'default',
      name: 'Default',
      isDefault: true,
      position: 0,
      sectionIds: ['verse', 'chorus'],
    },
    {
      id: 'choruses',
      name: 'Choruses',
      isDefault: false,
      position: 1,
      sectionIds: ['chorus', 'chorus'],
    },
  ],
};

describe('splitIntoSlides', () => {
  it('starts a new slide at every blank line, ignoring extra blank lines', () => {
    expect(splitIntoSlides('A\nB\n\nC\n \n\n\nD\n')).toEqual([
      'A\nB',
      'C',
      'D',
    ]);
  });

  it('returns no slides for whitespace', () => {
    expect(splitIntoSlides('\n \n')).toEqual([]);
  });
});

describe('buildSongSlides', () => {
  it('uses the default arrangement when none is named', () => {
    expect(buildSongSlides(song)).toEqual([
      { sectionLabel: 'Verse 1', text: 'Line one\nLine two' },
      { sectionLabel: 'Verse 1', text: 'Line three' },
      { sectionLabel: 'Chorus', text: 'Chorus line' },
    ]);
  });

  it('repeats a section as often as the arrangement does', () => {
    expect(buildSongSlides(song, 'choruses')).toEqual([
      { sectionLabel: 'Chorus', text: 'Chorus line' },
      { sectionLabel: 'Chorus', text: 'Chorus line' },
    ]);
  });

  it('returns null for an arrangement or section that is not the song’s', () => {
    expect(buildSongSlides(song, 'missing')).toBeNull();
    expect(
      buildSongSlides({
        ...song,
        arrangements: [
          { ...song.arrangements[0]!, sectionIds: ['verse', 'gone'] },
        ],
      }),
    ).toBeNull();
  });
});

describe('formatReference', () => {
  const verse = (chapter: number, number: number) => ({
    chapter,
    verse: number,
    text: 'x',
  });

  it('names one verse, a range in a chapter, and a range across chapters', () => {
    expect(formatReference('John', [verse(3, 16)])).toBe('John 3:16');
    expect(formatReference('John', [verse(3, 16), verse(3, 18)])).toBe(
      'John 3:16–18',
    );
    expect(formatReference('John', [verse(3, 36), verse(4, 2)])).toBe(
      'John 3:36–4:2',
    );
  });
});

describe('buildPassageSlides', () => {
  it('makes one numbered, captioned slide per verse', () => {
    expect(
      buildPassageSlides(
        { id: 't1', attribution: 'WEB (public domain)' },
        { code: 'JHN', name: 'John' },
        [{ chapter: 3, verse: 16, text: 'For God so loved the world,' }],
      ),
    ).toEqual([
      {
        sectionLabel: 'John 3:16',
        text: '16 For God so loved the world,',
        caption: 'John 3:16 · WEB (public domain)',
        verse: { translationId: 't1', bookCode: 'JHN', chapter: 3, verse: 16 },
      },
    ]);
  });
});
