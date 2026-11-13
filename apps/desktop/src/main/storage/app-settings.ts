import { join } from 'node:path';
import { z } from 'zod';

import { readJsonFile, writeJsonFile } from './json-file';

const appSettingsSchema = z.object({
  /** The church server, as an origin (see parseServerAddress). */
  serverOrigin: z.string().nullable().default(null),
  /** The workspace (church branch) this laptop works in. */
  workspaceId: z.string().nullable().default(null),
  /** The display the operator chose for the projector, by Electron id. */
  projectorDisplayId: z.number().int().nullable().default(null),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

const DEFAULT_SETTINGS: AppSettings = {
  serverOrigin: null,
  workspaceId: null,
  projectorDisplayId: null,
};

/** Non-secret settings, kept in `settings.json` in the app's data folder. */
export class AppSettingsStore {
  private readonly path: string;
  private settings: AppSettings;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, 'settings.json');
    this.settings = readJsonFile(
      this.path,
      appSettingsSchema,
      DEFAULT_SETTINGS,
    );
  }

  get(): AppSettings {
    return this.settings;
  }

  update(change: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...change };
    writeJsonFile(this.path, this.settings);
    return this.settings;
  }
}
