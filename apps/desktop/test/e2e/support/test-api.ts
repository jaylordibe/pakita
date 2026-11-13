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
  /** The platform administrator (creates accounts, sets passwords). */
  readonly administrator: TestAccount;
  readonly owner: TestAccount;
  readonly workspace: TestWorkspace;
  /** An authenticated JSON request as the workspace owner. */
  request<Result>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result>;
  /** An authenticated JSON request as the platform administrator. */
  adminRequest<Result>(
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
  // A value already in the environment wins, as in the API's own test setup
  // (dotenv never overrides), so the test stack can run on other ports.
  for (const key of Object.keys(parsed)) {
    const override = process.env[key];
    if (override !== undefined) parsed[key] = override;
  }
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

export async function startTestApi(): Promise<TestApi> {
  const port = await freePort();
  const databaseName = `pakita_desktop_e2e_${process.pid}`;
  const environment: Record<string, string> = loadTestEnvironment(
    databaseName,
    port,
  );
  const origin = `http://127.0.0.1:${port}`;

  await withAdminClient(environment.DATABASE_URL!, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });
  runInApi('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], environment);
  runInApi('pnpm', ['rbac:sync'], environment);

  // Accounts the way a church server gets them: its administrator from the
  // seeder (deploy/create-admin.sh runs the same), everyone else created by
  // an administrator. The owner is seeded too, on a password of their own —
  // a separate person: the administrator never belongs to a church.
  const stamp = `${process.pid}-${Date.now()}`;
  const administratorEmail = `admin-${stamp}@example.org`;
  const ownerEmail = `owner-${stamp}@example.org`;
  runInApi('pnpm', ['prisma:seed'], {
    ...environment,
    SEED_ADMIN_EMAIL: administratorEmail,
    SEED_ADMIN_PASSWORD: TEST_PASSWORD,
    SEED_USER_EMAIL: ownerEmail,
    SEED_USER_PASSWORD: TEST_PASSWORD,
  });

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
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as Result;
  };
  const signIn = (identifier: string) =>
    send<{ accessToken: string }>('POST', '/api/auth/login', {
      identifier,
      password: TEST_PASSWORD,
    });
  const adminLogin = await signIn(administratorEmail);
  const login = await signIn(ownerEmail);
  // The owner's one workspace: only the administrator creates one, naming
  // its owner.
  const workspace = await send<TestWorkspace>(
    'POST',
    '/api/workspaces',
    { name: 'Grace Church', slug: `grace-${process.pid}`, ownerEmail },
    adminLogin.accessToken,
  );

  return {
    origin,
    administrator: { identifier: administratorEmail, password: TEST_PASSWORD },
    owner: { identifier: ownerEmail, password: TEST_PASSWORD },
    workspace,
    request: (method, path, body) =>
      send(method, path, body, login.accessToken),
    adminRequest: (method, path, body) =>
      send(method, path, body, adminLogin.accessToken),
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
