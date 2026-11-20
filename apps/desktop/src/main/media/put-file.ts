import { createReadStream } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// How long the upload may go without the server reading anything.
const IDLE_TIMEOUT_MILLISECONDS = 60_000;

/**
 * Sends a file to a signed upload URL: one `PUT` of exactly its bytes, with
 * the signed headers and its `Content-Length` (storage checks both), streamed
 * from disk with backpressure, so a 1 GB video never sits in memory.
 *
 * Node's HTTP client, not Electron's `net` like the app's other requests:
 * `net` refuses a `Content-Length` set by hand (`ERR_INVALID_ARGUMENT`,
 * measured) and otherwise either sends the body chunked, which storage
 * refuses for a signed length, or buffers it whole. The cost: this one request
 * does not follow the system's proxy settings.
 */
export async function putFile(
  url: string,
  headers: Record<string, string>,
  path: string,
  sizeBytes: number,
  onProgress: (sentBytes: number) => void,
): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('The upload address is not a web address.');
  }
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const request = send(target, {
    method: 'PUT',
    headers: { ...headers, 'content-length': String(sizeBytes) },
  });
  request.setTimeout(IDLE_TIMEOUT_MILLISECONDS, () =>
    request.destroy(new Error('The upload stalled.')),
  );
  const response = new Promise<number>((resolve, reject) => {
    request.on('response', (incoming) => {
      // Drain the body; only the status matters.
      incoming.resume();
      incoming.on('end', () => resolve(incoming.statusCode ?? 0));
      incoming.on('error', reject);
    });
    request.on('error', reject);
  });

  let sentBytes = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sentBytes += chunk.length;
      onProgress(sentBytes);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(path), counted, request);
    const status = await response;
    if (status < 200 || status >= 300) {
      throw new Error(
        `The church server’s storage refused the video (HTTP ${status}).`,
      );
    }
  } catch (error) {
    request.destroy();
    if (error instanceof Error && error.message.startsWith('The church')) {
      throw error;
    }
    throw new Error('The video could not be uploaded. Check the connection.', {
      cause: error,
    });
  }
}
