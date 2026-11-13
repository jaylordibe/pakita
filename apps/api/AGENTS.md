# AGENTS.md

Repository truth for every coding agent. Keep it short: only what applies to
most changes. The reasoning behind each rule lives in
[`docs/engineering-conventions.md`](docs/engineering-conventions.md);
situational playbooks live in `.claude/skills/` and `docs/`.

Engineering methodology (gates, risk tiers, evidence language, review lenses,
`/himoa:work-item`) comes from the `himoa` plugin and is not restated here.
**Where a framework standard conflicts with this file, this file wins.** It
also supersedes any parent-workspace `CLAUDE.md`. No `tasks/` directory; a
correction worth keeping becomes an edit here.

**This file holds rules, not history.** Add a rule only when a change alters
something most changes need; feature detail belongs in the code, its tests and
`docs/`, and what changed and when belongs in the commit history.

## Project

NestJS 12 (TypeScript, Express) + Prisma 7 + PostgreSQL + Redis + BullMQ.
JWT auth with DB-backed RBAC + CASL over two scopes (PLATFORM / WORKSPACE).
Unversioned `/api/...`; Swagger at `/api/docs`. Package manager: pnpm, from the workspace root (one
`pnpm-lock.yaml` there; see the root `AGENTS.md`).

Pakita's API, created once from the `nestjs-api` template (commit in the
root `NOTICE`) and not kept in sync with it. `SERVICE_NAME` (`pakita`) drives
the DB name, container names and JWT `iss`/`aud`.

Cloud-provider neutral by construction; `docs/deployment/README.md` owns the
runtime contract. One image, two runtimes: `QUEUE_WORKER_ENABLED=false` +
`dist/main.js` (API) or `true` + `dist/worker.js` (worker). Locally one
process does both.

## Canonical commands

| Purpose | Command | Notes |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | |
| Build + type check | `pnpm build` | `nest build` typechecks |
| Lint / format check | `pnpm lint` | Evidence is `lint`, never `lint:fix`; Prettier runs inside it |
| Lint (apply fixes) | `pnpm lint:fix` | Closing step only |
| Unit tests | `pnpm test` | |
| Integration / e2e tests | `pnpm test:e2e` | Starts the test stack itself |
| Single e2e spec | `pnpm test:e2e <pattern>` | The cadence during implementation |
| Migration status | `pnpm prisma migrate status` | Read-only |
| Apply migrations (local) | `pnpm prisma:deploy` | Committed migrations only; never mid-work |
| RBAC catalog check | `pnpm rbac:check` | Read-only; `rbac:sync` writes |
| Security scan | `pnpm audit --audit-level moderate` | Run at the workspace root; the CI gate adds the root `.github/scripts/audit-gate.mjs` |
| Run locally | `pnpm start:dev` | Stacks: `pnpm stack:up` / `pnpm stack:down` |
| Export the OpenAPI contract | `pnpm openapi:export` | Writes `openapi.json` from the build; needs no database. CI fails when it is stale |

Every change: `pnpm build` + `pnpm lint` + the affected e2e specs. Full
`pnpm test:e2e` only when a module is complete or on request.

`pnpm build` type-checks `src/` only. After changing a shared DTO, fixture or
seeder, run `npx tsc --noEmit -p tsconfig.json` and compare with the errors
the branch already had. A feature without e2e coverage of its contract is not
done; update stale assertions instead of adding duplicates.

## High-risk paths

| Path pattern | Why |
|---|---|
| `src/modules/auth/*` | Authentication and tokens |
| `src/modules/authorization/*`, `src/common/authorization/*` | RBAC, CASL, tenant isolation |
| `src/common/errors/*` | The `errorCode` contract clients program against |
| `src/modules/queue-admin/*` | Privileged retry/cancel over every tenant's jobs |
| `prisma/schema.prisma`, `prisma/migrations/*` | Schema and applied migrations |
| `../../.claude/settings.json` (workspace root) | The committed permission rules; an unmatched rule is a hole |
| `eslint.config.mjs` | Tenant-isolation, layering and error guardrails; block order can silently disable a rule |

## Architecture

```
src/
  telemetry.ts   OpenTelemetry bootstrap; imported right after the time-zone pin
  main.ts        HTTP entrypoint: configureHttpApp + listen
  configure-http-app.ts  the HTTP edge (helmet, /api prefix, CORS, trust
                 proxy, gated Swagger under /api/docs); the e2e harness uses it
  worker.ts      queue-only entrypoint into the same AppModule
  app.module.ts  global pipe, serializer, one exception filter, throttler +
                 JWT + permissions guards
  config/        configuration.ts (typed) + env.validation.ts (Joi)
  prisma/        PrismaService + soft-delete extension
  common/        leaf layer: authorization catalog, audit, constants,
                 decorators, dto, enums, errors, filters,
                 storage, queue, redis, logging, telemetry, util
  modules/       feature modules; authorization/ holds the global guard,
                 AbilityScopedQueryService and the boot-time integrity gates
prisma/          schema, migrations, seed.ts + rbac-seeder.ts, scripts/
                 (one-off), seeds/ (JSON inputs; empty in the template)
test/            e2e specs + setup/ (global DB setup, worker isolation)
```

