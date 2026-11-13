import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { WorkspaceMembershipStatus } from '../src/common/enums/workspace-membership-status.enum';
import { AuthorizationDataIntegrityService } from '../src/modules/authorization/authorization-data-integrity.service';
import { UserRolesService } from '../src/modules/roles/user-roles.service';
import { WorkspaceOwnershipPolicy } from '../src/modules/workspaces/workspace-ownership.policy';
import { PrismaService } from '../src/prisma/prisma.service';
import { pauseBefore, runRace } from './setup/barrier';
import { truncateAll } from './setup/db';
import {
  addMembership,
  createPlatformAdmin,
  createRegularUser,
  createUser,
  createWorkspaceWithOwner,
  roleIdFor,
  seedRbacCatalog,
  type SeededUser,
} from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface ErrorBody {
  errorCode: string;
}
interface MembershipBody {
  id: string;
  userId: string;
  role: { name: string };
  user: { email: string };
}

/**
 * Platform accounts and workspace accounts are separate people.
 *
 * A Pakita server's platform roles are the Main Church's IT staff: they run the
 * server and never belong to a church. An account therefore holds platform
 * roles OR workspace memberships, never both — refused from either side, under
 * the user-row lock both sides take, and caught at boot if a row slips past.
 *
 * Also here: the platform admin governs workspaces without reaching their
 * content, and a workspace's owner and admins create their own people's
 * accounts.
 */
