# Pakita

![Pakita — worship presentation made simple](docs/images/pakita-hero.jpg)

**Simply present.**

Pakita is a free, open-source worship presentation app for churches: song
lyrics, Bible passages, service playlists and simple themes, presented from a
laptop to a projector.

Content is managed on the church's own server and synchronised to each
laptop, so a service can be presented with no internet connection.

> Pakita is in early development. It is not ready for use yet.

## Repository

| Path | What it is |
|---|---|
| `apps/api` | The church's server: NestJS, Prisma and PostgreSQL |
| `apps/desktop` | The presenter app: Electron and Vue |
| `deploy` | A church's server: Docker Compose and its scripts |

## Run a server

A church runs its own Pakita server with Docker Compose: see
[`deploy/README.md`](deploy/README.md). Desktop installers are on the
[releases page](https://github.com/jaylordibe/pakita/releases).

## Develop locally

**You need:** Node 24 (see `.nvmrc`), pnpm through Corepack
(`corepack enable pnpm`), and Docker with Compose for the API's database,
Redis and object storage.

```bash
pnpm install

# API — starts the local Postgres, Redis and storage, then the API.
# Copy apps/api/.env.example to apps/api/.env first and fill it in.
pnpm --filter @pakita/api stack:up
pnpm --filter @pakita/api start:dev

# Desktop — the Electron app with hot reload.
pnpm --filter @pakita/desktop dev
```

Tests, lint and the other commands, and which of them each change must
pass, are listed in each app's `AGENTS.md`:
[`apps/api/AGENTS.md`](apps/api/AGENTS.md) and
[`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md).

## Licence

Pakita is licensed under the [GNU Affero General Public License v3.0 or
later](LICENSE). See [`NOTICE`](NOTICE) for third-party notices.
