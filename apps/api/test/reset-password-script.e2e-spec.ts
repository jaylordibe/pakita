import { INestApplication } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { MAX_FAILED_SIGN_INS } from '../src/modules/auth/sign-in-failure-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { truncateAll } from './setup/db';
import { createUser, seedRbacCatalog } from './setup/rbac';
import { createTestApp } from './setup/test-app';

// The server owner's way back in (deploy/reset-password.sh runs
// `pnpm account:reset-password` in the migrate image). Run here as the real
// script, in a child process, against this worker's database and Redis — the
// environment the harness already set up.

const NEW_PASSWORD = 'owner-chose-this-4';

function runResetScript(email: string, password: string) {
  return spawnSync('pnpm', ['account:reset-password'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, RESET_EMAIL: email, RESET_PASSWORD: password },
    encoding: 'utf8',
  });
}

describe('Server owner password reset script (e2e)', () => {
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

  const login = (identifier: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier, password });

  it('sets the password, ends every session, lifts a sign-in refusal and audits', async () => {
    const owner = await createUser(app, { email: 'owner@example.org' });
    // Someone has been guessing: the account is refused even the right password.
    for (let attempt = 0; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
      await login('owner@example.org', 'wrong-password-1').expect(401);
    }

    const result = runResetScript('Owner@Example.org', NEW_PASSWORD);
    expect(result.stderr).not.toContain(NEW_PASSWORD);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Password set for owner@example.org');

    // The session the fixture held is over.
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(401);
    // The new password works at once, and asks for no further change: the
    // owner chose it.
    const signedIn = await login('owner@example.org', NEW_PASSWORD).expect(200);
    expect(signedIn.body.user.isPasswordChangeRequired).toBe(false);

    const audit = await app.get(PrismaService).auditLog.findFirstOrThrow({
      where: { action: 'password.reset.by_server_owner' },
    });
    expect(audit.targetUserId).toBe(owner.id);
    expect(audit.actorId).toBeNull();
  });

  it('refuses an unknown email and changes nothing', () => {
    const result = runResetScript('nobody@example.org', NEW_PASSWORD);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No account uses nobody@example.org');
  });

  it('refuses a password the server would refuse', async () => {
    await createUser(app, { email: 'owner@example.org' });
    const result = runResetScript('owner@example.org', 'short');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RESET_PASSWORD');
    await login('owner@example.org', 'short').expect(400);
  });
});
