import type { MediaFileState } from '../../shared/ipc-contract';
import type { FetchFunction } from '../api/api-client';
import type { Media } from '../api/api-schemas';
import {
  isMediaType,
  MediaDiskFullError,
  type MediaType,
  MediaIntegrityError,
  type MediaFolder,
} from './media-folder';

export interface MediaSyncDependencies {
  readonly folder: MediaFolder;
  /** The current workspace's videos (validated), or [] with none. */
  listMedia(): Promise<Media[]>;
  /** Every workspace's video hashes on this laptop: what the folder keeps. */
  listAllHashes(): Promise<string[]>;
  /** A fresh signed URL for one video's bytes. */
  downloadUrl(mediaId: string): Promise<string>;
  readonly fetchFunction: FetchFunction;
  /** Downloads never run during a presentation. */
  isLive(): boolean;
  onChange(states: readonly MediaFileState[]): void;
}

// Reports progress at most this often, so a fast download does not flood
// the operator window with events.
const PROGRESS_INTERVAL_MILLISECONDS = 500;

/**
 * Makes the laptop hold every video of its workspace, one download at a time,
 * after each synchronisation. Never during a presentation: going live stops
 * the download under way (its partial file stays, and it resumes with a
 * `Range` request next time). A video whose download failed verification is
 * not downloaded again until the app restarts or the operator re-downloads
 * everything, as for Bible translations.
 */
export class MediaSync {
  private states = new Map<string, MediaFileState>();
  private running: Promise<void> | null = null;
  private isRerunRequested = false;
  private controller: AbortController | null = null;
  private readonly rejected = new Set<string>();

  constructor(private readonly dependencies: MediaSyncDependencies) {}

  getStates(): MediaFileState[] {
    return [...this.states.values()];
  }

  /** Starts a run, or asks the one under way to run once more. */
  run(): Promise<void> {
    if (this.running) {
      this.isRerunRequested = true;
      return this.running;
    }
    this.running = this.runUntilSettled().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stops the download under way (a presentation started). */
  stop(): void {
    this.controller?.abort();
  }

  /** Tries videos that failed verification again (Re-download all). */
  forgetRejections(): void {
    this.rejected.clear();
  }

  private async runUntilSettled(): Promise<void> {
    do {
      this.isRerunRequested = false;
      await this.runOnce();
    } while (this.isRerunRequested && !this.dependencies.isLive());
  }

  private async runOnce(): Promise<void> {
    const { folder } = this.dependencies;
    const media = (await this.dependencies.listMedia()).filter((video) =>
      isMediaType(video.contentType),
    );
    await folder.removeAllExcept(
      new Set(await this.dependencies.listAllHashes()),
    );

    const next = new Map<string, MediaFileState>();
    for (const video of media) {
      const isHeld = await folder.has(this.identity(video));
      const previous = this.states.get(video.id);
      next.set(
        video.id,
        isHeld
          ? this.state(video, 'ready', video.sizeBytes)
          : previous?.state === 'failed'
            ? previous
            : this.state(video, 'waiting', 0),
      );
    }
    this.states = next;
    this.publish();

    for (const video of media) {
      if (this.dependencies.isLive()) return;
      const current = this.states.get(video.id);
      const rejection = `${video.id}:${video.sha256}`;
      if (current?.state === 'ready' || this.rejected.has(rejection)) continue;
      await this.download(video, rejection);
    }
  }

  private async download(video: Media, rejection: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    let lastReport = 0;
    this.update(video, 'downloading', 0);
    try {
      await this.dependencies.folder.download(
        { ...this.identity(video), name: video.name },
        () => this.dependencies.downloadUrl(video.id),
        this.dependencies.fetchFunction,
        {
          signal: controller.signal,
          onProgress: (receivedBytes) => {
            const now = Date.now();
            if (now - lastReport < PROGRESS_INTERVAL_MILLISECONDS) return;
            lastReport = now;
            this.update(video, 'downloading', receivedBytes);
          },
        },
      );
      this.update(video, 'ready', video.sizeBytes);
    } catch (error) {
      if (controller.signal.aborted) {
        this.update(video, 'waiting', 0);
        return;
      }
      if (error instanceof MediaIntegrityError) this.rejected.add(rejection);
      this.update(
        video,
        'failed',
        0,
        error instanceof MediaIntegrityError ||
          error instanceof MediaDiskFullError
          ? error.message
          : `“${video.name}” could not be downloaded. It will be tried again.`,
      );
    } finally {
      this.controller = null;
    }
  }

  private identity(video: Media) {
    return {
      sha256: video.sha256,
      sizeBytes: video.sizeBytes,
      contentType: video.contentType as MediaType,
    };
  }

  private state(
    video: Media,
    state: MediaFileState['state'],
    receivedBytes: number,
    message: string | null = null,
  ): MediaFileState {
    return {
      mediaId: video.id,
      state,
      receivedBytes,
      sizeBytes: video.sizeBytes,
      message,
    };
  }

  private update(
    video: Media,
    state: MediaFileState['state'],
    receivedBytes: number,
    message: string | null = null,
  ): void {
    this.states.set(video.id, this.state(video, state, receivedBytes, message));
    this.publish();
  }

  private publish(): void {
    this.dependencies.onChange(this.getStates());
  }
}
