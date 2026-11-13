import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppAbility } from '../../../common/authorization/app-ability';
import { WorkspaceInvitationStatus } from '../../../common/enums/workspace-invitation-status.enum';
import { WorkspaceMembershipStatus } from '../../../common/enums/workspace-membership-status.enum';
import { Errors } from '../../../common/errors/errors';
import { buildOrderBy, MetaQueryDto } from '../../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../../common/dto/paginated-response.dto';
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from '../../../common/util/opaque-token.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../../authorization/ability-scoped-query.service';
import { PermissionCheckService } from '../../authorization/permission-check.service';
import { PermissionLoaderService } from '../../authorization/permission-loader.service';
import { WorkspaceOwnershipPolicy } from '../workspace-ownership.policy';
import { WorkspaceRoleAssignmentPolicy } from '../workspace-role-assignment.policy';
import {
  describeTenure,
  type MembershipTenureSnapshot,
} from '../memberships/workspace-memberships.service';
import { CreateWorkspaceInvitationDto } from './dto/create-workspace-invitation.dto';
import type { WorkspaceInvitationRow } from './dto/workspace-invitation-response.dto';

const INVITATION_INCLUDE = {
  role: { select: { id: true, name: true, rank: true } },
  // The name only. The invitee may belong to no workspace the inviter can
  // see, and anyone can create a workspace and so invite: an email or
  // username here would turn invitations into a lookup of every account's
  // address on the server.
  invitedUser: {
    select: { id: true, firstName: true, lastName: true },
  },
} as const;

// Thrown out of the acceptance transaction when the conditional consume finds
// no pending row — i.e. somebody else redeemed the same token first. A private
// sentinel rather than a public error so the transaction rolls back cleanly and
// the caller-facing error is chosen once, outside it.
class InvitationAlreadyConsumedError extends Error {}

