// The local database's schema, as an ordered list of migrations. Migration N
// (1-based) takes the database from `user_version` N-1 to N, in one
// transaction. Append only: never edit or reorder a migration that has
// shipped, because laptops already ran it.
//
export const MIGRATIONS: readonly string[] = [
  // 1 — synchronised songs. A song is stored as the server sent it
  // (`payload`, the API's SongResponseDto), plus the columns the library
  // lists and searches by. `workspace_sync_states` remembers how far each
  // workspace has synchronised and which server history (`epoch`) that was.
  `
  CREATE TABLE workspace_sync_states (
    workspace_id TEXT PRIMARY KEY NOT NULL,
    epoch TEXT NOT NULL,
    cursor INTEGER NOT NULL CHECK (cursor >= 0),
    last_synced_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE songs (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    sync_version INTEGER NOT NULL CHECK (sync_version > 0),
    title TEXT NOT NULL,
    artist TEXT,
    is_archived INTEGER NOT NULL CHECK (is_archived IN (0, 1)),
    search_text TEXT NOT NULL,
    payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX songs_workspace_title ON songs (workspace_id, title COLLATE NOCASE);
  `,
  // 2 — full resynchronisation that keeps the old copy presentable until the
  // new one is complete: while `is_resyncing`, every song the new history
  // contains is recorded in `resync_seen_songs`; songs it lacks are removed
  // only when the last page has arrived.
  `
  ALTER TABLE workspace_sync_states
    ADD COLUMN is_resyncing INTEGER NOT NULL DEFAULT 0 CHECK (is_resyncing IN (0, 1));
  CREATE TABLE resync_seen_songs (
    workspace_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, song_id)
  ) STRICT;
  `,
  // 3 — Bible translations, downloaded whole and verified (see BibleStore),
  // with a full-text index for searching offline.
  `
  CREATE TABLE bible_translations (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    language_code TEXT NOT NULL,
    attribution TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    verse_count INTEGER NOT NULL CHECK (verse_count >= 0)
  ) STRICT;
  CREATE TABLE bible_books (
    translation_id TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    chapter_count INTEGER NOT NULL CHECK (chapter_count > 0),
    PRIMARY KEY (translation_id, code)
  ) STRICT;
  CREATE TABLE bible_verses (
    translation_id TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    book_code TEXT NOT NULL,
    chapter INTEGER NOT NULL CHECK (chapter > 0),
    verse INTEGER NOT NULL CHECK (verse > 0),
    text TEXT NOT NULL,
    UNIQUE (translation_id, book_code, chapter, verse)
  ) STRICT;
  CREATE VIRTUAL TABLE bible_verses_search USING fts5(
    text,
    content = 'bible_verses',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
  // 4 — synchronised themes and playlists, stored like songs (the server's
  // response as the payload, plus the columns listed by). Resynchronisation
  // now records every kind of content it sees, in one table.
  `
  CREATE TABLE themes (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    sync_version INTEGER NOT NULL CHECK (sync_version > 0),
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
    payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX themes_workspace_name ON themes (workspace_id, name COLLATE NOCASE);
  CREATE TABLE playlists (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    sync_version INTEGER NOT NULL CHECK (sync_version > 0),
    name TEXT NOT NULL,
    service_date TEXT,
    payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX playlists_workspace_date ON playlists (workspace_id, service_date);
  CREATE TABLE resync_seen (
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, kind, id)
  ) STRICT;
  INSERT INTO resync_seen (workspace_id, kind, id)
    SELECT workspace_id, 'song', song_id FROM resync_seen_songs;
  DROP TABLE resync_seen_songs;
  -- An older app may already have synchronised past themes and playlists it
  -- could not store: read the history once more. What the laptop already
  -- holds is skipped by its version, so only the missing content arrives.
  UPDATE workspace_sync_states SET cursor = 0;
  `,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

/** The subset of a better-sqlite3 connection the runner needs. */
export interface MigratableDatabase {
  pragma(source: string, options: { simple: true }): unknown;
  exec(source: string): unknown;
  transaction<Arguments extends unknown[]>(
    run: (...runArguments: Arguments) => void,
  ): (...runArguments: Arguments) => void;
}

/**
 * Brings the database up to `migrations.length`. A database from a NEWER app
 * version is refused rather than written to: this build cannot know what that
 * schema means.
 */
export function migrateDatabase(
  database: MigratableDatabase,
  migrations: readonly string[] = MIGRATIONS,
): number {
  const currentVersion = Number(
    database.pragma('user_version', { simple: true }),
  );
  if (currentVersion > migrations.length) {
    throw new Error(
      `The local database (schema ${currentVersion}) was written by a newer Pakita ` +
        `(this one knows schema ${migrations.length}). Update Pakita.`,
    );
  }
  migrations.slice(currentVersion).forEach((migration, offset) => {
    const version = currentVersion + offset + 1;
    database.transaction(() => {
      database.exec(migration);
      database.pragma(`user_version = ${version}`, { simple: true });
    })();
  });
  return migrations.length;
}