describe('Platform and workspace account separation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: SeededUser;
  let owner: SeededUser;
  let workspace: { id: string; slug: string };

  const server = () => app.getHttpServer();
  const as = (actor: SeededUser) => ({
    Authorization: `Bearer ${actor.token}`,
  });

  const invite = async (identifier: string): Promise<string> => {
    const response = await request(server())
      .post(`/api/workspaces/${workspace.id}/invitations`)
      .set(as(owner))
      .send({
        identifier,
        roleId: await roleIdFor(app, SeededRoleName.WORKSPACE_STAFF),
      })
      .expect(201);
    return (response.body as { token: string }).token;
  };
  const accept = (actor: SeededUser, token: string) =>
    request(server())
      .post('/api/invitations/accept')
      .set(as(actor))
      .send({ token });
  const grantPlatformRole = async (userId: string, roleName: SeededRoleName) =>
    request(server())
      .post(`/api/users/${userId}/roles`)
      .set(as(admin))
      .send({ roleId: await roleIdFor(app, roleName) });
  const membershipOf = (userId: string) =>
    prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      include: { role: true },
    });
  const platformRoleCount = (userId: string) =>
    prisma.userRole.count({ where: { userId } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
    admin = await createPlatformAdmin(app);
    owner = await createRegularUser(app, 'owner@example.com');
    workspace = await createWorkspaceWithOwner(app, owner.id, 'church');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a platform account never joins a workspace', () => {
    it('refuses to accept an invitation (409), and nothing joins', async () => {
      const engineer = await createUser(app, {
        email: 'engineer@example.com',
        roles: [SeededRoleName.PLATFORM_ENGINEER],
      });
      const token = await invite(engineer.email);

      const response = await accept(engineer, token).expect(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE',
      );
      expect(await membershipOf(engineer.id)).toBeNull();
    });

    it('refuses to add one as a member (409)', async () => {
      const response = await request(server())
        .post(`/api/workspaces/${workspace.id}/memberships`)
        .set(as(owner))
        .send({
          email: admin.email,
          roleId: await roleIdFor(app, SeededRoleName.WORKSPACE_STAFF),
        })
        .expect(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE',
      );
      expect(await membershipOf(admin.id)).toBeNull();
    });

    it('refuses to reactivate a planted suspended membership (409)', async () => {
      const support = await createUser(app, {
        email: 'support@example.com',
        roles: [SeededRoleName.PLATFORM_APP_SUPPORT],
      });
      const membershipId = await addMembership(
        app,
        workspace.id,
        support.id,
        SeededRoleName.WORKSPACE_STAFF,
        WorkspaceMembershipStatus.SUSPENDED,
      );

      const response = await request(server())
        .post(
          `/api/workspaces/${workspace.id}/memberships/${membershipId}/reactivate`,
        )
        .set(as(owner))
        .expect(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE',
      );
      expect((await membershipOf(support.id))?.status).toBe(
        WorkspaceMembershipStatus.SUSPENDED,
      );
    });
  });

  describe('a workspace member never holds a platform role', () => {
    it.each([
      WorkspaceMembershipStatus.ACTIVE,
      WorkspaceMembershipStatus.SUSPENDED,
    ])('refuses a %s member (409), granting nothing', async (status) => {
      const member = await createRegularUser(app, 'member@example.com');
      await addMembership(
        app,
        workspace.id,
        member.id,
        SeededRoleName.WORKSPACE_STAFF,
        status,
      );

      const response = await grantPlatformRole(
        member.id,
        SeededRoleName.PLATFORM_APP_SUPPORT,
      );
      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'WORKSPACE_MEMBER_CANNOT_HOLD_PLATFORM_ROLE',
      );
      expect(await platformRoleCount(member.id)).toBe(0);
    });

    it('allows someone whose membership ended, or whose workspace was deleted', async () => {
      const former = await createRegularUser(app, 'former@example.com');
      await addMembership(
        app,
        workspace.id,
        former.id,
        SeededRoleName.WORKSPACE_STAFF,
        WorkspaceMembershipStatus.LEFT,
      );
      const closedOwner = await createRegularUser(app, 'closed@example.com');
      const closed = await createWorkspaceWithOwner(
        app,
        closedOwner.id,
        'closed',
      );
      await prisma.workspace.update({
        where: { id: closed.id },
        data: { deletedAt: new Date() },
      });

      for (const user of [former, closedOwner]) {
        const response = await grantPlatformRole(
          user.id,
          SeededRoleName.PLATFORM_APP_SUPPORT,
        );
        expect(response.status).toBe(204);
        expect(await platformRoleCount(user.id)).toBe(1);
      }
    });
  });

  describe('races between the two sides', () => {
    it('a role granted while an invitation acceptance is in flight wins, and the acceptance is refused', async () => {
      const person = await createRegularUser(app, 'person@example.com');
      const token = await invite(person.email);
      const paused = pauseBefore(
        app.get(WorkspaceOwnershipPolicy),
        'assertUserMayHoldActiveMembership',
      );

      const result = await runRace(accept(person, token), paused, async () =>
        grantPlatformRole(person.id, SeededRoleName.PLATFORM_APP_SUPPORT),
      );

      expect(result.racer.status).toBe('fulfilled');
      expect(result.paused.status).toBe('fulfilled');
      if (
        result.racer.status === 'fulfilled' &&
        result.paused.status === 'fulfilled'
      ) {
        expect(result.racer.value.status).toBe(204);
        expect(result.paused.value.status).toBe(409);
      }
      expect(await platformRoleCount(person.id)).toBe(1);
      expect(await membershipOf(person.id)).toBeNull();
    });

    it('a membership accepted while a role grant is in flight wins, and the grant is refused', async () => {
      const person = await createRegularUser(app, 'person@example.com');
      const token = await invite(person.email);
      // `loadPlatformRole` runs before the grant's transaction, so pausing it
      // parks the grant before it takes any lock.
      // It is private, so the singleton is fetched as a plain record of its
      // members — the barrier wraps whatever function is there at runtime.
      const paused = pauseBefore(
        app.get<UserRolesService, Record<string, unknown>>(UserRolesService),
        'loadPlatformRole',
      );

      const result = await runRace(
        grantPlatformRole(person.id, SeededRoleName.PLATFORM_APP_SUPPORT),
        paused,
        async () => accept(person, token),
      );

      if (
        result.racer.status === 'fulfilled' &&
        result.paused.status === 'fulfilled'
      ) {
        expect(result.racer.value.status).toBe(200);
        expect(result.paused.value.status).toBe(409);
      } else {
        throw new Error('a request in the race rejected');
      }
      expect(await platformRoleCount(person.id)).toBe(0);
      expect((await membershipOf(person.id))?.status).toBe(
        WorkspaceMembershipStatus.ACTIVE,
      );
    });
  });

  describe("the platform admin governs workspaces, not a church's content or roster", () => {
    it.each([
      ['GET', 'songs', 404],
      ['GET', 'themes', 404],
      ['GET', 'playlists', 404],
      ['GET', 'sync/changes', 404],
      ['POST', 'songs', 403],
      ['POST', 'invitations', 403],
      ['POST', 'memberships', 403],
      ['POST', 'accounts', 403],
    ] as const)('%s /workspaces/:id/%s → %i', async (method, path, status) => {
      const url = `/api/workspaces/${workspace.id}/${path}`;
      const call =
        method === 'GET'
          ? request(server()).get(url)
          : request(server()).post(url).send({});
      const response = await call.set(as(admin));
      expect(response.status).toBe(status);
    });
  });

  describe('POST /api/workspaces/:workspaceId/accounts', () => {
    const newAccount = async (roleName: SeededRoleName, email: string) => ({
      email,
      password: 'first-password-1',
      firstName: 'New',
      lastName: 'Person',
      roleId: await roleIdFor(app, roleName),
    });
    const createAccount = (
      actor: SeededUser,
      body: Record<string, unknown>,
      workspaceId = workspace.id,
    ) =>
      request(server())
        .post(`/api/workspaces/${workspaceId}/accounts`)
        .set(as(actor))
        .send(body);

    it('an owner creates an account that joins with the role and must change its password', async () => {
      const response = await createAccount(
        owner,
        await newAccount(SeededRoleName.WORKSPACE_STAFF, 'New@Example.com'),
      ).expect(201);
      const body = response.body as MembershipBody;
      expect(body.role.name).toBe(SeededRoleName.WORKSPACE_STAFF);
      expect(body.user.email).toBe('new@example.com');
      expect(body).not.toHaveProperty('password');

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: body.userId },
      });
      expect(user.isPasswordChangeRequired).toBe(true);
      expect(user.createdBy).toBe(owner.id);
      expect(user.password).not.toBe('first-password-1');
      expect(await platformRoleCount(user.id)).toBe(0);
      const membership = await membershipOf(user.id);
      expect(membership?.status).toBe(WorkspaceMembershipStatus.ACTIVE);
      expect(membership?.invitedBy).toBe(owner.id);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.created.by_workspace' },
      });
      expect(audit.actorId).toBe(owner.id);
      expect(audit.targetUserId).toBe(user.id);
    });

    it('a workspace admin may create up to its own rank, never an owner', async () => {
      const deputy = await createRegularUser(app, 'deputy@example.com');
      await addMembership(
        app,
        workspace.id,
        deputy.id,
        SeededRoleName.WORKSPACE_ADMIN,
      );

      await createAccount(
        deputy,
        await newAccount(SeededRoleName.WORKSPACE_ADMIN, 'peer@example.com'),
      ).expect(201);
      const refused = await createAccount(
        deputy,
        await newAccount(SeededRoleName.WORKSPACE_OWNER, 'boss@example.com'),
      ).expect(403);
      expect((refused.body as ErrorBody).errorCode).toBe('ROLE_NOT_ASSIGNABLE');
      expect(
        await prisma.user.count({ where: { email: 'boss@example.com' } }),
      ).toBe(0);
    });

    it.each([SeededRoleName.WORKSPACE_MANAGER, SeededRoleName.WORKSPACE_STAFF])(
      'refuses a %s (403)',
      async (roleName) => {
        const member = await createRegularUser(app, 'member@example.com');
        await addMembership(app, workspace.id, member.id, roleName);

        const response = await createAccount(
          member,
          await newAccount(SeededRoleName.WORKSPACE_STAFF, 'new@example.com'),
        ).expect(403);
        expect((response.body as ErrorBody).errorCode).toBe(
          'PERMISSION_DENIED',
        );
        expect(
          await prisma.user.count({ where: { email: 'new@example.com' } }),
        ).toBe(0);
      },
    );

    it("refuses another workspace's owner (403), creating nothing", async () => {
      const stranger = await createRegularUser(app, 'stranger@example.com');
      await createWorkspaceWithOwner(app, stranger.id, 'elsewhere');

      await createAccount(
        stranger,
        await newAccount(SeededRoleName.WORKSPACE_STAFF, 'new@example.com'),
      ).expect(403);
      expect(
        await prisma.user.count({ where: { email: 'new@example.com' } }),
      ).toBe(0);
    });

    it('refuses an email that already has an account (409), creating nothing', async () => {
      const existing = await createRegularUser(app, 'existing@example.com');
      const usersBefore = await prisma.user.count();

      const response = await createAccount(
        owner,
        await newAccount(SeededRoleName.WORKSPACE_STAFF, existing.email),
      ).expect(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'UNIQUE_CONSTRAINT_VIOLATION',
      );
      expect(await prisma.user.count()).toBe(usersBefore);
      expect(await membershipOf(existing.id)).toBeNull();
    });

    it('the new account cannot then be given a platform role (409)', async () => {
      const response = await createAccount(
        owner,
        await newAccount(SeededRoleName.WORKSPACE_STAFF, 'new@example.com'),
      ).expect(201);
      const userId = (response.body as MembershipBody).userId;

      const grant = await grantPlatformRole(
        userId,
        SeededRoleName.PLATFORM_ADMIN,
      );
      expect(grant.status).toBe(409);
      expect(await platformRoleCount(userId)).toBe(0);
    });
  });

  describe('the boot gate', () => {
    it('reports a platform account holding a membership, by role name only', async () => {
      const support = await createUser(app, {
        email: 'support@example.com',
        roles: [SeededRoleName.PLATFORM_APP_SUPPORT],
      });
      await addMembership(
        app,
        workspace.id,
        support.id,
        SeededRoleName.WORKSPACE_STAFF,
      );

      const service = app.get(AuthorizationDataIntegrityService);
      await expect(service.findDefects()).resolves.toEqual([
        {
          kind: 'platform_account_holds_membership',
          count: 1,
          offenders: [SeededRoleName.PLATFORM_APP_SUPPORT],
        },
      ]);
      await expect(
        service.assertStoredAssignmentsAreCoherent(),
      ).rejects.toThrow(/active or suspended workspace membership/);
    });

    it('ignores an ended membership', async () => {
      const support = await createUser(app, {
        email: 'support@example.com',
        roles: [SeededRoleName.PLATFORM_APP_SUPPORT],
      });
      await addMembership(
        app,
        workspace.id,
        support.id,
        SeededRoleName.WORKSPACE_STAFF,
        WorkspaceMembershipStatus.LEFT,
      );

      await expect(
        app.get(AuthorizationDataIntegrityService).findDefects(),
      ).resolves.toEqual([]);
    });
  });
});
