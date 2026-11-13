import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { truncateAll } from './setup/db';
import {
  addMembership,
  createRegularUser,
  createWorkspaceWithOwner,
  seedRbacCatalog,
  SeededUser,
  SeededWorkspace,
} from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface SyncBody {
  epoch: string;
  latestVersion: number;
  nextCursor: number;
  hasMore: boolean;
  songs: Array<{
    id: string;
    syncVersion: number;
    isDeleted: boolean;
    song: { title: string; sections: unknown[] } | null;
  }>;
}

const songBody = (title: string) => ({
  title,
  sections: [{ key: 'v1', kind: 'verse', label: 'Verse 1', lyrics: 'Words' }],
});

describe('Sync changes (e2e)', () => {
  let app: INestApplication<App>;
  let owner: SeededUser;
  let staff: SeededUser;
  let stranger: SeededUser;
  let workspace: SeededWorkspace;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
    owner = await createRegularUser(app, 'owner@example.com');
    staff = await createRegularUser(app, 'staff@example.com');
    stranger = await createRegularUser(app, 'stranger@example.com');
    workspace = await createWorkspaceWithOwner(app, owner.id, 'main-branch');
    await createWorkspaceWithOwner(app, stranger.id, 'other-branch');
    await addMembership(
      app,
      workspace.id,
      staff.id,
      SeededRoleName.WORKSPACE_STAFF,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const changesUrl = (query = '') =>
    `/api/workspaces/${workspace.id}/sync/changes${query}`;
  const songsUrl = () => `/api/workspaces/${workspace.id}/songs`;

  async function fetchChanges(
    query = '',
    as: SeededUser = staff,
  ): Promise<SyncBody> {
    const response = await request(app.getHttpServer())
      .get(changesUrl(query))
      .set('Authorization', `Bearer ${as.token}`)
      .expect(200);
    return response.body as SyncBody;
  }

  async function createSong(title: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(songsUrl())
      .set('Authorization', `Bearer ${owner.token}`)
      .send(songBody(title))
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it('starts an empty workspace at version 0 with a stable epoch', async () => {
    const first = await fetchChanges();
    const second = await fetchChanges();

    expect(first).toEqual({
      epoch: expect.stringMatching(/^[0-9a-f-]{36}$/),
      latestVersion: 0,
      nextCursor: 0,
      hasMore: false,
      songs: [],
      themes: [],
      playlists: [],
    });
    expect(second.epoch).toBe(first.epoch);
  });

  it('delivers every change after the cursor, oldest first, in pages', async () => {
    const firstId = await createSong('First');
    await createSong('Second');
    await request(app.getHttpServer())
      .patch(`${songsUrl()}/${firstId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'First, edited' })
      .expect(200);

    const pageOne = await fetchChanges('?limit=1');
    expect(pageOne.latestVersion).toBe(3);
    expect(pageOne.hasMore).toBe(true);
    // The first song's latest change is version 3, so it now sorts last.
    expect(pageOne.songs.map((change) => change.syncVersion)).toEqual([2]);
    expect(pageOne.songs[0]?.song?.title).toBe('Second');

    const pageTwo = await fetchChanges(`?limit=1&cursor=${pageOne.nextCursor}`);
    expect(pageTwo.hasMore).toBe(false);
    expect(pageTwo.songs[0]).toMatchObject({
      id: firstId,
      syncVersion: 3,
      isDeleted: false,
      song: { title: 'First, edited' },
    });

    const caughtUp = await fetchChanges(`?cursor=${pageTwo.nextCursor}`);
    expect(caughtUp.songs).toEqual([]);
    expect(caughtUp.nextCursor).toBe(3);
  });

  it('delivers a deletion as a tombstone', async () => {
    const songId = await createSong('Going');
    const before = await fetchChanges();
    await request(app.getHttpServer())
      .delete(`${songsUrl()}/${songId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);

    const after = await fetchChanges(`?cursor=${before.nextCursor}`);
    expect(after.songs).toEqual([
      { id: songId, syncVersion: 2, isDeleted: true, song: null },
    ]);
  });

  it('numbers concurrent edits without gaps or repeats', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        createSong(`Song ${index}`),
      ),
    );
    const changes = await fetchChanges();
    expect(changes.songs.map((change) => change.syncVersion)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(changes.latestVersion).toBe(8);
  });

  it('answers a stranger to the workspace with 404', async () => {
    await createSong('Private');
    await request(app.getHttpServer())
      .get(changesUrl())
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('requires a signed-in caller', async () => {
    await request(app.getHttpServer()).get(changesUrl()).expect(401);
  });

  it('refuses a cursor or page size out of range (400)', async () => {
    for (const query of ['?cursor=-1', '?limit=0', '?limit=101']) {
      await request(app.getHttpServer())
        .get(changesUrl(query))
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(400);
    }
  });
});

describe('Public desktop endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes the server to a desktop without signing in', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/public/server-info')
      .expect(200);
    expect(response.body).toEqual({
      product: 'pakita',
      serverVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      apiLevel: 8,
      minimumDesktopVersion: expect.any(String),
    });
  });
});
