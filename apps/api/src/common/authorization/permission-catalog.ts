import { PermissionOwnership } from '../enums/permission-ownership.enum';
import { RoleScope } from '../enums/role-scope.enum';
import { SeededRoleName } from '../enums/seeded-role-name.enum';
import { toSnakeCase } from '../util/string-case.util';

// ─────────────────────────────────────────────────────────────────────────
// THE authorization catalog. Single source of truth for:
//
//   1. the compile-time types behind `@RequirePermission(action, subject)`,
//   2. the `permissions` / `roles` / `role_permissions` rows the seeder writes,
//   3. the CASL rules `AbilityFactory` compiles per request.
//
// The database is a *projection* of this file — never hand-edit permission
// rows. `PermissionCatalogIntegrityService` refuses to boot the app if the
// two ever disagree, and `pnpm rbac:check` asserts the same thing in CI.
//
// Central design rule: a permission row records WHAT (action + subject).
// It never records a condition. `AbilityFactory` derives the WHERE from
// `scope` + `ownership` + request context. See `subject-key.ts`.
// ─────────────────────────────────────────────────────────────────────────

// `manage` is CASL's wildcard: it matches every other action on the subject,
// including ones added later. It is granted only on subjects whose every verb
// belongs together (app versions, device tokens), and never on `all`: no role
// holds `manage all`, the platform admin included. Platform accounts run the
// server and never see a church's content, so the admin's authority is listed
// verb by verb like every other role's (`permission-catalog.spec.ts` asserts it).
//
// Every action below `delete` exists because `manage` would otherwise swallow
// it. That is the whole reason the list is this long: `manage
// WorkspaceMembership` silently includes `assignRole`, `suspend`, and
// `transferOwnership`, so a role that should administer a roster would
// silently gain the power to mint an owner.
export const AUTHORIZATION_ACTIONS = [
  'manage',
  'create',
  'read',
  'update',
  'delete',
  // Distinct from `update` on purpose. Resetting another user's password
  // bypasses the current-password re-authentication that `/users/me/password`
  // demands, so it must be grantable independently of ordinary profile edits.
  'resetPassword',
  // Handing out roles is how privilege escalation happens.
  'assignRole',
  // Withdrawing a membership's access without ending the relationship.
  // Separate from `update` because it revokes authority, and separate from
  // `delete` because it is reversible.
  'suspend',
  // Moving ownership of a workspace to another member. The single most
  // privileged action inside a tenant, so it is never implied by anything.
  'transferOwnership',
  // Re-running a failed background job. Held by support roles, so it must not
  // ride along with the diagnostic `read` that lets them see the job at all.
  'retry',
  // Removing a queued job. Destructive, so engineers hold it and support
  // does not.
  'cancel',
  // Seeing a job's raw payload, which can contain user-supplied data. This is
  // what makes "sanitized diagnostic visibility" enforceable rather than
  // aspirational: the same endpoint omits `payload` for a caller who can
  // `read` a job but cannot `readPayload` it.
  'readPayload',
  // Signing an account out everywhere.
  'revokeSession',
  // Creating an account that joins the workspace in the same step. Separate
  // from `create WorkspaceMembership` (adding an EXISTING account), because
  // choosing someone's first password is a stronger act than adding them.
  'createAccount',
] as const;
export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

// Subject names are exactly the Prisma model names, plus CASL's `all`
// wildcard. Keeping them identical is what lets `accessibleBy(...).ofType(subject)`
// resolve to that model's Prisma `WhereInput`.
//
// `QueueJob` is the one exception and is deliberate: BullMQ jobs live in Redis,
// not Postgres, so there is no Prisma model to name. It is therefore never
// used with `AbilityScopedQueryService` — only with subject-TYPE checks in the
// guard and explicit `ability.can` checks in the service.
export const AUTHORIZATION_SUBJECTS = [
  'all',
  'User',
  'Workspace',
  'WorkspaceMembership',
  'WorkspaceInvitation',
  'Role',
  'Permission',
  'AppVersion',
  'DeviceToken',
  'AuditLog',
  'QueueJob',
  'Song',
  'Theme',
  'Playlist',
  'BibleTranslation',
] as const;
export type AuthorizationSubject = (typeof AUTHORIZATION_SUBJECTS)[number];

