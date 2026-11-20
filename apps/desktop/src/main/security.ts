import { app, net, protocol, session } from 'electron';
import { pathToFileURL } from 'node:url';

import { MEDIA_SCHEME, serveFile } from './media/media-protocol';
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
    // Local videos for `<video>`: `stream` lets a media element read them in
    // ranges as it plays and seeks.
    {
      scheme: MEDIA_SCHEME,
      // `corsEnabled`: the operator window draws a still frame of a video on
      // a canvas, which a cross-origin video would taint (see serveMediaScheme).
      // `supportFetchAPI`: the converter reads a picked video with ranged
      // `fetch` requests (renderer/video-normalize).
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        corsEnabled: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

/** A local file a `pakita-media://` URL names, or null for none. */
export type MediaFileResolver = (
  url: URL,
) => { path: string; contentType: string } | null;

/**
 * Serves local videos and their still frames as `pakita-media://…`. The
 * resolver decides what a URL may name (only files of the media folder, or
 * one the operator just picked); anything else is a 404.
 */
export function serveMediaScheme(
  resolve: MediaFileResolver,
  trustedOrigins: ReadonlySet<string>,
): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = resolve(new URL(request.url));
    if (!file) return new Response(null, { status: 404 });
    const response = await serveFile(
      file.path,
      file.contentType,
      request.headers.get('range'),
    );
    // Readable (for a canvas) by the app's own pages, and by no other origin.
    const origin = request.headers.get('origin');
    if (origin && trustedOrigins.has(origin)) {
      response.headers.set('access-control-allow-origin', origin);
      response.headers.set('vary', 'origin');
    }
    return response;
  });
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

/** Refuses every browser permission (camera, notifications, …) for a session. */
function denyAllPermissions(target: Electron.Session): void {
  target.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  target.setPermissionCheckHandler(() => false);
}

/**
 * App-wide guards applied to every web contents, including ones created later:
 * no new windows, no navigation away from the app, no `<webview>`, and no
 * browser permission is ever granted.
 */
export function installWebContentsGuards(
  trustedOrigins: ReadonlySet<string>,
): void {
  denyAllPermissions(session.defaultSession);

  const isAllowed = (url: string) => isTrustedUrl(url, trustedOrigins);

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) {
        event.preventDefault();
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAllowed(url)) {
        event.preventDefault();
      }
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
