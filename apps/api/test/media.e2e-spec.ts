import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { FileAssetStatus } from '../src/common/enums/file-asset-status.enum';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { FILE_STORAGE_ADAPTER } from '../src/common/storage/adapters/file-storage-adapter.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './setup/db';
import {
  addMembership,
  createRegularUser,
  createWorkspaceWithOwner,
  seedRbacCatalog,
  SeededUser,
  SeededWorkspace,
} from './setup/rbac';
import { buildPng } from './fixtures/files';
import { RecordingStorageAdapter } from './setup/recording-storage';
import { createTestApp } from './setup/test-app';

// Background videos: an upload straight to storage, checked and added, then
// synchronised to laptops and shown by themes. `.env.test` sets the
// workspace quota to 4096 bytes.

interface ErrorBody {
  errorCode: string;
  details?: Record<string, unknown>;
}
interface UploadBody {
  fileId: string;
  url: string;
  headers: Record<string, string>;
  urlExpiresAt: string;
}
interface MediaBody {
  id: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  width: number;
  height: number;
  durationMs: number;
  syncVersion: number;
}

/** The smallest bytes `file-type` reads as an MP4 (an `ftyp` box), padded. */
function mp4(size = 1000): Buffer {
  const box = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  return Buffer.concat([box, Buffer.alloc(size - box.length, 7)]);
}
/** A PNG signature: an accepted image elsewhere, never a video. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(992, 1),
]);
const sha256Of = (body: Buffer) =>
  createHash('sha256').update(body).digest('hex');
const storageKeyOf = (uploadUrl: string) =>
  new URL(uploadUrl).pathname.slice(1);

const THEME = {
  name: 'Sunday',
  background: 'dusk',
  backgroundColor: '#102030',
  textColor: '#ffffff',
  font: 'serif',
  textScale: 110,
  textAlign: 'center',
};

describe('Media (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const storage = new RecordingStorageAdapter();
  let owner: SeededUser;
  let staff: SeededUser;
  let stranger: SeededUser;
  let workspace: SeededWorkspace;
  let otherWorkspace: SeededWorkspace;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(FILE_STORAGE_ADAPTER).useValue(storage),
    );
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
    storage.reset();
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
      patch: (url: string, body: object) =>
        withToken(server().patch(url).send(body)),
      delete: (url: string) => withToken(server().delete(url)),
    };
  };
  const url = (resource: string, workspaceId = workspace.id) =>
    `/api/workspaces/${workspaceId}/${resource}`;

  async function startUpload(
    body: Buffer,
    overrides: Record<string, unknown> = {},
  ): Promise<UploadBody> {
    return (
      await as(owner)
        .post(url('media/uploads'), {
          fileName: 'loop.mp4',
          sizeBytes: body.length,
          contentType: 'video/mp4',
          sha256: sha256Of(body),
          ...overrides,
        })
        .expect(201)
    ).body as UploadBody;
  }

  function addMedia(fileId: string, user = owner): request.Test {
    return as(user).post(url('media'), {
      fileId,
      name: 'Blue waves',
      width: 1920,
      height: 1080,
      durationMs: 12_000,
    });
  }

  async function uploadVideo(body = mp4()): Promise<MediaBody> {
    const upload = await startUpload(body);
    expect(storage.receiveUpload(storageKeyOf(upload.url), body)).toBe(true);
    return (await addMedia(upload.fileId).expect(201)).body as MediaBody;
  }

  describe('uploading', () => {
    it('signs an upload for the declared size, type and hash, then adds the video', async () => {
      const body = mp4();
      const upload = await startUpload(body);
      const signed = storage.signedUploads.get(storageKeyOf(upload.url));
      expect(signed).toMatchObject({
        sizeBytes: body.length,
        contentType: 'video/mp4',
        sha256Base64: createHash('sha256').update(body).digest('base64'),
      });
      expect(signed?.contentDisposition).toMatch(/^attachment;/);
      expect(upload.headers['x-amz-checksum-sha256']).toBe(
        signed?.sha256Base64,
      );

      storage.receiveUpload(storageKeyOf(upload.url), body);
      const media = (await addMedia(upload.fileId).expect(201))
        .body as MediaBody;
      expect(media).toMatchObject({
        name: 'Blue waves',
        sha256: sha256Of(body),
        sizeBytes: body.length,
        contentType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 12_000,
      });
      expect(media).not.toHaveProperty('fileAssetId');
      const file = await prisma.fileAsset.findFirstOrThrow({
        where: { id: upload.fileId },
      });
      expect(file.status).toBe(FileAssetStatus.ATTACHED);
    });

    it('answers FILE_NOT_UPLOADED until storage holds the bytes, then adds it', async () => {
      const body = mp4();
      const upload = await startUpload(body);
      const early = await addMedia(upload.fileId).expect(409);
      expect((early.body as ErrorBody).errorCode).toBe('FILE_NOT_UPLOADED');

      storage.receiveUpload(storageKeyOf(upload.url), body);
      await addMedia(upload.fileId).expect(201);
    });

    it('refuses bytes that are not a video, and releases the upload', async () => {
      const upload = await startUpload(PNG);
      // A backend that signs neither size nor hash stores whatever arrives.
      storage.receiveUpload(storageKeyOf(upload.url), PNG, {
        isUnchecked: true,
      });
      const refused = await addMedia(upload.fileId).expect(415);
      expect((refused.body as ErrorBody).errorCode).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
      const file = await prisma.fileAsset.findFirstOrThrow({
        where: { id: upload.fileId },
      });
      expect(file.status).toBe(FileAssetStatus.DELETING);
    });

    it('answers FILE_NOT_UPLOADED when storage holds another size', async () => {
      const body = mp4();
      const upload = await startUpload(body);
      storage.receiveUpload(storageKeyOf(upload.url), mp4(900), {
        isUnchecked: true,
      });
      const refused = await addMedia(upload.fileId).expect(409);
      expect((refused.body as ErrorBody).errorCode).toBe('FILE_NOT_UPLOADED');
    });

    it('refuses a type the purpose does not accept, before signing', async () => {
      await as(owner)
        .post(url('media/uploads'), {
          fileName: 'clip.mov',
          sizeBytes: 1000,
          contentType: 'video/quicktime',
          sha256: sha256Of(mp4()),
        })
        .expect(400);
      expect(storage.signedUploads.size).toBe(0);
    });

    it('refuses more than 1080p', async () => {
      const body = mp4();
      const upload = await startUpload(body);
      storage.receiveUpload(storageKeyOf(upload.url), body);
      await as(owner)
        .post(url('media'), {
          fileId: upload.fileId,
          name: 'Too big',
          width: 1920,
          height: 1440,
          durationMs: 1000,
        })
        .expect(400);
    });

    it('keeps a workspace within its quota, at the start and when adding', async () => {
      await uploadVideo(mp4(3000));
      const refused = await as(owner)
        .post(url('media/uploads'), {
          fileName: 'loop.mp4',
          sizeBytes: 2000,
          contentType: 'video/mp4',
          sha256: sha256Of(mp4(2000)),
        })
        .expect(409);
      expect(refused.body as ErrorBody).toMatchObject({
        errorCode: 'MEDIA_QUOTA_EXCEEDED',
        details: { limitBytes: 4096, usedBytes: 3000 },
      });

      // Two uploads that each fit when started, but not together.
      const first = await startUpload(mp4(1000));
      const second = await startUpload(mp4(1001));
      storage.receiveUpload(storageKeyOf(first.url), mp4(1000));
      storage.receiveUpload(storageKeyOf(second.url), mp4(1001));
      await addMedia(first.fileId).expect(201);
      const late = await addMedia(second.fileId).expect(409);
      expect((late.body as ErrorBody).errorCode).toBe('MEDIA_QUOTA_EXCEEDED');
    });

    it('accepts no video through the multipart upload', async () => {
      await request(app.getHttpServer())
        .post('/api/files')
        .set('Authorization', `Bearer ${owner.token}`)
        .field('purpose', 'background_video')
        .attach('file', mp4(), 'loop.mp4')
        .expect(400);
    });

    it("never adds another person's upload", async () => {
      const body = mp4();
      const upload = await startUpload(body);
      storage.receiveUpload(storageKeyOf(upload.url), body);
      await addMembership(
        app,
        workspace.id,
        stranger.id,
        SeededRoleName.WORKSPACE_ADMIN,
      );
      const refused = await addMedia(upload.fileId, stranger).expect(404);
      expect((refused.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('access', () => {
    it('lets staff read and download, but not upload or delete', async () => {
      const media = await uploadVideo();
      await as(staff)
        .get(url(`media/${media.id}`))
        .expect(200);
      const download = await as(staff)
        .get(url(`media/${media.id}/download`))
        .expect(200);
      expect((download.body as { url: string }).url).toContain(
        'storage.test/files/background-videos/',
      );
      await as(staff)
        .post(url('media/uploads'), {
          fileName: 'loop.mp4',
          sizeBytes: 1000,
          contentType: 'video/mp4',
          sha256: sha256Of(mp4()),
        })
        .expect(403);
      await as(staff)
        .delete(url(`media/${media.id}`))
        .expect(403);
    });

    it("hides a workspace's videos from a stranger", async () => {
      const media = await uploadVideo();
      await as(stranger)
        .get(url(`media/${media.id}`))
        .expect(404);
      await as(stranger)
        .get(url(`media/${media.id}/download`))
        .expect(404);
      await as(stranger).get(url('media')).expect(404);
    });
  });

  describe('themes', () => {
    it('shows a video under a theme, and synchronises both', async () => {
      const media = await uploadVideo();
      const theme = (
        await as(owner)
          .post(url('themes'), { ...THEME, backgroundMediaId: media.id })
          .expect(201)
      ).body as { id: string; backgroundMediaId: string | null };
      expect(theme.backgroundMediaId).toBe(media.id);

      const sync = (
        await as(staff).get(url('sync/changes?cursor=0&limit=50')).expect(200)
      ).body as {
        media: Array<{ id: string; isDeleted: boolean; media: MediaBody }>;
        themes: Array<{ theme: { backgroundMediaId: string } }>;
      };
      expect(sync.media).toEqual([
        expect.objectContaining({ id: media.id, isDeleted: false }),
      ]);
      expect(sync.media[0]?.media.sha256).toBe(media.sha256);
      expect(sync.themes[0]?.theme.backgroundMediaId).toBe(media.id);
    });

    it("refuses another workspace's video as a background", async () => {
      const body = mp4();
      const upload = (
        await as(stranger)
          .post(url('media/uploads', otherWorkspace.id), {
            fileName: 'loop.mp4',
            sizeBytes: body.length,
            contentType: 'video/mp4',
            sha256: sha256Of(body),
          })
          .expect(201)
      ).body as UploadBody;
      storage.receiveUpload(storageKeyOf(upload.url), body);
      const foreign = (
        await as(stranger)
          .post(url('media', otherWorkspace.id), {
            fileId: upload.fileId,
            name: 'Theirs',
            width: 1280,
            height: 720,
            durationMs: 5000,
          })
          .expect(201)
      ).body as MediaBody;
      const refused = await as(owner)
        .post(url('themes'), { ...THEME, backgroundMediaId: foreign.id })
        .expect(404);
      expect((refused.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');
    });

    it('refuses to delete a video a theme shows, then deletes it once unused', async () => {
      const media = await uploadVideo();
      const theme = (
        await as(owner)
          .post(url('themes'), { ...THEME, backgroundMediaId: media.id })
          .expect(201)
      ).body as { id: string };

      const refused = await as(owner)
        .delete(url(`media/${media.id}`))
        .expect(409);
      expect(refused.body as ErrorBody).toMatchObject({
        errorCode: 'MEDIA_IN_USE',
        details: { themeIds: [theme.id] },
      });

      await as(owner)
        .patch(url(`themes/${theme.id}`), { backgroundMediaId: null })
        .expect(200);
      await as(owner)
        .delete(url(`media/${media.id}`))
        .expect(204);
      await as(owner)
        .get(url(`media/${media.id}`))
        .expect(404);

      const row = await prisma.media.findUniqueOrThrow({
        where: { id: media.id },
      });
      expect(row.fileAssetId).toBeNull();
      const files = await prisma.fileAsset.findMany();
      expect(files.map((file) => file.status)).toEqual([
        FileAssetStatus.DELETING,
      ]);

      const sync = (
        await as(staff).get(url('sync/changes?cursor=0&limit=50')).expect(200)
      ).body as { media: Array<{ id: string; isDeleted: boolean }> };
      expect(sync.media).toEqual([
        expect.objectContaining({ id: media.id, isDeleted: true }),
      ]);
    });

    it('lets a deleted video free its quota', async () => {
      const media = await uploadVideo(mp4(3000));
      await as(owner)
        .delete(url(`media/${media.id}`))
        .expect(204);
      await uploadVideo(mp4(3000));
    });
  });

  describe('images', () => {
    async function uploadImage(body: Buffer): Promise<string> {
      const uploaded = await request(app.getHttpServer())
        .post('/api/files')
        .set('Authorization', `Bearer ${owner.token}`)
        .field('purpose', 'background_image')
        .attach('file', body, 'cross.png')
        .expect(201);
      return (uploaded.body as { id: string }).id;
    }

    it('adds an image with the size and hash of what the API stored', async () => {
      const fileId = await uploadImage(await buildPng(64, 48));
      const media = (
        await as(owner)
          .post(url('media'), {
            fileId,
            name: 'Cross',
            // Ignored for an image: the stored file's own size is used.
            width: 999,
            height: 999,
          })
          .expect(201)
      ).body as MediaBody & { kind: string };
      expect(media).toMatchObject({
        kind: 'image',
        contentType: 'image/png',
        width: 64,
        height: 48,
        durationMs: null,
      });
      const stored = [...storage.objects.values()].find(
        (object) => object.contentType === 'image/png',
      )!;
      expect(media.sha256).toBe(sha256Of(stored.body));
      expect(media.sizeBytes).toBe(stored.body.length);

      const theme = (
        await as(owner)
          .post(url('themes'), { ...THEME, backgroundMediaId: media.id })
          .expect(201)
      ).body as { backgroundMediaId: string };
      expect(theme.backgroundMediaId).toBe(media.id);
    });

    it('marks an uploaded video as a video, and asks for its measurements', async () => {
      const body = mp4();
      const upload = await startUpload(body);
      storage.receiveUpload(storageKeyOf(upload.url), body);
      const refused = await as(owner)
        .post(url('media'), { fileId: upload.fileId, name: 'Waves' })
        .expect(400);
      expect((refused.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
      const media = (await addMedia(upload.fileId).expect(201)).body as {
        kind: string;
      };
      expect(media.kind).toBe('video');
    });

    it('counts images toward the quota', async () => {
      const fileId = await uploadImage(await buildPng(400, 300));
      const image = (
        await as(owner).post(url('media'), { fileId, name: 'Big' }).expect(201)
      ).body as MediaBody;
      const refused = await as(owner)
        .post(url('media/uploads'), {
          fileName: 'loop.mp4',
          sizeBytes: 4096 - image.sizeBytes + 1,
          contentType: 'video/mp4',
          sha256: sha256Of(mp4()),
        })
        .expect(409);
      expect((refused.body as ErrorBody).errorCode).toBe(
        'MEDIA_QUOTA_EXCEEDED',
      );
    });
  });

  describe('without object storage', () => {
    it('refuses a video upload on a server whose storage keeps nothing', async () => {
      const stubbed: INestApplication<App> = await createTestApp();
      try {
        const refused = await request(stubbed.getHttpServer())
          .post(`/api/workspaces/${workspace.id}/media/uploads`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            fileName: 'loop.mp4',
            sizeBytes: 1000,
            contentType: 'video/mp4',
            sha256: sha256Of(mp4()),
          })
          .expect(503);
        expect((refused.body as ErrorBody).errorCode).toBe(
          'EXTERNAL_SERVICE_UNAVAILABLE',
        );
      } finally {
        await stubbed.close();
      }
    });
  });
});
