// The one definition of every IPC channel the renderer may call and what each
// returns. The preload exposes exactly these; the main process registers a
// handler for each. Nothing else crosses the boundary.

export const IpcChannel = {
  appGetVersion: 'app:get-version',
  databaseGetHealth: 'database:get-health',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

export interface DatabaseHealth {
  readonly journalMode: string;
  readonly schemaVersion: number;
  readonly latestSchemaVersion: number;
}

/** What the preload exposes on `window.pakita`. */
export interface PakitaApi {
  readonly app: {
    getVersion(): Promise<string>;
  };
  readonly database: {
    getHealth(): Promise<DatabaseHealth>;
  };
}