## Cross-cutting conventions

- **Naming (ESLint `id-length` + `id-denylist`):** full words everywhere,
  including loop variables, callbacks and declared names. No `i`/`j`, no
  `req`/`res`, no truncated morphemes (`Ack`, `Msg`, `Svc`). Allowed:
  `id`, `dto`, `url`, `db`, `ttl`, `jwt`, `otp`, `ip`, `to`, `_`, generic
  `T`/`K`/`V`.
- **Booleans:** start with `is` everywhere — DB columns are `is_…`
  (`is_active`, `is_force_update`), request/response fields and TS
  properties `is…` (`isActive`, `isForceUpdate`) and config keys
  (`isWorkerEnabled`), with no exception.
- **Placement:** services hold behaviour. Static tables go to a co-located
  config module; pure helpers to `src/common/util/*.util.ts` with a spec.
  Delete what you replace; no parallel implementations.
- **Layering:** `src/common/` never imports from `src/modules/` (ESLint).
- **Errors:** throw via the `Errors.*` factory (ESLint-enforced). Clients read
  `errorCode`, never `message`. Prisma errors are mapped once in
  `GlobalExceptionFilter`; services don't catch them.
- **Validation:** whitelist + `forbidNonWhitelisted`; extra fields → 400.
  Boolean query filters need `@Transform(toOptionalBoolean)`.
- **Datetimes:** timestamps use `@IsUtcIsoString()`, date-only fields
  `@IsDateString()`. The API pins its own process zone to UTC (see the
  conventions doc, "Datetime inputs").
- **Responses:** always `new <Resource>ResponseDto(row)`, never raw Prisma
  rows. Sensitive fields need both `@Exclude()` and `@ApiHideProperty()`.
- **Schema:** no allowed-value lists in the database: no DB enum types and
  no `CHECK (column IN (...))`. A column's allowed values live once, in a TS
  enum (`src/common/enums/`) or constant, validated with `@IsEnum()`/`@IsIn()`,
  so a new value needs no migration. A `CHECK` states only an invariant: a
  range, a pairing, or a rule between columns. Every column `@map`s to
  snake_case. A foreign key names the model it references in full:
  `<model>_id` and `<model>Id` (`workspace_id`, `role_id`), never a short
  stand-in (`member_id` for a `WorkspaceMembership`). A key that holds a row
  in a role names the role, then the model (`invited_user_id`); audit actors
  keep `…By`.
- **Authorization:** `JwtAuthGuard` + `PermissionsGuard` are global. Every
  handler declares exactly one of `@Public()` / `@AuthenticatedOnly()` /
  `@RequirePermission()`, or boot fails. The permission catalog in
  `src/common/authorization/permission-catalog.ts` is the source; the DB
  projects it. The JWT carries `{ sub, jti }` only.
- **Tenant isolation lives in the query:** scope reads through
  `AbilityScopedQueryService`; never import `@casl/prisma` elsewhere
  (ESLint). 404 when the caller cannot read, 403 when they can read but not
  act. `PermissionCheckService` is only for derived ownership needing a join.
- **Audit fields:** mutating service methods take `actorId` and write
  `createdBy`/`updatedBy`. Privileged actions go through `AuditService.record`.
- **Soft delete:** `prisma.scoped.*` filters top-level reads only; nested
  includes need explicit filters (ESLint bans bare `user: true` /
  `workspace: true`). Never a security boundary.
- **Prisma filters:** one `where` object holds one `OR`; a second (often
  arriving through a spread) silently replaces the first. Combine conditions
  that each carry an `OR` with `AND: [...]`.
- **Partial-unique columns** (`users.email`, `users.username`,
  `workspaces.slug`): look up with `findFirst`, never `findUnique`.
- **Lists:** five standard endpoints; read handlers are `findPaginated` /
  `findById`, one resource per controller, no unpaginated `GET /all`,
  `perPage` clamped to 100.
- **Config:** `configService.getOrThrow()` only; no `process.env` outside
  `configuration.ts` (exceptions: `src/telemetry.ts`, and the process time
  zone — see the conventions doc, "Datetime inputs").
  A new env var goes in `configuration.ts`, `env.validation.ts`,
  `.env.example`, `.env.test` (when tests need a value) and the runtime
  contract in `docs/deployment/README.md`; unset defaults to safe.
- **Swagger:** paginated handlers use `@ApiPaginatedResponse(T)`; others need
  an explicit `@ApiOkResponse`/`@ApiCreatedResponse({ type })`. Mapped types
  import from `@nestjs/swagger`. DTO JSDoc is the published API description
  (`introspectComments`): a `//` comment directly above a JSDoc block drops
  it silently.
- **No outside services:** the API sends no email or text and uses no bot
  check, so a church self-hosts it with no outside account. Accounts are
  created by an administrator (`POST /users`); there is no public sign-up.
  Do not add a route that depends on proving an address or a number.
