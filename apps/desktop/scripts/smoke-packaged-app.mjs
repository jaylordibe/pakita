// Launches the unpacked package `pnpm package:dir` built for this OS against a
// throwaway profile that remembers an account (on a server that is never
// contacted), and passes once the app has opened that account's local
// database in WAL mode. That proves what no unpackaged test can: the binary starts
// (signature, fuses), the code loads from the asar archive, and the database
// worker loads better-sqlite3 from outside it.
//
// Usage: node scripts/smoke-packaged-app.mjs
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MILLISECONDS = 30_000;
const releaseDirectory = fileURLToPath(new URL('../release/', import.meta.url));

function findExecutable() {
  const folders = readdirSync(releaseDirectory);
  if (process.platform === 'darwin') {
    const folder = folders.find((name) => name.startsWith('mac'));
    return (
      folder &&
      join(releaseDirectory, folder, 'Pakita.app/Contents/MacOS/Pakita')
    );
  }
  if (process.platform === 'win32') {
    return join(releaseDirectory, 'win-unpacked', 'Pakita.exe');
  }
  return join(releaseDirectory, 'linux-unpacked', 'pakita');
}

const executable = findExecutable();
if (!executable || !existsSync(executable)) {
  console.error(
    `smoke: no packaged app in ${releaseDirectory}; run pnpm package:dir first`,
  );
  process.exit(1);
}

const userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-smoke-'));
// A laptop that already holds an account opens its database at start-up,
// offline: exactly the path a service is presented from.
const serverOrigin = 'https://pakita.invalid';
writeFileSync(
  join(userDataDirectory, 'settings.json'),
  JSON.stringify({ serverOrigin, workspaceId: null, projectorDisplayId: null }),
);
writeFileSync(
  join(userDataDirectory, 'account.json'),
  JSON.stringify({
    origin: serverOrigin,
    userId: 'smoke-test',
    email: 'smoke@pakita.invalid',
    displayName: 'Smoke Test',
  }),
);
const accountsDirectory = join(userDataDirectory, 'accounts');
const hasOpenedDatabase = () =>
  existsSync(accountsDirectory) &&
  readdirSync(accountsDirectory).some((account) =>
    existsSync(join(accountsDirectory, account, 'pakita.sqlite-wal')),
  );
const child = spawn(executable, [`--user-data-dir=${userDataDirectory}`], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exitCode = null;
child.on('exit', (code, signal) => {
  exitCode = code ?? signal;
});

const startedAt = Date.now();
const timer = setInterval(() => {
  const isReady = hasOpenedDatabase();
  const hasExited = exitCode !== null;
  const hasTimedOut = Date.now() - startedAt > TIMEOUT_MILLISECONDS;
  if (!isReady && !hasExited && !hasTimedOut) {
    return;
  }
  clearInterval(timer);
  child.kill();
  rmSync(userDataDirectory, { recursive: true, force: true, maxRetries: 5 });
  if (isReady) {
    console.log(
      'smoke: the packaged app started and opened its database (WAL).',
    );
    process.exit(0);
  }
  console.error(
    hasExited
      ? `smoke: the packaged app exited (${exitCode}) before opening its database.`
      : 'smoke: the packaged app did not open its database in time.',
  );
  process.exit(1);
}, 250);
