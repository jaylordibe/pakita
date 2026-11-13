import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiClient } from '../api/api-client';
import { CredentialStore, type SecretEncryption } from './credential-store';
import { Session, SignInRequiredError } from './session';

const keychain: SecretEncryption = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plainText) => Buffer.from(plainText, 'utf8'),
  decryptStringAsync: async (encrypted) => ({
    result: encrypted.toString('utf8'),
    shouldReEncrypt: false,
  }),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const tokens = (generation: number) => ({
  accessToken: `access-${generation}`,
  refreshToken: `refresh-${generation}`,
  expiresIn: 900,
  user: {
    id: 'user-1',
    email: 'operator@example.org',
    firstName: 'Ann',
    lastName: 'Operator',
  },
});

/** A tiny fake server: login, rotating refresh, and one protected route. */
function fakeServer() {
  const state = {
    generation: 1,
    refreshCalls: 0,
    expiredAccessTokens: new Set<string>(),
    isSessionRevoked: false,
    lastTurnstileToken: null as string | null,
    /** When set, a refresh waits for it before answering. */
    refreshGate: null as Promise<void> | null,
    loggedOutTokens: [] as string[],
  };
  const fetchFunction = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as {
      refreshToken?: string;
    };
    if (path === '/api/auth/login') {
      state.lastTurnstileToken = headers['X-Turnstile-Token'] ?? null;
      return json(200, tokens(state.generation));
    }
    if (path === '/api/auth/logout') {
      state.loggedOutTokens.push(body.refreshToken ?? '');
      return new Response(null, { status: 204 });
    }
    if (path === '/api/auth/refresh') {
      state.refreshCalls += 1;
      if (state.refreshGate) await state.refreshGate;
      if (
        state.isSessionRevoked ||
        body.refreshToken !== `refresh-${state.generation}`
      ) {
        return json(401, { errorCode: 'REFRESH_TOKEN_INVALID' });
      }
      state.generation += 1;
      return json(200, tokens(state.generation));
    }
    if (path === '/api/protected') {
      const token = headers.Authorization?.replace('Bearer ', '') ?? '';
      if (state.expiredAccessTokens.has(token)) {
        return json(401, { errorCode: 'TOKEN_EXPIRED' });
      }
      return json(200, { token });
    }
    return json(404, { errorCode: 'RESOURCE_NOT_FOUND' });
  };
  return { state, fetchFunction };
}

const protectedRequest = {
  method: 'GET' as const,
  path: '/api/protected',
  schema: z.object({ token: z.string() }),
};

describe('Session', () => {
  let directory: string;
  let server: ReturnType<typeof fakeServer>;
  let store: CredentialStore;
  let session: Session;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-session-'));
    server = fakeServer();
    store = new CredentialStore(directory, keychain);
    session = await Session.restore(
      new ApiClient('https://pakita.example.org', server.fetchFunction),
      store,
      null,
    );
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('signs in with the Turnstile token and remembers the account', async () => {
    const account = await session.signIn('operator', 'secret', 'ts-token');

    expect(server.state.lastTurnstileToken).toBe('ts-token');
    expect(account).toEqual({
      origin: 'https://pakita.example.org',
      userId: 'user-1',
      email: 'operator@example.org',
      displayName: 'Ann Operator',
    });
    await expect(store.loadRefreshToken()).resolves.toBe('refresh-1');
    expect(session.isSignedIn).toBe(true);
    await expect(session.request(protectedRequest)).resolves.toEqual({
      token: 'access-1',
    });
  });

  it('refreshes once for concurrent requests after a restart', async () => {
    await session.signIn('operator', 'secret', null);
    const restarted = await Session.restore(
      new ApiClient('https://pakita.example.org', server.fetchFunction),
      store,
      store.loadAccount(),
    );

    const results = await Promise.all([
      restarted.request(protectedRequest),
      restarted.request(protectedRequest),
      restarted.request(protectedRequest),
    ]);
    expect(server.state.refreshCalls).toBe(1);
    expect(results.map((result) => result.token)).toEqual([
      'access-2',
      'access-2',
      'access-2',
    ]);
    await expect(store.loadRefreshToken()).resolves.toBe('refresh-2');
  });

  it('refreshes and retries once when the server says the token expired', async () => {
    await session.signIn('operator', 'secret', null);
    server.state.expiredAccessTokens.add('access-1');

    await expect(session.request(protectedRequest)).resolves.toEqual({
      token: 'access-2',
    });
  });

  it('asks for a new sign-in when the session was revoked, keeping the account', async () => {
    await session.signIn('operator', 'secret', null);
    server.state.expiredAccessTokens.add('access-1');
    server.state.isSessionRevoked = true;

    await expect(session.request(protectedRequest)).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
    await expect(store.loadRefreshToken()).resolves.toBeNull();
    expect(session.getAccount()).not.toBeNull();
    expect(session.isSignedIn).toBe(false);
  });

  it('forgets everything on sign-out', async () => {
    await session.signIn('operator', 'secret', null);
    await session.signOut();
    expect(store.loadAccount()).toBeNull();
    await expect(store.loadRefreshToken()).resolves.toBeNull();
    await expect(session.request(protectedRequest)).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
  });

  describe('a refresh still in flight', () => {
    async function pendingRefresh() {
      await session.signIn('operator', 'secret', null);
      let release!: () => void;
      server.state.refreshGate = new Promise((resolve) => {
        release = resolve;
      });
      server.state.expiredAccessTokens.add('access-1');
      const request = session.request(protectedRequest);
      await vi.waitFor(() => expect(server.state.refreshCalls).toBe(1));
      return { request, release };
    }

    it('cannot undo a sign-out: its new token is ended, not stored', async () => {
      const { request, release } = await pendingRefresh();

      await session.signOut();
      release();

      await expect(request).rejects.toBeInstanceOf(SignInRequiredError);
      await vi.waitFor(() =>
        expect(server.state.loggedOutTokens).toContain('refresh-2'),
      );
      expect(existsSync(join(directory, 'credentials.bin'))).toBe(false);
      expect(store.loadAccount()).toBeNull();
      expect(session.isSignedIn).toBe(false);
    });

    it('cannot replace the tokens of someone who signed in meanwhile', async () => {
      const { request, release } = await pendingRefresh();
      server.state.generation = 7; // the next sign-in hands out tokens 7

      await session.signIn('second-operator', 'secret', null);
      release();

      await expect(request).rejects.toBeInstanceOf(SignInRequiredError);
      await expect(store.loadRefreshToken()).resolves.toBe('refresh-7');
      await expect(session.request(protectedRequest)).resolves.toEqual({
        token: 'access-7',
      });
    });
  });
});
