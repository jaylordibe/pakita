import type Database from 'better-sqlite3';
import type { z } from 'zod';

import type {
  syncedPlaylistChangeSchema,
  syncedSongChangeSchema,
  syncedThemeChangeSchema,
} from './worker-protocol';

type SyncedSongChange = z.infer<typeof syncedSongChangeSchema>;
type SyncedThemeChange = z.infer<typeof syncedThemeChangeSchema>;
type SyncedPlaylistChange = z.infer<typeof syncedPlaylistChangeSchema>;

export interface SyncPage {
  readonly epoch: string;
  readonly nextCursor: number;
  readonly songs: readonly SyncedSongChange[];
  readonly themes: readonly SyncedThemeChange[];
  readonly playlists: readonly SyncedPlaylistChange[];
}

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

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface PlaylistSummary {
  readonly id: string;
  readonly name: string;
  readonly serviceDate: string | null;
}

type ContentKind = 'song' | 'theme' | 'playlist';

/** Lower-cased title and artist, for a simple case-insensitive search. */
const searchTextOf = (title: string, artist: string | null) =>
  `${title} ${artist ?? ''}`.toLowerCase();

const escapeLike = (term: string) => term.replace(/[\\%_]/g, '\\$&');

/**
 * The laptop's copy of a workspace's content — songs, themes and playlists.
 * Runs in the database worker thread; every write is one transaction, so an
 * interrupted synchronisation leaves the last complete page — and its cursor
 * — behind, never half a page.
 *
 * A full resynchronisation (the server's history was replaced) never empties
 * the library: the old copy stays presentable while the new history arrives,
 * and only `finishResync` removes what the new history no longer contains.
 */
