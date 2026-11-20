import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MediaFolder, MediaIntegrityError } from './media-folder';

const BYTES = Buffer.from('a looping background video, in spirit');
const SHA256 = createHash('sha256').update(BYTES).digest('hex');
const VIDEO = {
  name: 'Waves',
  sha256: SHA256,
  sizeBytes: BYTES.length,
  contentType: 'video/mp4' as const,
};

/** A storage server: whole file, or the asked range when it honours one. */
function storage(
  body: Buffer,
  { isRangeHonoured = true }: { isRangeHonoured?: boolean } = {},
) {
  const ranges: Array<string | null> = [];
  const fetchFunction = (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    ranges.push(range);
    const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    if (range && isRangeHonoured) {
      return Promise.resolve(
        new Response(new Uint8Array(body.subarray(start)), { status: 206 }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array(body)));
  };
  return { fetchFunction, ranges };
}

describe('MediaFolder', () => {
  let directory: string;
  let folder: MediaFolder;
  const url = () => Promise.resolve('https://storage.test/video');

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pakita-media-'));
    folder = new MediaFolder(directory);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('keeps a download whose size and hash match, named by its hash', async () => {
    await folder.download(VIDEO, url, storage(BYTES).fetchFunction);
    expect(await folder.has(VIDEO)).toBe(true);
    expect(readFileSync(join(directory, `${SHA256}.mp4`))).toEqual(BYTES);
  });

  it('resumes a partial download with a range', async () => {
    mkdirSync(join(directory, '.partial'), { recursive: true });
    writeFileSync(
      join(directory, '.partial', `${SHA256}.mp4`),
      BYTES.subarray(0, 10),
    );
    const server = storage(BYTES);
    await folder.download(VIDEO, url, server.fetchFunction);
    expect(server.ranges).toEqual(['bytes=10-']);
    expect(await folder.has(VIDEO)).toBe(true);
  });

  it('starts over when the server ignores the range', async () => {
    mkdirSync(join(directory, '.partial'), { recursive: true });
    writeFileSync(
      join(directory, '.partial', `${SHA256}.mp4`),
      BYTES.subarray(0, 10),
    );
    await folder.download(
      VIDEO,
      url,
      storage(BYTES, { isRangeHonoured: false }).fetchFunction,
    );
    expect(readFileSync(join(directory, `${SHA256}.mp4`))).toEqual(BYTES);
  });

  it('keeps nothing whose hash does not match', async () => {
    const tampered = Buffer.from(BYTES).fill(65, 0, 4);
    await expect(
      folder.download(VIDEO, url, storage(tampered).fetchFunction),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
    expect(await folder.has(VIDEO)).toBe(false);
    expect(readdirSync(join(directory, '.partial'))).toEqual([]);
  });

  it('stops reading a body longer than the video', async () => {
    const longer = Buffer.concat([BYTES, Buffer.from('more')]);
    await expect(
      folder.download(VIDEO, url, storage(longer).fetchFunction),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
    expect(await folder.has(VIDEO)).toBe(false);
  });

  it('keeps the partial file when stopped, to resume later', async () => {
    const controller = new AbortController();
    const fetchFunction = () => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          // The first bytes arrive, then the presentation starts.
          stream.enqueue(new Uint8Array(BYTES.subarray(0, 10)));
          setTimeout(() => controller.abort(), 50);
        },
      });
      return Promise.resolve(new Response(body));
    };
    await expect(
      folder.download(VIDEO, url, fetchFunction, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(await folder.has(VIDEO)).toBe(false);
    expect(existsSync(join(directory, '.partial', `${SHA256}.mp4`))).toBe(true);
  });

  it('removes videos, posters and partial files no workspace names', async () => {
    const kept = 'a'.repeat(64);
    const gone = 'b'.repeat(64);
    mkdirSync(join(directory, '.partial'), { recursive: true });
    for (const name of [
      `${kept}.mp4`,
      `${kept}.webp`,
      `${gone}.webm`,
      `${gone}.webp`,
      'stray.txt',
    ]) {
      writeFileSync(join(directory, name), 'x');
    }
    writeFileSync(join(directory, '.partial', `${gone}.mp4`), 'x');
    writeFileSync(join(directory, '.partial', `${kept}.mp4`), 'x');

    await folder.removeAllExcept(new Set([kept]));

    expect(readdirSync(directory).sort()).toEqual(
      ['.partial', `${kept}.mp4`, `${kept}.webp`].sort(),
    );
    expect(readdirSync(join(directory, '.partial'))).toEqual([`${kept}.mp4`]);
  });
});
