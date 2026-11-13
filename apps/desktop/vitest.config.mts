import { defineConfig } from 'vitest/config';

// Unit tests run under plain Node: pure code, plus database code against a
// real in-memory SQLite (better-sqlite3 ships Node-API binaries, which load in
// Node and Electron alike). Anything that needs Electron itself is covered by
// the Playwright tests in test/e2e, which run the real app.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
