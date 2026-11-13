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
// 2: Bible translations (/api/bible-translations).
// 3: themes and playlists, also in the sync feed.
// 4: copying a song to another workspace.
// 5: no email, text or bot check — administrator-created accounts that must
//    replace their first password (PASSWORD_CHANGE_REQUIRED), and invitation
//    codes returned to the inviter.
// 6: platform accounts never join a workspace; only the platform admin
//    creates one, naming its owner; replacing a workspace's owner
//    (PUT /workspaces/:id/owner); a workspace's owner and admins create their
//    people's accounts (POST /workspaces/:id/accounts).
// 7: the account list (GET /users) says what each account belongs to:
//    `platformRoles` and `workspaceMemberships`.
// 8: searching accounts (GET /users: `search`, `isActive`,
//    `isPlatformAccount`) and a workspace's members by role
//    (GET /workspaces/:id/memberships: `roleName`).
export const API_LEVEL = 8;
export const MINIMUM_DESKTOP_VERSION = '0.0.0';

// This package's version, read once from its package.json: three levels up
// from both `src/modules/public` and the built `dist/modules/public`.
export const SERVER_VERSION: string = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
  ) as { version: string }
).version;