- **Rate limiting:** every `@Public()` endpoint gets its own `@Throttle`.
  Every password sign-in goes through `AuthService.verifyCredentials`, which
  also limits failed sign-ins per account from every address
  (`SignInFailureLimitService`); the `auth-security` skill has the numbers.
- **Logging:** pino to stdout only; for a new secret extend
  `buildRedactPaths()` (headers) or `redactUrlSecrets` (query strings).
  Request bodies are never logged.
- **Health indicators** log the real error and return a fixed string.
- **Providers:** storage adapters are selected by env; a provider SDK is
  imported only by its own adapter. Store `storageKey`, never a URL;
  authorize before issuing a signed URL.
- **Files:** resource endpoints stay JSON; a file is uploaded with
  `POST /files` and attached by id through `FilesService` inside the domain's
  transaction (`docs/file-uploads.md`). No other route takes multipart.
- **Redis:** build every client from `buildRedisConnectionOptions`.
- **Background work:** BullMQ only, and by default: work the response does
  not need (every notification, side-effect call, unbounded loop) is
  enqueued, never run inline. A side effect the change must not lose (a
  push to a user, an outbound webhook) is an outbox:
  a row written in the same transaction as the change, enqueued after the
  commit, and re-queued by a sweep if its job is lost. Never reintroduce
  `@nestjs/schedule`. Consumers tolerate duplicate delivery and keep
  `correlationId`.
- **Cycles:** `forwardRef` in both the import and the `@Inject`.
- **TypeScript:** decorated signatures need `import type`
  (`isolatedModules`); cast DB strings to enums before comparing.

## Non-obvious invariants

- **Two local stacks:** dev (5433/6378, `.env`) and test (5434/6380,
  `.env.test`). e2e runs a real `DROP DATABASE`; never point it at dev.
- **`.env.test` is the only test config.** Under `NODE_ENV=test` the app
  never reads `.env`, and env validation refuses a real outside provider:
  tests never call a billed or outbound service. Never add a value to a
  workflow that `.env.test` already declares.
- **e2e runs in parallel** with per-worker databases and Redis logical DBs;
  a spec never assumes exclusive access outside its own database.
- **Only `QueueWorkerRegistrar` registers BullMQ workers**, gated on
  `QUEUE_WORKER_ENABLED`. No per-processor start/stop; never touch
  `this.worker` outside `startConsuming()`.
- **The local dev DB holds the user's data.** Never reset, drop or re-seed it
  without explicit permission.
- **Never apply migrations during in-progress work.** `pnpm build` verifies
  schema changes. Consolidate into one migration and let the user apply it.
  If applied by mistake, un-apply surgically; never `migrate reset`.
- **Never edit an applied migration** in a project built from this template:
  add a new one. In the template itself nothing is applied — a project copies
  it once and never syncs back — so fold a schema change into the migration
  that owns the table and keep no upgrade path for existing projects.
  A migration's folder is `YYYYMMDDHHMMSS_<what_it_does>`, never a ticket key.
- **Storage adapters are `require`d lazily**; don't convert to static imports.
  No adapter accepts a long-lived cloud credential.
- **The workspace-root `.claude/settings.json` is the only enforcement layer.** Mirror every
  `Bash(...)` rule as `PowerShell(...)`; see the conventions doc before
  editing it.

## Consumers

| Consumer | Repository / location | Audience | Owner |
|---|---|---|---|
| Pakita desktop | `apps/desktop` (this repository) | The operator and projector app; its API types are generated from the committed `openapi.json` | jaylordibe |

A contract change (DTO field, `errorCode`, enum value,
status, nullability, pagination, event payload) is done only when every
consumer is updated or recorded as unaffected, with the deploy order stated.
It also regenerates the committed `openapi.json` (`pnpm openapi:export`),
which the desktop's API types are generated from.
A consumer not updated in the same change gets a handoff naming its
repository, the change and the owner.

## Deep references

| Task | Where |
|---|---|
| Reasoning behind every rule above | `docs/engineering-conventions.md` |
| New CRUD resource | `resource-pattern` skill, `docs/resource-pattern.md` |
| Permissions, roles, tenant isolation | `authorization` skill, `src/common/authorization/README.md` |
| Auth, JWT, sessions, forced password change, sign-in limits | `auth-security` skill |
| e2e specs | `e2e-testing` skill |
| Background work (immediate, delayed, recurring) | `src/common/queue/README.md` |
| File uploads, attaching files to a resource | `docs/file-uploads.md` |
| Error envelope and `ErrorCode` catalog | `src/common/errors/README.md` |
| Deployment contract | `docs/deployment/README.md` |
| MCP endpoint (`/api/mcp`), its OAuth sign-in and adding a tool | `docs/mcp.md` |
| Publishing images | Not yet: the template's `publish-image.yml` returns in Phase 6 (see `docs/README.md`) |
| Which operational controls are enforced | `docs/operations.md` |
