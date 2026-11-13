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

interface ErrorBody {
  errorCode: string;
}
interface SongBody {
  id: string;
  workspaceId: string;
  title: string;
  artist: string | null;
  isArchived: boolean;
  syncVersion: number;
  sections: Array<{ id: string; kind: string; label: string; lyrics: string }>;
  arrangements: Array<{
    name: string;
    isDefault: boolean;
    sectionIds: string[];
  }>;
}
interface PageBody<T> {
  data: T[];
  meta: { total: number };
}

const AMAZING_GRACE = {
  title: 'Amazing Grace',
  artist: 'John Newton',
  sections: [
    {
      key: 'v1',
      kind: 'verse',
      label: 'Verse 1',
      lyrics:
        'Amazing grace, how sweet the sound\r\nThat saved a wretch like me',
    },
    {
      key: 'c',
      kind: 'chorus',
      label: 'Chorus',
      lyrics: 'My chains are gone\n\nI have been set free',
    },
  ],
};

describe('Songs (e2e)', () => {
  let app: INestApplication<App>;
  let owner: SeededUser;
  let staff: SeededUser;
  let stranger: SeededUser;
  let workspace: SeededWorkspace;
  let otherWorkspace: SeededWorkspace;

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
    otherWorkspace = await createWorkspaceWithOwner(
      app,
      stranger.id,
      'other-branch',
    );
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

  const songsUrl = (workspaceId = workspace.id) =>
    `/api/workspaces/${workspaceId}/songs`;

  async function createSong(
    body: object = AMAZING_GRACE,
    as: SeededUser = owner,
  ): Promise<SongBody> {
    const response = await request(app.getHttpServer())
      .post(songsUrl())
      .set('Authorization', `Bearer ${as.token}`)
      .send(body)
      .expect(201);
    return response.body as SongBody;
  }

  describe('create', () => {
    it('stores the song with a default arrangement of every section, in order', async () => {
      const song = await createSong();

      expect(song).toMatchObject({
        workspaceId: workspace.id,
        title: 'Amazing Grace',
        artist: 'John Newton',
        isArchived: false,
        syncVersion: 1,
      });
      expect(song.sections.map((section) => section.label)).toEqual([
        'Verse 1',
        'Chorus',
      ]);
      // Line endings normalised: slides split the same on every system.
      expect(song.sections[0]?.lyrics).toBe(
        'Amazing grace, how sweet the sound\nThat saved a wretch like me',
      );
      expect(song.arrangements).toEqual([
        {
          id: expect.any(String),
          name: 'Default',
          isDefault: true,
          position: 0,
          sectionIds: song.sections.map((section) => section.id),
        },
      ]);
      expect(song).not.toHaveProperty('createdBy');
      expect(song).not.toHaveProperty('deletedAt');
    });

    it('stores arrangements that repeat a section without copying it', async () => {
      const song = await createSong({
        ...AMAZING_GRACE,
        arrangements: [
          { name: 'Short', isDefault: false, sectionKeys: ['v1'] },
          { name: 'Full', isDefault: true, sectionKeys: ['v1', 'c', 'c'] },
        ],
      });
      const [verse, chorus] = song.sections;

      expect(song.sections).toHaveLength(2);
      expect(song.arrangements).toMatchObject([
        { name: 'Short', isDefault: false, sectionIds: [verse?.id] },
        {
          name: 'Full',
          isDefault: true,
          sectionIds: [verse?.id, chorus?.id, chorus?.id],
        },
      ]);
    });

    it.each([
      [
        'an arrangement naming an unknown section',
        {
          arrangements: [
            { name: 'Full', isDefault: true, sectionKeys: ['v1', 'v9'] },
          ],
        },
      ],
      [
        'no default arrangement',
        {
          arrangements: [
            { name: 'Full', isDefault: false, sectionKeys: ['v1'] },
          ],
        },
      ],
      [
        'two default arrangements',
        {
          arrangements: [
            { name: 'A', isDefault: true, sectionKeys: ['v1'] },
            { name: 'B', isDefault: true, sectionKeys: ['c'] },
          ],
        },
      ],
      [
        'a repeated section key',
        {
          sections: [
            AMAZING_GRACE.sections[0],
            { ...AMAZING_GRACE.sections[1], key: 'v1' },
          ],
        },
      ],
      ['no sections', { sections: [] }],
      [
        'an unknown section kind',
        {
          sections: [{ ...AMAZING_GRACE.sections[0], kind: 'interlude' }],
        },
      ],
      ['an empty title', { title: '   ' }],
      ['an unexpected field', { tempo: 120 }],
    ])('refuses %s (400)', async (_case, change) => {
      const response = await request(app.getHttpServer())
        .post(songsUrl())
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ ...AMAZING_GRACE, ...change })
        .expect(400);
      expect((response.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
    });
  });

  describe('read', () => {
    it('lists the active library, searchable, with archived songs on request', async () => {
      await createSong();
      const archived = await createSong({
        ...AMAZING_GRACE,
        title: 'Old Hymn',
      });
      await request(app.getHttpServer())
        .patch(`${songsUrl()}/${archived.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ isArchived: true })
        .expect(200);

      const active = await request(app.getHttpServer())
        .get(songsUrl())
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      expect(
        (active.body as PageBody<SongBody>).data.map((song) => song.title),
      ).toEqual(['Amazing Grace']);

      const archivedPage = await request(app.getHttpServer())
        .get(`${songsUrl()}?isArchived=true`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      expect(
        (archivedPage.body as PageBody<SongBody>).data.map(
          (song) => song.title,
        ),
      ).toEqual(['Old Hymn']);

      const search = await request(app.getHttpServer())
        .get(`${songsUrl()}?search=newton`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      expect((search.body as PageBody<SongBody>).meta.total).toBe(1);
    });
  });

  describe('workspace isolation', () => {
    it('answers a stranger to the workspace with 404 everywhere a song is read', async () => {
      const song = await createSong();

      for (const url of [songsUrl(), `${songsUrl()}/${song.id}`]) {
        const response = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${stranger.token}`)
          .expect(404);
        expect((response.body as ErrorBody).errorCode).toBe(
          'RESOURCE_NOT_FOUND',
        );
      }
      await request(app.getHttpServer())
        .patch(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ title: 'Hijacked' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });

    it('does not reach a song through another workspace the caller owns', async () => {
      const song = await createSong();

      // The stranger owns otherWorkspace; the song lives in workspace.
      await request(app.getHttpServer())
        .get(`${songsUrl(otherWorkspace.id)}/${song.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${songsUrl(otherWorkspace.id)}/${song.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ title: 'Hijacked' })
        .expect(404);

      const page = await request(app.getHttpServer())
        .get(songsUrl(otherWorkspace.id))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(200);
      expect((page.body as PageBody<SongBody>).data).toEqual([]);
    });

    it('refuses a stranger adding a song to the workspace', async () => {
      const response = await request(app.getHttpServer())
        .post(songsUrl())
        .set('Authorization', `Bearer ${stranger.token}`)
        .send(AMAZING_GRACE)
        .expect(403);
      expect((response.body as ErrorBody).errorCode).toBe('PERMISSION_DENIED');
    });
  });

  describe('staff (reads and presents, edits nothing)', () => {
    it('can read but not create, edit or delete (403: the song is visible)', async () => {
      const song = await createSong();

      await request(app.getHttpServer())
        .get(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(songsUrl())
        .set('Authorization', `Bearer ${staff.token}`)
        .send(AMAZING_GRACE)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ title: 'Edited' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(403);
    });

    it('lets a manager edit the library', async () => {
      const manager = await createRegularUser(app, 'manager@example.com');
      await addMembership(
        app,
        workspace.id,
        manager.id,
        SeededRoleName.WORKSPACE_MANAGER,
      );
      const song = await createSong(AMAZING_GRACE, manager);
      await request(app.getHttpServer())
        .patch(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ title: 'Edited' })
        .expect(200);
    });
  });

  describe('update and delete', () => {
    it('replaces the content as a whole and bumps the sync version', async () => {
      const song = await createSong();

      const response = await request(app.getHttpServer())
        .patch(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          artist: null,
          sections: [
            { key: 'b', kind: 'bridge', label: 'Bridge', lyrics: 'New words' },
          ],
        })
        .expect(200);
      const updated = response.body as SongBody;

      expect(updated.title).toBe('Amazing Grace');
      expect(updated.artist).toBeNull();
      expect(updated.syncVersion).toBe(2);
      expect(updated.sections.map((section) => section.label)).toEqual([
        'Bridge',
      ]);
      expect(updated.arrangements).toHaveLength(1);
      expect(updated.arrangements[0]?.sectionIds).toEqual([
        updated.sections[0]?.id,
      ]);
    });

    it('refuses arrangements without the sections they refer to', async () => {
      const song = await createSong();
      const response = await request(app.getHttpServer())
        .patch(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          arrangements: [{ name: 'X', isDefault: true, sectionKeys: ['v1'] }],
        })
        .expect(400);
      expect((response.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
    });

    it('deletes a song so it is no longer found', async () => {
      const song = await createSong();
      await request(app.getHttpServer())
        .delete(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);
      await request(app.getHttpServer())
        .get(`${songsUrl()}/${song.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
    });
  });
});