export interface PermissionDefinition {
  readonly action: AuthorizationAction;
  readonly subject: AuthorizationSubject;
  readonly scope: RoleScope;
  readonly ownership: PermissionOwnership;
  readonly description: string;
}

// `platform.user.update.own`, `workspace.workspace_membership.assign_role`,
// `platform.all.manage`. The `.own` suffix is omitted for ANY so the common
// case reads cleanly. This is the `permissions.name` unique key, and the
// identity function shared by the catalog, the seeder, and the integrity check.
export function permissionName(
  definition: Pick<
    PermissionDefinition,
    'scope' | 'action' | 'subject' | 'ownership'
  >,
): string {
  const segments = [
    definition.scope,
    toSnakeCase(definition.subject),
    toSnakeCase(definition.action),
  ];
  if (definition.ownership === PermissionOwnership.OWN) {
    segments.push('own');
  }
  return segments.join('.');
}

// Terse constructors so the catalog below reads as a table rather than as
// a wall of object literals.
const platform = (
  action: AuthorizationAction,
  subject: AuthorizationSubject,
  ownership: PermissionOwnership,
  description: string,
): PermissionDefinition => ({
  action,
  subject,
  scope: RoleScope.PLATFORM,
  ownership,
  description,
});

// Workspace-scoped permissions are always ANY: their condition is the tenant
// (supplied from the caller's `workspace_memberships` row), not the acting user.
const workspace = (
  action: AuthorizationAction,
  subject: AuthorizationSubject,
  description: string,
): PermissionDefinition => ({
  action,
  subject,
  scope: RoleScope.WORKSPACE,
  ownership: PermissionOwnership.ANY,
  description,
});

const { OWN, ANY } = PermissionOwnership;

// ── Platform scope: governance ───────────────────────────────────────────
const READ_ANY_USER = platform('read', 'User', ANY, 'View any user account');
const CREATE_ANY_USER = platform('create', 'User', ANY, 'Create user accounts');
const UPDATE_ANY_USER = platform(
  'update',
  'User',
  ANY,
  'Edit any user account',
);
const DELETE_ANY_USER = platform(
  'delete',
  'User',
  ANY,
  'Delete any user account',
);
const RESET_ANY_USER_PASSWORD = platform(
  'resetPassword',
  'User',
  ANY,
  "Reset another user's password without their current password",
);
const ASSIGN_PLATFORM_ROLE = platform(
  'assignRole',
  'User',
  ANY,
  'Grant or revoke a platform-scope role on a user account',
);
const MANAGE_ANY_DEVICE_TOKEN = platform(
  'manage',
  'DeviceToken',
  ANY,
  "Administer any user's push-notification device tokens",
);
const READ_ANY_AUDIT_LOG = platform(
  'read',
  'AuditLog',
  ANY,
  'View the platform audit trail',
);
const READ_ANY_WORKSPACE = platform(
  'read',
  'Workspace',
  ANY,
  'View any workspace on the platform',
);
// The workspace RECORD only — its name, its owner. A platform account never
// holds a membership, so none of these reaches a workspace's content.
const CREATE_ANY_WORKSPACE = platform(
  'create',
  'Workspace',
  ANY,
  'Create a workspace and name its owner',
);
const UPDATE_ANY_WORKSPACE = platform(
  'update',
  'Workspace',
  ANY,
  "Edit any workspace's profile",
);
const DELETE_ANY_WORKSPACE = platform(
  'delete',
  'Workspace',
  ANY,
  'Delete any workspace',
);
const TRANSFER_ANY_WORKSPACE_OWNERSHIP = platform(
  'transferOwnership',
  'Workspace',
  ANY,
  "Replace any workspace's owner",
);
const MANAGE_ANY_APP_VERSION = platform(
  'manage',
  'AppVersion',
  ANY,
  'Publish and edit mobile app version records',
);

