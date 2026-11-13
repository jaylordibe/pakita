import { app, net, protocol, session, type WebContents } from 'electron';
import { pathToFileURL } from 'node:url';

import {
  APP_HOST,
  APP_SCHEME,
  isTrustedUrl,
  resolveRendererFile,
} from './security-policy';

/** Must run before the app's `ready` event. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/**
 * Serves the built renderer from `app://pakita/…`, confined to the renderer
 * folder (see `resolveRendererFile`).
 */
export function serveRendererFromAppScheme(rendererDirectory: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const filePath =
      url.host === APP_HOST
        ? resolveRendererFile(rendererDirectory, url.pathname)
        : null;
    if (filePath === null) {
      return new Response(null, { status: 404 });
    }
    // A missing file is a 404, not a failed request.
    return net
      .fetch(pathToFileURL(filePath).toString())
      .catch(() => new Response(null, { status: 404 }));
  });
}

// Windows that may navigate beyond the app's own origins (the Turnstile check,
// which loads the church server's page) register their own rule here; every
// other window keeps the app-wide rule.
const navigationPolicies = new Map<number, (url: string) => boolean>();

export function setNavigationPolicy(
  contents: WebContents,
  isAllowed: (url: string) => boolean,
): void {
  const contentsId = contents.id;
  navigationPolicies.set(contentsId, isAllowed);
  contents.once('destroyed', () => navigationPolicies.delete(contentsId));
}

/** Refuses every browser permission (camera, notifications, …) for a session. */
export function denyAllPermissions(target: Electron.Session): void {
  target.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  target.setPermissionCheckHandler(() => false);
}

/**
 * App-wide guards applied to every web contents, including ones created later:
 * no new windows, no navigation away from the app (or, for a window with its
 * own policy, beyond what that policy allows), no `<webview>`, and no browser
 * permission is ever granted.
 */
export function installWebContentsGuards(
  trustedOrigins: ReadonlySet<string>,
): void {
  denyAllPermissions(session.defaultSession);

  const isAllowed = (contents: WebContents, url: string) =>
    (
      navigationPolicies.get(contents.id) ??
      ((candidate: string) => isTrustedUrl(candidate, trustedOrigins))
    )(url);

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAllowed(contents, url)) {
        event.preventDefault();
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAllowed(contents, url)) {
        event.preventDefault();
      }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
