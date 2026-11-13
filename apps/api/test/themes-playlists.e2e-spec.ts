import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { truncateAll } from './setup/db';
import {
  addMembership,
  createPlatformAdmin,
  createRegularUser,
  createWorkspaceWithOwner,
  seedRbacCatalog,
  SeededUser,
  SeededWorkspace,
} from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface ErrorBody {
  errorCode: string;
  details?: Array<{ field: string }>;
}
interface ThemeBody {
  id: string;
  name: string;
  isDefault: boolean;
  syncVersion: number;
}
interface PlaylistBody {
  id: string;
  name: string;
  serviceDate: string | null;
  themeId: string | null;
  syncVersion: number;
  items: Array<Record<string, unknown>>;
}
interface SyncBody {
  nextCursor: number;
  hasMore: boolean;
  songs: Array<{ id: string; syncVersion: number }>;
  themes: Array<{ id: string; isDeleted: boolean; syncVersion: number }>;
  playlists: Array<{ id: string; isDeleted: boolean; syncVersion: number }>;
}

const THEME = {
  name: 'Sunday',
  background: 'dusk',
  backgroundColor: '#102030',
  textColor: '#FFFFFF',
  font: 'serif',
  textScale: 110,
  textAlign: 'center',
};

describe('Themes and playlists (e2e)', () => {
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

  const as = (user: SeededUser) => {
    const withToken = (test: request.Test) =>
      test.set('Authorization', `Bearer ${user.token}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => withToken(server().get(url)),
      post: (url: string, body: object) =>
        withToken(server().post(url).send(body)),
      put: (url: string, body: object) =>
        withToken(server().put(url).send(body)),
      patch: (url: string, body: object) =>
        withToken(server().patch(url).send(body)),
      delete: (url: string) => withToken(server().delete(url)),
    };
  };
  const url = (resource: string, workspaceId = workspace.id) =>
    `/api/workspaces/${workspaceId}/${resource}`;

  async function createTheme(body: object = THEME): Promise<ThemeBody> {
    return (await as(owner).post(url('themes'), body).expect(201))
      .body as ThemeBody;
  }

  async function createSong(workspaceId = workspace.id, as_ = owner) {
    const response = await as(as_)
      .post(url('songs', workspaceId), {
        title: 'Amazing Grace',
        sections: [
          { key: 'v1', kind: 'verse', label: 'Verse 1', lyrics: 'Amazing' },
        ],
      })
      .expect(201);
    return response.body as { id: string };
  }

  async function publishTranslation(): Promise<string> {
    const admin = await createPlatformAdmin(app);
    const draft = (
      await as(admin)
        .post('/api/bible-translations', {
          code: 'WEB',
          name: 'World English Bible',
          languageCode: 'en',
          licence: 'Public domain',
          attribution: 'WEB (public domain)',
        })
        .expect(201)
    ).body as { id: string };
    await as(admin)
      .put(`/api/bible-translations/${draft.id}/books/JHN/chapters/3`, {
        bookName: 'John',
        verses: [{ number: 16, text: 'For God so loved the world,' }],
      })
      .expect(204);
    await as(admin)
      .post(`/api/bible-translations/${draft.id}/publish`, {})
      .expect(200);
    return draft.id;
  }

  describe('themes', () => {
    it('stores a theme, normalising its colours', async () => {
      const theme = await createTheme();
      expect(theme).toMatchObject({
        name: 'Sunday',
        textColor: '#ffffff',
        isDefault: false,
      });
      const listed = (await as(staff).get(url('themes')).expect(200)).body as {
        data: ThemeBody[];
      };
      expect(listed.data.map((row) => row.id)).toEqual([theme.id]);
    });

    it('keeps one default per workspace, re-versioning the previous one', async () => {
      const first = await createTheme({ ...THEME, isDefault: true });
      const second = await createTheme({
        ...THEME,
        name: 'Evening',
        isDefault: true,
      });
      const reloaded = (
        await as(owner)
          .get(`${url('themes')}/${first.id}`)
          .expect(200)
      ).body as ThemeBody;
      expect(reloaded.isDefault).toBe(false);
      expect(reloaded.syncVersion).toBeGreaterThan(second.syncVersion);

      await as(owner)
        .patch(`${url('themes')}/${first.id}`, { isDefault: true })
        .expect(200);
      const themes = (await as(owner).get(url('themes')).expect(200)).body as {
        data: ThemeBody[];
      };
      expect(
        themes.data.filter((theme) => theme.isDefault).map((theme) => theme.id),
      ).toEqual([first.id]);
    });

    it('refuses an unknown font, a bad colour and an out-of-range size', async () => {
      for (const invalid of [
        { font: 'comic' },
        { textColor: 'white' },
        { textScale: 300 },
        { background: 'video' },
      ]) {
        const response = await as(owner)
          .post(url('themes'), { ...THEME, ...invalid })
          .expect(400);
        expect((response.body as ErrorBody).errorCode).toBe(
          'VALIDATION_FAILED',
        );
      }
    });

    it('lets staff read but not change themes, and hides them from strangers', async () => {
      const theme = await createTheme();
      await as(staff).post(url('themes'), THEME).expect(403);
      await as(staff)
        .patch(`${url('themes')}/${theme.id}`, { name: 'x' })
        .expect(403);
      await as(staff)
        .delete(`${url('themes')}/${theme.id}`)
        .expect(403);
      await as(stranger)
        .get(`${url('themes')}/${theme.id}`)
        .expect(404);
      await as(stranger).get(url('themes')).expect(404);
    });
  });

  describe('playlists', () => {
    it('stores a running order of songs and passages with its theme', async () => {
      const theme = await createTheme();
      const song = await createSong();
      const translationId = await publishTranslation();
      const playlist = (
        await as(owner)
          .post(url('playlists'), {
            name: 'Sunday service',
            serviceDate: '2026-11-15',
            themeId: theme.id,
            items: [
              { kind: 'song', songId: song.id, arrangementName: 'Default' },
              {
                kind: 'passage',
                bibleTranslationId: translationId,
                bookCode: 'JHN',
                startChapter: 3,
                startVerse: 16,
                endChapter: 3,
                endVerse: 17,
              },
            ],
          })
          .expect(201)
      ).body as PlaylistBody;
      expect(playlist).toMatchObject({
        name: 'Sunday service',
        serviceDate: '2026-11-15',
        themeId: theme.id,
      });
      expect(playlist.items).toEqual([
        expect.objectContaining({
          position: 0,
          kind: 'song',
          songId: song.id,
          arrangementName: 'Default',
          bibleTranslationId: null,
        }),
        expect.objectContaining({
          position: 1,
          kind: 'passage',
          songId: null,
          bookCode: 'JHN',
          startVerse: 16,
          endVerse: 17,
        }),
      ]);

      const updated = (
        await as(owner)
          .patch(`${url('playlists')}/${playlist.id}`, {
            items: [{ kind: 'song', songId: song.id }],
            serviceDate: null,
          })
          .expect(200)
      ).body as PlaylistBody;
      expect(updated.items).toHaveLength(1);
      expect(updated.serviceDate).toBeNull();
      expect(updated.syncVersion).toBeGreaterThan(playlist.syncVersion);
    });

    it('refuses another workspace’s song or theme, a draft translation and mixed fields', async () => {
      const foreignSong = await createSong(otherWorkspace.id, stranger);
      const foreignTheme = (
        await as(stranger).post(url('themes', otherWorkspace.id), THEME)
      ).body as ThemeBody;
      const cases: Array<[object, string]> = [
        [
          { items: [{ kind: 'song', songId: foreignSong.id }] },
          'items[0].songId',
        ],
        [{ themeId: foreignTheme.id, items: [] }, 'themeId'],
        [
          {
            items: [
              {
                kind: 'passage',
                bibleTranslationId: '00000000-0000-4000-8000-000000000000',
                bookCode: 'JHN',
                startChapter: 3,
                startVerse: 16,
                endChapter: 3,
                endVerse: 16,
              },
            ],
          },
          'items[0].bibleTranslationId',
        ],
        [
          {
            items: [
              {
                kind: 'song',
                songId: foreignSong.id,
                bookCode: 'JHN',
              },
            ],
          },
          'items[0].bookCode',
        ],
      ];
      for (const [body, field] of cases) {
        const response = await as(owner)
          .post(url('playlists'), { name: 'x', ...body })
          .expect(400);
        expect(
          (response.body as ErrorBody).details?.map((detail) => detail.field),
        ).toContain(field);
      }
    });

    it('refuses a passage that ends before it starts', async () => {
      const translationId = await publishTranslation();
      await as(owner)
        .post(url('playlists'), {
          name: 'x',
          items: [
            {
              kind: 'passage',
              bibleTranslationId: translationId,
              bookCode: 'JHN',
              startChapter: 3,
              startVerse: 17,
              endChapter: 3,
              endVerse: 16,
            },
          ],
        })
        .expect(400);
    });

    it('lets staff read but not plan, and hides playlists from strangers', async () => {
      const playlist = (
        await as(owner).post(url('playlists'), { name: 'x', items: [] })
      ).body as PlaylistBody;
      await as(staff)
        .get(`${url('playlists')}/${playlist.id}`)
        .expect(200);
      await as(staff)
        .post(url('playlists'), { name: 'y', items: [] })
        .expect(403);
      await as(staff)
        .patch(`${url('playlists')}/${playlist.id}`, { name: 'z' })
        .expect(403);
      await as(stranger)
        .get(`${url('playlists')}/${playlist.id}`)
        .expect(404);
    });
  });

  describe('edits', () => {
    it('refuses a playlist edit made from an older copy (409)', async () => {
      const playlist = (
        await as(owner).post(url('playlists'), { name: 'x', items: [] })
      ).body as PlaylistBody;
      const changed = (
        await as(owner)
          .patch(`${url('playlists')}/${playlist.id}`, {
            name: 'y',
            expectedSyncVersion: playlist.syncVersion,
          })
          .expect(200)
      ).body as PlaylistBody;
      const stale = await as(owner)
        .patch(`${url('playlists')}/${playlist.id}`, {
          name: 'z',
          expectedSyncVersion: playlist.syncVersion,
        })
        .expect(409);
      expect((stale.body as ErrorBody).errorCode).toBe('RESOURCE_CONFLICT');
      const reloaded = (
        await as(owner)
          .get(`${url('playlists')}/${playlist.id}`)
          .expect(200)
      ).body as PlaylistBody;
      expect(reloaded).toMatchObject({
        name: 'y',
        syncVersion: changed.syncVersion,
      });
    });

    it('refuses null for a field that must have a value (400, not 500)', async () => {
      const theme = await createTheme();
      const playlist = (
        await as(owner).post(url('playlists'), { name: 'x', items: [] })
      ).body as PlaylistBody;
      for (const body of [
        { name: null },
        { textColor: null },
        { isDefault: null },
      ]) {
        const response = await as(owner)
          .patch(`${url('themes')}/${theme.id}`, body)
          .expect(400);
        expect((response.body as ErrorBody).errorCode).toBe(
          'VALIDATION_FAILED',
        );
      }
      await as(owner)
        .patch(`${url('playlists')}/${playlist.id}`, { name: null })
        .expect(400);
    });
  });

  describe('sync feed', () => {
    it('carries songs, themes and playlists in one version order, with tombstones', async () => {
      const theme = await createTheme();
      const song = await createSong();
      const playlist = (
        await as(owner).post(url('playlists'), {
          name: 'x',
          themeId: theme.id,
          items: [{ kind: 'song', songId: song.id }],
        })
      ).body as PlaylistBody;
      await as(owner)
        .delete(`${url('themes')}/${theme.id}`)
        .expect(204);

      // Each row's latest change: the song (2), the theme's tombstone (4)
      // and the playlist moved off the deleted theme (5). Two per page, so
      // the page boundary falls between kinds.
      const first = (
        await as(staff)
          .get(`${url('sync/changes')}?cursor=0&limit=2`)
          .expect(200)
      ).body as SyncBody;
      expect(first.hasMore).toBe(true);
      expect(first.songs.map((change) => change.id)).toEqual([song.id]);
      expect(first.themes).toEqual([
        expect.objectContaining({ id: theme.id, isDeleted: true }),
      ]);
      expect(first.playlists).toEqual([]);

      const second = (
        await as(staff)
          .get(`${url('sync/changes')}?cursor=${first.nextCursor}&limit=2`)
          .expect(200)
      ).body as SyncBody;
      expect(second.hasMore).toBe(false);
      expect(second.playlists).toEqual([
        expect.objectContaining({ id: playlist.id, isDeleted: false }),
      ]);

      // The playlist fell back to the default theme, and stays editable.
      const reloaded = (
        await as(owner)
          .get(`${url('playlists')}/${playlist.id}`)
          .expect(200)
      ).body as PlaylistBody;
      expect(reloaded.themeId).toBeNull();
      await as(owner)
        .patch(`${url('playlists')}/${playlist.id}`, { items: [] })
        .expect(200);
    });
  });
});
