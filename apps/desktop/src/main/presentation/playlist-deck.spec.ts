import { describe, expect, it } from 'vitest';

import type { Playlist, Song } from '../../shared/ipc-contract';
import {
  buildDeck,
  type PlaylistSources,
  resolvePlaylist,
} from './playlist-deck';

const song: Song = {
  id: 'song-1',
  workspaceId: 'workspace',
  title: 'Amazing Grace',
  artist: null,
  isArchived: false,
  syncVersion: 1,
  createdAt: '',
  updatedAt: '',
  sections: [
    {
      id: 'v',
      kind: 'verse',
      label: 'Verse',
      lyrics: 'One\n\nTwo',
      position: 0,
    },
    { id: 'c', kind: 'chorus', label: 'Chorus', lyrics: 'Three', position: 1 },
  ],
  arrangements: [
    {
      id: 'a1',
      name: 'Default',
      isDefault: true,
      position: 0,
      sectionIds: ['v', 'c'],
    },
    {
      id: 'a2',
      name: 'Short',
      isDefault: false,
      position: 1,
      sectionIds: ['c'],
    },
  ],
};

const item = (overrides: Partial<Playlist['items'][number]>) => ({
  id: 'item',
  position: 0,
  kind: 'song' as const,
  songId: null,
  arrangementName: null,
  bibleTranslationId: null,
  bookCode: null,
  startChapter: null,
  startVerse: null,
  endChapter: null,
  endVerse: null,
  ...overrides,
});

const playlist = (items: Playlist['items']): Playlist => ({
  id: 'playlist',
  workspaceId: 'workspace',
  name: 'Sunday',
  serviceDate: null,
  themeId: null,
  syncVersion: 1,
  createdAt: '',
  updatedAt: '',
  items,
});

const sources: PlaylistSources = {
  song: async (id) => (id === song.id ? song : null),
  passage: async (passage) =>
    passage.bibleTranslationId === 'web'
      ? {
          reference: 'John 3:16',
          translationCode: 'WEB',
          slides: [{ sectionLabel: 'John 3:16', text: '16 For God so loved' }],
        }
      : null,
};

const passageItem = (translationId: string) =>
  item({
    kind: 'passage',
    bibleTranslationId: translationId,
    bookCode: 'JHN',
    startChapter: 3,
    startVerse: 16,
    endChapter: 3,
    endVerse: 16,
  });

describe('resolvePlaylist', () => {
  it('resolves songs in their named arrangement and passages, ready to present', async () => {
    const entries = await resolvePlaylist(
      playlist([
        item({ songId: 'song-1', arrangementName: 'Short' }),
        passageItem('web'),
      ]),
      sources,
    );
    expect(
      entries.map(({ title, detail, isReady, slideCount }) => ({
        title,
        detail,
        isReady,
        slideCount,
      })),
    ).toEqual([
      { title: 'Amazing Grace', detail: 'Short', isReady: true, slideCount: 1 },
      { title: 'John 3:16', detail: 'WEB', isReady: true, slideCount: 1 },
    ]);
    expect(entries[0]!.slides[0]!.sectionLabel).toBe('Amazing Grace · Chorus');
    expect(entries[1]!.input).toMatchObject({
      kind: 'passage',
      bookCode: 'JHN',
    });
  });

  it('marks what the laptop lacks, and falls back from a renamed arrangement', async () => {
    const entries = await resolvePlaylist(
      playlist([
        item({ songId: 'missing' }),
        passageItem('kjv'),
        item({ songId: 'song-1', arrangementName: 'Gone' }),
      ]),
      sources,
    );
    expect(entries.map((entry) => entry.isReady)).toEqual([false, false, true]);
    expect(entries[0]!.note).toMatch(/not on this laptop/);
    expect(entries[1]!.title).toBe('JHN 3:16–3:16');
    expect(entries[2]).toMatchObject({ slideCount: 3, detail: null });
    expect(entries[2]!.note).toMatch(/no longer exists/);
  });
});

describe('buildDeck', () => {
  it('joins the ready entries and records where each starts', async () => {
    const entries = await resolvePlaylist(
      playlist([
        item({ songId: 'song-1' }),
        item({ songId: 'missing' }),
        passageItem('web'),
      ]),
      sources,
    );
    const deck = buildDeck(entries);
    expect(deck.slides).toHaveLength(4);
    expect(deck.startIndexes).toEqual([0, null, 3]);
  });
});