export class ContentStore {
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
        .prepare('DELETE FROM resync_seen WHERE workspace_id = ?')
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
   * reuses version numbers — and everything it contains is recorded.
   */
  applySyncPage(workspaceId: string, page: SyncPage): void {
    const upsertSong = this.database.prepare(`
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
    const upsertTheme = this.database.prepare(`
      INSERT INTO themes (id, workspace_id, sync_version, name, is_default, payload)
      VALUES (@id, @workspaceId, @syncVersion, @name, @isDefault, @payload)
      ON CONFLICT (id) DO UPDATE SET
        sync_version = excluded.sync_version,
        name = excluded.name,
        is_default = excluded.is_default,
        payload = excluded.payload
      WHERE themes.workspace_id = excluded.workspace_id
        AND (@isResyncing = 1 OR excluded.sync_version > themes.sync_version)
    `);
    const upsertPlaylist = this.database.prepare(`
      INSERT INTO playlists (id, workspace_id, sync_version, name, service_date, payload)
      VALUES (@id, @workspaceId, @syncVersion, @name, @serviceDate, @payload)
      ON CONFLICT (id) DO UPDATE SET
        sync_version = excluded.sync_version,
        name = excluded.name,
        service_date = excluded.service_date,
        payload = excluded.payload
      WHERE playlists.workspace_id = excluded.workspace_id
        AND (@isResyncing = 1 OR excluded.sync_version > playlists.sync_version)
    `);
    const removeFrom = (table: 'songs' | 'themes' | 'playlists') =>
      this.database.prepare(
        `DELETE FROM ${table} WHERE id = @id AND workspace_id = @workspaceId
           AND (@isResyncing = 1 OR sync_version < @syncVersion)`,
      );
    const remove = {
      song: removeFrom('songs'),
      theme: removeFrom('themes'),
      playlist: removeFrom('playlists'),
    };
    const markSeen = this.database.prepare(
      'INSERT OR IGNORE INTO resync_seen (workspace_id, kind, id) VALUES (?, ?, ?)',
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
      const apply = (
        kind: ContentKind,
        change: { id: string; syncVersion: number; isDeleted: boolean },
        content: object | null,
        upsert: () => void,
      ) => {
        if (change.isDeleted || content === null) {
          remove[kind].run({
            id: change.id,
            workspaceId,
            isResyncing,
            syncVersion: change.syncVersion,
          });
          return;
        }
        upsert();
        if (isResyncing) markSeen.run(workspaceId, kind, change.id);
      };
      const common = (change: { id: string; syncVersion: number }) => ({
        id: change.id,
        workspaceId,
        isResyncing,
        syncVersion: change.syncVersion,
      });

      for (const change of page.songs) {
        apply('song', change, change.song, () =>
          upsertSong.run({
            ...common(change),
            title: change.song!.title,
            artist: change.song!.artist,
            isArchived: change.song!.isArchived ? 1 : 0,
            searchText: searchTextOf(change.song!.title, change.song!.artist),
            payload: JSON.stringify(change.song),
          }),
        );
      }
      for (const change of page.themes) {
        apply('theme', change, change.theme, () =>
          upsertTheme.run({
            ...common(change),
            name: change.theme!.name,
            isDefault: change.theme!.isDefault ? 1 : 0,
            payload: JSON.stringify(change.theme),
          }),
        );
      }
      for (const change of page.playlists) {
        apply('playlist', change, change.playlist, () =>
          upsertPlaylist.run({
            ...common(change),
            name: change.playlist!.name,
            serviceDate: change.playlist!.serviceDate,
            payload: JSON.stringify(change.playlist),
          }),
        );
      }
      saveState.run(
        workspaceId,
        page.epoch,
        page.nextCursor,
        new Date().toISOString(),
      );
    })();
  }

  /**
   * Completes a resynchronisation: removes what the new history does not
   * contain, in the same transaction that ends resync mode.
   */
  finishResync(workspaceId: string): void {
    this.database.transaction(() => {
      for (const [table, kind] of [
        ['songs', 'song'],
        ['themes', 'theme'],
        ['playlists', 'playlist'],
      ] as const) {
        this.database
          .prepare(
            `DELETE FROM ${table} WHERE workspace_id = ? AND id NOT IN
               (SELECT id FROM resync_seen WHERE workspace_id = ? AND kind = ?)`,
          )
          .run(workspaceId, workspaceId, kind);
      }
      this.database
        .prepare('DELETE FROM resync_seen WHERE workspace_id = ?')
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
    return this.payloadOf('songs', workspaceId, songId);
  }

  listThemes(workspaceId: string): ThemeSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, is_default AS isDefault FROM themes
         WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(workspaceId) as Array<
      Omit<ThemeSummary, 'isDefault'> & { isDefault: number }
    >;
    return rows.map((row) => ({ ...row, isDefault: row.isDefault === 1 }));
  }

  /** The theme as the server sent it, or null. */
  getTheme(workspaceId: string, themeId: string): unknown {
    return this.payloadOf('themes', workspaceId, themeId);
  }

  /** The workspace's default theme as the server sent it, or null. */
  getDefaultTheme(workspaceId: string): unknown {
    const row = this.database
      .prepare(
        // Mid-sync, the new default can arrive before the old one is cleared:
        // the later change wins.
        `SELECT payload FROM themes WHERE workspace_id = ? AND is_default = 1
         ORDER BY sync_version DESC LIMIT 1`,
      )
      .get(workspaceId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as unknown) : null;
  }

  /** Newest service first; undated playlists last. */
  listPlaylists(workspaceId: string): PlaylistSummary[] {
    return this.database
      .prepare(
        `SELECT id, name, service_date AS serviceDate FROM playlists
         WHERE workspace_id = ?
         ORDER BY service_date IS NULL, service_date DESC, name COLLATE NOCASE
         LIMIT 1000`,
      )
      .all(workspaceId) as PlaylistSummary[];
  }

  /** The playlist as the server sent it, or null. */
  getPlaylist(workspaceId: string, playlistId: string): unknown {
    return this.payloadOf('playlists', workspaceId, playlistId);
  }

  private payloadOf(
    table: 'songs' | 'themes' | 'playlists',
    workspaceId: string,
    id: string,
  ): unknown {
    const row = this.database
      .prepare(`SELECT payload FROM ${table} WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as unknown) : null;
  }
}
