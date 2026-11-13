import type Database from 'better-sqlite3';
import type { z } from 'zod';

import type { syncedSongChangeSchema } from './worker-protocol';

type SyncedSongChange = z.infer<typeof syncedSongChangeSchema>;

export interface SyncState {
  readonly epoch: string;
  readonly cursor: number;
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
 */
export class SongStore {
  constructor(private readonly database: Database.Database) {}

  getSyncState(workspaceId: string): SyncState | null {
    const row = this.database
      .prepare(
        'SELECT epoch, cursor FROM workspace_sync_states WHERE workspace_id = ?',
      )
      .get(workspaceId) as SyncState | undefined;
    return row ?? null;
  }

  /**
   * Applies one page of the server's changes and advances the cursor, in one
   * transaction. A change older than what the laptop already holds is
   * ignored, so a page applied twice (after a crash) changes nothing.
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
      WHERE excluded.sync_version > songs.sync_version
    `);
    const remove = this.database.prepare(
      'DELETE FROM songs WHERE id = ? AND workspace_id = ? AND sync_version < ?',
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
      for (const change of changes) {
        if (change.isDeleted || change.song === null) {
          remove.run(change.id, workspaceId, change.syncVersion);
          continue;
        }
        upsert.run({
          id: change.id,
          workspaceId,
          syncVersion: change.syncVersion,
          title: change.song.title,
          artist: change.song.artist,
          isArchived: change.song.isArchived ? 1 : 0,
          searchText: searchTextOf(change.song.title, change.song.artist),
          payload: JSON.stringify(change.song),
        });
      }
      saveState.run(workspaceId, epoch, nextCursor, new Date().toISOString());
    })();
  }

  /** Forgets a workspace's content, before a full resynchronisation. */
  resetWorkspace(workspaceId: string): void {
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM songs WHERE workspace_id = ?')
        .run(workspaceId);
      this.database
        .prepare('DELETE FROM workspace_sync_states WHERE workspace_id = ?')
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
