import type { WebPreferences } from 'electron';
import { isAbsolute, relative, resolve } from 'node:path';

// Pure security policy for the desktop app, kept free of Electron runtime
// imports so every rule here is unit-tested without launching Electron.
// `security.ts` applies it to the running app.

/** The custom scheme the packaged renderer is served from. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'pakita';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The web preferences every window gets. One factory, so no window can be
 * created with a weaker setting by accident.
 */
export function createSecureWebPreferences(
  preloadPath: string,
): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  };
}

/**
 * The origins a window may show, and the only origins whose frames may call
 * IPC. The development server origin is trusted only in an unpackaged build.
 */
export function createTrustedOrigins(
  developmentServerUrl?: string,
): ReadonlySet<string> {
  const origins = new Set([APP_ORIGIN]);
  if (developmentServerUrl) {
    origins.add(new URL(developmentServerUrl).origin);
  }
  return origins;
}

/**
 * Maps an `app://pakita/<path>` request to a file inside the renderer folder,
 * or `null` when the request would leave it (`..`, an encoded `%2e%2e`, an
 * absolute or other-drive path). `/` serves `index.html`.
 */
export function resolveRendererFile(
  rendererDirectory: string,
  pathname: string,
): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes('\0')) {
    return null;
  }
  const root = resolve(rendererDirectory);
  const filePath = resolve(
    root,
    `.${decodedPath === '/' ? '/index.html' : decodedPath}`,
  );
  const pathFromRoot = relative(root, filePath);
  if (
    pathFromRoot === '' ||
    pathFromRoot.startsWith('..') ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  return filePath;
}

export function isTrustedUrl(
  url: string,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // A custom scheme's origin is the string "null" in the URL standard, so
  // compare scheme and host instead of `origin` for it.
  const origin =
    parsed.protocol === `${APP_SCHEME}:`
      ? `${APP_SCHEME}://${parsed.host}`
      : parsed.origin;
  return trustedOrigins.has(origin);
}
