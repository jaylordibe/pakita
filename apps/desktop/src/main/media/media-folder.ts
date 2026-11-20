import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { FetchFunction } from '../api/api-client';

// A laptop's copy of its church's background videos: one file per video,
// named by its SHA-256, written to `.partial/` while it downloads and moved
// into place only once its size and hash match. So a file in the folder is a
// verified video, and its presence is what "downloaded" means.

/** The extension each playable type is stored under. */
export const VIDEO_EXTENSIONS = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
} as const satisfies Record<string, string>;
export type VideoType = keyof typeof VIDEO_EXTENSIONS;

export const isVideoType = (contentType: string): contentType is VideoType =>
  Object.hasOwn(VIDEO_EXTENSIONS, contentType);

/** `<sha256>.<mp4|webm>`: the only names the folder serves. */
export const VIDEO_FILE_NAME = /^([0-9a-f]{64})\.(mp4|webm)$/;
/** `<sha256>.webp`: a still frame of a video, for the operator's lists. */
export const POSTER_FILE_NAME = /^([0-9a-f]{64})\.webp$/;

/** Left free on the disk after a download, so the laptop keeps working. */
const DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;

export interface VideoIdentity {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: VideoType;
}

/** A download that did not produce the file it promised; not saved. */
export class MediaIntegrityError extends Error {
  constructor(name: string) {
    super(
      `The server’s copy of “${name}” did not match its checksum; it was not saved.`,
    );
    this.name = 'MediaIntegrityError';
  }
}

/** Too little free disk for a video; nothing was written. */
export class MediaDiskFullError extends Error {
  constructor(name: string) {
    super(
      `There is not enough free disk space on this laptop to download “${name}”.`,
    );
    this.name = 'MediaDiskFullError';
  }
}

export class MediaFolder {
  constructor(readonly directory: string) {}

  fileNameOf(video: Pick<VideoIdentity, 'sha256' | 'contentType'>): string {
    return `${video.sha256}.${VIDEO_EXTENSIONS[video.contentType]}`;
  }

  pathOf(fileName: string): string {
    return join(this.directory, fileName);
  }

  /** Whether the verified video is on this laptop. */
  async has(
    video: Pick<VideoIdentity, 'sha256' | 'contentType'>,
  ): Promise<boolean> {
    return stat(this.pathOf(this.fileNameOf(video))).then(
      (stats) => stats.isFile(),
      () => false,
    );
  }

  async hasPoster(sha256: string): Promise<boolean> {
    return stat(this.pathOf(`${sha256}.webp`)).then(
      (stats) => stats.isFile(),
      () => false,
    );
  }

  /** Saves a still frame the operator window drew from a local video. */
  async savePoster(sha256: string, webp: Uint8Array): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.pathOf(`${sha256}.webp`);
    const partial = `${target}.partial`;
    await pipeline(Readable.from([webp]), createWriteStream(partial));
    await rename(partial, target);
  }

  /**
   * Downloads a video to the folder, resuming a partial download with a
   * `Range` request, and keeps it only when its size and SHA-256 match.
   * `signal` stops it (a presentation started); the partial file stays for
   * the next attempt. `urlFor` is asked for a fresh signed URL each attempt.
   */
  async download(
    video: VideoIdentity & { readonly name: string },
    urlFor: () => Promise<string>,
    fetchFunction: FetchFunction,
    options: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (receivedBytes: number) => void;
    } = {},
  ): Promise<void> {
    const partialDirectory = join(this.directory, '.partial');
    await mkdir(partialDirectory, { recursive: true });
    const partial = join(partialDirectory, this.fileNameOf(video));

    let existingBytes = await stat(partial).then(
      (stats) => stats.size,
      () => 0,
    );
    if (existingBytes > video.sizeBytes) {
      await rm(partial, { force: true });
      existingBytes = 0;
    }
    await this.assertRoomFor(video, video.sizeBytes - existingBytes);

    if (existingBytes < video.sizeBytes) {
      const response = await fetchFunction(await urlFor(), {
        headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : {},
        signal: options.signal,
      });
      // A server that ignores the range sends the whole file: start over.
      const isResumed = existingBytes > 0 && response.status === 206;
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(
          `Downloading “${video.name}” failed (HTTP ${response.status}).`,
        );
      }
      if (!isResumed) existingBytes = 0;
      let receivedBytes = existingBytes;
      const body = Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream<Uint8Array>,
      );
      body.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > video.sizeBytes) {
          body.destroy(new MediaIntegrityError(video.name));
          return;
        }
        options.onProgress?.(receivedBytes);
      });
      await pipeline(
        body,
        createWriteStream(partial, { flags: isResumed ? 'a' : 'w' }),
        { signal: options.signal },
      );
    }

    const isIntact = await this.matches(partial, video);
    if (!isIntact) {
      await rm(partial, { force: true });
      throw new MediaIntegrityError(video.name);
    }
    await rename(partial, this.pathOf(this.fileNameOf(video)));
  }

  /**
   * Deletes every video, poster and partial download no workspace on this
   * laptop names any more.
   */
  async removeAllExcept(keptHashes: ReadonlySet<string>): Promise<void> {
    const isKept = (name: string) => {
      const match = VIDEO_FILE_NAME.exec(name) ?? POSTER_FILE_NAME.exec(name);
      return match !== null && keptHashes.has(match[1]!);
    };
    for (const folder of [this.directory, join(this.directory, '.partial')]) {
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const name of names) {
        if (name === '.partial' || isKept(name)) continue;
        await rm(join(folder, name), { force: true, recursive: true });
      }
    }
  }

  private async matches(path: string, video: VideoIdentity): Promise<boolean> {
    const size = await stat(path).then(
      (stats) => stats.size,
      () => -1,
    );
    if (size !== video.sizeBytes) return false;
    return (await sha256Of(path)) === video.sha256;
  }

  private async assertRoomFor(
    video: { readonly name: string },
    bytes: number,
  ): Promise<void> {
    const disk = await statfs(this.directory);
    if (disk.bavail * disk.bsize < bytes + DISK_RESERVE_BYTES) {
      throw new MediaDiskFullError(video.name);
    }
  }
}

/** The SHA-256 of a file, read as a stream (lowercase hex). */
export async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
