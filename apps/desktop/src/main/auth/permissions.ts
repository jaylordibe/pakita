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
  canImportBibles: false,
  canManageAccounts: false,
  canInviteMembers: false,
};

/**
 * Which administrative actions these rules allow. `workspaceId` is the open
 * church: inviting is granted per church, so with none open it is refused.
 */
export function capabilitiesOf(
  rules: PackedRules,
  workspaceId: string | null,
): AccountCapabilities {
  const ability = createMongoAbility(
    unpackRules(rules as unknown as PackRule<never>[]),
  );
  return {
    canImportBibles: ability.can('create', 'BibleTranslation'),
    // Creating accounts and setting their passwords are separate permissions
    // on the server; the account screen needs both.
    canManageAccounts:
      ability.can('read', 'User') &&
      ability.can('create', 'User') &&
      ability.can('resetPassword', 'User'),
    canInviteMembers:
      workspaceId !== null &&
      ability.can(
        'create',
        subject('WorkspaceInvitation', { workspaceId }) as never,
      ),
  };
}
