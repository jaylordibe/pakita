import { Worker } from 'node:worker_threads';

import type { DatabaseHealth } from '../../shared/ipc-contract';
import type { BibleContent } from '../api/api-schemas';
import type {
  BibleSearchResult as BibleSearchHit,
  StoredBibleBook,
  StoredBibleTranslation,
  StoredBibleVerse,
} from './bible-store';
import type {
  PlaylistSummary,
  SongSummary,
  SyncPage,
  SyncState,
  ThemeSummary,
} from './content-store';
import {
  BibleBooksResult,
  BiblePassageResult,
  BibleSearchResult,
  BibleTranslationsResult,
  DatabaseHealthResult,
  PlaylistSummaryResult,
  ThemeSummaryResult,
  type DatabaseWorkerRequestInput,
  DatabaseWorkerResponse,
  SongSummaryResult,
  SyncStateResult,
} from './worker-protocol';

type RequestWithoutId = DatabaseWorkerRequestInput extends infer Request
  ? Request extends unknown
    ? Omit<Request, 'requestId'>
    : never
  : never;

type PendingRequest = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

/** How long `close()` waits for the worker to close the database cleanly. */
const CLOSE_TIMEOUT_MILLISECONDS = 5_000;

/**
 * The main process's handle on the database worker thread.
 *
 * Once the worker has stopped — it failed to open or migrate the database, or
 * it crashed — every request rejects at once with the reason, instead of
 * being posted to a thread that will never answer.
 */
export class DatabaseClient {
  private readonly worker: Worker;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private stoppedError: Error | null = null;
  private isClosing = false;

  constructor(
    workerPath: string,
    databasePath: string,
    private readonly logError: (message: string) => void = console.error,
  ) {
    this.worker = new Worker(workerPath, { workerData: { databasePath } });
    this.worker.on('message', (message: unknown) => this.settle(message));
    this.worker.on('error', (error) => this.stop(error));
    this.worker.on('exit', (exitCode) =>
      this.stop(
        new Error(`The database worker stopped (exit code ${exitCode})`),
      ),
    );
  }

  async getHealth(): Promise<DatabaseHealth> {
    return DatabaseHealthResult.parse(await this.request({ type: 'health' }));
  }

  async getSyncState(workspaceId: string): Promise<SyncState | null> {
    return SyncStateResult.parse(
      await this.request({ type: 'getSyncState', workspaceId }),
    );
  }

  async applySyncPage(workspaceId: string, page: SyncPage): Promise<void> {
    await this.request({
      type: 'applySyncPage',
      workspaceId,
      epoch: page.epoch,
      nextCursor: page.nextCursor,
      songs: [...page.songs],
      themes: [...page.themes],
      playlists: [...page.playlists],
    });
  }

  async beginResync(workspaceId: string, epoch: string): Promise<void> {
    await this.request({ type: 'beginResync', workspaceId, epoch });
  }

  async finishResync(workspaceId: string): Promise<void> {
    await this.request({ type: 'finishResync', workspaceId });
  }

  async listSongs(
    workspaceId: string,
    search: string,
    isArchived: boolean,
  ): Promise<SongSummary[]> {
    return SongSummaryResult.parse(
      await this.request({
        type: 'listSongs',
        workspaceId,
        search,
        isArchived,
      }),
    );
  }

  /** The song as the server sent it (validate before use), or null. */
  async getSong(workspaceId: string, songId: string): Promise<unknown> {
    return this.request({ type: 'getSong', workspaceId, songId });
  }

  async listThemes(workspaceId: string): Promise<ThemeSummary[]> {
    return ThemeSummaryResult.parse(
      await this.request({ type: 'listThemes', workspaceId }),
    );
  }

  /** The theme as the server sent it (validate before use), or null. */
  async getTheme(workspaceId: string, themeId: string): Promise<unknown> {
    return this.request({ type: 'getTheme', workspaceId, themeId });
  }

  /** The default theme as the server sent it (validate before use), or null. */
  async getDefaultTheme(workspaceId: string): Promise<unknown> {
    return this.request({ type: 'getDefaultTheme', workspaceId });
  }

  async listPlaylists(workspaceId: string): Promise<PlaylistSummary[]> {
    return PlaylistSummaryResult.parse(
      await this.request({ type: 'listPlaylists', workspaceId }),
    );
  }

  /** The playlist as the server sent it (validate before use), or null. */
  async getPlaylist(workspaceId: string, playlistId: string): Promise<unknown> {
    return this.request({ type: 'getPlaylist', workspaceId, playlistId });
  }

  async listBibleTranslations(): Promise<StoredBibleTranslation[]> {
    return BibleTranslationsResult.parse(
      await this.request({ type: 'listBibleTranslations' }),
    );
  }

  async replaceBibleTranslation(content: BibleContent): Promise<void> {
    await this.request({ type: 'replaceBibleTranslation', content });
  }

  async removeBibleTranslation(translationId: string): Promise<void> {
    await this.request({ type: 'removeBibleTranslation', translationId });
  }

  async listBibleBooks(translationId: string): Promise<StoredBibleBook[]> {
    return BibleBooksResult.parse(
      await this.request({ type: 'listBibleBooks', translationId }),
    );
  }

  async getBiblePassage(
    translationId: string,
    bookCode: string,
    start: { chapter: number; verse: number },
    end: { chapter: number; verse: number },
  ): Promise<StoredBibleVerse[]> {
    return BiblePassageResult.parse(
      await this.request({
        type: 'getBiblePassage',
        translationId,
        bookCode,
        start,
        end,
      }),
    );
  }

  async searchBible(
    translationId: string,
    search: string,
  ): Promise<BibleSearchHit[]> {
    return BibleSearchResult.parse(
      await this.request({ type: 'searchBible', translationId, search }),
    );
  }

  /**
   * Asks the worker to close the database (finishing its current statement),
   * and terminates it only if it does not answer in time.
   */
  async close(): Promise<void> {
    if (this.stoppedError) {
      return;
    }
    this.isClosing = true;
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MILLISECONDS).unref(),
    );
    const outcome = await Promise.race([
      this.request({ type: 'close' }).catch(() => 'failed' as const),
      timeout,
    ]);
    // `undefined` is the worker's answer: database closed, thread exiting.
    const isClosedCleanly = outcome === undefined;
    if (!isClosedCleanly) {
      await this.worker.terminate();
    }
  }

  private request(request: RequestWithoutId): Promise<unknown> {
    if (this.stoppedError) {
      return Promise.reject(this.stoppedError);
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...request, requestId });
    });
  }

  private settle(message: unknown): void {
    const parsed = DatabaseWorkerResponse.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const pending = this.pendingRequests.get(parsed.data.requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(parsed.data.requestId);
    if (parsed.data.isSuccess) {
      pending.resolve(parsed.data.result);
    } else {
      pending.reject(new Error(parsed.data.errorMessage));
    }
  }

  private stop(error: Error): void {
    // The first reason is the real one; `exit` always follows `error`.
    if (!this.stoppedError) {
      this.stoppedError = error;
      if (!this.isClosing) {
        this.logError(`Local database unavailable: ${error.message}`);
      }
    }
    for (const pending of this.pendingRequests.values()) {
      pending.reject(this.stoppedError);
    }
    this.pendingRequests.clear();
  }
}
