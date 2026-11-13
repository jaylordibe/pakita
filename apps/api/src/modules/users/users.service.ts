import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { packRules } from '@casl/ability/extra';
import type { AppAbility } from '../../common/authorization/app-ability';
import * as bcrypt from 'bcrypt';
import { buildOrderBy } from '../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { AuditService } from '../../common/audit/audit.service';
import { Errors } from '../../common/errors/errors';
import { WorkspaceMembershipStatus } from '../../common/enums/workspace-membership-status.enum';
import { hashPassword } from '../../common/util/password-hashing.util';
import { FilePurpose } from '../../common/enums/file-purpose.enum';
import { lockUserRow } from '../../common/util/row-lock.util';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  RefreshTokenContext,
  SessionTokens,
} from '../auth/refresh-token.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  accountSignInSubject,
  SignInFailureLimitService,
} from '../auth/sign-in-failure-limit.service';
import { PermissionLoaderService } from '../authorization/permission-loader.service';
import { FilesService } from '../files/files.service';
import { WorkspaceOwnershipPolicy } from '../workspaces/workspace-ownership.policy';
import { CreateUserDto } from './dto/create-user.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UpdateAuthUserEmailDto } from './dto/update-auth-user-email.dto';
import { UpdateAuthUserInfoDto } from './dto/update-auth-user-info.dto';
import { UpdateAuthUserPasswordDto } from './dto/update-auth-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPermissionsResponseDto } from './dto/user-permissions-response.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    // `forwardRef` on both sides: AuthModule imports UsersModule for the login
    // path, and UsersModule needs session revocation back. Per CLAUDE.md, the
    // ref goes in the module imports AND on the injection.
    @Inject(forwardRef(() => RefreshTokenService))
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(forwardRef(() => SignInFailureLimitService))
    private readonly signInFailureLimit: SignInFailureLimitService,
    private readonly permissionLoaderService: PermissionLoaderService,
    // The ownership invariant is enforced from BOTH sides. Deleting an account
    // is the other half of "a live workspace always has an active owner"; drop
    // it and a deleted owner leaves the workspace ownerless.
    private readonly workspaceOwnershipPolicy: WorkspaceOwnershipPolicy,
    private readonly filesService: FilesService,
  ) {}

  /**
   * Records an email change. The previous address travels in the audit row,
   * the one place it stays answerable "which address did this account use
   * before?".
   */
  private async recordEmailChange(
    user: User,
    newEmail: string,
    actorId: string,
  ): Promise<void> {
    await this.auditService.record({
      action: 'user.email_changed',
      actorId,
      targetUserId: user.id,
      metadata: { previousEmail: user.email, newEmail },
    });
  }

  /**
   * An administrator creates every account (there is no public sign-up). The
   * administrator chose the password, so the account must replace it before
   * it can do anything else (`isPasswordChangeRequired`).
   */
  async create(dto: CreateUserDto, actorId: string): Promise<User> {
    const passwordHash = await hashPassword(dto.password);
    // A single INSERT. No role is assigned, and no transaction is needed to
    // make one atomic with the user row.
    //
    // Self-service capability comes from AUTHENTICATED_USER_PERMISSIONS, which
    // `AbilityFactory` grants to every authenticated caller, so an account with
    // no roles is complete and working. Attaching a default role here instead
    // would make the user row and that row a single unit that must not be
    // half-written — a class of bug this design does not have rather than
    // guards against.
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        username: dto.username?.toLowerCase(),
        password: passwordHash,
        passwordChangedAt: new Date(),
        isPasswordChangeRequired: true,
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
        gender: dto.gender,
        birthday: dto.birthday,
        timezone: dto.timezone,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    await this.auditService.record({
      action: 'user.created.by_admin',
      actorId,
      targetUserId: user.id,
      metadata: { email: user.email },
    });
    return user;
  }

  /**
   * Names of the user's platform roles (PLATFORM scope), in name order. Used
   * where a caller identifies itself without a CASL ability — the MCP
   * `get_current_user` tool.
   */
  async findPlatformRoleNames(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.scoped.userRole.findMany({
      where: { userId },
      select: { role: { select: { name: true } } },
      orderBy: { role: { name: 'asc' } },
    });
    return userRoles.map((userRole) => userRole.role.name);
  }

  /**
   * The caller's own authorization, as packed CASL rules plus the role names
   * behind them. Consumed by `GET /users/me/permissions` so a client can
   * evaluate `can(...)` locally and reach the same verdict the server will.
   */
  async getOwnPermissions(
    userId: string,
    ability: AppAbility,
  ): Promise<UserPermissionsResponseDto> {
    const user = await this.prisma.scoped.user.findUnique({
      where: { id: userId },
      select: {
        userRoles: { select: { role: { select: { name: true } } } },
        // Every status, not only ACTIVE. A client showing "your workspaces"
        // needs to render a suspended or pending membership differently rather
        // than have it silently vanish — and `rules` above already reflects the
        // truth about authority, since only ACTIVE memberships compile into
        // grants. This list is context, not permission.
        memberships: {
          select: {
            id: true,
            workspaceId: true,
            status: true,
            role: { select: { name: true } },
          },
        },
      },
    });

    return new UserPermissionsResponseDto({
      // `packRules` compresses each rule to a positional tuple. The client
      // restores it with `unpackRules` — the shape is CASL's, not ours.
      rules: packRules(ability.rules),
      platformRoles: (user?.userRoles ?? []).map(
        (userRole) => userRole.role.name,
      ),
      workspaceMemberships: (user?.memberships ?? []).map((membership) => ({
        membershipId: membership.id,
        workspaceId: membership.workspaceId,
        roleName: membership.role.name,
        status: membership.status as WorkspaceMembershipStatus,
      })),
    });
  }

  async findPaginated(
    query: UserListQueryDto,
  ): Promise<{ data: User[]; meta: PaginationMeta }> {
    const { page, perPage } = query;
    const args = this.buildListArgs(query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        ...args,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.user.count({ where: args.where }),
    ]);
    return {
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  // Single source of truth for findPaginated's sort allowlist and default
  // ordering. Pass-through for the buildOrderBy() 400 on disallowed sortBy.
  // Extend this with a `where` clause built from `query.search` when adding
  // search to a resource.
  private buildListArgs(query: UserListQueryDto): {
    where: Prisma.UserWhereInput;
    orderBy: Prisma.UserOrderByWithRelationInput;
  } {
    return {
      where:
        query.isDeleted === undefined
          ? {}
          : { deletedAt: query.isDeleted ? { not: null } : null },
      orderBy: buildOrderBy(
        query,
        ['email', 'firstName', 'lastName', 'createdAt', 'updatedAt'] as const,
        'createdAt',
      ),
    };
  }

  // Admin-facing fetch — uses the raw client so admins can see soft-
  // deleted rows for recovery/audit. Paths that must reject deleted users
  // (auth, login, JwtStrategy) use findByIdOrNull / findByEmail, which go
  // through the scoped client.
  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw Errors.resourceNotFound('User');
    }
    return user;
  }

  // Returns null for soft-deleted users — the scoped client filters
  // deletedAt: null automatically. Callers that need to see deleted rows
  // (admin recovery paths) should go through `findById` or directly hit
  // `prisma.user.*` instead.
  findByIdOrNull(id: string): Promise<User | null> {
    return this.prisma.scoped.user.findUnique({ where: { id } });
  }

  // `findFirst`, not `findUnique`: `email` is unique only among live rows (a
  // partial index), and Prisma cannot see a partial index — so `email` is not a
  // unique selector and `findUnique` would not type-check. The scoped client
  // filters `deletedAt: null`, which is exactly the set the partial index makes
  // unique, so `findFirst` returns at most one row.
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.scoped.user.findFirst({
      where: { email: email.toLowerCase() },
    });
  }

  // Login lookup: the identifier may be an email or a username (both stored
  // lowercase; usernames can never contain '@' so the namespaces are
  // disjoint). Scoped client — soft-deleted users come back null, identical
  // to "unknown identifier".
  findByEmailOrUsername(identifier: string): Promise<User | null> {
    const normalized = identifier.toLowerCase();
    return this.prisma.scoped.user.findFirst({
      where: { OR: [{ email: normalized }, { username: normalized }] },
    });
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<User> {
    const existing = await this.findById(id);
    const newEmail = dto.email?.toLowerCase();
    const isEmailChanged =
      newEmail !== undefined && newEmail !== existing.email;

    const updateData: Prisma.UserUpdateInput = {
      email: newEmail,
      username: dto.username?.toLowerCase(),
      firstName: dto.firstName,
      middleName: dto.middleName,
      lastName: dto.lastName,
      gender: dto.gender,
      birthday: dto.birthday,
      timezone: dto.timezone,
      isActive: dto.isActive,
      updatedBy: actorId,
    };

    // Deactivation is not an ordinary field write. An inactive account cannot
    // authenticate — `JwtStrategy` refuses it on every request — so a workspace
    // whose only owner is deactivated is exactly as unadministrable as one whose
    // owner was deleted, and it needs the same refusal. It also has to end the
    // account's sessions: leaving live refresh rows behind means a later
    // reactivation silently resurrects every session that existed before.
    const updated =
      dto.isActive === false && existing.isActive
        ? await this.deactivate(id, updateData, actorId)
        : await this.prisma.user.update({ where: { id }, data: updateData });

    if (actorId !== id) {
      await this.auditService.record({
        action: 'user.updated.by_admin',
        actorId,
        targetUserId: id,
        metadata: {
          // Role changes no longer travel through this endpoint — they have
          // their own audited routes (`POST/DELETE /users/:userId/roles`).
          isActiveChanged: dto.isActive !== undefined,
          isEmailChanged,
        },
      });
    }
    if (isEmailChanged) {
      await this.recordEmailChange(existing, newEmail, actorId);
    }
    return updated;
  }

  /**
   * Active → inactive, with the ownership invariant and the session end that a
   * bare field write would skip.
   *
   * Refused when the account is somebody's last owner. A platform admin is not
   * exempt: `manage all` bypasses AUTHORIZATION, not data integrity, and the
   * unadministrable workspace it would leave behind is invisible to every roster
   * read — so nobody would find it to repair it.
   */
  private async deactivate(
    userId: string,
    updateData: Prisma.UserUpdateInput,
    actorId: string,
  ): Promise<User> {
    const deactivated = await this.prisma.$transaction(async (transaction) => {
      // User row first, then workspaces — the order in `row-lock.util.ts`.
      await this.refreshTokenService.lockSessions(transaction, userId);
      await this.workspaceOwnershipPolicy.assertUserIsNotASoleOwner(
        transaction,
        userId,
      );
      return this.refreshTokenService.endAllSessionsInTransaction(
        transaction,
        userId,
        actorId,
        updateData,
      );
    });
    // Their workspace-scoped grants are gone the instant the row says inactive.
    await this.invalidateGrantsFor([userId]);
    return deactivated;
  }

  async remove(id: string, actorId: string | null): Promise<void> {
    await this.findById(id);
    // Admin "delete" is soft — keeps the row for audit trail / recovery.
    // For true PII removal (GDPR right-to-be-forgotten) the user themselves
    // invokes gdprErase, which also anonymizes personal columns.
    //
    // Refused outright when the target is somebody's last owner. A platform
    // admin is not exempt: `manage all` bypasses AUTHORIZATION, not data
    // integrity, and the stranded membership it would create is invisible to
    // every roster read — so nobody would find it to repair it.
    await this.deleteAccount(id, actorId);
    if (actorId) {
      await this.auditService.record({
        action: 'user.soft_deleted.by_admin',
        actorId,
        targetUserId: id,
      });
    }
  }

  // Right-to-be-forgotten path. Overwrites every column that could identify
  // the user (email, name, etc.) with sentinel values, wipes the
  // password so no bcrypt hash survives, and marks deletedAt. The row
  // itself stays so FK'd records (audit logs, bookings, etc.) remain
  // queryable — but none of it points back to a real human.
  async gdprErase(userId: string, currentPassword: string): Promise<void> {
    const user = await this.findById(userId);
    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!passwordMatches) {
      throw Errors.currentPasswordIncorrect();
    }
    const now = new Date();
    const erasedPasswordHash = await hashPassword(
      `erased-${userId}-${now.getTime()}`,
    );

    // Erasure does NOT refuse on sole ownership, and that asymmetry with
    // `softDelete` is the whole point: a right-to-be-forgotten request answers a
    // legal obligation, so it cannot be declined because of a commercial
    // relationship. The workspaces are closed in the same transaction instead —
    // never left ownerless, never left live.
    const { workspaces: closedWorkspaces, affectedUserIds } =
      await this.prisma.$transaction(async (transaction) => {
        // User row first, then the workspaces — the order documented in
        // `row-lock.util.ts`. Taking the workspaces first is the opposite of
        // what every membership mutation takes, so the two sides of the
        // ownership invariant would deadlock against each other.
        await this.refreshTokenService.lockSessions(transaction, userId);
        const closed =
          await this.workspaceOwnershipPolicy.closeSolelyOwnedWorkspaces(
            transaction,
            userId,
            userId,
          );
        // Files go with the person: the picture and every upload never
        // attached. Released here, in the erasing transaction, so the cleanup
        // job deletes their objects even if this process dies after commit —
        // and after the workspace locks, because `file_assets` is always
        // locked last (`row-lock.util.ts`).
        // A fork that attaches files to shared records (a workspace's gallery)
        // decides here whether those leave with the uploader or stay.
        const { profileImageFileAssetId } =
          await transaction.user.findUniqueOrThrow({
            where: { id: userId },
            select: { profileImageFileAssetId: true },
          });
        if (profileImageFileAssetId) {
          await this.filesService.markDeleting(transaction, [
            profileImageFileAssetId,
          ]);
        }
        await this.filesService.markUnattachedDeleting(transaction, userId);

        // The anonymisation rides INSIDE the session-ending mutation, so the
        // erased row and the dead sessions are one row version. There is no
        // ordering in which the account is wiped but its sessions still work.
        await this.refreshTokenService.endAllSessionsInTransaction(
          transaction,
          userId,
          userId,
          {
            email: `deleted-${userId}@deleted.invalid`,
            username: null,
            password: erasedPasswordHash,
            firstName: 'Deleted',
            middleName: null,
            lastName: 'User',
            gender: null,
            birthday: null,
            timezone: null,
            profileImageFileAsset: { disconnect: true },
            deletedAt: now,
            deletedBy: userId,
          },
        );
        return closed;
      });

    // Cache invalidation happens AFTER the commit. Dropping a cached grant set
    // while the transaction could still roll back would repopulate it from the
    // pre-erasure rows and leave the stale copy behind — the one failure mode
    // an invalidation is supposed to rule out.
    await this.invalidateGrantsFor([userId, ...affectedUserIds]);

    await this.auditService.record({
      action: 'user.gdpr_erased',
      actorId: userId,
      targetUserId: userId,
      // Ids only. The workspace NAMES are personal data in a single-proprietor
      // tenant, and writing them into the audit trail during an erasure would
      // re-create exactly what the erasure just removed.
      metadata: {
        closedWorkspaceIds: closedWorkspaces.map((workspace) => workspace.id),
      },
    });
  }

  /**
   * Soft-delete an account, refusing to strand a workspace without an owner.
   *
   * Shared by the administrative delete and the self-close so the invariant
   * cannot hold on one route and not the other — they differ only in who acts
   * and which audit event follows, never in what is allowed.
   */
  private async deleteAccount(
    userId: string,
    actorId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      // User row first, then workspaces — see `row-lock.util.ts`. This is also
      // what makes the check below binding: a promotion racing this deletion
      // contends on the SAME user row, so it either loses and finds the account
      // gone, or wins and is counted here.
      await this.refreshTokenService.lockSessions(transaction, userId);
      await this.workspaceOwnershipPolicy.assertUserIsNotASoleOwner(
        transaction,
        userId,
      );
      // A deleted account must not keep minting access tokens off a refresh
      // token. `JwtStrategy` already rejects the user through the scoped
      // client, but leaving live rows behind means a restore silently
      // resurrects every session that existed before the deletion.
      await this.refreshTokenService.endAllSessionsInTransaction(
        transaction,
        userId,
        actorId,
        { deletedAt: new Date(), deletedBy: actorId },
      );
    });
    await this.invalidateGrantsFor([userId]);
  }

  /** Drop cached grant sets, one user at a time, tolerating a cache outage. */
  private async invalidateGrantsFor(userIds: readonly string[]): Promise<void> {
    for (const userId of new Set(userIds)) {
      await this.permissionLoaderService.invalidateUser(userId);
    }
  }

  async updateInfo(
    userId: string,
    dto: UpdateAuthUserInfoDto,
    actorId: string,
  ): Promise<User> {
    await this.findById(userId);
    return this.prisma.$transaction(async (transaction) => {
      // Lock, then re-read: an erasure that committed while this request
      // waited must not have its anonymised row written back over.
      await lockUserRow(transaction, userId);
      const lockedUser = await transaction.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!lockedUser) {
        throw Errors.resourceNotFound('User');
      }
      return transaction.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          gender: dto.gender,
          birthday: dto.birthday,
          timezone: dto.timezone,
          updatedBy: actorId,
        },
      });
    });
  }

  /**
   * Sets (`fileId`), replaces, or removes (`null`) the person's picture, and
   * nothing else on their profile. The new file must be the actor's own
   * unattached `profile_image` upload; the one it replaces is released in the
   * same transaction, so no replaced file stays attached. The current picture
   * again — including no picture when there is none — writes nothing at all (a
   * client retrying a request that already succeeded).
   */
  async setProfileImage(
    userId: string,
    fileId: string | null,
    actorId: string,
  ): Promise<User> {
    return this.prisma.$transaction(async (transaction) => {
      // The user row first (`row-lock.util.ts` order): two concurrent changes
      // must not both read the same "current" file — the loser's replacement
      // would never be released. Then re-read under the lock: an erasure that
      // committed while this request waited must not get a picture attached.
      await lockUserRow(transaction, userId);
      const lockedUser = await transaction.user.findFirst({
        where: { id: userId, deletedAt: null },
      });
      if (!lockedUser) {
        throw Errors.resourceNotFound('User');
      }
      const currentFileId = lockedUser.profileImageFileAssetId;
      // Postgres returns a uuid in lower case; a client may send it in any.
      const requestedFileId = fileId?.toLowerCase() ?? null;
      if (requestedFileId === currentFileId) return lockedUser;

      if (requestedFileId !== null) {
        await this.filesService.claimForAttachment(transaction, {
          fileId: requestedFileId,
          actorId,
          purpose: FilePurpose.PROFILE_IMAGE,
        });
      }
      if (currentFileId) {
        await this.filesService.markDeleting(transaction, [currentFileId]);
      }
      return transaction.user.update({
        where: { id: userId },
        data: { profileImageFileAssetId: requestedFileId, updatedBy: actorId },
      });
    });
  }

  /**
   * The API shape of a user, with a signed profile-picture URL
   * (`FilesService.findAttachedResponses`).
   * **Only for a user the caller was authorized to read** — the URL is a
   * bearer credential for the picture. Never fails for a storage problem: the
   * picture is then null (see `FilesService.findAttachedResponses`).
   */
  async toResponse(user: User): Promise<UserResponseDto> {
    const [response] = await this.toResponses([user]);
    return response as UserResponseDto;
  }

  async toResponses(users: User[]): Promise<UserResponseDto[]> {
    const pictures = await this.filesService.findAttachedResponses(
      users
        .map((user) => user.profileImageFileAssetId)
        .filter((fileId): fileId is string => fileId !== null),
    );
    return users.map(
      (user) =>
        new UserResponseDto(
          user,
          (user.profileImageFileAssetId &&
            pictures.get(user.profileImageFileAssetId)) ||
            null,
        ),
    );
  }

  async softDelete(userId: string, actorId: string): Promise<void> {
    await this.findById(userId);
    // Self-close: mark the row deleted. The scoped Prisma client and the
    // auth hot paths both reject rows with deletedAt set, so the user
    // can't log back in. `isActive` is untouched — that flag exists for
    // suspension (a separate domain concept from deletion), not to
    // double-signal lifecycle state. The row stays for audit/FK integrity;
    // call gdprErase for true PII removal.
    //
    // Refused while the user is the last active owner of a live workspace — the
    // response names them, and the remedy (transfer ownership, or delete the
    // workspace) is entirely in the caller's hands. `POST /users/me/gdpr-erase`
    // is the path that cannot be refused, and it closes those workspaces
    // instead.
    await this.deleteAccount(userId, actorId);
    await this.auditService.record({
      action: 'user.self_deleted',
      actorId,
      targetUserId: userId,
    });
  }

  async updateUsername(
    userId: string,
    username: string,
    actorId: string,
  ): Promise<User> {
    await this.findById(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { username: username.toLowerCase(), updatedBy: actorId },
    });
  }

  /**
   * Moves the account to a new sign-in address. It changes what a person signs
   * in with, so every OTHER session ends, as a password change does; the
   * caller gets a fresh session (their current tokens die with the cutoff).
   */
  async updateEmail(
    userId: string,
    dto: UpdateAuthUserEmailDto,
    context: RefreshTokenContext = {},
  ): Promise<{ user: User; tokens: SessionTokens }> {
    const user = await this.findById(userId);
    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!passwordMatches) {
      throw Errors.currentPasswordIncorrect();
    }
    const newEmail = dto.newEmail.toLowerCase();
    const updated = await this.prisma.$transaction(async (transaction) => {
      // User lock first, as in `applyPasswordChange`.
      await this.refreshTokenService.lockSessions(transaction, userId);
      await assertPasswordUnchangedWithin(transaction, userId, {
        passwordHash: user.password,
      });
      return this.refreshTokenService.endAllSessionsInTransaction(
        transaction,
        userId,
        userId,
        { email: newEmail },
      );
    });
    if (newEmail !== user.email) {
      await this.recordEmailChange(user, newEmail, userId);
    }
    const tokens = await this.refreshTokenService.startSession(
      userId,
      updated.passwordChangedAt,
      context,
    );
    return { user: updated, tokens };
  }

  /**
   * THE credential write: hash, cutoff bump and revocation of every refresh
   * family, in one transaction. There is no way to change a password without
   * ending the account's sessions. `isPasswordChangeRequired` records who
   * chose it: true when an administrator did, false when the person did.
   */
  private async applyPasswordChange(
    userId: string,
    plaintextPassword: string,
    actorId: string,
    isPasswordChangeRequired: boolean,
    proof: CurrentPasswordProof | null = null,
  ): Promise<User> {
    // Hashed BEFORE the transaction opens. bcrypt at 12 rounds costs ~250ms, and
    // holding a row lock across it would serialise every concurrent session
    // operation on this account behind a deliberately slow function.
    const passwordHash = await hashPassword(plaintextPassword);

    return this.prisma.$transaction(async (transaction) => {
      // User lock first — the same order every session path uses, so a
      // credential change and a concurrent rotation cannot deadlock, and a
      // rotation in flight cannot slip a replacement token past the revocation.
      await this.refreshTokenService.lockSessions(transaction, userId);
      if (proof) {
        await assertPasswordUnchangedWithin(transaction, userId, proof);
      }
      return this.refreshTokenService.endAllSessionsInTransaction(
        transaction,
        userId,
        actorId,
        { password: passwordHash, isPasswordChangeRequired },
      );
    });
  }

  /**
   * Changes the caller's password and ends every OTHER session, like Laravel's
   * `logoutOtherDevices` / Django's `update_session_auth_hash`: the caller gets
   * a fresh session in the response. It is also how a person replaces a
   * password an administrator chose, which lifts `isPasswordChangeRequired`.
   */
  async updateOwnPassword(
    userId: string,
    dto: UpdateAuthUserPasswordDto,
    context: RefreshTokenContext = {},
  ): Promise<{ user: User; tokens: SessionTokens }> {
    const user = await this.findById(userId);
    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!passwordMatches) {
      throw Errors.currentPasswordIncorrect();
    }
    // A new password must be new: "changing" a password an administrator chose
    // to itself would lift `isPasswordChangeRequired` while the administrator
    // still knows it.
    if (dto.newPassword === dto.currentPassword) {
      throw Errors.badRequest(
        'Choose a new password different from the current one.',
      );
    }
    const updated = await this.applyPasswordChange(
      userId,
      dto.newPassword,
      userId,
      false,
      { passwordHash: user.password },
    );
    const tokens = await this.refreshTokenService.startSession(
      userId,
      updated.passwordChangedAt,
      context,
    );
    return { user: updated, tokens };
  }

  /**
   * Sets a password for someone who lost theirs. Every session they hold
   * ends, and they must replace this password at their next sign-in, so the
   * administrator who chose it does not keep knowing it.
   */
  async updatePasswordAsAdmin(
    userId: string,
    newPassword: string,
    actorId: string,
  ): Promise<User> {
    if (userId === actorId) {
      throw Errors.adminSelfTargetForbidden(
        'Use /users/me/password to change your own password',
      );
    }
    await this.findById(userId);
    const updated = await this.applyPasswordChange(
      userId,
      newPassword,
      actorId,
      true,
    );
    // Someone guessing at the account may be why it was reset: the new
    // password must not wait out their failed attempts.
    await this.signInFailureLimit.clear(accountSignInSubject(userId));
    await this.auditService.record({
      action: 'password.reset.by_admin',
      actorId,
      targetUserId: userId,
    });
    return updated;
  }

  // ── Support operations ─────────────────────────────────────────────────
  // Narrow capabilities held by PLATFORM_APP_SUPPORT, each its own permission
  // so support can help an account holder without being able to edit them.

  /**
   * Ends every session the account holds, on every device: revokes the refresh
   * chains and moves the cutoff, so live access tokens (`JWT_EXPIRES_IN`,
   * 15 minutes by default) stop working immediately rather than at expiry.
   */
  async revokeAllSessions(userId: string, actorId: string): Promise<void> {
    const user = await this.findById(userId);
    await this.refreshTokenService.endAllSessions(user.id, actorId);
    await this.auditService.record({
      action: 'user.sessions_revoked_by_support',
      actorId,
      targetUserId: user.id,
    });
  }
}

/** The password hash a caller proved, by its current password, before locking. */
interface CurrentPasswordProof {
  readonly passwordHash: string;
}

/**
 * Refuses a self-service change when the password changed after the caller
 * proved it: the proof was checked against a row read before the user lock,
 * so an administrator's reset committing in between would otherwise be
 * silently overwritten — undoing the reset that answered a compromise.
 * Answers as a wrong current password would: the one the caller gave is no
 * longer the account's. Call under the user lock.
 */
async function assertPasswordUnchangedWithin(
  transaction: Prisma.TransactionClient,
  userId: string,
  proof: CurrentPasswordProof,
): Promise<void> {
  const current = await transaction.user.findUniqueOrThrow({
    where: { id: userId },
    select: { password: true },
  });
  if (current.password !== proof.passwordHash) {
    throw Errors.currentPasswordIncorrect();
  }
}
