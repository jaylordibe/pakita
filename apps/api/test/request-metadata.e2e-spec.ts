import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './setup/db';
import { createUser, seedRbacCatalog } from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface RequestEnvelope {
  requestId?: string;
  ip?: string;
  country?: string;
  cfRay?: string;
  method?: string;
  path?: string;
}

/**
 * The correlation contract.
 *
 * `X-Request-Id` is what ties a user-reported failure to a log line to an audit
 * row. It is only worth anything if all three carry the SAME value, and the
 * value is only safe if it cannot be chosen freely by the caller — the audit
 * envelope is the one place the platform claims to know what really happened.
 */
describe('Request metadata (e2e)', () => {
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

  // Signing out audits unconditionally, so it is the cheapest way to get an
  // audit row with a request envelope attached.
  const logoutWith = async (
    headers: Record<string, string>,
    email: string,
    path = '/api/auth/logout',
  ) => {
    const { token } = await createUser(app, { email });
    const pending = request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    for (const [name, value] of Object.entries(headers)) {
      void pending.set(name, value);
    }
    return pending.expect(204);
  };

  const auditEnvelope = async (): Promise<RequestEnvelope> => {
    const prisma = app.get(PrismaService);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.logout' },
      orderBy: { createdAt: 'desc' },
    });
    return (row.metadata as { request?: RequestEnvelope }).request ?? {};
  };

  describe('correlation', () => {
    it('the response header and the audit row carry the SAME id when NONE is supplied', async () => {
      // The case that was broken and that no previous test could catch: pino's
      // `genReqId` and the CLS `idGenerator` each minted their OWN UUID, so the
      // header the client sees and the id recorded in `audit_logs` disagreed on
      // every request that did not carry the header — i.e. essentially all real
      // traffic. A test that always SENDS the header agrees by luck.
      const response = await logoutWith({}, 'nohead@example.com');

      const headerId = response.headers['x-request-id'];
      expect(headerId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect((await auditEnvelope()).requestId).toBe(headerId);
    });

    it('honours a well-formed client-supplied id end to end', async () => {
      const response = await logoutWith(
        { 'X-Request-Id': 'client-trace-123' },
        'supplied@example.com',
      );

      expect(response.headers['x-request-id']).toBe('client-trace-123');
      expect((await auditEnvelope()).requestId).toBe('client-trace-123');
    });
  });

  describe('a client-supplied id is untrusted input', () => {
    it('replaces an oversized id rather than persisting it', async () => {
      // Uncapped, this is ~16 KiB of attacker-chosen data per request into the
      // audit_logs JSONB column, from an unauthenticated endpoint.
      const oversized = 'a'.repeat(5_000);
      const response = await logoutWith(
        { 'X-Request-Id': oversized },
        'oversized@example.com',
      );

      expect(response.headers['x-request-id']).not.toBe(oversized);
      const envelope = await auditEnvelope();
      expect(envelope.requestId).not.toBe(oversized);
      expect(envelope.requestId?.length).toBeLessThanOrEqual(200);
    });

    it('replaces an id carrying characters outside the safe set', async () => {
      // CR/LF is not tested here: Node's own HTTP client refuses to serialise a
      // header containing it, so that vector never reaches this code. The unit
      // spec covers it directly. What CAN arrive over the wire is anything
      // else printable — quotes and spaces break out of a quoted logfmt field,
      // and the value lands in a JSONB column read by admins.
      const injected = 'forged" level=error msg="owned';
      const response = await logoutWith(
        { 'X-Request-Id': injected },
        'injected@example.com',
      );

      const headerId = response.headers['x-request-id'];
      expect(headerId).not.toBe(injected);
      expect(headerId).toMatch(/^[A-Za-z0-9._~-]+$/);
      // …and the replacement is what gets persisted, so the log and the audit
      // row still agree.
      expect((await auditEnvelope()).requestId).toBe(headerId);
    });
  });

  // The audit envelope is the DURABLE URL sink. Four other sinks (pino's
  // `req.url`, pino's `req.query`, the exception filter's log line and the error
  // envelope's `path`) were redacted while this one was not, so a query-string
  // credential still reached the database — the table an incident responder
  // reads, and every backup of it.
  describe('secrets in the query string', () => {
    // A request that succeeds and writes an audit row, deliberately: a request
    // that fails before any row is written would assert against a row that
    // does not exist — which is exactly how the first version of this test
    // passed while proving nothing.
    it('redacts a query-string credential out of the persisted audit path', async () => {
      const secret = 'a-query-string-secret-value';
      await logoutWith(
        {},
        'audit-path-redaction@example.com',
        `/api/auth/logout?token=${secret}`,
      );

      const persistedPath = (await auditEnvelope()).path;
      expect(persistedPath).toBe('/api/auth/logout?token=[redacted]');
      expect(persistedPath).not.toContain(secret);
    });

    // The error envelope goes back to the client and straight into client-side
    // error trackers, so it is a second distribution channel for the same
    // credential.
    it('redacts the credential out of the error envelope path', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users/me?token=NOT-A-REAL-TOKEN-VALUE')
        .expect(401);

      const body = response.body as { path: string };
      expect(body.path).toBe('/api/users/me?token=[redacted]');
      expect(body.path).not.toContain('NOT-A-REAL-TOKEN-VALUE');
    });

    // An unmatched route is answered inside the `/api` router mount, where
    // Express rewrites `req.url` relative to the mount. The envelope must still
    // report the path the client sent — prefix included, secrets redacted.
    it('reports the full client path for an unmatched route', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/does-not-exist?token=NOT-A-REAL-TOKEN-VALUE')
        .expect(404);

      const body = response.body as { path: string; errorCode: string };
      expect(body.errorCode).toBe('RESOURCE_NOT_FOUND');
      expect(body.path).toBe('/api/does-not-exist?token=[redacted]');
    });
  });

  // The body parser rejects these before any handler runs. They are the
  // client's fault, so they answer 4xx through the envelope — never a 500.
  describe('bodies the parser rejects', () => {
    it('answers an oversized body with 413 PAYLOAD_TOO_LARGE', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ identifier: 'x'.repeat(2_000_000) }))
        .expect(413);

      expect((response.body as { errorCode: string }).errorCode).toBe(
        'PAYLOAD_TOO_LARGE',
      );
    });

    it('answers an unsupported charset with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json; charset=klingon')
        .send('{}')
        .expect(415);

      expect((response.body as { errorCode: string }).errorCode).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
    });
  });

  describe('Cloudflare headers', () => {
    // `.env.test` leaves TRUST_CLOUDFLARE_HEADERS unset, so the suite runs with
    // the safe default. That is deliberate: the default is what a fork inherits.
    it('are IGNORED when trust is disabled', async () => {
      await logoutWith(
        {
          'CF-Connecting-IP': '203.0.113.9',
          'CF-IPCountry': 'XX',
          'CF-Ray': 'forged-ray-id',
        },
        'cf@example.com',
      );

      const envelope = await auditEnvelope();
      // The forged IP must not become the recorded one — audit_logs is the
      // table an incident responder trusts.
      expect(envelope.ip).not.toBe('203.0.113.9');
      expect(typeof envelope.ip).toBe('string');
      // A missing field is honest; a forged one is not.
      expect(envelope.country).toBeUndefined();
      expect(envelope.cfRay).toBeUndefined();
    });
  });

  it('records the server-vouched method and path, not anything the caller sent', async () => {
    await logoutWith({}, 'envelope@example.com');

    expect(await auditEnvelope()).toMatchObject({
      method: 'POST',
      path: '/api/auth/logout',
    });
  });
});
