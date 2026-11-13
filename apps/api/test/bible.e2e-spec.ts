import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { bibleContentHash } from '../src/common/util/bible-content-hash.util';
import { MAX_VERSE_LENGTH } from '../src/modules/bible/dto/put-bible-chapter.dto';
import { truncateAll } from './setup/db';
import {
  createPlatformAdmin,
  createRegularUser,
  seedRbacCatalog,
  SeededUser,
} from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface ErrorBody {
  errorCode: string;
}
interface TranslationBody {
  id: string;
  code: string;
  isPublished: boolean;
  contentHash: string | null;
  verseCount: number;
}
interface ContentBody {
  translation: TranslationBody;
  books: Array<{ code: string; name: string; position: number }>;
  verses: Array<{
    bookCode: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
}

const WEB = {
  code: 'web',
  name: 'World English Bible',
  languageCode: 'en',
  licence: 'Public domain',
  attribution: 'World English Bible (public domain)',
  sourceUrl: 'https://ebible.org/web/',
};

describe('Bible translations (e2e)', () => {
  let app: INestApplication<App>;
  let admin: SeededUser;
  let member: SeededUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
    admin = await createPlatformAdmin(app);
    member = await createRegularUser(app, 'member@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (user: SeededUser) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${user.token}`),
    post: (url: string, body?: object) =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body),
    put: (url: string, body: object) =>
      request(app.getHttpServer())
        .put(url)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body),
    delete: (url: string) =>
      request(app.getHttpServer())
        .delete(url)
        .set('Authorization', `Bearer ${user.token}`),
  });

  async function createDraft(): Promise<TranslationBody> {
    const response = await as(admin)
      .post('/api/bible-translations', WEB)
      .expect(201);
    return response.body as TranslationBody;
  }

  const chapterUrl = (id: string, book: string, chapter: number | string) =>
    `/api/bible-translations/${id}/books/${book}/chapters/${chapter}`;

  async function importSample(id: string): Promise<void> {
    // Out of canonical order on purpose: publication orders it.
    await as(admin)
      .put(chapterUrl(id, 'JHN', 3), {
        bookName: 'John',
        verses: [
          {
            number: 17,
            text: 'For God didn’t send his Son into the world to judge the world,',
          },
          { number: 16, text: '  For God so loved   the world,  ' },
        ],
      })
      .expect(204);
    await as(admin)
      .put(chapterUrl(id, 'GEN', 1), {
        bookName: 'Genesis',
        verses: [
          {
            number: 1,
            text: 'In the beginning, God created the heavens and the earth.',
          },
        ],
      })
      .expect(204);
  }

  it('imports a draft chapter by chapter and publishes it with its content hash', async () => {
    const draft = await createDraft();
    expect(draft).toMatchObject({
      code: 'WEB',
      isPublished: false,
      contentHash: null,
    });
    await importSample(draft.id);

    const published = (
      await as(admin)
        .post(`/api/bible-translations/${draft.id}/publish`)
        .expect(200)
    ).body as TranslationBody;

    const content = (
      await as(member)
        .get(`/api/bible-translations/${draft.id}/content`)
        .expect(200)
    ).body as ContentBody;
    expect(content.books.map((book) => book.code)).toEqual(['GEN', 'JHN']);
    expect(content.verses).toEqual([
      {
        bookCode: 'GEN',
        chapter: 1,
        verse: 1,
        text: 'In the beginning, God created the heavens and the earth.',
      },
      {
        bookCode: 'JHN',
        chapter: 3,
        verse: 16,
        text: 'For God so loved the world,',
      },
      {
        bookCode: 'JHN',
        chapter: 3,
        verse: 17,
        text: 'For God didn’t send his Son into the world to judge the world,',
      },
    ]);
    expect(published).toMatchObject({ isPublished: true, verseCount: 3 });
    expect(published.contentHash).toBe(bibleContentHash(content.verses));
    expect(content.translation.contentHash).toBe(published.contentHash);
  });

  it('shows members only published translations, and drafts to the importer', async () => {
    const draft = await createDraft();
    const memberList = (
      await as(member).get('/api/bible-translations').expect(200)
    ).body as TranslationBody[];
    expect(memberList).toEqual([]);
    await as(member)
      .get(`/api/bible-translations/${draft.id}/content`)
      .expect(404);

    const adminList = (
      await as(admin).get('/api/bible-translations').expect(200)
    ).body as TranslationBody[];
    expect(adminList.map((translation) => translation.id)).toEqual([draft.id]);
  });

  it('lets only an administrator import, publish or delete', async () => {
    const draft = await createDraft();
    await as(member)
      .post('/api/bible-translations', { ...WEB, code: 'KJV' })
      .expect(403);
    await as(member)
      .put(chapterUrl(draft.id, 'GEN', 1), {
        bookName: 'Genesis',
        verses: [{ number: 1, text: 'x' }],
      })
      .expect(403);
    await as(member)
      .post(`/api/bible-translations/${draft.id}/publish`)
      .expect(403);
    await as(member).delete(`/api/bible-translations/${draft.id}`).expect(403);
    await request(app.getHttpServer())
      .get('/api/bible-translations')
      .expect(401);
  });

  it('never changes a published translation', async () => {
    const draft = await createDraft();
    await importSample(draft.id);
    await as(admin)
      .post(`/api/bible-translations/${draft.id}/publish`)
      .expect(200);

    const response = await as(admin)
      .put(chapterUrl(draft.id, 'GEN', 2), {
        bookName: 'Genesis',
        verses: [{ number: 1, text: 'x' }],
      })
      .expect(409);
    expect((response.body as ErrorBody).errorCode).toBe('RESOURCE_CONFLICT');
    await as(admin)
      .post(`/api/bible-translations/${draft.id}/publish`)
      .expect(409);
  });

  it('refuses an empty translation, a duplicate code and malformed chapters', async () => {
    const draft = await createDraft();
    await as(admin)
      .post(`/api/bible-translations/${draft.id}/publish`)
      .expect(409);
    await as(admin).post('/api/bible-translations', WEB).expect(409);

    for (const [url, body] of [
      [
        chapterUrl(draft.id, 'XYZ', 1),
        { bookName: 'X', verses: [{ number: 1, text: 'x' }] },
      ],
      [
        chapterUrl(draft.id, 'GEN', 0),
        { bookName: 'X', verses: [{ number: 1, text: 'x' }] },
      ],
      [chapterUrl(draft.id, 'GEN', 1), { bookName: 'X', verses: [] }],
      [
        chapterUrl(draft.id, 'GEN', 1),
        {
          bookName: 'X',
          verses: [
            { number: 1, text: 'a' },
            { number: 1, text: 'b' },
          ],
        },
      ],
      [
        chapterUrl(draft.id, 'GEN', 1),
        {
          bookName: 'X',
          verses: [{ number: 1, text: 'x'.repeat(MAX_VERSE_LENGTH + 1) }],
        },
      ],
      [
        chapterUrl(draft.id, 'GEN', 1),
        { bookName: 'X', verses: [{ number: 1, text: '   ' }] },
      ],
    ] as const) {
      const response = await as(admin).put(url, body).expect(400);
      expect((response.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
    }
  });

  it('keeps a verse as long as the limit, such as the additions to Greek Esther', async () => {
    const draft = await createDraft();
    const longest = 'x'.repeat(MAX_VERSE_LENGTH);
    await as(admin)
      .put(chapterUrl(draft.id, 'ESG', 8), {
        bookName: 'Esther (Greek)',
        verses: [{ number: 13, text: longest }],
      })
      .expect(204);
    await as(admin)
      .post(`/api/bible-translations/${draft.id}/publish`)
      .expect(200);
    const content = await as(admin)
      .get(`/api/bible-translations/${draft.id}/content`)
      .expect(200);
    expect((content.body as ContentBody).verses).toEqual([
      expect.objectContaining({ bookCode: 'ESG', verse: 13, text: longest }),
    ]);
  });

  it('replaces a chapter when it is sent again, and deletes a translation', async () => {
    const draft = await createDraft();
    await importSample(draft.id);
    await as(admin)
      .put(chapterUrl(draft.id, 'GEN', 1), {
        bookName: 'Genesis',
        verses: [
          { number: 1, text: 'Replaced.' },
          { number: 2, text: 'Added.' },
        ],
      })
      .expect(204);
    const published = (
      await as(admin)
        .post(`/api/bible-translations/${draft.id}/publish`)
        .expect(200)
    ).body as TranslationBody;
    expect(published.verseCount).toBe(4);

    await as(admin).delete(`/api/bible-translations/${draft.id}`).expect(204);
    await as(member)
      .get(`/api/bible-translations/${draft.id}/content`)
      .expect(404);
  });

  it('never lets a chapter write land after publication froze the hash', async () => {
    const draft = await createDraft();
    await importSample(draft.id);
    const [published, written] = await Promise.all([
      as(admin).post(`/api/bible-translations/${draft.id}/publish`),
      as(admin).put(chapterUrl(draft.id, 'GEN', 2), {
        bookName: 'Genesis',
        verses: [{ number: 1, text: 'Thus the heavens were finished.' }],
      }),
    ]);
    expect(published.status).toBe(200);
    // Either order is fine; a write after publication is refused.
    expect([204, 409]).toContain(written.status);
    const content = (
      await as(member)
        .get(`/api/bible-translations/${draft.id}/content`)
        .expect(200)
    ).body as ContentBody;
    expect(bibleContentHash(content.verses)).toBe(
      (published.body as TranslationBody).contentHash,
    );
  });

  it('refuses a language tag longer than 40 characters', async () => {
    await as(admin)
      .post('/api/bible-translations', {
        ...WEB,
        languageCode: `en-${'abcdefgh-'.repeat(5)}x1`,
      })
      .expect(400);
  });
});
