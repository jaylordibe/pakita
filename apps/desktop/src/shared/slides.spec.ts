import { describe, expect, it } from 'vitest';

import { buildSongSlides, type Song, splitIntoSlides } from './slides';

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
