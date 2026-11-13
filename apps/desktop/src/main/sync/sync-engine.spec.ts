import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SyncStatus } from '../../shared/ipc-contract';
import { ServerUnreachableError } from '../api/api-client';
import type { SyncChanges } from '../api/api-schemas';
import { migrateDatabase } from '../database/migrations';
import { ContentStore, type SyncPage } from '../database/content-store';
import { SyncEngine } from './sync-engine';

const song = (id: string, syncVersion: number, title: string) => ({
  id,
  syncVersion,
  isDeleted: false,
  song: {
    id,
    workspaceId: 'workspace',
    title,
    artist: null,
    isArchived: false,
    syncVersion,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    sections: [],
    arrangements: [],
  },
});

/** A fake server holding a list of changes, paged like the real feed. */
function fakeServer(epoch: string, changes: ReturnType<typeof song>[]) {
  const server = { epoch, changes, requests: [] as number[], isDown: false };
  const fetchChanges = async (
    _workspaceId: string,
    cursor: number,
    limit: number,
  ): Promise<SyncChanges> => {
    server.requests.push(cursor);
    if (server.isDown) throw new ServerUnreachableError(new Error('down'));
    const after = server.changes.filter(
      (change) => change.syncVersion > cursor,
    );
    const page = after.slice(0, limit);
    const latestVersion = Math.max(
      0,
      ...server.changes.map((change) => change.syncVersion),
    );
    return {
      epoch: server.epoch,
      latestVersion,
      nextCursor: page.at(-1)?.syncVersion ?? cursor,
      hasMore: after.length > limit,
      songs: page,
      themes: [],
      playlists: [],
    };
  };
  return { server, fetchChanges };
}

