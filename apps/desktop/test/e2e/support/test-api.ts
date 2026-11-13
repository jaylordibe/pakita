import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';
import { Client } from 'pg';

/**
 * A real Pakita API for the desktop's end-to-end tests: the built API
 * (apps/api/dist) on a free port, against its own throwaway database on the
 * API's TEST stack (`pnpm --filter @pakita/api stack:up` or `pretest:e2e`),
 * configured from the API's committed `.env.test` — never `.env`, never a
 * developer's data.
 */

const API_DIRECTORY = resolve(__dirname, '../../../../api');
const TEST_PASSWORD = 'correct-horse-battery-1';
// Redis logical database 15: the API's own e2e workers use 1 and up.
const REDIS_DATABASE_INDEX = 15;

export interface TestAccount {
  readonly identifier: string;
  readonly password: string;
}

export interface TestWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface TestApi {
  readonly origin: string;
  readonly owner: TestAccount;
  readonly workspace: TestWorkspace;
  /** An authenticated JSON request as the workspace owner. */
  request<Result>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result>;
  /** Stops the server: the desktop is now offline. */
  stop(): Promise<void>;
  /** Starts it again on the same port and database. */
  start(): Promise<void>;
  /** Stops the server and drops its database. */
  dispose(): Promise<void>;
}

function loadTestEnvironment(databaseName: string, port: number) {
  const parsed = parse(readFileSync(resolve(API_DIRECTORY, '.env.test')));
  const { parsed: expanded } = expand({ parsed, processEnv: {} });
  const environment = { ...(expanded as Record<string, string>) };
  environment.DB_NAME = databaseName;
  environment.DATABASE_URL = environment.DATABASE_URL!.replace(
    /\/[^/?]+(\?|$)/,
    `/${databaseName}$1`,
  );
  environment.REDIS_URL = environment.REDIS_URL!.replace(
    /\/\d+$/,
    `/${REDIS_DATABASE_INDEX}`,
  );
  environment.PORT = String(port);
  return environment;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        resolvePort(typeof address === 'object' && address ? address.port : 0),
      );
    });
  });
}

async function withAdminClient<Result>(
  databaseUrl: string,
  work: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client({
    connectionString: databaseUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1'),
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function runInApi(command: string, args: string[], environment: object): void {
  const result = spawnSync(command, args, {
    cwd: API_DIRECTORY,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

// Cloudflare's published test keys: the site key's widget always passes and
// works on any hostname; the secret accepts only its dummy token.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TURNSTILE_TEST_KEYS = {
  TURNSTILE_WEB_SECRET: '1x0000000000000000000000000000000AA',
  TURNSTILE_MOBILE_SECRET: '1x0000000000000000000000000000000AA',
  TURNSTILE_MOBILE_SITE_KEY: '1x00000000000000000000AA',
};

export async function startTestApi(
  options: {
    isBotCheckOn?: boolean;
    /** The owner is also a platform administrator (may import Bibles). */
    isOwnerPlatformAdmin?: boolean;
  } = {},
): Promise<TestApi> {
  const port = await freePort();
  const databaseName = `pakita_desktop_e2e_${process.pid}_${options.isBotCheckOn ? 'turnstile' : 'plain'}`;
  const environment: Record<string, string> = {
    ...loadTestEnvironment(databaseName, port),
    // The bot check is on only where asked; registering the owner below
    // then needs a token too, which the test keys' dummy token provides.
    ...(options.isBotCheckOn ? TURNSTILE_TEST_KEYS : {}),
  };
  const origin = `http://127.0.0.1:${port}`;

  await withAdminClient(environment.DATABASE_URL!, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });
  runInApi('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], environment);
  runInApi('pnpm', ['rbac:sync'], environment);

  let server: ChildProcess | null = null;
  const start = async () => {
    server = spawn(process.execPath, ['dist/main.js'], {
      cwd: API_DIRECTORY,
      env: { ...process.env, ...environment },
      stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`${origin}/api/health/liveness`);
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    throw new Error('The test API did not start');
  };
  const stop = async () => {
    const running = server;
    server = null;
    if (!running || running.exitCode !== null) return;
    await new Promise<void>((resolveExit) => {
      running.once('exit', () => resolveExit());
      running.kill('SIGTERM');
    });
  };

  await start();

  // A verified account that owns one workspace.
  const email = `owner-${process.pid}-${Date.now()}@example.org`;
  const send = async <Result>(
    method: string,
    path: string,
    body: unknown,
    token?: string,
  ): Promise<Result> => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.isBotCheckOn
          ? { 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as Result;
  };
  await send('POST', '/api/auth/register', {
    email,
    password: TEST_PASSWORD,
    firstName: 'Grace',
    lastName: 'Owner',
  });
  const database = new Client({ connectionString: environment.DATABASE_URL });
  await database.connect();
  try {
    await database.query(
      'UPDATE users SET email_verified_at = now() WHERE email = $1',
      [email],
    );
    // Before the first sign-in, so no permission cache holds the old grants.
    if (options.isOwnerPlatformAdmin) {
      await database.query(
        `INSERT INTO user_roles (id, user_id, role_id)
         SELECT gen_random_uuid(), users.id, roles.id FROM users, roles
         WHERE users.email = $1 AND roles.name = 'platform_admin'`,
        [email],
      );
    }
  } finally {
    await database.end();
  }
  const login = await send<{ accessToken: string }>('POST', '/api/auth/login', {
    identifier: email,
    password: TEST_PASSWORD,
  });
  const workspace = await send<TestWorkspace>(
    'POST',
    '/api/workspaces',
    { name: 'Grace Church', slug: `grace-${process.pid}` },
    login.accessToken,
  );

  return {
    origin,
    owner: { identifier: email, password: TEST_PASSWORD },
    workspace,
    request: (method, path, body) =>
      send(method, path, body, login.accessToken),
    stop,
    start,
    dispose: async () => {
      await stop();
      await withAdminClient(environment.DATABASE_URL!, async (client) => {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [databaseName],
        );
        await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      });
    },
  };
}
