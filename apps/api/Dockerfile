# syntax=docker/dockerfile:1

# Build from the WORKSPACE ROOT — the lockfile and workspace settings live there:
#
#   docker build -f apps/api/Dockerfile --target runtime .
#   docker build -f apps/api/Dockerfile --target migrate .
#
# The root `.dockerignore` is the ignore list for that context.

# The package managers bundled with the Node base image, listed once here so
# the stages cannot drift. npm (and yarn) ship their own dependency tree with advisories
# image scanners flag even though our lockfile controls the app's real
# dependencies, and nothing in a shipped image runs it. Corepack is what runs
# pnpm (pinned, with its hash, by `packageManager` in the root package.json):
# the runtime image runs `node dist/main.js` directly and deletes it too; the
# migrate image runs package scripts with pnpm and keeps it.
# yarn ships in the image too (/opt/yarn-*) and nothing in Pakita runs it.
ARG BUNDLED_NPM="/usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg"
ARG BUNDLED_COREPACK="/usr/local/lib/node_modules/corepack /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx"

FROM node:24-alpine AS base
WORKDIR /app

FROM base AS deps
# openssl: required by Prisma's schema engine during `migrate deploy`.
# libc6-compat: shim for npm packages that ship glibc-linked prebuilds.
RUN apk add --no-cache libc6-compat openssl && corepack enable pnpm
# Manifests first, so a source-only change reuses the installed layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @pakita/api...

# Build stage keeps the FULL dev toolchain (prisma CLI, nest CLI). The `migrate`
# stage below is built from it and runs `pnpm prisma:deploy`, so it must retain
# devDeps — do NOT prune here.
#
# GIT_SHA is embedded in the RUN command so its value participates in the
# build cache key: every commit produces a unique instruction and forces a
# fresh `pnpm build`. Without it BuildKit can serve a stale `dist/` across
# commits whose source COPY is content-equivalent (e.g. reverts/cherry-picks).
#
# The heap limit is stated because Node's default scales with the machine's
# memory, and `nest build` runs out of heap at 2048 MB but not at 3072 MB: on a
# small VM or CI runner the default is too low. Scoped to this one command, so
# the `migrate` image below does not inherit it.
#
# The generated Prisma client is written next to the installed @prisma/client
# inside pnpm's store, under a hashed folder name; it is copied to one fixed
# path here so the runtime stage can take it without knowing that name.
FROM deps AS build
ARG GIT_SHA=unknown
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN : "git_sha=${GIT_SHA}" \
 && pnpm prisma generate \
 && NODE_OPTIONS=--max-old-space-size=3072 pnpm build \
 && cp -R "$(node -p "require('path').resolve(require.resolve('@prisma/client/package.json'), '../../../.prisma')")" /app/generated-prisma

# Migration image. Schema changes are applied by a SEPARATE, short-lived
# container that runs to completion and exits — never on API startup and never
# on worker startup. Ten API instances booting concurrently would otherwise race
# `migrate deploy` against each other, and an instance whose migration failed
# would restart-loop while the previous release was already stopped.
#
# Run it as whatever the platform calls a run-to-completion container (a job, a
# task, a one-off `docker run`) as a deploy step before the new API revision
# receives traffic. It needs DATABASE_URL and network reach to the database,
# nothing else. pnpm was downloaded and verified at build time; the image never
# fetches it again.
#
# Runs as root, unlike the runtime image below: this stage is the build
# environment, whose `node_modules` is root-owned, and re-chowning it would add
# a full copy of the tree to every build. Acceptable for a container that exists
# for seconds, runs one known command, and serves no traffic — but it is the
# reason this stage must never be used to serve the API.
FROM build AS migrate
ARG BUNDLED_NPM
ENV COREPACK_ENABLE_NETWORK=0
RUN rm -rf ${BUNDLED_NPM}
# BOTH steps, and in this order. The schema migration alone is not a complete
# deploy step: the permission catalog in src/common/authorization is the source
# of truth and the database is its projection, and the application REFUSES TO
# BOOT when the two disagree. A release that adds a permission would therefore
# migrate successfully, report success, and then crash-loop the API and the
# worker — after the previous release had already been replaced. `rbac:sync` is
# idempotent, so running it on every deploy costs nothing when nothing changed.
CMD ["sh", "-c", "pnpm prisma:deploy && pnpm rbac:sync"]

