import { randomUUID } from 'node:crypto';
import {
  copyFile,
  type FileHandle,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { MAX_VIDEO_BYTES } from '../../shared/video-spec';
import type {
  MediaUploadInput,
  MediaUploadProgress,
  PickedVideo,
} from '../../shared/ipc-contract';
import type { Media } from '../api/api-schemas';
import { type MediaFolder, sha256Of, type VideoType } from './media-folder';
import { MEDIA_SCHEME } from './media-protocol';

/** The largest file picked to convert: a 4K master can be several gigabytes. */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024 * 1024;

/** What a picked file's first bytes say it is. */
export type PickedType = VideoType | 'video/quicktime';

const TYPE_BY_EXTENSION: Readonly<Record<string, PickedType>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

// The container's first bytes: an MP4 has an `ftyp` box at offset 4 (brand
// `qt  ` for QuickTime), an older QuickTime file starts with another atom,
// a WebM starts with an EBML header.
async function sniffType(path: string): Promise<PickedType | null> {
  const file = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0);
    const start = buffer.subarray(0, bytesRead);
    const box = start.subarray(4, 8).toString('latin1');
    if (box === 'ftyp') {
      return start.subarray(8, 12).toString('latin1') === 'qt  '
        ? 'video/quicktime'
        : 'video/mp4';
    }
    if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) {
      return 'video/quicktime';
    }
    if (start.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return 'video/webm';
    }
    return null;
  } finally {
    await file.close();
  }
}

interface PickedFile {
  readonly path: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly contentType: PickedType;
  /** A normalised copy this app wrote; deleted once forgotten. */
  readonly isTemporary: boolean;
}

interface OpenOutput {
  readonly path: string;
  readonly handle: FileHandle;
}

/**
 * Files the operator picked in the system dialog, and normalised copies of
 * them, by a random token. The operator window names a file only by its
 * token, so it can never make the main process read or write a path of its
 * choosing.
 */
export class PickedFiles {
  private readonly files = new Map<string, PickedFile>();
  private readonly outputs = new Map<string, OpenOutput>();

  /** `directory` holds normalised copies while they are written and uploaded. */
  constructor(private readonly directory: string) {}

  /** Records a chosen file, or explains why it cannot be used. */
  async add(path: string): Promise<PickedVideo> {
    const stats = await stat(path);
    if (!stats.isFile()) throw new Error('Choose a video file.');
    if (stats.size === 0) throw new Error('That file is empty.');
    if (stats.size > MAX_SOURCE_BYTES) {
      throw new Error('That file is too large to use as a background video.');
    }
    const declared = TYPE_BY_EXTENSION[extname(path).toLowerCase()];
    const contentType = await sniffType(path);
    const isQuickTimeFamily = (type: PickedType | undefined | null) =>
      type === 'video/mp4' || type === 'video/quicktime';
    if (
      !declared ||
      !contentType ||
      (contentType !== declared &&
        !(isQuickTimeFamily(contentType) && isQuickTimeFamily(declared)))
    ) {
      throw new Error('Choose an MP4, MOV or WebM video.');
    }
    return this.register({
      path,
      fileName: basename(path),
      sizeBytes: stats.size,
      contentType,
      isTemporary: false,
    });
  }

  get(token: string): PickedFile | null {
    return this.files.get(token) ?? null;
  }

  /** Forgets a file; a normalised copy is deleted with it. */
  async forget(token: string): Promise<void> {
    const file = this.files.get(token);
    this.files.delete(token);
    if (file?.isTemporary) await rm(file.path, { force: true });
  }

