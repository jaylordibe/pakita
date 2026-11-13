import { defineConfig } from '@playwright/test';

// Launches the BUILT app (`pnpm test:e2e` builds first) through Playwright's
// Electron support; no browser download is involved.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  // One Electron instance at a time: each test owns its own profile, and
  // parallel GUI apps on a CI virtual display only add flakiness.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
});