// ── Platform scope: support operations ───────────────────────────────────
// Each is a narrow, named capability rather than a slice of `update User`,
// so app support can act on an account without being able to change its
// email — which is account takeover wearing a helpful hat.
const REVOKE_ANY_USER_SESSION = platform(
  'revokeSession',
  'User',
  ANY,
  'Sign any account out of every device',
);

// ── Platform scope: technical diagnostics ────────────────────────────────
const READ_ANY_QUEUE_JOB = platform(
  'read',
  'QueueJob',
  ANY,
  'Inspect background jobs and queue depth (payloads redacted)',
);
const READ_ANY_QUEUE_JOB_PAYLOAD = platform(
  'readPayload',
  'QueueJob',
  ANY,
  "View a background job's raw payload, which may contain user data",
);
const RETRY_ANY_QUEUE_JOB = platform(
  'retry',
  'QueueJob',
  ANY,
  'Re-run a failed background job',
);
const CANCEL_ANY_QUEUE_JOB = platform(
  'cancel',
  'QueueJob',
  ANY,
  'Remove a pending background job',
);

// ── Platform scope: the shared vocabulary ────────────────────────────────
// The role/permission catalogue is not sensitive — it is a vocabulary, much
// like `GET /enums`. Every authenticated user can read it, because a workspace
// owner needs a `roleId` before they can add anyone to their roster.
const READ_ROLE = platform('read', 'Role', ANY, 'List the available roles');
const READ_PERMISSION = platform(
  'read',
  'Permission',
  ANY,
  'List the permissions a role grants',
);

// ── Platform scope: cross-tenant investigation ───────────────────────────
// Reading memberships and invitations platform-wide is how an engineer
// answers "why can this person see that workspace?". It grants no authority
// to CHANGE anything.
const READ_ANY_WORKSPACE_MEMBERSHIP = platform(
  'read',
  'WorkspaceMembership',
  ANY,
  'View any workspace membership across every tenant',
);
const READ_ANY_WORKSPACE_INVITATION = platform(
  'read',
  'WorkspaceInvitation',
  ANY,
  'View any workspace invitation across every tenant',
);

// ── Platform scope: intrinsic self-service ───────────────────────────────
// Ownership-scoped, so each compiles to a rule conditioned on the caller's own
// id. These are granted to NO role — see AUTHENTICATED_USER_PERMISSIONS.
const READ_OWN_USER = platform('read', 'User', OWN, 'View your own profile');
const UPDATE_OWN_USER = platform(
  'update',
  'User',
  OWN,
  'Edit your own profile',
);
const DELETE_OWN_USER = platform(
  'delete',
  'User',
  OWN,
  'Delete your own account',
);
const MANAGE_OWN_DEVICE_TOKEN = platform(
  'manage',
  'DeviceToken',
  OWN,
  'Register and remove your own push-notification device tokens',
);
const READ_OWN_WORKSPACE_MEMBERSHIP = platform(
  'read',
  'WorkspaceMembership',
  OWN,
  'See which workspaces you belong to, and in what capacity',
);

// ── Workspace scope ───────────────────────────────────────────────────────
// Note the absence of any `manage` grant in this whole section. Every verb is
// spelled out, including on WORKSPACE_OWNER, because `manage WorkspaceMembership`
// would silently include `assignRole`, `suspend`, and `transferOwnership`.
const READ_WORKSPACE = workspace('read', 'Workspace', 'View the workspace');
const UPDATE_WORKSPACE = workspace(
  'update',
  'Workspace',
  'Edit the workspace profile and settings',
);
const DELETE_WORKSPACE = workspace(
  'delete',
  'Workspace',
  'Delete the workspace',
);
const TRANSFER_WORKSPACE_OWNERSHIP = workspace(
  'transferOwnership',
  'Workspace',
  'Hand ownership of the workspace to another active member',
);

