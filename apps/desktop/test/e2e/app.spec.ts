import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the BUILT app (out/), the same main, preload and renderer bundles a
// package contains, against a throwaway profile.

let application: ElectronApplication;
let operatorPage: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-e2e-'));
  application = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: {
      ...process.env,
      PAKITA_TEST_USER_DATA_DIRECTORY: userDataDirectory,
      // Never let a developer's dev-server URL leak into the built-app test.
      ELECTRON_RENDERER_URL: '',
    },
  });
  operatorPage = await application.firstWindow();
  await operatorPage.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await application?.close();
  rmSync(userDataDirectory, { recursive: true, force: true });
});

test('serves the operator window from the app origin', async () => {
  expect(operatorPage.url()).toBe('app://pakita/index.html');
  await expect(
    operatorPage.getByRole('heading', { name: 'Welcome to Pakita' }),
  ).toBeVisible();
});

test('reports the app version through the preload API', async () => {
  const expectedVersion = await application.evaluate(({ app }) =>
    app.getVersion(),
  );
  const version = await operatorPage.evaluate(() =>
    window.pakita.app.getVersion(),
  );
  expect(version).toBe(expectedVersion);
});

test('opens no local database before an account signs in', async () => {
  const health = await operatorPage.evaluate(() =>
    window.pakita.database.getHealth(),
  );
  expect(health).toBeNull();
});

test('gives the renderer no Node.js or Electron access', async () => {
  const exposure = await operatorPage.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    module: typeof (globalThis as { module?: unknown }).module,
    pakitaKeys: Object.keys(window.pakita).sort(),
  }));
  expect(exposure).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    pakitaKeys: [
      'account',
      'accounts',
      'app',
      'bible',
      'database',
      'displays',
      'invitations',
      'library',
      'live',
      'playlists',
      'server',
      'songs',
      'sync',
      'themes',
      'workspaces',
    ],
  });
});

test('refuses to open new windows', async () => {
  const opened = await operatorPage.evaluate(
    () => window.open('https://example.com/') === null,
  );
  expect(opened).toBe(true);
  expect(application.windows()).toHaveLength(1);
});

test('refuses to navigate away from the app', async () => {
  // A local server the navigation would reach if the guard failed: no slow
  // public host can make a regression look like a pass.
  let requestCount = 0;
  const server: Server = createServer((_request, response) => {
    requestCount += 1;
    response.end('navigated');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await operatorPage.evaluate((target) => {
      window.location.href = target;
    }, `http://127.0.0.1:${port}/`);
    await operatorPage.waitForTimeout(1_000);
    expect(requestCount).toBe(0);
    expect(operatorPage.url()).toBe('app://pakita/index.html');
  } finally {
    server.close();
  }
});

test('ships a content security policy without inline styles or scripts', async () => {
  const policy = await operatorPage.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '',
  );
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain('unsafe-inline');
  expect(policy).not.toContain('unsafe-eval');
});

// The traversal cases themselves (`..`, `%2e%2e`, `%5c`) are unit-tested in
// security-policy.spec.ts: the URL parser normalises them before a request
// reaches the handler, so from the page they arrive as in-folder paths.
test('answers 404 for anything that is not a renderer file', async () => {
  const statuses = await operatorPage.evaluate(async () =>
    Promise.all(
      ['app://pakita/%2e%2e/main/index.js', 'app://pakita/missing.js'].map(
        async (url) => (await fetch(url)).status,
      ),
    ),
  );
  expect(statuses).toEqual([404, 404]);
});

test('blocks requests to any other origin by its content security policy', async () => {
  const targets = [
    'app://elsewhere/index.html',
    'https://example.com/',
    'http://localhost:3000/api/health',
  ];
  // A rejected fetch alone proves nothing (CORS or a closed port reject too):
  // the policy itself must report a connect-src violation for each target.
  const violations = await operatorPage.evaluate(async (urls) => {
    const blocked: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'connect-src') {
        blocked.push(event.blockedURI);
      }
    });
    await Promise.all(urls.map((url) => fetch(url).catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 200));
    return blocked;
  }, targets);
  // Chromium reports a custom scheme's blocked URI as the bare scheme.
  expect(violations.sort()).toEqual([
    'app',
    'http://localhost:3000/api/health',
    'https://example.com/',
  ]);
});
