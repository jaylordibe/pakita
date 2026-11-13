import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkspaceMembershipStatus } from '../../common/enums/workspace-membership-status.enum';
import { Errors } from '../../common/errors/errors';

/**
 * A membership that still ties an account to a live workspace: ACTIVE, or
 * SUSPENDED (reversible, so the account is still that workspace's person).
 * LEFT is history and ties nobody to anything.
 */
export const HELD_MEMBERSHIP_OF_LIVE_WORKSPACE = {
  status: {
    in: [WorkspaceMembershipStatus.ACTIVE, WorkspaceMembershipStatus.SUSPENDED],
  },
  workspace: { deletedAt: null },
} satisfies Prisma.WorkspaceMembershipWhereInput;

/**
 * The one place that keeps platform accounts and workspace accounts apart.
 *
 * A Pakita server's platform roles are the Main Church's IT staff. They run
 * the server and never belong to a church; a person who also serves in one
 * uses a second, ordinary account. So an account holds platform roles OR
 * workspace memberships, never both, and each write that could join the two
 * asks here first:
 *
 * - every write that leaves an account with an ACTIVE membership, through
 *   `WorkspaceOwnershipPolicy.assertUserMayHoldActiveMembership`;
 * - granting a platform role, in `UserRolesService.assign`.
 *
 * **The caller must already hold the target's user-row lock** (`lockUserRow`)
 * inside the same transaction. Both directions take that lock first, so a role
 * grant and an invitation accept racing on one account serialise, and the
 * second re-reads what the first committed. Checking outside the lock would let
 * both pass.
 *
 * `AuthorizationDataIntegrityService` refuses to boot on stored state that
 * breaks the rule anyway (`platform_account_holds_membership`).
 */
@Injectable()
export class PlatformAccountPolicy {
  async assertMayJoinWorkspace(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const platformRole = await transaction.userRole.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (platformRole) {
      throw Errors.platformAccountCannotJoinWorkspace();
    }
  }

  async assertMayHoldPlatformRole(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const membership = await transaction.workspaceMembership.findFirst({
      where: { userId, ...HELD_MEMBERSHIP_OF_LIVE_WORKSPACE },
      select: { id: true },
    });
    if (membership) {
      throw Errors.workspaceMemberCannotHoldPlatformRole();
    }
  }
}