describe('SyncEngine', () => {
  let store: ContentStore;
  let statuses: SyncStatus[];

  // The engine talks to the worker through DatabaseClient; here the same
  // ContentStore runs in-process.
  const database = () => ({
    getSyncState: async (workspaceId: string) =>
      store.getSyncState(workspaceId),
    applySyncPage: async (workspaceId: string, page: SyncPage) =>
      store.applySyncPage(workspaceId, page),
    beginResync: async (workspaceId: string, epoch: string) =>
      store.beginResync(workspaceId, epoch),
    finishResync: async (workspaceId: string) =>
      store.finishResync(workspaceId),
  });

  const engineFor = (
    fetchChanges: ReturnType<typeof fakeServer>['fetchChanges'],
    syncBibleTranslations: () => Promise<void> = async () => undefined,
  ) =>
    new SyncEngine(
      {
        fetchChanges,
        database: database() as never,
        syncBibleTranslations,
        now: () => new Date('2026-11-13T10:00:00.000Z'),
      },
      (status) => statuses.push(status),
    );

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    migrateDatabase(sqlite);
    store = new ContentStore(sqlite);
    statuses = [];
  });

  it('records the songs as synchronised when only the Bible fails', async () => {
    const { fetchChanges } = fakeServer('epoch-1', [song('song-1', 1, 'One')]);
    const engine = engineFor(fetchChanges, async () => {
      throw new Error('checksum mismatch');
    });
    await expect(engine.syncWorkspace('workspace')).resolves.toEqual({
      state: 'idle',
      lastSyncedAt: '2026-11-13T10:00:00.000Z',
      message: 'Bible translations were not updated: checksum mismatch',
    });
    expect(store.listSongs('workspace', '', false)).toHaveLength(1);
  });

  it('pulls every page and then only what changed since', async () => {
    const changes = Array.from({ length: 120 }, (_unused, index) =>
      song(`song-${index}`, index + 1, `Song ${index}`),
    );
    const { server, fetchChanges } = fakeServer('epoch-1', changes);
    const engine = engineFor(fetchChanges);

    await expect(engine.syncWorkspace('workspace')).resolves.toMatchObject({
      state: 'idle',
      lastSyncedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(server.requests).toEqual([0, 50, 100]);
    expect(store.listSongs('workspace', '', false)).toHaveLength(120);

    server.changes.push(song('song-0', 121, 'Renamed'));
    server.requests = [];
    await engine.syncWorkspace('workspace');
    expect(server.requests).toEqual([120]);
    expect(store.getSong('workspace', 'song-0')).toMatchObject({
      title: 'Renamed',
    });
  });

  it('rebuilds its copy when the server history was replaced', async () => {
    const { server, fetchChanges } = fakeServer('epoch-1', [
      song('a', 1, 'A'),
      song('b', 2, 'B'),
    ]);
    const engine = engineFor(fetchChanges);
    await engine.syncWorkspace('workspace');

    // A backup from before song B was restored: new epoch, older history.
    server.epoch = 'epoch-2';
    server.changes = [song('a', 1, 'A')];
    server.requests = [];
    await engine.syncWorkspace('workspace');

    expect(server.requests).toEqual([2, 0]);
    expect(store.getSong('workspace', 'b')).toBeNull();
    expect(store.getSyncState('workspace')).toEqual({
      epoch: 'epoch-2',
      cursor: 1,
      isResyncing: false,
    });
  });

  it('keeps the old copy presentable when a resync is interrupted, then resumes it', async () => {
    const { server, fetchChanges } = fakeServer('epoch-1', [
      song('a', 1, 'A'),
      song('b', 2, 'B'),
    ]);
    const engine = engineFor(fetchChanges);
    await engine.syncWorkspace('workspace');

    server.epoch = 'epoch-2';
    server.changes = Array.from({ length: 60 }, (_unused, index) =>
      song(`new-${index}`, index + 1, `New ${index}`),
    );
    // The connection drops after the first page of the new history.
    let calls = 0;
    const flaky: typeof fetchChanges = async (...callArguments) => {
      calls += 1;
      if (calls === 3) throw new ServerUnreachableError(new Error('gone'));
      return fetchChanges(...callArguments);
    };
    await expect(
      engineFor(flaky).syncWorkspace('workspace'),
    ).resolves.toMatchObject({
      state: 'offline',
    });
    // Nothing presentable was lost: old songs and the first new page.
    expect(store.getSong('workspace', 'a')).not.toBeNull();
    expect(store.getSong('workspace', 'b')).not.toBeNull();
    expect(store.listSongs('workspace', '', false)).toHaveLength(52);

    // Online again: the resync resumes and completes.
    await engineFor(fetchChanges).syncWorkspace('workspace');
    expect(store.listSongs('workspace', '', false)).toHaveLength(60);
    expect(store.getSong('workspace', 'a')).toBeNull();
    expect(store.getSyncState('workspace')?.isResyncing).toBe(false);
  });

  it('refuses a page that carries another workspace’s songs', async () => {
    const foreign = song('x', 1, 'X');
    foreign.song.workspaceId = 'someone-else';
    const { fetchChanges } = fakeServer('epoch-1', [foreign]);
    await expect(
      engineFor(fetchChanges).syncWorkspace('workspace'),
    ).resolves.toMatchObject({
      state: 'error',
    });
    expect(store.getSong('workspace', 'x')).toBeNull();
  });

  it('reports offline without touching the laptop’s copy', async () => {
    const { server, fetchChanges } = fakeServer('epoch-1', [song('a', 1, 'A')]);
    const engine = engineFor(fetchChanges);
    await engine.syncWorkspace('workspace');

    server.isDown = true;
    await expect(engine.syncWorkspace('workspace')).resolves.toMatchObject({
      state: 'offline',
      lastSyncedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(store.getSong('workspace', 'a')).not.toBeNull();
  });

  it('joins a running synchronisation, then runs once more for what changed meanwhile', async () => {
    const { server, fetchChanges } = fakeServer('epoch-1', [song('a', 1, 'A')]);
    const engine = engineFor(fetchChanges);

    const first = engine.syncWorkspace('workspace');
    server.changes.push(song('b', 2, 'B'));
    const second = engine.syncWorkspace('workspace');
    expect(second).toBe(first);
    await Promise.all([first, second]);

    // A second request, from wherever the first run got to.
    expect(server.requests).toHaveLength(2);
    expect(store.getSong('workspace', 'b')).not.toBeNull();
  });

  it('rebuilds only between runs, so a page in flight never defeats the sweep', async () => {
    const { server, fetchChanges } = fakeServer(
      'epoch-1',
      Array.from({ length: 120 }, (_unused, index) =>
        song(`song-${index}`, index + 1, `Song ${index}`),
      ),
    );
    const engine = engineFor(fetchChanges);
    await engine.syncWorkspace('workspace');

    // A stray row the server's history does not contain.
    store.applySyncPage('workspace', {
      epoch: 'epoch-1',
      nextCursor: 120,
      songs: [song('stray', 500, 'Stray')],
      themes: [],
      playlists: [],
    });
    // A sync is paging when the rebuild is asked for.
    const running = engine.syncWorkspace('workspace');
    const rebuilt = engine.rebuildWorkspace('workspace');
    await running;
    await expect(rebuilt).resolves.toMatchObject({ state: 'idle' });

    const titles = store
      .listSongs('workspace', '', false)
      .map((row) => row.title);
    expect(titles).toHaveLength(120);
    expect(titles).not.toContain('Stray');
    expect(server.requests.at(-3)).toBe(0);
  });
});
