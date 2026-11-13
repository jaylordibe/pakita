import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SyncStatus } from '../../shared/ipc-contract';
import { ServerUnreachableError } from '../api/api-client';
import type { SyncChanges } from '../api/api-schemas';
import { migrateDatabase } from '../database/migrations';
import { SongStore } from '../database/song-store';
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
    };
  };
  return { server, fetchChanges };
}

describe('SyncEngine', () => {
  let store: SongStore;
  let statuses: SyncStatus[];

  // The engine talks to the worker through DatabaseClient; here the same
  // SongStore runs in-process.
  const database = () => ({
    getSyncState: async (workspaceId: string) =>
      store.getSyncState(workspaceId),
    applySyncPage: async (
      workspaceId: string,
      page: { epoch: string; nextCursor: number; songs: never[] },
    ) =>
      store.applySyncPage(workspaceId, page.epoch, page.nextCursor, page.songs),
    resetWorkspace: async (workspaceId: string) =>
      store.resetWorkspace(workspaceId),
  });

  const engineFor = (
    fetchChanges: ReturnType<typeof fakeServer>['fetchChanges'],
  ) =>
    new SyncEngine(
      {
        fetchChanges,
        database: database() as never,
        now: () => new Date('2026-11-13T10:00:00.000Z'),
      },
      (status) => statuses.push(status),
    );

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    migrateDatabase(sqlite);
    store = new SongStore(sqlite);
    statuses = [];
  });

  it('pulls every page and then only what changed since', async () => {
    const changes = Array.from({ length: 450 }, (_unused, index) =>
      song(`song-${index}`, index + 1, `Song ${index}`),
    );
    const { server, fetchChanges } = fakeServer('epoch-1', changes);
    const engine = engineFor(fetchChanges);

    await expect(engine.syncWorkspace('workspace')).resolves.toMatchObject({
      state: 'idle',
      lastSyncedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(server.requests).toEqual([0, 200, 400]);
    expect(store.listSongs('workspace', '', false)).toHaveLength(450);

    server.changes.push(song('song-0', 451, 'Renamed'));
    server.requests = [];
    await engine.syncWorkspace('workspace');
    expect(server.requests).toEqual([450]);
    expect(store.getSong('workspace', 'song-0')).toMatchObject({
      title: 'Renamed',
    });
  });

  it('discards its copy and starts over when the server history was replaced', async () => {
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
    });
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

  it('joins a synchronisation already running instead of starting another', async () => {
    const { server, fetchChanges } = fakeServer('epoch-1', [song('a', 1, 'A')]);
    const engine = engineFor(fetchChanges);

    await Promise.all([
      engine.syncWorkspace('workspace'),
      engine.syncWorkspace('workspace'),
    ]);
    expect(server.requests).toEqual([0]);
  });
});
