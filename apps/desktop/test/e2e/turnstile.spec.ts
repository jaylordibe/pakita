import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp } from './support/launch';
import { startTestApi } from './support/test-api';

// Signing in when the server requires the Turnstile bot check
// (docs/decisions/0001-desktop-turnstile.md): the desktop opens the server's
// check page in its own window, takes the token from the cancelled
// navigation, and signs in with it.
//
// Uses Cloudflare's test keys, so it needs the internet (the widget and the
// server's verification both call challenges.cloudflare.com). Opt in with
// PAKITA_E2E_TURNSTILE=1; it is not part of the offline-safe CI gate.
test.skip(
  process.env.PAKITA_E2E_TURNSTILE !== '1',
  'Set PAKITA_E2E_TURNSTILE=1 to run (needs the internet)',
);

test('signs in through the Turnstile check window', async () => {
  test.setTimeout(120_000);
  const api = await startTestApi({ isBotCheckOn: true });
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'pakita-turnstile-'));
  const { application, operator } = await launchApp(userDataDirectory);
  try {
    const info = await (
      await fetch(`${api.origin}/api/public/server-info`)
    ).json();
    expect(info).toMatchObject({ isBotCheckRequired: true });

    await operator.getByTestId('server-address').fill(api.origin);
    await operator.getByRole('button', { name: 'Connect' }).click();
    await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
    await operator.getByTestId('sign-in-password').fill(api.owner.password);
    await operator.getByRole('button', { name: 'Sign in' }).click();

    // The check window opens on the server's page and closes by itself.
    await expect
      .poll(() =>
        application
          .windows()
          .some((window) =>
            window.url().includes('/api/public/desktop-turnstile'),
          ),
      )
      .toBe(true);
    // Signed in: the owner's only church opens without asking.
    await expect(operator.getByTestId('library-search')).toBeVisible({
      timeout: 60_000,
    });
    expect(
      application
        .windows()
        .some((window) => window.url().includes('desktop-turnstile')),
    ).toBe(false);
  } finally {
    await application.close();
    await api.dispose();
    rmSync(userDataDirectory, { recursive: true, force: true });
  }
});
