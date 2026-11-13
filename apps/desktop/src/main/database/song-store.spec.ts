import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { SongStore } from './song-store';

const songChange = (
  id: string,
  syncVersion: number,
  title: string,
  extra: { artist?: string | null; isArchived?: boolean } = {},
) => ({
  id,
  syncVersion,
  isDeleted: false,
  song: {
    id,
    title,
    artist: extra.artist ?? null,
    isArchived: extra.isArchived ?? false,
    sections: [],
  },
});

describe('SongStore', () => {
  let store: SongStore;

  beforeEach(() => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    store = new SongStore(database);
  });

  it('applies a page and remembers the cursor and epoch', () => {
    store.applySyncPage('workspace', 'epoch-1', 2, [
      songChange('a', 1, 'Amazing Grace', { artist: 'John Newton' }),
      songChange('b', 2, 'Be Thou My Vision'),
    ]);

    expect(store.getSyncState('workspace')).toEqual({
      epoch: 'epoch-1',
      cursor: 2,
    });
    expect(
      store.listSongs('workspace', '', false).map((song) => song.title),
    ).toEqual(['Amazing Grace', 'Be Thou My Vision']);
    expect(store.getSong('workspace', 'a')).toMatchObject({
      title: 'Amazing Grace',
    });
  });

  it('ignores a change older than the one already held (a page applied twice)', () => {
    store.applySyncPage('workspace', 'epoch-1', 3, [songChange('a', 3, 'New')]);
    store.applySyncPage('workspace', 'epoch-1', 1, [songChange('a', 1, 'Old')]);

    expect(store.getSong('workspace', 'a')).toMatchObject({ title: 'New' });
  });

  it('removes a deleted song, but not a newer copy of it', () => {
    store.applySyncPage('workspace', 'epoch-1', 1, [songChange('a', 1, 'A')]);
    store.applySyncPage('workspace', 'epoch-1', 2, [
      { id: 'a', syncVersion: 2, isDeleted: true, song: null },
    ]);
    expect(store.getSong('workspace', 'a')).toBeNull();

    store.applySyncPage('workspace', 'epoch-1', 5, [songChange('b', 5, 'B')]);
    store.applySyncPage('workspace', 'epoch-1', 4, [
      { id: 'b', syncVersion: 4, isDeleted: true, song: null },
    ]);
    expect(store.getSong('workspace', 'b')).not.toBeNull();
  });

  it('searches title and artist, case-insensitively, treating % and _ literally', () => {
    store.applySyncPage('workspace', 'epoch-1', 3, [
      songChange('a', 1, 'Amazing Grace', { artist: 'John Newton' }),
      songChange('b', 2, '100% Yes'),
      songChange('c', 3, 'Holy', { isArchived: true }),
    ]);

    expect(
      store.listSongs('workspace', 'NEWTON', false).map((song) => song.id),
    ).toEqual(['a']);
    expect(
      store.listSongs('workspace', '100%', false).map((song) => song.id),
    ).toEqual(['b']);
    expect(store.listSongs('workspace', '_', false)).toEqual([]);
    expect(
      store.listSongs('workspace', '', true).map((song) => song.id),
    ).toEqual(['c']);
  });

  it('keeps workspaces apart and resets one without touching another', () => {
    store.applySyncPage('one', 'epoch-1', 1, [songChange('a', 1, 'A')]);
    store.applySyncPage('two', 'epoch-2', 1, [songChange('b', 1, 'B')]);

    expect(store.getSong('two', 'a')).toBeNull();
    store.resetWorkspace('one');
    expect(store.getSyncState('one')).toBeNull();
    expect(store.listSongs('one', '', false)).toEqual([]);
    expect(store.listSongs('two', '', false)).toHaveLength(1);
  });

  it('applies a page all or nothing', () => {
    expect(() =>
      store.applySyncPage('workspace', 'epoch-1', 2, [
        songChange('a', 1, 'A'),
        // NOT NULL title violated mid-page.
        {
          ...songChange('b', 2, 'B'),
          song: {
            ...songChange('b', 2, 'B').song,
            title: null as unknown as string,
          },
        },
      ]),
    ).toThrow();
    expect(store.getSong('workspace', 'a')).toBeNull();
    expect(store.getSyncState('workspace')).toBeNull();
  });
});
