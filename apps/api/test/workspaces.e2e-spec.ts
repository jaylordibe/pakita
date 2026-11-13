import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { WorkspaceMembershipStatus } from '../src/common/enums/workspace-membership-status.enum';
import { truncateAll } from './setup/db';
import {
  addMembership,
  createPlatformAdmin,
  createRegularUser,
  createUser,
  seedRbacCatalog,
  SeededUser,
} from './setup/rbac';
import { createTestApp } from './setup/test-app';

interface WorkspaceBody {
  id: string;
  name: string;
  slug: string;
}
interface MembershipBody {
  id: string;
  userId: string;
  role: { name: string };
}
interface ErrorBody {
  errorCode: string;
}
interface PageBody<T> {
  data: T[];
  meta: { total: number };
}

describe('Workspaces (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: SeededUser;

  /** Only the platform admin creates a workspace, naming its owner. */
  async function createWorkspace(
    owner: SeededUser,
    slug: string,
  ): Promise<WorkspaceBody> {
    const response = await request(app.getHttpServer())
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: `Workspace ${slug}`, slug, ownerEmail: owner.email })
      .expect(201);
    return response.body as WorkspaceBody;
  }

  async function roleOf(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: string; status: string } | null> {
    const membership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { role: true },
    });
    return membership
      ? { role: membership.role.name, status: membership.status }
      : null;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(app);
    await seedRbacCatalog(app);
    admin = await createPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/workspaces', () => {
    it('makes the named account the owner, and the admin no member, atomically', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const workspace = await createWorkspace(owner, 'acme');

      const membership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: { workspaceId: workspace.id, userId: owner.id },
        },
        include: { role: true },
      });
      expect(membership.role.name).toBe(SeededRoleName.WORKSPACE_OWNER);
      expect(membership.status).toBe(WorkspaceMembershipStatus.ACTIVE);
      // Audit columns come from the DB, never the API body.
      expect(membership.createdBy).toBe(admin.id);
      expect(membership.invitedBy).toBe(admin.id);
      expect(await roleOf(workspace.id, admin.id)).toBeNull();
    });

    it('the owner can use the workspace at once (their cached grants are dropped)', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      // Warm the owner's grants cache before the workspace exists.
      await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const workspace = await createWorkspace(owner, 'acme');

      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
    });

    it.each([
      ['an ordinary account', []],
      ['a platform engineer', [SeededRoleName.PLATFORM_ENGINEER]],
      [
        'platform technical support',
        [SeededRoleName.PLATFORM_TECHNICAL_SUPPORT],
      ],
      ['platform app support', [SeededRoleName.PLATFORM_APP_SUPPORT]],
    ])('refuses %s with 403', async (_label, roles) => {
      const caller = await createUser(app, {
        email: 'caller@example.com',
        roles,
      });
      const owner = await createRegularUser(app, 'owner@example.com');
      const response = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${caller.token}`)
        .send({ name: 'Startup', slug: 'startup', ownerEmail: owner.email })
        .expect(403);
      expect((response.body as ErrorBody).errorCode).toBe('PERMISSION_DENIED');
      expect(await prisma.workspace.count()).toBe(0);
    });

    it('requires an owner email (400)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Ownerless', slug: 'ownerless' })
        .expect(400);
      expect((response.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
    });

    it('404s an owner email with no account, and creates nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Ghost', slug: 'ghost', ownerEmail: 'ghost@example.com' })
        .expect(404);
      expect((response.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');
      expect(await prisma.workspace.count()).toBe(0);
    });

    it('refuses a platform account as owner (409), and creates nothing', async () => {
      const engineer = await createUser(app, {
        email: 'engineer@example.com',
        roles: [SeededRoleName.PLATFORM_ENGINEER],
      });
      for (const ownerEmail of [engineer.email, admin.email]) {
        const response = await request(app.getHttpServer())
          .post('/api/workspaces')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ name: 'Staff church', slug: 'staff', ownerEmail })
          .expect(409);
        expect((response.body as ErrorBody).errorCode).toBe(
          'PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE',
        );
      }
      expect(await prisma.workspace.count()).toBe(0);
      expect(await prisma.workspaceMembership.count()).toBe(0);
    });

    it('rejects a duplicate slug among live workspaces', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      await createWorkspace(owner, 'taken');
      const response = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Other', slug: 'taken', ownerEmail: owner.email })
        .expect(409);
      expect((response.body as ErrorBody).errorCode).toBe(
        'UNIQUE_CONSTRAINT_VIOLATION',
      );
    });

    it('a soft-deleted workspace releases its slug (partial unique index)', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const first = await createWorkspace(owner, 'reusable');
      await request(app.getHttpServer())
        .delete(`/api/workspaces/${first.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);

      // Same slug, brand-new workspace.
      await createWorkspace(owner, 'reusable');
    });
  });

  describe('reading and editing', () => {
    it('GET /api/workspaces lists only the caller’s workspaces', async () => {
      const alice = await createRegularUser(app, 'alice@example.com');
      const bob = await createRegularUser(app, 'bob@example.com');
      await createWorkspace(alice, 'alice-co');
      await createWorkspace(bob, 'bob-co');

      const response = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200);
      const body = response.body as PageBody<WorkspaceBody>;
      expect(body.meta.total).toBe(1);
      expect(body.data[0]?.slug).toBe('alice-co');
    });

    // `isDeniedAsNotFound` — belonging to no workspace is not a refusal.
    it('GET /api/workspaces returns an empty page for a user with no workspaces', async () => {
      const loner = await createRegularUser(app, 'loner@example.com');
      const response = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${loner.token}`)
        .expect(200);
      const body = response.body as PageBody<WorkspaceBody>;
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
    });

    // The tenant boundary. A 403 would confirm the workspace exists.
    it('GET /api/workspaces/:id returns 404 (not 403) across the tenant boundary', async () => {
      const alice = await createRegularUser(app, 'alice@example.com');
      const bob = await createRegularUser(app, 'bob@example.com');
      const bobsWorkspace = await createWorkspace(bob, 'bob-co');

      const response = await request(app.getHttpServer())
        .get(`/api/workspaces/${bobsWorkspace.id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(404);
      expect((response.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');
    });

    it('PATCH /api/workspaces/:id returns 404 across the tenant boundary', async () => {
      const alice = await createRegularUser(app, 'alice@example.com');
      const bob = await createRegularUser(app, 'bob@example.com');
      const bobsWorkspace = await createWorkspace(bob, 'bob-co');

      await request(app.getHttpServer())
        .patch(`/api/workspaces/${bobsWorkspace.id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      // And the row is untouched.
      const row = await prisma.workspace.findUniqueOrThrow({
        where: { id: bobsWorkspace.id },
      });
      expect(row.name).toBe('Workspace bob-co');
    });

    it('an owner may update and soft-delete their own workspace', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const workspace = await createWorkspace(owner, 'owned');

      await request(app.getHttpServer())
        .patch(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Renamed' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);

      const row = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(owner.id);
    });

    it('PATCH cannot change the owner (400: not a profile field)', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const other = await createRegularUser(app, 'other@example.com');
      const workspace = await createWorkspace(owner, 'owned');

      const response = await request(app.getHttpServer())
        .patch(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ownerEmail: other.email })
        .expect(400);
      expect((response.body as ErrorBody).errorCode).toBe('VALIDATION_FAILED');
    });

    it('PLATFORM_ADMIN reads, renames and deletes any workspace without belonging to it', async () => {
      const alice = await createRegularUser(app, 'alice@example.com');
      const bob = await createRegularUser(app, 'bob@example.com');
      await createWorkspace(alice, 'alice-co');
      const bobsWorkspace = await createWorkspace(bob, 'bob-co');

      const list = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect((list.body as PageBody<WorkspaceBody>).meta.total).toBe(2);

      await request(app.getHttpServer())
        .get(`/api/workspaces/${bobsWorkspace.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/workspaces/${bobsWorkspace.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Bob Branch' })
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/workspaces/${bobsWorkspace.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);
      expect(await roleOf(bobsWorkspace.id, admin.id)).toBeNull();
    });
  });

  describe('PUT /api/workspaces/:workspaceId/owner', () => {
    const replaceOwner = (
      actor: SeededUser,
      workspaceId: string,
      email: string,
    ) =>
      request(app.getHttpServer())
        .put(`/api/workspaces/${workspaceId}/owner`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ email });

    it('the admin hands the workspace to an account outside it; the old owner becomes admin', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const successor = await createRegularUser(app, 'successor@example.com');
      const workspace = await createWorkspace(owner, 'church');

      const response = await replaceOwner(
        admin,
        workspace.id,
        successor.email,
      ).expect(200);
      const body = response.body as MembershipBody;
      expect(body.userId).toBe(successor.id);
      expect(body.role.name).toBe(SeededRoleName.WORKSPACE_OWNER);

      expect(await roleOf(workspace.id, successor.id)).toEqual({
        role: SeededRoleName.WORKSPACE_OWNER,
        status: WorkspaceMembershipStatus.ACTIVE,
      });
      expect(await roleOf(workspace.id, owner.id)).toEqual({
        role: SeededRoleName.WORKSPACE_ADMIN,
        status: WorkspaceMembershipStatus.ACTIVE,
      });
      expect(await roleOf(workspace.id, admin.id)).toBeNull();

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'workspace_membership.ownership_transferred' },
      });
      expect(audit.actorId).toBe(admin.id);
      expect(audit.targetUserId).toBe(successor.id);
    });

    it('promotes an existing active member, and a member who left re-joins as owner', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const member = await createRegularUser(app, 'member@example.com');
      const former = await createRegularUser(app, 'former@example.com');
      const workspace = await createWorkspace(owner, 'church');
      await addMembership(
        app,
        workspace.id,
        member.id,
        SeededRoleName.WORKSPACE_STAFF,
      );
      await addMembership(
        app,
        workspace.id,
        former.id,
        SeededRoleName.WORKSPACE_STAFF,
        WorkspaceMembershipStatus.LEFT,
      );

      await replaceOwner(admin, workspace.id, member.email).expect(200);
      expect((await roleOf(workspace.id, member.id))?.role).toBe(
        SeededRoleName.WORKSPACE_OWNER,
      );

      await replaceOwner(admin, workspace.id, former.email).expect(200);
      expect(await roleOf(workspace.id, former.id)).toEqual({
        role: SeededRoleName.WORKSPACE_OWNER,
        status: WorkspaceMembershipStatus.ACTIVE,
      });
      expect((await roleOf(workspace.id, member.id))?.role).toBe(
        SeededRoleName.WORKSPACE_ADMIN,
      );
      expect(
        await prisma.workspaceMembership.count({
          where: {
            workspaceId: workspace.id,
            role: { name: SeededRoleName.WORKSPACE_OWNER },
            status: WorkspaceMembershipStatus.ACTIVE,
          },
        }),
      ).toBe(1);
    });

    it("a workspace's own owner may hand it over; its admin may not (403)", async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const deputy = await createRegularUser(app, 'deputy@example.com');
      const successor = await createRegularUser(app, 'successor@example.com');
      const workspace = await createWorkspace(owner, 'church');
      await addMembership(
        app,
        workspace.id,
        deputy.id,
        SeededRoleName.WORKSPACE_ADMIN,
      );

      const refused = await replaceOwner(
        deputy,
        workspace.id,
        deputy.email,
      ).expect(403);
      expect((refused.body as ErrorBody).errorCode).toBe('PERMISSION_DENIED');

      await replaceOwner(owner, workspace.id, successor.email).expect(200);
      expect((await roleOf(workspace.id, owner.id))?.role).toBe(
        SeededRoleName.WORKSPACE_ADMIN,
      );
    });

    it("refuses another workspace's owner (403) and leaves the owner in place", async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const stranger = await createRegularUser(app, 'stranger@example.com');
      const workspace = await createWorkspace(owner, 'church');
      await createWorkspace(stranger, 'elsewhere');

      await replaceOwner(stranger, workspace.id, stranger.email).expect(403);
      expect((await roleOf(workspace.id, owner.id))?.role).toBe(
        SeededRoleName.WORKSPACE_OWNER,
      );
      expect(await roleOf(workspace.id, stranger.id)).toBeNull();
    });

    it('refuses a platform account (409), a suspended member (409) and an unknown email (404)', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const suspended = await createRegularUser(app, 'suspended@example.com');
      const support = await createUser(app, {
        email: 'support@example.com',
        roles: [SeededRoleName.PLATFORM_APP_SUPPORT],
      });
      const workspace = await createWorkspace(owner, 'church');
      await addMembership(
        app,
        workspace.id,
        suspended.id,
        SeededRoleName.WORKSPACE_STAFF,
        WorkspaceMembershipStatus.SUSPENDED,
      );

      for (const email of [support.email, admin.email]) {
        const response = await replaceOwner(admin, workspace.id, email).expect(
          409,
        );
        expect((response.body as ErrorBody).errorCode).toBe(
          'PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE',
        );
      }
      const suspendedResponse = await replaceOwner(
        admin,
        workspace.id,
        suspended.email,
      ).expect(409);
      expect((suspendedResponse.body as ErrorBody).errorCode).toBe(
        'MEMBERSHIP_NOT_ACTIVE',
      );
      const unknown = await replaceOwner(
        admin,
        workspace.id,
        'ghost@example.com',
      ).expect(404);
      expect((unknown.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');

      expect((await roleOf(workspace.id, owner.id))?.role).toBe(
        SeededRoleName.WORKSPACE_OWNER,
      );
    });

    it('404s a deleted workspace', async () => {
      const owner = await createRegularUser(app, 'owner@example.com');
      const successor = await createRegularUser(app, 'successor@example.com');
      const workspace = await createWorkspace(owner, 'church');
      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204);

      const response = await replaceOwner(
        admin,
        workspace.id,
        successor.email,
      ).expect(404);
      expect((response.body as ErrorBody).errorCode).toBe('RESOURCE_NOT_FOUND');
    });
  });
});