  /** Opens a new file for a normalised copy, named by a token. */
  async beginOutput(): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const token = randomUUID();
    const path = join(this.directory, `${token}.video`);
    this.outputs.set(token, { path, handle: await open(path, 'w') });
    return token;
  }

  /** Writes one chunk where the converter placed it, within 1 GB. */
  async writeOutput(
    token: string,
    position: number,
    data: Uint8Array,
  ): Promise<void> {
    const output = this.outputs.get(token);
    if (!output) throw new Error('That conversion is no longer open.');
    if (position + data.byteLength > MAX_VIDEO_BYTES) {
      await this.discardOutput(token);
      throw new Error(
        'The converted video would be larger than 1 GB. Use a shorter video.',
      );
    }
    await output.handle.write(data, 0, data.byteLength, position);
  }

  /** Closes a normalised copy and makes it a picked file of its own. */
  async finishOutput(
    token: string,
    sourceFileName: string,
    contentType: VideoType,
  ): Promise<PickedVideo> {
    const output = this.outputs.get(token);
    if (!output) throw new Error('That conversion is no longer open.');
    this.outputs.delete(token);
    await output.handle.close();
    const stats = await stat(output.path);
    if ((await sniffType(output.path)) !== contentType) {
      await rm(output.path, { force: true });
      throw new Error('The converted video could not be read back.');
    }
    const extension = contentType === 'video/webm' ? '.webm' : '.mp4';
    return this.register({
      path: output.path,
      fileName: `${basename(sourceFileName, extname(sourceFileName))}${extension}`,
      sizeBytes: stats.size,
      contentType,
      isTemporary: true,
    });
  }

  async discardOutput(token: string): Promise<void> {
    const output = this.outputs.get(token);
    if (!output) return;
    this.outputs.delete(token);
    await output.handle.close().catch(() => undefined);
    await rm(output.path, { force: true });
  }

  private register(file: PickedFile): PickedVideo {
    const token = randomUUID();
    this.files.set(token, file);
    return {
      token,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      url: `${MEDIA_SCHEME}://picked/${token}`,
    };
  }
}

export interface UploadDependencies {
  readonly folder: MediaFolder;
  /** `POST …/media/uploads`: where to send the bytes. */
  startUpload(body: {
    fileName: string;
    sizeBytes: number;
    contentType: string;
    sha256: string;
  }): Promise<{ fileId: string; url: string; headers: Record<string, string> }>;
  /** Sends the file to a signed URL: a PUT of exactly its bytes. */
  putFile(
    url: string,
    headers: Record<string, string>,
    path: string,
    sizeBytes: number,
    onProgress: (sentBytes: number) => void,
  ): Promise<void>;
  /** `POST …/media`: adds the uploaded video. */
  createMedia(body: {
    fileId: string;
    name: string;
    width: number;
    height: number;
    durationMs: number;
  }): Promise<Media>;
  onProgress(progress: MediaUploadProgress): void;
}

/**
 * Uploads a picked video: hashes it, sends it straight to storage with the
 * signed URL, adds it, and keeps a verified copy in the media folder so this
 * laptop never downloads what it just sent.
 */
export async function uploadPickedVideo(
  picked: PickedFile,
  input: MediaUploadInput,
  dependencies: UploadDependencies,
): Promise<Media> {
  const progress = (stage: MediaUploadProgress['stage'], sentBytes: number) =>
    dependencies.onProgress({
      token: input.token,
      stage,
      sentBytes,
      totalBytes: picked.sizeBytes,
    });

  if (
    (picked.contentType !== 'video/mp4' &&
      picked.contentType !== 'video/webm') ||
    picked.sizeBytes > MAX_VIDEO_BYTES
  ) {
    throw new Error('Convert this video before uploading it.');
  }
  const contentType: VideoType = picked.contentType;
  progress('checking', 0);
  const sha256 = await sha256Of(picked.path);
  // The file may have changed since it was picked; what was hashed is what
  // the server must receive.
  if ((await stat(picked.path)).size !== picked.sizeBytes) {
    throw new Error('The file changed while it was being uploaded. Try again.');
  }
  const upload = await dependencies.startUpload({
    fileName: picked.fileName,
    sizeBytes: picked.sizeBytes,
    contentType,
    sha256,
  });
  progress('uploading', 0);
  await dependencies.putFile(
    upload.url,
    upload.headers,
    picked.path,
    picked.sizeBytes,
    (sentBytes) => progress('uploading', sentBytes),
  );
  progress('saving', picked.sizeBytes);
  const media = await dependencies.createMedia({
    fileId: upload.fileId,
    name: input.name,
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
  });

  // A copy for this laptop, put in place only if it still matches.
  const { folder } = dependencies;
  await mkdir(folder.directory, { recursive: true });
  const target = folder.pathOf(
    folder.fileNameOf({
      sha256: media.sha256,
      contentType,
    }),
  );
  const copy = `${target}.copying`;
  await copyFile(picked.path, copy);
  if ((await sha256Of(copy)) === media.sha256) {
    await rename(copy, target);
  } else {
    await rm(copy, { force: true });
  }
  return media;
}
