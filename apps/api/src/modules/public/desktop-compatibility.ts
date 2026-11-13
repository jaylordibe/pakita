import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The API/desktop compatibility contract, stated once.
 *
 * - `API_LEVEL` rises by one whenever the API adds something a desktop may
 *   depend on. Changes within a level are backward compatible; a desktop
 *   built for level N works with any server at level N or above.
 * - `MINIMUM_DESKTOP_VERSION` is the oldest desktop release this server still
 *   serves. Raise it only in a release whose notes say so.
 *
 * A desktop compares both against its own (see apps/desktop) and tells the
 * operator exactly which side to update.
 */
export const API_LEVEL = 1;
export const MINIMUM_DESKTOP_VERSION = '0.0.0';

// This package's version, read once from its package.json: three levels up
// from both `src/modules/public` and the built `dist/modules/public`.
export const SERVER_VERSION: string = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
  ) as { version: string }
).version;
