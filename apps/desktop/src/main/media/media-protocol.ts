import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

// Serves local videos to the app's own windows, as `pakita-media://…`.
//
// A `<video>` asks for byte ranges, and plays and seeks only when the answer
// is a real `206` with `Content-Range`. `net.fetch(file://…)` honours `Range`
// but answers `200` with no `Content-Range` (measured: the video then reports
// nothing seekable), so this handler answers ranges itself.

export const MEDIA_SCHEME = 'pakita-media';

export interface ByteRange {
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
}

/**
 * Reads a single `Range: bytes=…` header against a file of `size` bytes:
 * the range to send, `null` for the whole file (no header, or one this
 * handler does not serve, such as several ranges), or `'unsatisfiable'`.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** Answers a request for one file, with ranges, as a media element expects. */
export async function serveFile(
  path: string,
  contentType: string,
  rangeHeader: string | null,
): Promise<Response> {
  const size = await stat(path).then(
    (stats) => (stats.isFile() ? stats.size : null),
    () => null,
  );
  if (size === null) return new Response(null, { status: 404 });
  const common = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    // A local file, read by this app alone; never kept by any cache.
    'cache-control': 'no-store',
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...common, 'content-range': `bytes */${size}` },
    });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body =
    size === 0
      ? null
      : (Readable.toWeb(
          createReadStream(path, { start, end }),
        ) as ReadableStream<Uint8Array>);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...common,
      'content-length': String(size === 0 ? 0 : end - start + 1),
      ...(range && { 'content-range': `bytes ${start}-${end}/${size}` }),
    },
  });
}
