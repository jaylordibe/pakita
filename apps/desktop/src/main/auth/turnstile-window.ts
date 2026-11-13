import { BrowserWindow, session } from 'electron';

import { denyAllPermissions, setNavigationPolicy } from '../security';
import { createSecureWebPreferences } from '../security-policy';

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const CHECK_PATH = '/api/public/desktop-turnstile';
const DONE_PATH = '/api/public/desktop-turnstile/done';
const TIMEOUT_MILLISECONDS = 5 * 60_000;

export class TurnstileCancelledError extends Error {
  constructor() {
    super('The sign-in check was closed before it finished.');
    this.name = 'TurnstileCancelledError';
  }
}

/** Reads the token from `…/done#token=…`, or null if the URL is not that. */
export function readTurnstileToken(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.pathname !== DONE_PATH) {
    return null;
  }
  const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
  return token && token.length <= 2048 ? token : null;
}

/**
 * Shows the church server's Turnstile check in its own window and resolves
 * with the token (docs/decisions/0001-desktop-turnstile.md).
 *
 * The window is a plain remote page: no preload, sandboxed, in its own
 * in-memory session with every permission refused, and allowed to navigate
 * only within the church server and Cloudflare's challenge origin. The token
 * arrives as the page navigates to `…/done#token=…`; that navigation is
 * cancelled, so the token never leaves this process.
 */
export function obtainTurnstileToken(
  origin: string,
  parent: BrowserWindow | null,
): Promise<string> {
  const checkSession = session.fromPartition('pakita-turnstile');
  denyAllPermissions(checkSession);

  const window = new BrowserWindow({
    parent: parent ?? undefined,
    modal: parent !== null,
    width: 480,
    height: 560,
    title: 'Pakita — sign-in check',
    autoHideMenuBar: true,
    webPreferences: {
      ...createSecureWebPreferences(null),
      session: checkSession,
    },
  });
  setNavigationPolicy(window.webContents, (url) => {
    const target = URL.canParse(url) ? new URL(url).origin : null;
    return target === origin || target === TURNSTILE_ORIGIN;
  });

  return new Promise<string>((resolve, reject) => {
    let isSettled = false;
    const settle = (outcome: () => void) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      outcome();
      if (!window.isDestroyed()) window.destroy();
    };
    const timer = setTimeout(
      () => settle(() => reject(new TurnstileCancelledError())),
      TIMEOUT_MILLISECONDS,
    );

    window.webContents.on('will-navigate', (event, url) => {
      const token = readTurnstileToken(url, origin);
      if (token !== null) {
        event.preventDefault();
        settle(() => resolve(token));
      }
    });
    window.on('closed', () =>
      settle(() => reject(new TurnstileCancelledError())),
    );
    window.webContents.on('did-fail-load', (_event, _code, description) =>
      settle(() =>
        reject(new Error(`The sign-in check could not load: ${description}`)),
      ),
    );
    void window.loadURL(`${origin}${CHECK_PATH}`);
  });
}
