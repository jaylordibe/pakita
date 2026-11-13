import type Database from 'better-sqlite3';
import type { z } from 'zod';

import type { syncedSongChangeSchema } from './worker-protocol';

type SyncedSongChange = z.infer<typeof syncedSongChangeSchema>;

export interface SyncState {
  readonly epoch: string;
  readonly cursor: number;
  /** A full resynchronisation is under way (see `beginResync`). */
  readonly isResyncing: boolean;
}

export interface SongSummary {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  readonly isArchived: boolean;
}

/** Lower-cased title and artist, for a simple case-insensitive search. */
const searchTextOf = (title: string, artist: string | null) =>
  `${title} ${artist ?? ''}`.toLowerCase();

const escapeLike = (term: string) => term.replace(/[\\%_]/g, '\\$&');

/**
 * The laptop's copy of a workspace's songs. Runs in the database worker
 * thread; every write is one transaction, so an interrupted synchronisation
 * leaves the last complete page — and its cursor — behind, never half a page.
 *
 * A full resynchronisation (the server's history was replaced) never empties
 * the library: the old copy stays presentable while the new history arrives,
 * and only `finishResync` removes what the new history no longer contains.
 */
export class SongStore {
  constructor(private readonly database: Database.Database) {}

  getSyncState(workspaceId: string): SyncState | null {
    const row = this.database
      .prepare(
        `SELECT epoch, cursor, is_resyncing AS isResyncing
         FROM workspace_sync_states WHERE workspace_id = ?`,
      )
      .get(workspaceId) as
      | { epoch: string; cursor: number; isResyncing: number }
      | undefined;
    return row ? { ...row, isResyncing: row.isResyncing === 1 } : null;
  }

  /** Starts rebuilding the workspace's copy from a new server history. */
  beginResync(workspaceId: string, epoch: string): void {
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM resync_seen_songs WHERE workspace_id = ?')
        .run(workspaceId);
      this.database
        .prepare(
          `INSERT INTO workspace_sync_states (workspace_id, epoch, cursor, last_synced_at, is_resyncing)
           VALUES (?, ?, 0, ?, 1)
           ON CONFLICT (workspace_id) DO UPDATE SET
             epoch = excluded.epoch, cursor = 0, is_resyncing = 1`,
        )
        .run(workspaceId, epoch, new Date().toISOString());
    })();
  }

  /**
   * Applies one page of the server's changes and advances the cursor, in one
   * transaction. Normally a change older than what the laptop holds is
   * ignored, so a page applied twice (after a crash) changes nothing. During
   * a resynchronisation the new history wins outright — a restored server
   * reuses version numbers — and every song it contains is recorded.
   */
  applySyncPage(
    workspaceId: string,
    epoch: string,
    nextCursor: number,
    changes: readonly SyncedSongChange[],
  ): void {
    const upsert = this.database.prepare(`
      INSERT INTO songs (id, workspace_id, sync_version, title, artist, is_archived, search_text, payload)
      VALUES (@id, @workspaceId, @syncVersion, @title, @artist, @isArchived, @searchText, @payload)
      ON CONFLICT (id) DO UPDATE SET
        sync_version = excluded.sync_version,
        title = excluded.title,
        artist = excluded.artist,
        is_archived = excluded.is_archived,
        search_text = excluded.search_text,
        payload = excluded.payload
      WHERE songs.workspace_id = excluded.workspace_id
        AND (@isResyncing = 1 OR excluded.sync_version > songs.sync_version)
    `);
    const remove = this.database.prepare(
      `DELETE FROM songs WHERE id = @id AND workspace_id = @workspaceId
         AND (@isResyncing = 1 OR sync_version < @syncVersion)`,
    );
    const markSeen = this.database.prepare(
      'INSERT OR IGNORE INTO resync_seen_songs (workspace_id, song_id) VALUES (?, ?)',
    );
    const saveState = this.database.prepare(`
      INSERT INTO workspace_sync_states (workspace_id, epoch, cursor, last_synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (workspace_id) DO UPDATE SET
        epoch = excluded.epoch,
        cursor = excluded.cursor,
        last_synced_at = excluded.last_synced_at
    `);

    this.database.transaction(() => {
      const isResyncing = this.getSyncState(workspaceId)?.isResyncing ? 1 : 0;
      for (const change of changes) {
        if (change.isDeleted || change.song === null) {
          remove.run({
            id: change.id,
            workspaceId,
            isResyncing,
            syncVersion: change.syncVersion,
          });
          continue;
        }
        upsert.run({
          id: change.id,
          workspaceId,
          isResyncing,
          syncVersion: change.syncVersion,
          title: change.song.title,
          artist: change.song.artist,
          isArchived: change.song.isArchived ? 1 : 0,
          searchText: searchTextOf(change.song.title, change.song.artist),
          payload: JSON.stringify(change.song),
        });
        if (isResyncing) {
          markSeen.run(workspaceId, change.id);
        }
      }
      saveState.run(workspaceId, epoch, nextCursor, new Date().toISOString());
    })();
  }

  /**
   * Completes a resynchronisation: removes the songs the new history does not
   * contain, in the same transaction that ends resync mode.
   */
  finishResync(workspaceId: string): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM songs WHERE workspace_id = ? AND id NOT IN
             (SELECT song_id FROM resync_seen_songs WHERE workspace_id = ?)`,
        )
        .run(workspaceId, workspaceId);
      this.database
        .prepare('DELETE FROM resync_seen_songs WHERE workspace_id = ?')
        .run(workspaceId);
      this.database
        .prepare(
          'UPDATE workspace_sync_states SET is_resyncing = 0 WHERE workspace_id = ?',
        )
        .run(workspaceId);
    })();
  }

  listSongs(
    workspaceId: string,
    search: string,
    isArchived: boolean,
  ): SongSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, artist, is_archived AS isArchived FROM songs
         WHERE workspace_id = ? AND is_archived = ?
           AND search_text LIKE ? ESCAPE '\\'
         ORDER BY title COLLATE NOCASE
         LIMIT 1000`,
      )
      .all(
        workspaceId,
        isArchived ? 1 : 0,
        `%${escapeLike(search.trim().toLowerCase())}%`,
      ) as Array<Omit<SongSummary, 'isArchived'> & { isArchived: number }>;
    return rows.map((row) => ({ ...row, isArchived: row.isArchived === 1 }));
  }

  /** The song as the server sent it, or null if this laptop does not have it. */
  getSong(workspaceId: string, songId: string): unknown {
    const row = this.database
      .prepare('SELECT payload FROM songs WHERE id = ? AND workspace_id = ?')
      .get(songId, workspaceId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as unknown) : null;
  }
}