const READ_WORKSPACE_MEMBERSHIP = workspace(
  'read',
  'WorkspaceMembership',
  'View the workspace roster',
);
const CREATE_WORKSPACE_MEMBERSHIP = workspace(
  'create',
  'WorkspaceMembership',
  'Add an existing user to the workspace roster',
);
const UPDATE_WORKSPACE_MEMBERSHIP = workspace(
  'update',
  'WorkspaceMembership',
  'Edit a roster entry (staff notes)',
);
const DELETE_WORKSPACE_MEMBERSHIP = workspace(
  'delete',
  'WorkspaceMembership',
  'End a membership, removing the person from the workspace',
);
const ASSIGN_ROLE_WORKSPACE_MEMBERSHIP = workspace(
  'assignRole',
  'WorkspaceMembership',
  "Change a member's role within the workspace (bounded by the rank guard)",
);
const SUSPEND_WORKSPACE_MEMBERSHIP = workspace(
  'suspend',
  'WorkspaceMembership',
  "Suspend or reactivate a member's access without ending the membership",
);
const CREATE_ACCOUNT_WORKSPACE_MEMBERSHIP = workspace(
  'createAccount',
  'WorkspaceMembership',
  'Create an account for a new person, who joins the workspace (bounded by the rank guard)',
);

const READ_WORKSPACE_INVITATION = workspace(
  'read',
  'WorkspaceInvitation',
  'View pending invitations to the workspace',
);
const CREATE_WORKSPACE_INVITATION = workspace(
  'create',
  'WorkspaceInvitation',
  'Invite someone to join the workspace',
);
const DELETE_WORKSPACE_INVITATION = workspace(
  'delete',
  'WorkspaceInvitation',
  'Revoke a pending invitation',
);

// ── Platform scope: Bible translations ───────────────────────────────────
// Shared by the whole installation (a church's licence covers its branches),
// so every signed-in person reads them. Importing and deleting one is the
// platform admin's job.
const READ_BIBLE_TRANSLATION = platform(
  'read',
  'BibleTranslation',
  ANY,
  'View and download the installation’s published Bible translations',
);
const CREATE_BIBLE_TRANSLATION = platform(
  'create',
  'BibleTranslation',
  ANY,
  'Import a Bible translation for the whole installation',
);
const DELETE_BIBLE_TRANSLATION = platform(
  'delete',
  'BibleTranslation',
  ANY,
  'Delete a Bible translation from the installation',
);

