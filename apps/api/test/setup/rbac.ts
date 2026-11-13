import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { App } from 'supertest/types';
import {
  assignPlatformRole,
  seedPermissions,
  seedRoles,
} from '../../prisma/rbac-seeder';
import { WorkspaceMembershipStatus } from '../../src/common/enums/workspace-membership-status.enum';
import { SeededRoleName } from '../../src/common/enums/seeded-role-name.enum';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service';
import { PrismaService } from '../../src/prisma/prisma.service';

// Shared RBAC fixtures.
//
// `truncateAll` wipes `roles` / `permissions` between specs and nothing works
// without them, so every spec calls `seedRbacCatalog(app)` in `beforeEach`,
// right after truncating.
//
// The catalog is projected from `permission-catalog.ts` by the same seeder
// production uses, so tests exercise the real grant graph rather than a
// hand-maintained fixture that could drift from it.
//
// Note what is deliberately NOT here: a default role. Self-service capability
// comes from AUTHENTICATED_USER_PERMISSIONS, which the ability factory injects
// for every authenticated caller — so `createUser` below creates an account
// with NO roles at all, which is exactly the shape of a real signup.

export const TEST_PASSWORD = 'correct-horse-battery-1';

export async function seedRbacCatalog(
  app: INestApplication<App>,
): Promise<void> {
  const prisma = app.get(PrismaService);
  await seedPermissions(prisma);
  await seedRoles(prisma);
}

/**
 * An access token for an existing account, minted through the same session
 * service `POST /auth/login` uses (refresh row + signed JWT), without the
 * password round trip. Auth specs use the real endpoint instead.
 */
export async function issueAccessToken(
  app: INestApplication<App>,
  userId: string,
): Promise<string> {
  const user = await app
    .get(PrismaService)
    .user.findUniqueOrThrow({ where: { id: userId } });
  const { accessToken } = await app
    .get(RefreshTokenService)
    .startSession(user.id, user.passwordChangedAt);
  return accessToken;
}

export interface SeededUser {
  id: string;
  email: string;
  token: string;
}

/**
 * Creates an account holding the given platform roles — none, by default —
 * on a password its owner chose (`isPasswordChangeRequired` false).
 *
 * Rows are inserted directly rather than through `POST /users` so the spec
 * controls the role set and needs no administrator.
 */
export async function createUser(
  app: INestApplication<App>,
  options: {
    email: string;
    roles?: readonly SeededRoleName[];
    firstName?: string;
    lastName?: string;
  },
): Promise<SeededUser> {
  const prisma = app.get(PrismaService);
  const email = options.email.toLowerCase();

  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(TEST_PASSWORD, 10),
      firstName: options.firstName ?? 'Test',
      lastName: options.lastName ?? 'User',
    },
  });

  for (const roleName of options.roles ?? []) {
    await assignPlatformRole(prisma, user.id, roleName);
  }

  return { id: user.id, email, token: await issueAccessToken(app, user.id) };
}

// A platform administrator: governance over accounts, platform roles, workspaces
// and their owners. Never a member of a workspace.
export function createPlatformAdmin(
  app: INestApplication<App>,
  email = 'admin@example.com',
): Promise<SeededUser> {
  return createUser(app, {
    email,
    roles: [SeededRoleName.PLATFORM_ADMIN],
    firstName: 'Admin',
  });
}

/**
 * An ordinary registered user: NO platform role whatsoever.
 *
 * This is the single most important fixture in the suite, because it is the
 * shape of every real account. If a `/users/me/*` route breaks for this user,
 * it is broken for everybody.
 */
export function createRegularUser(
  app: INestApplication<App>,
  email = 'user@example.com',
): Promise<SeededUser> {
  return createUser(app, { email, firstName: 'Regular' });
}

/** The id of a seeded role, by name. */
export async function roleIdFor(
  app: INestApplication<App>,
  name: SeededRoleName,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const role = await prisma.role.findUniqueOrThrow({ where: { name } });
  return role.id;
}

export interface SeededWorkspace {
  id: string;
  slug: string;
}

/**
 * Creates a workspace directly in the database and makes `ownerId` its owner.
 *
 * Bypasses `POST /workspaces` so a spec can set up a tenant without asserting
 * anything about the creation endpoint — and so it can create a workspace owned
 * by somebody other than the caller.
 */
export async function createWorkspaceWithOwner(
  app: INestApplication<App>,
  ownerId: string,
  slug = 'acme',
): Promise<SeededWorkspace> {
  const prisma = app.get(PrismaService);
  const workspace = await prisma.workspace.create({
    data: { name: slug, slug, createdBy: ownerId, updatedBy: ownerId },
  });
  await addMembership(
    app,
    workspace.id,
    ownerId,
    SeededRoleName.WORKSPACE_OWNER,
  );
  return { id: workspace.id, slug: workspace.slug };
}

/**
 * Puts a user into a workspace with a given role and status.
 *
 * `joinedAt` is always stamped: the column is NOT NULL, because a membership row
 * now exists only once somebody has actually joined. A pending invitation is a
 * `workspace_invitations` row, never a placeholder membership.
 */
export async function addMembership(
  app: INestApplication<App>,
  workspaceId: string,
  userId: string,
  roleName: SeededRoleName,
  status: WorkspaceMembershipStatus = WorkspaceMembershipStatus.ACTIVE,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: roleName },
  });
  const membership = await prisma.workspaceMembership.create({
    data: {
      workspaceId,
      userId,
      roleId: role.id,
      status,
      joinedAt: new Date(),
      endedAt: status === WorkspaceMembershipStatus.LEFT ? new Date() : null,
    },
  });
  return membership.id;
}
