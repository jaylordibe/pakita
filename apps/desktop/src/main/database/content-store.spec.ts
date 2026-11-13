import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { MIGRATIONS, migrateDatabase } from './migrations';
import { ContentStore, type SyncPage } from './content-store';

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

describe('ContentStore', () => {
  let store: ContentStore;
  const apply = (
    workspaceId: string,
    epoch: string,
    nextCursor: number,
    songs: SyncPage['songs'],
    extras: Partial<Pick<SyncPage, 'themes' | 'playlists'>> = {},
  ) =>
    store.applySyncPage(workspaceId, {
      epoch,
      nextCursor,
      songs,
      themes: [],
      playlists: [],
      ...extras,
    });

  beforeEach(() => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    store = new ContentStore(database);
  });

  it('applies a page and remembers the cursor and epoch', () => {
    apply('workspace', 'epoch-1', 2, [
      songChange('a', 1, 'Amazing Grace', { artist: 'John Newton' }),
      songChange('b', 2, 'Be Thou My Vision'),
    ]);

    expect(store.getSyncState('workspace')).toEqual({
      epoch: 'epoch-1',
      cursor: 2,
      isResyncing: false,
    });
    expect(
      store.listSongs('workspace', '', false).map((song) => song.title),
    ).toEqual(['Amazing Grace', 'Be Thou My Vision']);
    expect(store.getSong('workspace', 'a')).toMatchObject({
      title: 'Amazing Grace',
    });
  });

  it('ignores a change older than the one already held (a page applied twice)', () => {
    apply('workspace', 'epoch-1', 3, [songChange('a', 3, 'New')]);
    apply('workspace', 'epoch-1', 1, [songChange('a', 1, 'Old')]);

    expect(store.getSong('workspace', 'a')).toMatchObject({ title: 'New' });
  });

  it('removes a deleted song, but not a newer copy of it', () => {
    apply('workspace', 'epoch-1', 1, [songChange('a', 1, 'A')]);
    apply('workspace', 'epoch-1', 2, [
      { id: 'a', syncVersion: 2, isDeleted: true, song: null },
    ]);
    expect(store.getSong('workspace', 'a')).toBeNull();

    apply('workspace', 'epoch-1', 5, [songChange('b', 5, 'B')]);
    apply('workspace', 'epoch-1', 4, [
      { id: 'b', syncVersion: 4, isDeleted: true, song: null },
    ]);
    expect(store.getSong('workspace', 'b')).not.toBeNull();
  });

  it('searches title and artist, case-insensitively, treating % and _ literally', () => {
    apply('workspace', 'epoch-1', 3, [
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

  it('keeps workspaces apart: a song id never overwrites another workspace’s row', () => {
    apply('one', 'epoch-1', 1, [songChange('a', 1, 'A')]);
    apply('two', 'epoch-2', 5, [songChange('a', 5, 'Imposter')]);

    expect(store.getSong('one', 'a')).toMatchObject({ title: 'A' });
    expect(store.getSong('two', 'a')).toBeNull();
  });

  it('resynchronises without ever emptying the library', () => {
    apply('workspace', 'old', 3, [
      songChange('kept', 1, 'Kept, old text'),
      songChange('gone', 2, 'Only in the old history'),
      songChange('other', 3, 'Other'),
    ]);

    store.beginResync('workspace', 'new');
    // Restored history reuses lower version numbers; it still wins.
    apply('workspace', 'new', 1, [songChange('kept', 1, 'Kept, new text')]);
    // Interrupted here: everything is still presentable.
    expect(
      store
        .listSongs('workspace', '', false)
        .map((song) => song.id)
        .sort(),
    ).toEqual(['gone', 'kept', 'other']);
    expect(store.getSyncState('workspace')).toMatchObject({
      epoch: 'new',
      cursor: 1,
      isResyncing: true,
    });

    apply('workspace', 'new', 2, [songChange('other', 2, 'Other')]);
    store.finishResync('workspace');

    expect(
      store
        .listSongs('workspace', '', false)
        .map((song) => song.id)
        .sort(),
    ).toEqual(['kept', 'other']);
    expect(store.getSong('workspace', 'kept')).toMatchObject({
      title: 'Kept, new text',
    });
    expect(store.getSyncState('workspace')?.isResyncing).toBe(false);
  });

  it('applies a page all or nothing', () => {
    expect(() =>
      apply('workspace', 'epoch-1', 2, [
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

  const theme = (
    id: string,
    version: number,
    name: string,
    isDefault = false,
  ) => ({
    id,
    syncVersion: version,
    isDeleted: false,
    theme: { id, name, isDefault, background: 'solid' },
  });
  const playlist = (
    id: string,
    version: number,
    serviceDate: string | null,
  ) => ({
    id,
    syncVersion: version,
    isDeleted: false,
    playlist: { id, name: `Service ${id}`, serviceDate, items: [] },
  });

  it('keeps themes and playlists, finds the default theme, and lists services newest first', () => {
    apply('workspace', 'epoch-1', 4, [], {
      themes: [theme('t1', 1, 'Sunday', true), theme('t2', 2, 'Evening')],
      playlists: [
        playlist('p1', 3, '2026-11-08'),
        playlist('p2', 4, '2026-11-15'),
        playlist('p3', 5, null),
      ],
    });
    expect(store.listThemes('workspace').map((row) => row.name)).toEqual([
      'Evening',
      'Sunday',
    ]);
    expect(store.getDefaultTheme('workspace')).toMatchObject({ id: 't1' });
    expect(store.listPlaylists('workspace').map((row) => row.id)).toEqual([
      'p2',
      'p1',
      'p3',
    ]);

    apply('workspace', 'epoch-1', 6, [], {
      themes: [{ id: 't1', syncVersion: 6, isDeleted: true, theme: null }],
    });
    expect(store.getDefaultTheme('workspace')).toBeNull();
    expect(store.getTheme('workspace', 't1')).toBeNull();
  });

  it('takes the later default while a default switch is half-synchronised', () => {
    apply('workspace', 'epoch-1', 2, [], {
      themes: [theme('old', 1, 'Old', true), theme('new', 2, 'New', true)],
    });
    expect(store.getDefaultTheme('workspace')).toMatchObject({ id: 'new' });
  });

  it('removes themes and playlists the new history lacks when a resync finishes', () => {
    apply('workspace', 'old', 2, [], {
      themes: [theme('kept', 1, 'Kept'), theme('gone', 2, 'Gone')],
      playlists: [playlist('gone-playlist', 3, null)],
    });
    store.beginResync('workspace', 'new');
    apply('workspace', 'new', 1, [], { themes: [theme('kept', 1, 'Kept')] });
    expect(store.listThemes('workspace')).toHaveLength(2);
    store.finishResync('workspace');
    expect(store.listThemes('workspace').map((row) => row.id)).toEqual([
      'kept',
    ]);
    expect(store.listPlaylists('workspace')).toEqual([]);
  });

  it('carries an interrupted resync’s progress across migration 4', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, MIGRATIONS.slice(0, 3));
    database.exec(
      `INSERT INTO resync_seen_songs (workspace_id, song_id) VALUES ('workspace', 'song-1')`,
    );
    database.exec(
      `INSERT INTO workspace_sync_states (workspace_id, epoch, cursor, last_synced_at)
       VALUES ('workspace', 'epoch', 50, 'now')`,
    );
    migrateDatabase(database);
    expect(
      database
        .prepare('SELECT cursor FROM workspace_sync_states')
        .pluck()
        .get(),
    ).toBe(0);
    expect(database.prepare('SELECT * FROM resync_seen').all()).toEqual([
      { workspace_id: 'workspace', kind: 'song', id: 'song-1' },
    ]);
  });
});