// ── Workspace scope: worship content ─────────────────────────────────────
// Reading is what every member needs to present and to synchronise a laptop;
// editing the library is a separate, narrower grant.
const READ_SONG = workspace(
  'read',
  'Song',
  "View and synchronise the workspace's songs",
);
const CREATE_SONG = workspace('create', 'Song', 'Add songs to the library');
const UPDATE_SONG = workspace(
  'update',
  'Song',
  "Edit or archive the library's songs",
);
const DELETE_SONG = workspace(
  'delete',
  'Song',
  'Delete songs from the library',
);
const READ_THEME = workspace(
  'read',
  'Theme',
  "View and synchronise the workspace's themes",
);
const CREATE_THEME = workspace('create', 'Theme', 'Add themes');
const UPDATE_THEME = workspace(
  'update',
  'Theme',
  "Edit the workspace's themes and choose its default",
);
const DELETE_THEME = workspace('delete', 'Theme', 'Delete themes');
const READ_PLAYLIST = workspace(
  'read',
  'Playlist',
  "View and synchronise the workspace's playlists",
);
const CREATE_PLAYLIST = workspace('create', 'Playlist', 'Plan services');
const UPDATE_PLAYLIST = workspace(
  'update',
  'Playlist',
  "Edit the workspace's playlists",
);
const DELETE_PLAYLIST = workspace('delete', 'Playlist', 'Delete playlists');

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  READ_ANY_USER,
  CREATE_ANY_USER,
  UPDATE_ANY_USER,
  DELETE_ANY_USER,
  RESET_ANY_USER_PASSWORD,
  ASSIGN_PLATFORM_ROLE,
  MANAGE_ANY_DEVICE_TOKEN,
  READ_ANY_AUDIT_LOG,
  READ_ANY_WORKSPACE,
  CREATE_ANY_WORKSPACE,
  UPDATE_ANY_WORKSPACE,
  DELETE_ANY_WORKSPACE,
  TRANSFER_ANY_WORKSPACE_OWNERSHIP,
  MANAGE_ANY_APP_VERSION,
  REVOKE_ANY_USER_SESSION,
  READ_ANY_QUEUE_JOB,
  READ_ANY_QUEUE_JOB_PAYLOAD,
  RETRY_ANY_QUEUE_JOB,
  CANCEL_ANY_QUEUE_JOB,
  READ_ROLE,
  READ_PERMISSION,
  READ_ANY_WORKSPACE_MEMBERSHIP,
  READ_ANY_WORKSPACE_INVITATION,
  READ_OWN_USER,
  UPDATE_OWN_USER,
  DELETE_OWN_USER,
  MANAGE_OWN_DEVICE_TOKEN,
  READ_OWN_WORKSPACE_MEMBERSHIP,
  READ_WORKSPACE,
  UPDATE_WORKSPACE,
  DELETE_WORKSPACE,
  TRANSFER_WORKSPACE_OWNERSHIP,
  READ_WORKSPACE_MEMBERSHIP,
  CREATE_WORKSPACE_MEMBERSHIP,
  UPDATE_WORKSPACE_MEMBERSHIP,
  DELETE_WORKSPACE_MEMBERSHIP,
  ASSIGN_ROLE_WORKSPACE_MEMBERSHIP,
  SUSPEND_WORKSPACE_MEMBERSHIP,
  CREATE_ACCOUNT_WORKSPACE_MEMBERSHIP,
  READ_WORKSPACE_INVITATION,
  CREATE_WORKSPACE_INVITATION,
  DELETE_WORKSPACE_INVITATION,
  READ_SONG,
  CREATE_SONG,
  UPDATE_SONG,
  DELETE_SONG,
  READ_THEME,
  CREATE_THEME,
  UPDATE_THEME,
  DELETE_THEME,
  READ_PLAYLIST,
  CREATE_PLAYLIST,
  UPDATE_PLAYLIST,
  DELETE_PLAYLIST,
  READ_BIBLE_TRANSLATION,
  CREATE_BIBLE_TRANSLATION,
  DELETE_BIBLE_TRANSLATION,
] as const;

// ─────────────────────────────────────────────────────────────────────────
// What EVERY authenticated caller can do, with no role of any kind.
//
// These are intrinsic rather than a role, and the distinction is the design.
// A role granted to every account at signup, which nothing may then revoke, is
// not a role — it is a baseline wearing a role's clothes. It costs a
// `user_roles` row per user, a special case in the revoke path to stop anyone
// breaking an account by taking it away, and a permanent lie in every
// "which roles does this user have?" answer.
//
// `AbilityFactory` injects these unconditionally, so an account with no
// platform role and zero workspace memberships is fully valid and can still
// manage itself.
//
// These stay in PERMISSION_CATALOG so `GET /permissions` and the boot-time
// integrity check still see them, but they are granted by NO role — a role
// that granted one would be redundant, and `permission-catalog.spec.ts`
// asserts none does.
//
// NOTHING TENANT-SCOPED BELONGS HERE. Every entry is ownership-scoped to the
// caller's own id, or is a read of the shared role/permission vocabulary.
// Creating a workspace is NOT here: on a Pakita server only the platform admin
// starts a church, naming its owner (`CREATE_ANY_WORKSPACE`).
// ─────────────────────────────────────────────────────────────────────────
export const AUTHENTICATED_USER_PERMISSIONS: readonly PermissionDefinition[] = [
  READ_OWN_USER,
  UPDATE_OWN_USER,
  DELETE_OWN_USER,
  MANAGE_OWN_DEVICE_TOKEN,
  READ_OWN_WORKSPACE_MEMBERSHIP,
  // Needed to pick a `roleId` when inviting someone to a workspace.
  READ_ROLE,
  READ_PERMISSION,
  // Every member presents Bible passages.
  READ_BIBLE_TRANSLATION,
] as const;

