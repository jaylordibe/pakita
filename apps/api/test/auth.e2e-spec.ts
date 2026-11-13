import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { MAX_FAILED_SIGN_INS } from '../src/modules/auth/sign-in-failure-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './setup/test-app';
import { truncateAll } from './setup/db';
import {
  createPlatformAdmin,
  createUser,
  seedRbacCatalog,
  TEST_PASSWORD,
} from './setup/rbac';

const VALID_PASSWORD = TEST_PASSWORD;
const NEW_PASSWORD = 'a-password-of-my-own-2';

describe('Auth (e2e)', () => {
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

  const login = (
    identifier: string,
    password: string,
    address?: string,
    deviceTokens?: string[],
  ) => {
    const call = request(app.getHttpServer()).post('/api/auth/login');
    if (address) call.set('X-Forwarded-For', address);
    return call.send({
      identifier,
      password,
      ...(deviceTokens ? { deviceTokens } : {}),
    });
  };

  // There is no public sign-up: the routes that served it are gone.
  describe('removed public account routes', () => {
    it.each([
      ['post', '/api/auth/register'],
      ['post', '/api/auth/verify-email'],
      ['get', '/api/auth/verify-email'],
      ['post', '/api/auth/resend-verification'],
      ['post', '/api/users/request-password-reset'],
      ['post', '/api/users/reset-password'],
    ] as const)('%s %s answers 404', async (method, path) => {
      await request(app.getHttpServer())[method](path).send({}).expect(404);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await createUser(app, { email: 'bob@example.com', firstName: 'Bob' });
    });

    it('returns an access token for valid credentials', async () => {
      const res = await login('bob@example.com', VALID_PASSWORD).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.email).toBe('bob@example.com');
      expect(res.body.user.isPasswordChangeRequired).toBe(false);
    });

    it('login is case-insensitive on email', async () => {
      await login('BOB@example.com', VALID_PASSWORD).expect(200);
    });

    it('logs in with a username identifier (not just email)', async () => {
      const prisma = app.get(PrismaService);
      const bob = await prisma.user.findFirstOrThrow({
        where: { email: 'bob@example.com' },
      });
      await prisma.user.update({
        where: { id: bob.id },
        data: { username: 'bobby' },
      });
      await login('bobby', VALID_PASSWORD).expect(200);
    });

    it('answers a wrong password and an unknown identifier the same way', async () => {
      const wrong = await login('bob@example.com', 'wrong-password-1').expect(
        401,
      );
      const unknown = await login('nope@example.com', VALID_PASSWORD).expect(
        401,
      );
      expect(wrong.body.errorCode).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.errorCode).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    // Every stored password is at most 72 bytes, so a longer one can never
    // match: refused as input, before the account lookup or bcrypt.
    it('refuses a password over 72 bytes before checking it', async () => {
      const res = await login(
        'bob@example.com',
        // 38 characters, 74 bytes.
        `${'ñ'.repeat(36)}a1`,
      ).expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('checks a password of exactly 72 bytes', async () => {
      const res = await login(
        'bob@example.com',
        // 35 × 2 bytes + 2 = 72 bytes.
        `${'ñ'.repeat(35)}a1`,
      ).expect(401);
      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
    });

    it('returns expiresIn (seconds) matching the access token lifetime', async () => {
      const res = await login('bob@example.com', VALID_PASSWORD).expect(200);
      const claims = app
        .get(JwtService)
        .decode<{ iat: number; exp: number }>(res.body.accessToken as string);
      expect(res.body.expiresIn).toBe(claims.exp - claims.iat);
      expect(res.body.expiresIn).toBeGreaterThan(0);
    });
  });

  // The route throttles key on the client address; this limit does not, so
  // one account guessed at from many addresses is still slowed down.
  describe('failed sign-ins per account', () => {
    beforeEach(async () => {
      await createUser(app, { email: 'bob@example.com', firstName: 'Bob' });
      const prisma = app.get(PrismaService);
      const bob = await prisma.user.findFirstOrThrow({
        where: { email: 'bob@example.com' },
      });
      await prisma.user.update({
        where: { id: bob.id },
        data: { username: 'bobby' },
      });
      // Lets each request name its client address in X-Forwarded-For
      // (supertest connects from loopback).
      (app as unknown as NestExpressApplication).set('trust proxy', 'loopback');
    });

    afterEach(() => {
      (app as unknown as NestExpressApplication).set('trust proxy', false);
    });

    it('refuses even the right password once an account has used its failures, from every address', async () => {
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        // A new address every time, alternating email and username: both
        // name one account, so they spend one budget.
        await login(
          attempt % 2 === 0 ? 'bob@example.com' : 'bobby',
          'wrong-password-1',
          `198.51.100.${attempt + 1}`,
        ).expect(401);
      }

      const refused = await login(
        'bob@example.com',
        VALID_PASSWORD,
        '203.0.113.99',
      ).expect(429);
      expect(refused.body.errorCode).toBe('RATE_LIMITED');
    });

    it('compares at most the limit when guesses arrive all at once', async () => {
      const results = await Promise.all(
        Array.from({ length: MAX_FAILED_SIGN_INS * 3 }, (_, attempt) =>
          login(
            'bob@example.com',
            'wrong-password-1',
            `198.51.100.${attempt + 1}`,
          ),
        ),
      );
      const statuses = results.map((response) => response.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(
        MAX_FAILED_SIGN_INS,
      );
      expect(statuses.filter((status) => status === 429)).toHaveLength(
        MAX_FAILED_SIGN_INS * 2,
      );
    });

    it('lets the account in at once after an administrator resets its password', async () => {
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        await login('bob@example.com', 'wrong-password-1').expect(401);
      }
      await login('bob@example.com', VALID_PASSWORD).expect(429);

      const { token: adminToken } = await createPlatformAdmin(app);
      const bob = await app
        .get(PrismaService)
        .user.findFirstOrThrow({ where: { email: 'bob@example.com' } });
      await request(app.getHttpServer())
        .patch(`/api/users/${bob.id}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'reset-by-admin-3' })
        .expect(200);
      await login('bob@example.com', 'reset-by-admin-3').expect(200);
    });

    // OWASP's device cookies: a stranger's guesses must not keep out a device
    // the person has signed in from before.
    it('lets a device that signed in before through while strangers are limited', async () => {
      const first = await login('bob@example.com', VALID_PASSWORD).expect(200);
      const deviceToken = first.body.deviceToken as string;
      expect(deviceToken).toEqual(expect.any(String));

      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        await login('bob@example.com', 'wrong-password-1').expect(401);
      }
      await login('bob@example.com', VALID_PASSWORD).expect(429);

      const again = await login('bob@example.com', VALID_PASSWORD, undefined, [
        deviceToken,
      ]).expect(200);
      expect(again.body.deviceToken).not.toBe(deviceToken);
    });

    it('still limits guesses from a known device, on its own count', async () => {
      const first = await login('bob@example.com', VALID_PASSWORD).expect(200);
      const deviceTokens = [first.body.deviceToken as string];
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        await login(
          'bob@example.com',
          'wrong-password-1',
          undefined,
          deviceTokens,
        ).expect(401);
      }
      await login(
        'bob@example.com',
        VALID_PASSWORD,
        undefined,
        deviceTokens,
      ).expect(429);
      // The device's failures are its own: the account is not limited.
      await login('bob@example.com', VALID_PASSWORD).expect(200);
    });

    it('treats a device token for another account as no token', async () => {
      await createUser(app, { email: 'carol@example.com' });
      const carols = await login('carol@example.com', VALID_PASSWORD).expect(
        200,
      );
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        await login('bob@example.com', 'wrong-password-1').expect(401);
      }
      await login('bob@example.com', VALID_PASSWORD, undefined, [
        carols.body.deviceToken as string,
      ]).expect(429);
    });

    it('limits an identifier that names no account the same way', async () => {
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
        await login('nobody@example.com', 'wrong-password-1').expect(401);
      }
      const refused = await login('nobody@example.com', VALID_PASSWORD).expect(
        429,
      );
      expect(refused.body.errorCode).toBe('RATE_LIMITED');
      // Somebody else's account is untouched.
      await login('bob@example.com', VALID_PASSWORD).expect(200);
    });

    it('starts the count again after a correct password', async () => {
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS - 1; attempt += 1) {
        await login('bob@example.com', 'wrong-password-1').expect(401);
      }
      await login('bob@example.com', VALID_PASSWORD).expect(200);
      for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS - 1; attempt += 1) {
        await login('bob@example.com', 'wrong-password-1').expect(401);
      }
      await login('bob@example.com', VALID_PASSWORD).expect(200);
    });
  });

  // An administrator creates every account and chooses its first password;
  // until the person replaces it, their session reaches almost nothing.
  describe('password chosen by an administrator', () => {
    let adminToken: string;

    beforeEach(async () => {
      ({ token: adminToken } = await createPlatformAdmin(app));
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'new@example.com',
          password: VALID_PASSWORD,
          firstName: 'New',
          lastName: 'Person',
        })
        .expect(201)
        .expect((response) => {
          expect(response.body.isPasswordChangeRequired).toBe(true);
        });
    });

    it('signs in, but every other route answers PASSWORD_CHANGE_REQUIRED', async () => {
      const signedIn = await login('new@example.com', VALID_PASSWORD).expect(
        200,
      );
      expect(signedIn.body.user.isPasswordChangeRequired).toBe(true);
      const token = signedIn.body.accessToken as string;

      for (const path of ['/api/workspaces', '/api/users/me/permissions']) {
        const refused = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        expect(refused.body.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Changed' })
        .expect(403);
    });

    it('still lets the session read the account and sign out', async () => {
      const signedIn = await login('new@example.com', VALID_PASSWORD).expect(
        200,
      );
      const token = signedIn.body.accessToken as string;
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken: signedIn.body.refreshToken })
        .expect(204);
    });

    it('refuses "changing" the password to the one the administrator chose', async () => {
      const signedIn = await login('new@example.com', VALID_PASSWORD).expect(
        200,
      );
      const token = signedIn.body.accessToken as string;
      await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: VALID_PASSWORD, newPassword: VALID_PASSWORD })
        .expect(400);
      const refused = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(refused.body.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('lifts the restriction once the person chooses their own password', async () => {
      const signedIn = await login('new@example.com', VALID_PASSWORD).expect(
        200,
      );
      const changed = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
        .send({
          currentPassword: VALID_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        .expect(200);
      expect(changed.body.user.isPasswordChangeRequired).toBe(false);

      await request(app.getHttpServer())
        .get('/api/users/me/permissions')
        .set('Authorization', `Bearer ${changed.body.accessToken as string}`)
        .expect(200);
      // The administrator's password no longer works.
      await login('new@example.com', VALID_PASSWORD).expect(401);
      await login('new@example.com', NEW_PASSWORD).expect(200);
    });

    it('requires a new password again after an administrator resets it, and ends the old sessions', async () => {
      const signedIn = await login('new@example.com', VALID_PASSWORD).expect(
        200,
      );
      const own = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
        .send({
          currentPassword: VALID_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        .expect(200);
      const ownToken = own.body.accessToken as string;
      const userId = own.body.user.id as string;

      // A whole second, so the reset's session cutoff lands after this
      // session was issued (`iat` is whole seconds).
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const reset = await request(app.getHttpServer())
        .patch(`/api/users/${userId}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newPassword: 'reset-by-admin-3',
        })
        .expect(200);
      expect(reset.body.isPasswordChangeRequired).toBe(true);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${ownToken}`)
        .expect(401);
      const again = await login('new@example.com', 'reset-by-admin-3').expect(
        200,
      );
      expect(again.body.user.isPasswordChangeRequired).toBe(true);
      await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${again.body.accessToken as string}`)
        .expect(403);
    });
  });

  // Every audit_logs entry written inside an HTTP request gets a server-vouched
  // `metadata.request` envelope, populated by the ClsModule middleware
  // (app.module.ts) and merged in AuditService.
  describe('audit request-context envelope (ClsModule)', () => {
    it('auto-attaches metadata.request (requestId/method/path/userAgent/ip) to audit rows', async () => {
      await createUser(app, { email: 'envelope@example.com' });
      const signedIn = await login('envelope@example.com', VALID_PASSWORD);
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
        .set('User-Agent', 'AuditEnvelopeProbe/1.0')
        .set('X-Request-Id', 'test-req-id-123')
        .send({})
        .expect(204);

      const prisma = app.get(PrismaService);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.logout' },
      });
      const meta = audit.metadata as {
        request?: Record<string, unknown>;
      };
      expect(meta.request).toBeDefined();
      // requestId mirrors the supplied X-Request-Id (same value pino logs use).
      expect(meta.request).toMatchObject({
        requestId: 'test-req-id-123',
        method: 'POST',
        path: '/api/auth/logout',
        userAgent: 'AuditEnvelopeProbe/1.0',
      });
      // ip is resolved server-side (req.ip / CF header) — present, a string.
      expect(typeof meta.request?.ip).toBe('string');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the exact token it was called with; other tokens stay valid', async () => {
      await createUser(app, { email: 'logout@example.com' });

      const first = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'logout@example.com', password: VALID_PASSWORD });
      const second = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'logout@example.com', password: VALID_PASSWORD });

      const tokenA = first.body.accessToken;
      const tokenB = second.body.accessToken;

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('revokes every active token for the user', async () => {
      await createUser(app, { email: 'logout-all@example.com' });

      const loginA = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: 'logout-all@example.com',
          password: VALID_PASSWORD,
        });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const loginB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: 'logout-all@example.com',
          password: VALID_PASSWORD,
        });

      const tokenA = loginA.body.accessToken;
      const tokenB = loginB.body.accessToken;

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await request(app.getHttpServer())
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(401);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const loginC = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          identifier: 'logout-all@example.com',
          password: VALID_PASSWORD,
        })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${loginC.body.accessToken}`)
        .expect(200);
    });
  });

  describe('access token verification', () => {
    async function userIdFor(email: string): Promise<string> {
      return (await createUser(app, { email })).id;
    }

    const signAccessToken = (userId: string, options: object = {}): string =>
      app.get(JwtService).sign({ sub: userId }, options);

    it('accepts an access token signed as this service signs them', async () => {
      const id = await userIdFor('hs256@example.com');
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${signAccessToken(id)}`)
        .expect(200);
    });

    // Signed with the real secret, issuer and audience — only the algorithm
    // differs. Only HS256 is ever minted here, so nothing else is accepted.
    it.each(['HS384', 'HS512'] as const)(
      'refuses an access token signed %s (401)',
      async (algorithm) => {
        const id = await userIdFor(`${algorithm.toLowerCase()}@example.com`);
        await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Authorization', `Bearer ${signAccessToken(id, { algorithm })}`)
          .expect(401);
      },
    );
  });

  describe('GET /api/users/me', () => {
    let token: string;

    beforeEach(async () => {
      await createUser(app, {
        email: 'carol@example.com',
        firstName: 'Carol',
        lastName: 'Lee',
      });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'carol@example.com', password: VALID_PASSWORD });
      token = login.body.accessToken as string;
    });

    it('returns current user profile with valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        email: 'carol@example.com',
        firstName: 'Carol',
        isActive: true,
      });
      expect(res.body).not.toHaveProperty('password');
    });

    it('rejects request without a token with 401', async () => {
      await request(app.getHttpServer()).get('/api/users/me').expect(401);
    });

    it('rejects malformed token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', 'Bearer junk')
        .expect(401);
    });
  });
});