# Pruned production dependencies for the runtime image: `pnpm deploy` writes
# the API's production dependency tree, resolved from the shared lockfile, into
# one self-contained folder. `--ignore-scripts` is safe: bcrypt and sharp load
# the prebuilt binaries their packages ship, and @prisma/client's postinstall
# would try to regenerate against a missing schema here — the generated client
# is copied from the `build` stage instead (see below).
FROM build AS prod-deps
WORKDIR /app
RUN pnpm deploy --filter @pakita/api --prod --ignore-scripts /prod/api

FROM base AS runtime
ENV NODE_ENV=production
# Commit hash baked into the running container (e.g. for a /health/version
# endpoint). `unknown` when the build context didn't pass it (local builds).
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
# tini for proper PID-1 signal handling. The bundled package managers go (see
# the top of this file): we run `node dist/main.js` directly.
ARG BUNDLED_NPM
ARG BUNDLED_COREPACK
RUN apk add --no-cache openssl tini \
 && rm -rf ${BUNDLED_NPM} ${BUNDLED_COREPACK} \
 && addgroup -S app && adduser -S app -G app
COPY --from=prod-deps --chown=app:app /prod/api/node_modules        ./node_modules
# The generated client (see the build stage). @prisma/client requires
# `.prisma/client/default`, which Node finds by walking up to this folder;
# without it `require('@prisma/client')` fails at boot with
# "Cannot find module '.prisma/client/default'".
COPY --from=build     --chown=app:app /app/generated-prisma         ./node_modules/.prisma
COPY --from=build     --chown=app:app /app/apps/api/dist            ./dist
COPY --from=build     --chown=app:app /app/apps/api/package.json    ./package.json
# Strip the .js.map files. `tsconfig.json` sets `sourceMap: true` for local
# debugging, but NOTHING in the runtime image consumes them: `source-map-support`
# is a devDependency and so is absent from the pruned tree, and the container
# runs plain `node dist/main.js` with no `--enable-source-maps`. So they are
# inert weight that also embeds the original TypeScript — comments included — in
# a production artifact. Deleted here rather than by disabling `sourceMap`, which
# would take local debugging with it.
#
# If readable stack traces are wanted in production, this is the line to remove
# — and `--enable-source-maps` must be added to the CMD in the same change, or
# the maps go back to being unread.
RUN find ./dist -name '*.js.map' -delete
USER app
# Documentation only — EXPOSE binds nothing and no runtime reads it to choose a
# port. 3000 because that is the PORT default in `.env.example` and the port the
# compose files map. A platform that injects its own PORT simply wins (8080 is a
# common choice) and the app listens on whatever it is given, so this line is
# deliberately NOT changed to match any one platform: doing so would make it
# disagree with every other environment while still not affecting behaviour.
EXPOSE 3000
# tini as PID 1 so SIGTERM reaches node rather than being swallowed. This is
# what makes graceful shutdown work at all: Nest's shutdown hooks (API) and the
# explicit drain in dist/worker.js both hang off that signal, and a platform
# that SIGKILLs after its grace period would otherwise cut active jobs off
# mid-flight.
ENTRYPOINT ["/sbin/tini", "--"]
# The API runtime. The worker runtime is the SAME IMAGE with a different
# command and QUEUE_WORKER_ENABLED=true:
#   command: ["node", "dist/worker.js"]
CMD ["node", "dist/main.js"]