export interface RoleDefinition {
  readonly scope: RoleScope;
  // Orders roles for the escalation guard ONLY: you may assign a role at or
  // below your own rank, never one above it. It does NOT imply inherited
  // permissions — every role's grants are listed explicitly below. Conflating
  // "outranks" with "inherits" is how RBAC systems rot.
  readonly rank: number;
  readonly description: string;
  readonly permissions: readonly PermissionDefinition[];
}

export const ROLE_DEFINITION_CATALOG: Readonly<
  Record<SeededRoleName, RoleDefinition>
> = {
  // ── Platform ───────────────────────────────────────────────────────────
  [SeededRoleName.PLATFORM_ADMIN]: {
    scope: RoleScope.PLATFORM,
    rank: 100,
    // Every verb named, and nothing inside a workspace: no songs, themes or
    // playlists, and no roster or invitation writes. A platform account never
    // belongs to a church; its owner and admins run it. What the admin keeps
    // over a workspace is its record — create it naming an owner, rename it,
    // replace its owner, delete it — and the read-only roster view every
    // platform role has for "who belongs where".
    description:
      'Platform governance: accounts, platform roles, workspaces and their owners, Bible translations, audit',
    permissions: [
      READ_ANY_USER,
      CREATE_ANY_USER,
      UPDATE_ANY_USER,
      DELETE_ANY_USER,
      RESET_ANY_USER_PASSWORD,
      ASSIGN_PLATFORM_ROLE,
      REVOKE_ANY_USER_SESSION,
      MANAGE_ANY_DEVICE_TOKEN,
      READ_ANY_AUDIT_LOG,
      MANAGE_ANY_APP_VERSION,
      READ_ANY_QUEUE_JOB,
      READ_ANY_QUEUE_JOB_PAYLOAD,
      RETRY_ANY_QUEUE_JOB,
      CANCEL_ANY_QUEUE_JOB,
      READ_ANY_WORKSPACE,
      CREATE_ANY_WORKSPACE,
      UPDATE_ANY_WORKSPACE,
      DELETE_ANY_WORKSPACE,
      TRANSFER_ANY_WORKSPACE_OWNERSHIP,
      READ_ANY_WORKSPACE_MEMBERSHIP,
      READ_ANY_WORKSPACE_INVITATION,
      CREATE_BIBLE_TRANSLATION,
      DELETE_BIBLE_TRANSLATION,
    ],
  },
  [SeededRoleName.PLATFORM_ENGINEER]: {
    scope: RoleScope.PLATFORM,
    rank: 90,
    // Rank 90 is an ASSIGNMENT CEILING, not an inheritance chain. Engineers
    // outrank both support roles, and still cannot do a single thing this
    // list does not name — most importantly ASSIGN_PLATFORM_ROLE, which is
    // absent on purpose. An engineer who could grant roles could grant
    // themselves PLATFORM_ADMIN, and the split between technical authority
    // and governance authority would be decorative.
    description:
      'Highest technical authority: diagnostics, queue and worker investigation, controlled recovery, release operations',
    permissions: [
      READ_ANY_USER,
      READ_ANY_WORKSPACE,
      READ_ANY_AUDIT_LOG,
      MANAGE_ANY_APP_VERSION,
      READ_ANY_QUEUE_JOB,
      READ_ANY_QUEUE_JOB_PAYLOAD,
      RETRY_ANY_QUEUE_JOB,
      CANCEL_ANY_QUEUE_JOB,
      // Tenant-isolation investigation: see who belongs where, change nothing.
      READ_ANY_WORKSPACE_MEMBERSHIP,
      READ_ANY_WORKSPACE_INVITATION,
      // NOTE: no READ_ROLE / READ_PERMISSION here. Every authenticated caller
      // already holds them intrinsically, so listing them would compile a
      // second identical CASL rule into every engineer's ability — harmless in
      // outcome, but it bloats the `where` clauses and the packed rule set sent
      // to clients, and it invites the reader to think engineers have some
      // catalog access others lack. `permission-catalog.spec.ts` asserts no
      // role grants an intrinsic permission.
    ],
  },
  [SeededRoleName.PLATFORM_TECHNICAL_SUPPORT]: {
    scope: RoleScope.PLATFORM,
    rank: 60,
    // Note what is missing against PLATFORM_ENGINEER: no
    // READ_ANY_QUEUE_JOB_PAYLOAD (so payloads are redacted in the response),
    // no CANCEL_ANY_QUEUE_JOB (destructive), no app-version authority, no
    // role governance. Retry is the one write it holds, and it is idempotent
    // by the queue's own contract.
    description:
      'Escalated technical support: incident investigation, sanitized diagnostics, approved retries',
    // NOTE the absence of READ_ANY_AUDIT_LOG. The audit trail carries IP
    // addresses, user agents, parsed device fingerprints, and — behind
    // Cloudflare — geolocation, for every account on the platform. That is
    // surveillance-grade data, and "support might need it" is not a reason to
    // hand it to the two most widely-staffed roles by default.
    //
    // Queue diagnostics answer the questions support actually has (what failed,
    // why, retry it) without exposing who did what from where. A project that
    // genuinely needs support-side audit visibility should add a SANITIZED
    // endpoint — whitelisted fields, restricted event types, server-side
    // filtering — rather than granting this permission.
    permissions: [
      READ_ANY_USER,
      READ_ANY_WORKSPACE,
      READ_ANY_QUEUE_JOB,
      RETRY_ANY_QUEUE_JOB,
      READ_ANY_WORKSPACE_MEMBERSHIP,
    ],
  },
  [SeededRoleName.PLATFORM_APP_SUPPORT]: {
    scope: RoleScope.PLATFORM,
    rank: 40,
    // Customer-facing. Holds narrow act-on-account capabilities and no
    // general UPDATE_ANY_USER: resending a link or ending sessions helps the
    // owner, whereas editing their email takes the account from them.
    description:
      'Customer-facing support: account visibility and session revocation',
    // Also without READ_ANY_AUDIT_LOG — see the note on
    // PLATFORM_TECHNICAL_SUPPORT above. This role is the widest-staffed one on
    // the platform and is the least appropriate place for a firehose of other
    // people's IP addresses and device fingerprints.
    permissions: [
      READ_ANY_USER,
      READ_ANY_WORKSPACE,
      READ_ANY_WORKSPACE_MEMBERSHIP,
      REVOKE_ANY_USER_SESSION,
    ],
  },

  // ── Workspace ───────────────────────────────────────────────────────────
  [SeededRoleName.WORKSPACE_OWNER]: {
    scope: RoleScope.WORKSPACE,
    rank: 100,
    // Explicit verbs, NOT `manage Workspace`/`manage WorkspaceMembership`. The
    // owner genuinely holds everything listed here, so `manage` would be
    // equivalent TODAY — and would silently grant whatever action is added to
    // the vocabulary NEXT, without anyone reviewing that decision.
    description: 'Owns the workspace. Every capability within it, named',
    permissions: [
      READ_WORKSPACE,
      UPDATE_WORKSPACE,
      DELETE_WORKSPACE,
      TRANSFER_WORKSPACE_OWNERSHIP,
      READ_WORKSPACE_MEMBERSHIP,
      CREATE_WORKSPACE_MEMBERSHIP,
      UPDATE_WORKSPACE_MEMBERSHIP,
      DELETE_WORKSPACE_MEMBERSHIP,
      ASSIGN_ROLE_WORKSPACE_MEMBERSHIP,
      SUSPEND_WORKSPACE_MEMBERSHIP,
      CREATE_ACCOUNT_WORKSPACE_MEMBERSHIP,
      READ_WORKSPACE_INVITATION,
      CREATE_WORKSPACE_INVITATION,
      DELETE_WORKSPACE_INVITATION,
      READ_SONG,
      CREATE_SONG,
      UPDATE_SONG,
      DELETE_SONG,
      READ_THEME,
      CREATE_THEME,
      UPDATE_THEME,
      DELETE_THEME,
      READ_PLAYLIST,
      CREATE_PLAYLIST,
      UPDATE_PLAYLIST,
      DELETE_PLAYLIST,
    ],
  },
  [SeededRoleName.WORKSPACE_ADMIN]: {
    scope: RoleScope.WORKSPACE,
    rank: 70,
    // Owner minus DELETE_WORKSPACE and TRANSFER_WORKSPACE_OWNERSHIP. It holds
    // ASSIGN_ROLE_WORKSPACE_MEMBERSHIP, but rank 70 < 100 means the rank guard
    // refuses to let it hand out WORKSPACE_OWNER — to anyone, including itself.
    description: 'Administers the workspace and its roster, below the owner',
    permissions: [
      READ_WORKSPACE,
      UPDATE_WORKSPACE,
      READ_WORKSPACE_MEMBERSHIP,
      CREATE_WORKSPACE_MEMBERSHIP,
      UPDATE_WORKSPACE_MEMBERSHIP,
      DELETE_WORKSPACE_MEMBERSHIP,
      ASSIGN_ROLE_WORKSPACE_MEMBERSHIP,
      SUSPEND_WORKSPACE_MEMBERSHIP,
      CREATE_ACCOUNT_WORKSPACE_MEMBERSHIP,
      READ_WORKSPACE_INVITATION,
      CREATE_WORKSPACE_INVITATION,
      DELETE_WORKSPACE_INVITATION,
      READ_SONG,
      CREATE_SONG,
      UPDATE_SONG,
      DELETE_SONG,
      READ_THEME,
      CREATE_THEME,
      UPDATE_THEME,
      DELETE_THEME,
      READ_PLAYLIST,
      CREATE_PLAYLIST,
      UPDATE_PLAYLIST,
      DELETE_PLAYLIST,
    ],
  },
  [SeededRoleName.WORKSPACE_MANAGER]: {
    scope: RoleScope.WORKSPACE,
    rank: 40,
    description:
      'Runs day-to-day operations; can grow the roster but not assign roles or suspend anyone',
    permissions: [
      READ_WORKSPACE,
      UPDATE_WORKSPACE,
      READ_WORKSPACE_MEMBERSHIP,
      CREATE_WORKSPACE_MEMBERSHIP,
      READ_WORKSPACE_INVITATION,
      CREATE_WORKSPACE_INVITATION,
      READ_SONG,
      CREATE_SONG,
      UPDATE_SONG,
      DELETE_SONG,
      READ_THEME,
      CREATE_THEME,
      UPDATE_THEME,
      DELETE_THEME,
      READ_PLAYLIST,
      CREATE_PLAYLIST,
      UPDATE_PLAYLIST,
      DELETE_PLAYLIST,
    ],
  },
  [SeededRoleName.WORKSPACE_STAFF]: {
    scope: RoleScope.WORKSPACE,
    rank: 20,
    // Presents services: reads (and so synchronises) the library, its themes and
    // playlists; edits nothing.
    description: 'Works here. Reads the workspace, its roster and its library',
    permissions: [
      READ_WORKSPACE,
      READ_WORKSPACE_MEMBERSHIP,
      READ_SONG,
      READ_THEME,
      READ_PLAYLIST,
    ],
  },
};
