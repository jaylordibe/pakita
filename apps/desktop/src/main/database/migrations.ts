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
