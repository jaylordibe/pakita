import type { SyncStatus } from '../../shared/ipc-contract';
import { ApiError, ServerUnreachableError } from '../api/api-client';
import type { SyncChanges } from '../api/api-schemas';
import { SignInRequiredError } from '../auth/session';
import type { DatabaseClient } from '../database/database-client';

/** Pages of 50 songs; a sanity bound well above any church library. */
const PAGE_SIZE = 50;
const MAX_PAGES = 5_000;

export interface SyncDependencies {
  /** One page of the workspace's changes after `cursor` (validated). */
  fetchChanges(
    workspaceId: string,
    cursor: number,
    limit: number,
  ): Promise<SyncChanges>;
  readonly database: Pick<
    DatabaseClient,
    'getSyncState' | 'applySyncPage' | 'beginResync' | 'finishResync'
  >;
  now(): Date;
}

/**
 * Brings the laptop's copy of a workspace up to date with the server.
 *
 * Each page is applied in one database transaction together with its cursor,
 * so an interrupted run resumes where the last complete page left off. When
 * the server's history was replaced (its epoch changed, or it is behind the
 * laptop — a backup was restored), the workspace is resynchronised from the
 * beginning: the old copy stays presentable until the new history has fully
 * arrived, and an interrupted resynchronisation resumes as one.
 *
 * It only ever writes the database; what is on screen during a presentation
 * is held in memory and is never touched by a synchronisation.
 */
export class SyncEngine {
  private status: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    message: null,
  };
  private running: Promise<SyncStatus> | null = null;
  private isRerunRequested = false;

  constructor(
    private readonly dependencies: SyncDependencies,
    private readonly onStatus: (status: SyncStatus) => void,
  ) {}

  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * Runs one synchronisation. A call while one is running joins it, and
   * makes it run once more when it finishes — so a change saved during a run
   * is never left behind by it.
   */
  syncWorkspace(workspaceId: string): Promise<SyncStatus> {
    if (this.running) {
      this.isRerunRequested = true;
      return this.running;
    }
    this.running = this.runUntilSettled(workspaceId).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runUntilSettled(workspaceId: string): Promise<SyncStatus> {
    let status: SyncStatus;
    do {
      this.isRerunRequested = false;
      status = await this.run(workspaceId);
    } while (this.isRerunRequested && status.state === 'idle');
    return status;
  }

  private async run(workspaceId: string): Promise<SyncStatus> {
    this.setStatus({ ...this.status, state: 'syncing', message: null });
    try {
      await this.pullAll(workspaceId);
      return this.setStatus({
        state: 'idle',
        lastSyncedAt: this.dependencies.now().toISOString(),
        message: null,
      });
    } catch (error) {
      return this.setStatus({ ...this.status, ...describeFailure(error) });
    }
  }

  private async pullAll(workspaceId: string): Promise<void> {
    const { database } = this.dependencies;
    const saved = await database.getSyncState(workspaceId);
    let cursor = saved?.cursor ?? 0;
    let epoch = saved?.epoch ?? null;
    let isResyncing = saved?.isResyncing ?? false;
    let hasBegunResync = false;

    for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
      const page = await this.dependencies.fetchChanges(
        workspaceId,
        cursor,
        PAGE_SIZE,
      );
      const isHistoryReplaced =
        epoch !== null && (page.epoch !== epoch || cursor > page.latestVersion);
      if (isHistoryReplaced) {
        if (hasBegunResync) {
          throw new Error('The server’s history changed again mid-sync.');
        }
        await database.beginResync(workspaceId, page.epoch);
        hasBegunResync = true;
        isResyncing = true;
        cursor = 0;
        epoch = page.epoch;
        continue;
      }
      const foreign = page.songs.find(
        (change) =>
          change.song !== null && change.song.workspaceId !== workspaceId,
      );
      if (foreign) {
        throw new Error('The server sent songs from another workspace.');
      }
      await database.applySyncPage(workspaceId, {
        epoch: page.epoch,
        nextCursor: page.nextCursor,
        songs: page.songs,
      });
      epoch = page.epoch;
      cursor = page.nextCursor;
      if (!page.hasMore) {
        if (isResyncing) {
          await database.finishResync(workspaceId);
        }
        return;
      }
    }
    throw new Error('Synchronisation did not finish; try again.');
  }

  private setStatus(status: SyncStatus): SyncStatus {
    this.status = status;
    this.onStatus(status);
    return status;
  }
}

function describeFailure(
  error: unknown,
): Pick<SyncStatus, 'state' | 'message'> {
  if (error instanceof ServerUnreachableError) {
    return {
      state: 'offline',
      message: 'Offline — presenting from this laptop’s copy.',
    };
  }
  if (error instanceof SignInRequiredError) {
    return { state: 'sign-in-required', message: error.message };
  }
  if (error instanceof ApiError && error.status === 404) {
    return {
      state: 'error',
      message: 'This workspace is no longer available to you on the server.',
    };
  }
  return {
    state: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}
