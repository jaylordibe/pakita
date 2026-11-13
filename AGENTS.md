# AGENTS.md

Repository truth for every coding agent working on Pakita, a free, open-source
worship presentation app. This file covers the workspace. Each app's own rules
live in its own `AGENTS.md`, and are not repeated here:

| App | Rules |
|---|---|
| `apps/api` — NestJS + Prisma + PostgreSQL backend, created from the `nestjs-api` template (see `NOTICE`) | [`apps/api/AGENTS.md`](apps/api/AGENTS.md) |
| `apps/desktop` — Electron + Vue operator and projector app | [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |

Engineering methodology (gates, risk tiers, evidence language, review lenses)
comes from the `himoa` plugin. Where it conflicts with an `AGENTS.md`, the
`AGENTS.md` wins.

## Workspace

- **Package manager:** pnpm only, version pinned by `packageManager` in the
  root `package.json`. One lockfile, `pnpm-lock.yaml`, at the root.
- **Node:** 24 (`.nvmrc`, `.node-version`, `engines`).
- **Workspace settings live once, in `pnpm-workspace.yaml`:** the shared tool
  versions (`catalog:`), the 14-day minimum release age, the packages allowed
  to run install scripts (`allowBuilds`), dependency overrides, and
  dependency patches (`patchedDependencies`, files in `patches/`). A patch
  only backports an upstream fix that cannot be upgraded to yet, and its
  comment says when to drop it. A package
  uses `"<name>": "catalog:"` for a catalogued tool, never its own version.
- **A new install-script entry in `allowBuilds`** needs the same reason the
  existing ones have: the package cannot work without the native binary its
  script builds or downloads.
- **After any install that changes dependencies, run
  `pnpm --filter @pakita/api prisma:generate`.** The generated Prisma client
  is written inside pnpm's folder for `@prisma/client`, and that folder's name
  changes when its peer dependencies resolve differently (adding a package to
  either app can do it), leaving the API with no client. The symptom is
  `Cannot find module '.prisma/client/default'`.
- **Start coding agents at the workspace root.** Claude Code reads project
  settings only from the directory a session starts in, so the permission
  rules in `.claude/settings.json` (the only enforcement layer; see
  `apps/api/docs/engineering-conventions.md`) do not apply to a session
  started inside `apps/api` or `apps/desktop`.
- **Formatting:** one `.prettierrc` at the root serves every app.
- **Licence:** AGPL-3.0-or-later (`LICENSE`). `NOTICE` keeps the template's
  MIT notice and its source commit. Every new dependency must have a licence
  compatible with AGPLv3.

## Workspace commands

| Purpose | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Run one app's script | `pnpm --filter @pakita/api <script>` / `pnpm --filter @pakita/desktop <script>` |
| Build, lint or unit-test every app | `pnpm build` / `pnpm lint` / `pnpm test` |

Each app's own commands, and which of them count as evidence, are in its
`AGENTS.md`.

## Cross-app rules

- **The API's OpenAPI document is the contract the desktop consumes.** The
  desktop never hand-writes a type the API already publishes.
- **Live presentation never depends on the network.** The desktop presents
  only content already stored locally. Any change that would make presenting
  wait on a server request is a defect.
- **CI lives at the root** (`.github/workflows/`). GitHub never reads a
  workflow inside an app folder.
- **A release is a version tag** (`v1.2.3`, equal to every `package.json`
  version). `publish-image.yml` publishes the server images (opt-in through the
  `PUBLISH_ENABLED` repository variable); `desktop-release.yml` uploads the
  installers to a draft GitHub release. Pushing a branch releases nothing.
- **A church's server is `deploy/`** (Docker Compose and its install, update,
  backup and restore scripts, `deploy/README.md`). A restore rotates every
  workspace's sync epoch, so laptops resynchronise.
