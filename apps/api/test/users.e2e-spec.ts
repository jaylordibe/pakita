import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './setup/test-app';
import { truncateAll } from './setup/db';
import {
  createPlatformAdmin,
  createRegularUser,
  seedRbacCatalog,
} from './setup/rbac';

const PASSWORD = 'correct-horse-battery-1';

// Create an account and return an access token.
async function registerUser(
  app: INestApplication<App>,
  email = 'user@example.com',
): Promise<string> {
  const { token } = await createRegularUser(app, email);
  return token;
}

describe('Users (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access control', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('rejects non-admin authenticated requests with 403', async () => {
      const token = await registerUser(app);
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('self-service', () => {
    it('GET /api/users/me returns the authenticated user', async () => {
      const { token } = await createRegularUser(app, 'me@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.email).toBe('me@example.com');
      expect(res.body).not.toHaveProperty('password');
    });

    it('GET /api/users/me rejects unauthenticated with 401', async () => {
      await request(app.getHttpServer()).get('/api/users/me').expect(401);
    });

    it('PATCH /api/users/me updates allowed profile fields only', async () => {
      const { token } = await createRegularUser(app);
      const res = await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Renamed', timezone: 'Asia/Manila' })
        .expect(200);
      expect(res.body.firstName).toBe('Renamed');
      expect(res.body.timezone).toBe('Asia/Manila');

      // Disallowed fields (role, email) rejected by the whitelist.
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'admin' })
        .expect(400);
    });

    it('DELETE /api/users/me soft-deletes (deletedAt + deletedBy set, isActive untouched) and blocks login', async () => {
      const { id, token } = await createRegularUser(
        app,
        'self-del@example.com',
      );
      await request(app.getHttpServer())
        .delete('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const prisma = app.get(PrismaService);
      const row = await prisma.user.findUniqueOrThrow({ where: { id } });
      // isActive stays `true` — it's reserved for explicit suspension,
      // not double-signalling deletion. deletedAt is the lifecycle gate.
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(id);

      // Token invalidated via JwtStrategy's deletedAt check.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      // Login refuses the account even with the right password.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'self-del@example.com', password: PASSWORD })
        .expect(401);
    });

    it('POST /api/users/me/gdpr-erase anonymizes PII and blocks login', async () => {
      const { id, token } = await createRegularUser(app, 'erase@example.com');

      await request(app.getHttpServer())
        .post('/api/users/me/gdpr-erase')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD })
        .expect(204);

      const prisma = app.get(PrismaService);
      const row = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(row.email).not.toBe('erase@example.com');
      expect(row.email).toMatch(/^deleted-.+@deleted\.invalid$/);
      expect(row.firstName).toBe('Deleted');
      expect(row.lastName).toBe('User');
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(id);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'erase@example.com', password: PASSWORD })
        .expect(401);
    });

    it('POST /api/users/me/gdpr-erase rejects wrong password with 401', async () => {
      const { token } = await createRegularUser(app, 'wrong-erase@example.com');
      await request(app.getHttpServer())
        .post('/api/users/me/gdpr-erase')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'definitely-not-right-1' })
        .expect(401);
    });

    it('PATCH /api/users/me/username changes username', async () => {
      const { token } = await createRegularUser(app);
      const res = await request(app.getHttpServer())
        .patch('/api/users/me/username')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'Handle_01' })
        .expect(200);
      expect(res.body.username).toBe('handle_01');
    });

    it('PATCH /api/users/me/username returns 409 on duplicate', async () => {
      const a = await createRegularUser(app, 'a@example.com');
      await request(app.getHttpServer())
        .patch('/api/users/me/username')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ username: 'taken' })
        .expect(200);

      const b = await createRegularUser(app, 'b@example.com');
      await request(app.getHttpServer())
        .patch('/api/users/me/username')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ username: 'taken' })
        .expect(409);
    });

    it('PATCH /api/users/me/email changes the sign-in address and returns a fresh session', async () => {
      const { id, token } = await createRegularUser(app, 'old@example.com');
      const prisma = app.get(PrismaService);

      const res = await request(app.getHttpServer())
        .patch('/api/users/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: 'New@example.com', currentPassword: PASSWORD })
        .expect(200);
      expect(res.body.user.email).toBe('new@example.com');
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
      });

      // The caller stays signed in on the returned token.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken as string}`)
        .expect(200);
      // And signs in with the new address from now on.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'new@example.com', password: PASSWORD })
        .expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.email_changed', targetUserId: id },
      });
      expect(audit.actorId).toBe(id);
      expect(audit.metadata).toMatchObject({
        previousEmail: 'old@example.com',
        newEmail: 'new@example.com',
      });
    });

    it('PATCH /api/users/me/email to the current address records no change', async () => {
      const { id, token } = await createRegularUser(app, 'same@example.com');
      await request(app.getHttpServer())
        .patch('/api/users/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: 'Same@Example.com', currentPassword: PASSWORD })
        .expect(200);
      expect(
        await app.get(PrismaService).auditLog.count({
          where: { action: 'user.email_changed', targetUserId: id },
        }),
      ).toBe(0);
    });

    it('PATCH /api/users/me/email rejects wrong current password with 401', async () => {
      const { token } = await createRegularUser(app);
      await request(app.getHttpServer())
        .patch('/api/users/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({
          newEmail: 'x@example.com',
          currentPassword: 'wrong-password-1',
        })
        .expect(401);
    });

    // A current password over 72 bytes can never match a stored one: refused
    // as input, before bcrypt, on every route that checks one.
    it('PATCH /api/users/me/password refuses a current password over 72 bytes', async () => {
      const { token } = await createRegularUser(app, 'pw-bytes@example.com');
      const res = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: `${'ñ'.repeat(36)}a1`,
          newPassword: 'new-password-1',
        })
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('PATCH /api/users/me/password requires current password and keeps the caller signed in', async () => {
      const { token } = await createRegularUser(app, 'pw@example.com');
      await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrong-password-1',
          newPassword: 'new-password-1',
        })
        .expect(401);

      const res = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'new-password-1' })
        .expect(200);
      expect(res.body.user.email).toBe('pw@example.com');
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken as string}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'pw@example.com', password: 'new-password-1' })
        .expect(200);
    });

    it('PATCH /api/users/me/password takes the sign-up rule: 8 characters, not 7', async () => {
      const { token } = await createRegularUser(app, 'pw-rule@example.com');
      const refused = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'secret1' })
        .expect(400);
      expect(refused.body.errorCode).toBe('VALIDATION_FAILED');

      await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'secret12' })
        .expect(200);
    });

    // Profile images are uploaded files now (`POST /files`, then
    // `PUT /users/me/profile-image { fileId }`). The old URL-taking PATCH on
    // that path is gone, and a client still sending it gets a clear refusal
    // rather than a silently ignored field.
    it('no longer serves PATCH /api/users/me/profile-image', async () => {
      const { token } = await createRegularUser(app);
      await request(app.getHttpServer())
        .patch('/api/users/me/profile-image')
        .set('Authorization', `Bearer ${token}`)
        .send({ profileImageUrl: 'https://cdn.example.com/me.jpg' })
        .expect(404);
    });

    it('GET /api/users/me/export returns the user JSON', async () => {
      const { token } = await createRegularUser(app, 'export@example.com');
      const res = await request(app.getHttpServer())
        .get('/api/users/me/export')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.email).toBe('export@example.com');
      expect(res.body).not.toHaveProperty('password');
    });
  });

  describe('as ADMIN', () => {
    let adminToken: string;
    let adminId: string;

    beforeEach(async () => {
      ({ id: adminId, token: adminToken } = await createPlatformAdmin(app));
    });

    // A date-time without an offset is read in the process's zone, so the day
    // stored moves on any host not in UTC — back east of it at midnight,
    // forward west of it late at night — unless the process runs in the
    // application zone.
    it.each(['T00:00:00', 'T23:59:59'])(
      'POST /api/users stores the birthday a date-time without an offset names (%s), whatever the host zone',
      async (timeOfDay) => {
        const res = await request(app.getHttpServer())
          .post('/api/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            email: 'birthday@example.com',
            password: PASSWORD,
            firstName: 'Birth',
            lastName: 'Day',
            birthday: `1990-05-15${timeOfDay}`,
          })
          .expect(201);

        const stored = await app
          .get(PrismaService)
          .user.findUniqueOrThrow({ where: { id: res.body.id as string } });
        expect(stored.birthday?.toISOString().slice(0, 10)).toBe('1990-05-15');
      },
    );

    // The admin create/update bodies used to accept any URL as a profile
    // image. That field is gone: an image is an uploaded file the person
    // attaches themselves.
    it('refuses profileImageUrl on POST /api/users and PATCH /api/users/:id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'url-field@example.com',
          password: PASSWORD,
          firstName: 'Url',
          lastName: 'Field',
          profileImageUrl: 'https://cdn.example.com/me.jpg',
        })
        .expect(400);
      expect(created.body.errorCode).toBe('VALIDATION_FAILED');

      const updated = await request(app.getHttpServer())
        .patch(`/api/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ profileImageUrl: 'https://cdn.example.com/me.jpg' })
        .expect(400);
      expect(updated.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('GET /api/users returns a paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toMatchObject({
        meta: { page: 1, perPage: 20, total: 1, totalPages: 1 },
      });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        email: 'admin@example.com',
      });
      // `role` is gone from the user representation entirely — authorization
      // lives in `user_roles` / `workspace_members`, never on the user row.
      expect(res.body.data[0]).not.toHaveProperty('role');
      expect(res.body.data[0]).not.toHaveProperty('password');
    });

    // P2002 → 409 envelope contract.
    it('POST /api/users emits the UNIQUE_CONSTRAINT_VIOLATION envelope on a duplicate email', async () => {
      const newUser = {
        email: 'dup-admin@example.com',
        password: PASSWORD,
        firstName: 'Dup',
        lastName: 'User',
      };
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newUser)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...newUser, firstName: 'Second' })
        .expect(409);

      expect(res.body.errorCode).toBe('UNIQUE_CONSTRAINT_VIOLATION');
      expect(res.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        details: { field: 'email' },
        path: '/api/users',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });

    it('GET /api/users honors page and perPage query params', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'second@example.com',
          password: PASSWORD,
          firstName: 'Second',
          lastName: 'User',
        });

      const page1 = await request(app.getHttpServer())
        .get('/api/users?page=1&perPage=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page1.body.meta).toEqual({
        page: 1,
        perPage: 1,
        total: 2,
        totalPages: 2,
      });
      expect(page1.body.data).toHaveLength(1);

      const page2 = await request(app.getHttpServer())
        .get('/api/users?page=2&perPage=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    });

    it('GET /api/users rejects invalid pagination params with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/users?page=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/users?perPage=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('GET /api/users filters by isDeleted, and lists both without it', async () => {
      const kept = await createRegularUser(app, 'kept@example.com');
      const gone = await createRegularUser(app, 'gone@example.com');
      await request(app.getHttpServer())
        .delete(`/api/users/${gone.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const idsFor = async (query: string) =>
        (
          (
            await request(app.getHttpServer())
              .get(`/api/users${query}`)
              .set('Authorization', `Bearer ${adminToken}`)
              .expect(200)
          ).body as { data: Array<{ id: string }>; meta: { total: number } }
        ).data.map((user) => user.id);

      const live = await idsFor('?isDeleted=false');
      expect(live).toContain(kept.id);
      expect(live).not.toContain(gone.id);
      expect(await idsFor('?isDeleted=true')).toEqual([gone.id]);
      expect(await idsFor('')).toEqual(
        expect.arrayContaining([kept.id, gone.id]),
      );
    });

    it('GET /api/users clamps perPage above 100 to 100', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users?perPage=9999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.meta.perPage).toBe(100);
    });

    it('POST /api/users creates an account that must replace its first password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'new@example.com',
          password: PASSWORD,
          firstName: 'New',
          lastName: 'Person',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'new@example.com',
        isActive: true,
        isPasswordChangeRequired: true,
      });
      expect(res.body).not.toHaveProperty('password');
      const audit = await app.get(PrismaService).auditLog.findFirstOrThrow({
        where: { action: 'user.created.by_admin' },
      });
      expect(audit.actorId).toBe(adminId);
    });

    it('POST /api/users is refused to an account that does not administer users', async () => {
      const { token } = await createRegularUser(app, 'plain@example.com');
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'new@example.com',
          password: PASSWORD,
          firstName: 'New',
          lastName: 'Person',
        })
        .expect(403);
      expect(
        await app
          .get(PrismaService)
          .user.count({ where: { email: 'new@example.com' } }),
      ).toBe(0);
    });

    it('PATCH /api/users/:id with a new email moves the account and audits it', async () => {
      const target = await createRegularUser(app, 'before@example.com');
      await request(app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'after@example.com' })
        .expect(200);
      const row = await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.email).toBe('after@example.com');
      const audit = await app.get(PrismaService).auditLog.findFirstOrThrow({
        where: { action: 'user.email_changed', targetUserId: target.id },
      });
      expect(audit.actorId).toBe(adminId);
      expect(audit.metadata).toMatchObject({
        previousEmail: 'before@example.com',
        newEmail: 'after@example.com',
      });
    });

    // Audit columns (createdBy/updatedBy/deletedBy) are intentionally
    // hidden from the API response and not in the body. Verify via the
    // DB row directly — the columns still exist for reporting.
    it('POST /api/users sets createdBy and updatedBy to the acting admin (DB-side assertion)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'audited@example.com',
          password: PASSWORD,
          firstName: 'Audited',
          lastName: 'User',
        })
        .expect(201);
      expect(res.body).not.toHaveProperty('createdBy');
      expect(res.body).not.toHaveProperty('updatedBy');

      const row = await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.createdBy).toBe(adminId);
      expect(row.updatedBy).toBe(adminId);
    });

    it('PATCH /api/users/:id updates updatedBy but leaves createdBy intact (DB-side assertion)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'audit-patch@example.com',
          password: PASSWORD,
          firstName: 'Audit',
          lastName: 'Patch',
        });
      const prisma = app.get(PrismaService);
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: created.body.id },
      });

      const other = await createPlatformAdmin(app, 'other-admin@example.com');
      await request(app.getHttpServer())
        .patch(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ firstName: 'Renamed' })
        .expect(200);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(after.createdBy).toBe(before.createdBy);
      expect(after.updatedBy).toBe(other.id);
    });

    it('GET /api/users/:id returns a user', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'find@example.com',
          password: PASSWORD,
          firstName: 'Find',
          lastName: 'Me',
        });

      const res = await request(app.getHttpServer())
        .get(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.email).toBe('find@example.com');
    });

    it('GET /api/users/:id with non-existent UUID returns 404 with RESOURCE_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      expect(res.body.errorCode).toBe('RESOURCE_NOT_FOUND');
      expect(res.body.details).toEqual({ resource: 'User' });
    });

    it('GET /api/users/:id with invalid UUID returns 400', async () => {
      await request(app.getHttpServer())
        .get('/api/users/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('PATCH /api/users/:id updates and persists changes', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'patch@example.com',
          password: PASSWORD,
          firstName: 'Patch',
          lastName: 'Me',
        });

      const patched = await request(app.getHttpServer())
        .patch(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Patched', isActive: false })
        .expect(200);
      expect(patched.body).toMatchObject({
        firstName: 'Patched',
        isActive: false,
      });

      const refetched = await request(app.getHttpServer())
        .get(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(refetched.body.firstName).toBe('Patched');
      expect(refetched.body.isActive).toBe(false);
    });

    it('PATCH /api/users/:id/password refuses admin self-target (H3)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${adminId}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'new-admin-password-1' })
        .expect(403);
    });

    it('old token is rejected after password change (H2)', async () => {
      const { token } = await createRegularUser(app, 'rotate@example.com');
      await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'rotated-password-1' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('PATCH /api/users/:id/password lets admin reset without current password', async () => {
      const target = await createRegularUser(app, 'target@example.com');
      await request(app.getHttpServer())
        .patch(`/api/users/${target.id}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'secret1' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/users/${target.id}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'secret12' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'target@example.com', password: 'secret12' })
        .expect(200);
    });

    it('DELETE /api/users/:id soft-deletes (row remains, admin can still see it)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'gone@example.com',
          password: PASSWORD,
          firstName: 'Gone',
          lastName: 'Soon',
        });

      await request(app.getHttpServer())
        .delete(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // Admin can still fetch the soft-deleted row via the API — but
      // `deletedAt`/`deletedBy` are hidden from the response (frontend
      // sees only `createdAt`/`updatedAt`). Deletion metadata is
      // asserted at the DB layer; reports read from there.
      const after = await request(app.getHttpServer())
        .get(`/api/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(after.body).not.toHaveProperty('deletedAt');
      expect(after.body).not.toHaveProperty('deletedBy');

      const row = await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(adminId);

      // But the deleted user can't log in.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'gone@example.com', password: PASSWORD })
        .expect(401);
    });
  });
});