@Injectable()
export class WorkspaceInvitationsService {
  private readonly expiresInDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly permissionLoaderService: PermissionLoaderService,
    private readonly permissionCheckService: PermissionCheckService,
    private readonly workspaceOwnershipPolicy: WorkspaceOwnershipPolicy,
    private readonly workspaceRoleAssignmentPolicy: WorkspaceRoleAssignmentPolicy,
    configService: ConfigService,
  ) {
    this.expiresInDays = configService.getOrThrow<number>(
      'workspaceInvitation.expiresInDays',
    );
  }

  /**
   * Invites an existing account, named by its email or username, and returns
   * the invitation with its one-time code. Pakita sends nothing: the inviter
   * passes the code on themselves, and only the invited account can redeem it.
   * An unknown identifier is a 404 — the inviter needs to know to ask an
   * administrator for the account.
   *
   * **No membership row is written here.** Writing a placeholder membership
   * instead would consume the ONE row `@@unique([workspaceId, userId])`
   * allows, so re-inviting a former member would overwrite their
   * `joinedAt`/`endedAt` — a manager could silently rewrite somebody's
   * history by sending an invitation.
   */
  async create(
    workspaceId: string,
    dto: CreateWorkspaceInvitationDto,
    ability: AppAbility,
    actorId: string,
  ): Promise<{ invitation: WorkspaceInvitationRow; token: string }> {
    const role = await this.workspaceRoleAssignmentPolicy.loadAssignableRole(
      dto.roleId,
    );
    // The SAME two bounds the roster path applies. An invitation IS a role
    // assignment, merely deferred, so enforcing this only on `POST
    // /memberships` would make the rule whichever endpoint the caller picked.
    await this.workspaceRoleAssignmentPolicy.assertMayAssign(
      workspaceId,
      actorId,
      role,
      ability,
    );

    const workspace = await this.prisma.scoped.workspace.findFirst({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) {
      throw Errors.resourceNotFound('Workspace');
    }

    // Email and username are both stored lower-cased and never overlap
    // (a username cannot contain '@').
    const invitee = await this.prisma.scoped.user.findFirst({
      where: {
        OR: [{ email: dto.identifier }, { username: dto.identifier }],
      },
      select: { id: true },
    });
    if (!invitee) {
      throw Errors.resourceNotFound('User');
    }

    const token = generateOpaqueToken();
    const expiresAt = this.expiryFromNow();

    const { created: invitation, supersededCount } =
      await this.prisma.$transaction(async (transaction) => {
        // The same workspace-row lock every membership mutation takes. An invite
        // does not change the roster, but it reads it to decide whether the
        // person is already on it, and that read must not race a concurrent
        // removal or role change.
        //
        // The reads after this lock are correct only because this transaction
        // runs at READ COMMITTED. Do NOT add an `isolationLevel` here — see the
        // isolation section in `src/common/util/row-lock.util.ts`, which explains
        // why REPEATABLE READ breaks it silently, and why SERIALIZABLE breaks it
        // loudly enough to need a retry loop this codebase does not have.
        await this.workspaceOwnershipPolicy.lockWorkspace(
          transaction,
          workspaceId,
        );

        // Release the partial unique index on `(workspace_id, invited_user_id)
        // WHERE status = 'pending'` from invitations that are already dead.
        //
        // Expiry is a timestamp, not a status, so an unattended invitation stays
        // `pending` for ever. `accept` correctly refuses it on `expiresAt`, but
        // the index does not know that — it counts the row as an outstanding
        // invitation, so the INSERT below fails with P2002 and the person can
        // never be invited to this workspace again. Retiring it here, under the
        // lock we already hold, is what makes re-invitation possible. Done lazily
        // rather than in a sweep: a row stays `pending` after it lapses, but there
        // is no window in which `create` FAILS because of that staleness, which is
        // the only symptom that ever mattered.
        //
        // Scoped to already-lapsed rows on purpose: a LIVE pending invitation must
        // still collide, because "one outstanding invitation per person" is a
        // real rule and the P2002 handler below is what reports it. `lte` matches
        // `accept`'s definition of expired (`expiresAt <= now`) so the two cannot
        // disagree about a row on the boundary.
        const supersededExpiredInvitations =
          await transaction.workspaceInvitation.updateMany({
            where: {
              workspaceId,
              invitedUserId: invitee.id,
              status: WorkspaceInvitationStatus.PENDING,
              expiresAt: { lte: new Date() },
            },
            data: {
              status: WorkspaceInvitationStatus.EXPIRED,
              updatedBy: actorId,
            },
          });

        const membership = await transaction.workspaceMembership.findUnique({
          where: {
            workspaceId_userId: { workspaceId, userId: invitee.id },
          },
          select: { status: true },
        });
        // A former member may be invited back; anyone currently attached —
        // active or suspended — is already here.
        if (
          membership &&
          (membership.status as WorkspaceMembershipStatus) !==
            WorkspaceMembershipStatus.LEFT
        ) {
          throw Errors.resourceConflict(
            'That person already has a membership in this workspace',
          );
        }

        try {
          const created = await transaction.workspaceInvitation.create({
            data: {
              workspaceId,
              invitedUserId: invitee.id,
              roleId: role.id,
              tokenHash: hashOpaqueToken(token),
              status: WorkspaceInvitationStatus.PENDING,
              invitedBy: actorId,
              expiresAt,
              createdBy: actorId,
              updatedBy: actorId,
            },
            include: INVITATION_INCLUDE,
          });
          return {
            created,
            supersededCount: supersededExpiredInvitations.count,
          };
        } catch (error) {
          // The partial unique index on (workspace_id, invited_user_id) WHERE
          // status = 'pending' is what makes "one outstanding invitation per
          // person" true under concurrency — and, with no placeholder
          // membership, it is the ONLY thing that makes it true. Translate it rather
          // than letting the global filter report a raw
          // UNIQUE_CONSTRAINT_VIOLATION on a column pair the client never sent
          // as a pair.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw Errors.resourceConflict(
              'That person already has a pending invitation to this workspace',
            );
          }
          throw error;
        }
      });

    await this.auditService.record({
      action: 'workspace_invitation.created',
      actorId,
      targetUserId: invitee.id,
      // The token is NOT recorded, not even hashed: an audit log is read by
      // more people than the invitations table is.
      metadata: {
        workspaceId,
        invitationId: invitation.id,
        roleId: role.id,
        roleName: role.name,
        // How many already-lapsed invitations to this person this call retired
        // to make room. Normally 0.
        //
        // Who retired them and when is already durable on the rows themselves
        // (`updated_by` / `updated_at`, written by the `updateMany` above), so a
        // second audit write inside the transaction would add nothing an
        // investigator cannot already reach. What the row cannot say is that a
        // retirement happened at all without knowing to go looking — this count
        // is what puts that in the log, and it answers "why can I no longer
        // resend the invitation I sent three weeks ago?".
        supersededExpiredInvitations: supersededCount,
      },
    });

    return { invitation, token };
  }

  async findPaginated(
    workspaceId: string,
    query: MetaQueryDto,
    ability: AppAbility,
  ): Promise<{ data: WorkspaceInvitationRow[]; meta: PaginationMeta }> {
    // An empty page would tell a stranger nothing, but the contract is 404.
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'WorkspaceInvitation',
      workspaceId,
    );
    const { page, perPage } = query;
    const where = this.abilityScopedQueryService.buildWhereOrEmpty(
      ability,
      'read',
      'WorkspaceInvitation',
      { workspaceId },
    );

    const [data, total] = await this.prisma.$transaction([
      this.prisma.workspaceInvitation.findMany({
        where,
        include: INVITATION_INCLUDE,
        orderBy: buildOrderBy(
          query,
          ['createdAt', 'expiresAt'] as const,
          'createdAt',
        ),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.workspaceInvitation.count({ where }),
    ]);
    return {
      data,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /**
   * Withdraws a pending invitation. Accepted ones are history and immutable.
   *
   * One statement against one table, deliberately: a crash can never leave
   * half a revocation behind.
   */
  async revoke(
    workspaceId: string,
    invitationId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<void> {
    const existing = await this.findVisibleInvitation(
      workspaceId,
      invitationId,
      ability,
    );

    // Conditional, not a read-then-write: revoking and accepting race, and the
    // loser must not silently overwrite the winner.
    const revoked = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, status: WorkspaceInvitationStatus.PENDING },
      data: {
        status: WorkspaceInvitationStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: actorId,
        updatedBy: actorId,
      },
    });
    if (revoked.count !== 1) {
      throw Errors.resourceConflict(
        'That invitation is no longer pending and cannot be revoked',
      );
    }

    await this.auditService.record({
      action: 'workspace_invitation.revoked',
      actorId,
      targetUserId: existing.invitedUserId,
      metadata: { workspaceId, invitationId },
    });
  }

  /**
   * Re-issues a pending invitation on a FRESH code, with a fresh expiry, and
   * returns it. The old code stops working.
   *
   * The recovery path a workspace actually needs: the code was lost, or is
   * about to expire. Without it the only remedy was revoke-then-invite, which
   * needs `delete WorkspaceInvitation` on top of `create` — a manager holding
   * one and not the other could raise an invitation they could never repair.
   *
   * The server keeps only the code's hash, so it cannot show the old one
   * again; and rotating it means exactly one code ever opens the invitation.
   */
  async resend(
    workspaceId: string,
    invitationId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<{ invitation: WorkspaceInvitationRow; token: string }> {
    const existing = await this.findVisibleInvitation(
      workspaceId,
      invitationId,
      ability,
    );
    // Re-checked at resend time, not just at invite time: the actor may have
    // been demoted since, or had `assignRole` withdrawn, and a resend re-issues
    // the same role.
    await this.workspaceRoleAssignmentPolicy.assertMayAssign(
      workspaceId,
      actorId,
      existing.role,
      ability,
    );

    // A deleted workspace grants nothing, so no fresh code for it.
    const workspace = await this.prisma.scoped.workspace.findFirst({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      throw Errors.resourceNotFound('Workspace');
    }

    const token = generateOpaqueToken();
    // Conditional on PENDING for the same reason revoke is: a resend racing an
    // acceptance must not resurrect a consumed invitation with a working token.
    const rotated = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, status: WorkspaceInvitationStatus.PENDING },
      data: {
        tokenHash: hashOpaqueToken(token),
        expiresAt: this.expiryFromNow(),
        updatedBy: actorId,
      },
    });
    if (rotated.count !== 1) {
      throw Errors.resourceConflict(
        'That invitation is no longer pending and cannot be resent',
      );
    }

    await this.auditService.record({
      action: 'workspace_invitation.resent',
      actorId,
      targetUserId: existing.invitedUserId,
      // No token material, hashed or otherwise — same rule as `create`.
      metadata: { workspaceId, invitationId },
    });

    const invitation = await this.prisma.workspaceInvitation.findUniqueOrThrow({
      where: { id: invitationId },
      include: INVITATION_INCLUDE,
    });
    return { invitation, token };
  }

  /**
   * Redeems an invitation.
   *
   * The caller must be the invited account (`invitedUserId`). Without that
   * check the code alone would be sufficient, and a forwarded or overheard
   * code would let anyone join a workspace that invited somebody else
   * specifically. The account, not an address: an email can change.
   *
   * Replay safety is a conditional UPDATE out of `pending` inside the same
   * transaction that writes the membership: two simultaneous redemptions of one
   * token both attempt it, exactly one matches a row, and the loser's entire
   * transaction — membership included — rolls back.
   */
  async accept(
    token: string,
    actorId: string,
  ): Promise<{ workspaceId: string; membershipId: string }> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: {
        id: true,
        workspaceId: true,
        invitedUserId: true,
        roleId: true,
        status: true,
        expiresAt: true,
        invitedBy: true,
        workspace: { select: { id: true, deletedAt: true } },
      },
    });

    // Unknown, consumed, or revoked — one indistinguishable answer, so a token
    // cannot be probed for existence.
    //
    // `EXPIRED` is deliberately NOT collapsed in here. It is only ever written
    // by `create` retiring a row that had already lapsed, so it means exactly
    // what a past `expiresAt` means — and that case is reported separately
    // below, on purpose, because the remedy differs. Folding it in here would
    // make the answer depend on whether some unrelated actor happened to
    // re-invite the same person: the same lapsed code would say "expired"
    // before the re-invite and "invalid" after it, and the *less* actionable
    // message would be the one given at the exact moment a fresh invitation
    // was waiting for them.
    const invitationStatus = invitation?.status as
      | WorkspaceInvitationStatus
      | undefined;
    if (
      !invitation ||
      (invitationStatus !== WorkspaceInvitationStatus.PENDING &&
        invitationStatus !== WorkspaceInvitationStatus.EXPIRED)
    ) {
      throw Errors.invitationInvalid();
    }
    // A soft-deleted workspace grants nothing, so joining one is meaningless.
    if (invitation.workspace.deletedAt) {
      throw Errors.invitationInvalid();
    }
    // Every failure is the SAME error the unknown-code path raises, so a holder
    // of somebody else's code learns nothing about whose it is.
    if (invitation.invitedUserId !== actorId) {
      throw Errors.invitationInvalid();
    }
    // Distinguishable on purpose: the holder already proved possession of a
    // real code AND that they are the invitee, so this leaks nothing, and
    // their remedy differs. Reached only after the invitee check, which is what
    // keeps "expired" from being observable by a mere token holder — so the
    // `EXPIRED` status is answered here rather than in the gate above.
    if (
      invitationStatus === WorkspaceInvitationStatus.EXPIRED ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw Errors.invitationExpired();
    }

    const now = new Date();
    let accepted: {
      membershipId: string;
      previousTenure: MembershipTenureSnapshot | null;
    };
    try {
      accepted = await this.prisma.$transaction(async (transaction) => {
        // An invitation carries a `roleId`, so acceptance is an owner-creation
        // path like any other. The caller's account was checked by `JwtStrategy`
        // one request ago — not under a lock, so a deletion or deactivation committing in between would leave
        // an ACTIVE membership on an account that can never use it.
        //
        // User row, then workspace row: the order in `row-lock.util.ts`. The
        // workspace lock is what serialises this against every roster mutation;
        // acceptance previously took no lock at all.
        await this.workspaceOwnershipPolicy.assertUserMayHoldActiveMembership(
          transaction,
          actorId,
        );
        await this.workspaceOwnershipPolicy.lockWorkspace(
          transaction,
          invitation.workspaceId,
        );
        // Under the workspace lock, which every roster change takes, so the
        // inviter's authority read here is the authority they hold as this
        // commits — not one a suspension or demotion has just taken away.
        await this.assertInviterMayStillAssign(invitation);

        const consumed = await transaction.workspaceInvitation.updateMany({
          where: {
            id: invitation.id,
            // The code that was presented, still: a re-issue committing since
            // the lookup above retired it.
            tokenHash: hashOpaqueToken(token),
            status: WorkspaceInvitationStatus.PENDING,
            expiresAt: { gt: now },
          },
          data: {
            status: WorkspaceInvitationStatus.ACCEPTED,
            acceptedAt: now,
            acceptedBy: actorId,
            updatedBy: actorId,
          },
        });
        if (consumed.count !== 1) {
          throw new InvitationAlreadyConsumedError();
        }

        // Read BEFORE the upsert: this is the last moment the tenure about to be
        // overwritten is still readable, and `audit_logs` is where this template
        // keeps membership history.
        const previous = await transaction.workspaceMembership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: invitation.workspaceId,
              userId: actorId,
            },
          },
          select: {
            status: true,
            joinedAt: true,
            endedAt: true,
            role: { select: { name: true } },
          },
        });

        // The membership as it is NOW, under the workspace lock — not as it
        // was when the invitation was sent. Only a former member re-joins;
        // overwriting a current one would let a stale link lift a suspension
        // or demote an owner. Throwing rolls the consume above back, so the
        // invitation stays pending.
        if (
          previous &&
          (previous.status as WorkspaceMembershipStatus) !==
            WorkspaceMembershipStatus.LEFT
        ) {
          throw Errors.resourceConflict(
            'You already have a membership in this workspace',
          );
        }

        // Upsert, because someone who previously LEFT still owns the only row
        // `@@unique([workspaceId, userId])` will ever allow. `joinedAt` is
        // rewritten on that path deliberately — this IS the day they joined
        // again — where an invitation that was merely SENT must never touch it.
        const membership = await transaction.workspaceMembership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: invitation.workspaceId,
              userId: actorId,
            },
          },
          create: {
            workspaceId: invitation.workspaceId,
            userId: actorId,
            roleId: invitation.roleId,
            status: WorkspaceMembershipStatus.ACTIVE,
            joinedAt: now,
            invitedBy: invitation.invitedBy,
            createdBy: actorId,
            updatedBy: actorId,
          },
          update: {
            roleId: invitation.roleId,
            status: WorkspaceMembershipStatus.ACTIVE,
            joinedAt: now,
            endedAt: null,
            updatedBy: actorId,
          },
          select: { id: true },
        });
        return {
          membershipId: membership.id,
          previousTenure: previous ? describeTenure(previous) : null,
        };
      });
    } catch (error) {
      if (error instanceof InvitationAlreadyConsumedError) {
        throw Errors.invitationInvalid();
      }
      throw error;
    }

    // Their authority changed the instant the transaction committed.
    await this.permissionLoaderService.invalidateUser(actorId);
    await this.auditService.record({
      action: 'workspace_invitation.accepted',
      actorId: actorId,
      targetUserId: actorId,
      metadata: {
        workspaceId: invitation.workspaceId,
        invitationId: invitation.id,
        membershipId: accepted.membershipId,
        roleId: invitation.roleId,
        // Accepting an invitation is a JOIN, and a former member accepting one
        // re-uses their existing row. Same reasoning as
        // `workspace_membership.added`: the row is current state, so the tenure
        // it replaces only survives here.
        isRejoin: accepted.previousTenure !== null,
        previousTenure: accepted.previousTenure,
      },
    });

    return {
      workspaceId: invitation.workspaceId,
      membershipId: accepted.membershipId,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private expiryFromNow(): Date {
    return new Date(Date.now() + this.expiresInDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Loads an invitation the caller is allowed to see, or 404s.
   *
   * Scoped through the ability so a caller who cannot read the invitation is
   * told it does not exist rather than that they may not touch it — a 403 here
   * would confirm that a given person was invited to a given workspace.
   */
  private async findVisibleInvitation(
    workspaceId: string,
    invitationId: string,
    ability: AppAbility,
  ) {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: this.abilityScopedQueryService.buildWhereOrEmpty(
        ability,
        'read',
        'WorkspaceInvitation',
        { id: invitationId, workspaceId },
      ),
      select: {
        id: true,
        status: true,
        invitedUserId: true,
        // `id` included so the row satisfies `AssignableWorkspaceRole` — a
        // resend re-issues this exact role and is re-checked against it.
        role: { select: { id: true, name: true, rank: true } },
      },
    });
    if (!invitation) {
      throw Errors.resourceNotFound('Workspace invitation');
    }
    return invitation;
  }

  /**
   * An invitation is the inviter's role assignment, deferred, so it is only as
   * good as their authority now. The same checks `create` applies — the role
   * is a workspace role, and the inviter may hand it out — re-run against the
   * inviter as they are at acceptance: a demoted, removed or deactivated
   * inviter's invitations no longer grant anything.
   *
   * Reported as INVITATION_INVALID: the invitee can do nothing about the
   * inviter's authority, and the remedy is a fresh invitation either way.
   */
  private async assertInviterMayStillAssign(invitation: {
    workspaceId: string;
    invitedBy: string | null;
    roleId: string;
  }): Promise<void> {
    const inviter = invitation.invitedBy
      ? await this.prisma.scoped.user.findFirst({
          where: { id: invitation.invitedBy, isActive: true },
          select: { id: true },
        })
      : null;
    if (!inviter) {
      throw Errors.invitationInvalid();
    }
    const inviterAbility =
      await this.permissionCheckService.createAbilityForUser(inviter.id);
    try {
      const role = await this.workspaceRoleAssignmentPolicy.loadAssignableRole(
        invitation.roleId,
      );
      await this.workspaceRoleAssignmentPolicy.assertMayAssign(
        invitation.workspaceId,
        inviter.id,
        role,
        inviterAbility,
      );
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw Errors.invitationInvalid();
      }
      throw error;
    }
  }
}
