import { app, net, protocol, session } from 'electron';
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

/**
 * App-wide guards applied to every web contents, including ones created later:
 * no new windows, no navigation away from the app, no `<webview>`, and no
 * browser permission (camera, notifications, …) is ever granted.
 */
export function installWebContentsGuards(
  trustedOrigins: ReadonlySet<string>,
): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url, trustedOrigins)) {
        event.preventDefault();
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url, trustedOrigins)) {
        event.preventDefault();
      }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
