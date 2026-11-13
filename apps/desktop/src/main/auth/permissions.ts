import { createMongoAbility, subject } from '@casl/ability';
import { type PackRule, unpackRules } from '@casl/ability/extra';

import type { AccountCapabilities } from '../../shared/ipc-contract';

// What the signed-in person may do, rebuilt from the packed CASL rules of
// `GET /api/users/me/permissions` exactly as the API documents
// (apps/api/src/common/authorization/README.md, "Client-side ability sync").
// It only decides what the interface offers: the server checks every request.

type PackedRules = readonly (readonly unknown[])[];

/** None of the administrative actions: offline, signed out, or no rules. */
export const NO_CAPABILITIES: AccountCapabilities = {
  isPlatformAccount: false,
  canImportBibles: false,
  canManageAccounts: false,
  canManageChurches: false,
  canInviteMembers: false,
  canCreateMemberAccounts: false,
};

// A church no membership names. A church account reads only the churches it
// belongs to (a rule conditioned on each one's id), so only a rule with no
// condition — every platform role's "read any workspace" — reads this one.
const UNKNOWN_CHURCH_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Which administrative actions these rules allow. `workspaceId` is the open
 * church: inviting and creating its people's accounts are granted per church,
 * so with none open they are refused.
 */
export function capabilitiesOf(
  rules: PackedRules,
  workspaceId: string | null,
): AccountCapabilities {
  const ability = createMongoAbility(
    unpackRules(rules as unknown as PackRule<never>[]),
  );
  return {
    // Decided from the rules, never from role names (`api-schemas.ts`):
    // the server's staff read every church; nobody else does.
    isPlatformAccount: ability.can(
      'read',
      subject('Workspace', { id: UNKNOWN_CHURCH_ID }) as never,
    ),
    canImportBibles: ability.can('create', 'BibleTranslation'),
    // Creating accounts and setting their passwords are separate permissions
    // on the server; the account screen needs both.
    canManageAccounts:
      ability.can('read', 'User') &&
      ability.can('create', 'User') &&
      ability.can('resetPassword', 'User'),
    canManageChurches: ability.can('create', 'Workspace'),
    canInviteMembers:
      workspaceId !== null &&
      ability.can(
        'create',
        subject('WorkspaceInvitation', { workspaceId }) as never,
      ),
    canCreateMemberAccounts:
      workspaceId !== null &&
      ability.can(
        'createAccount',
        subject('WorkspaceMembership', { workspaceId }) as never,
      ),
  };
}
