# AGENTS.md — apps/desktop

Rules for Pakita's desktop app: Electron (main process), a sandboxed preload,
and a Vue 3 renderer, built with electron-vite and packaged with
electron-builder. Workspace rules are in the root [`AGENTS.md`](../../AGENTS.md).

## Canonical commands

Run from `apps/desktop` (or `pnpm --filter @pakita/desktop <script>` from the
root).

| Purpose | Command | Notes |
|---|---|---|
| Run in development | `pnpm dev` | Renderer from the Vite dev server, with hot reload |
| Build | `pnpm build` | Writes `out/` |
| Type check | `pnpm typecheck` | Main + preload, renderer (`vue-tsc`), and the e2e tests |
| Lint / format check | `pnpm lint` | Evidence is `lint`, never `lint:fix`; Prettier runs inside it |
| Unit tests | `pnpm test` | Pure code only (vitest) |
| App tests | `pnpm test:e2e` | Builds, then drives the real app with Playwright |
| Package (unpacked) | `pnpm package:dir` | Proves packaging and the native rebuild; publishes nothing |

Every change: `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm test:e2e`.

## Layout

```
src/
  main/        Electron main process: windows, security, IPC, database client
    database/  better-sqlite3 in a worker thread, migrations
  preload/     the ONLY bridge to the renderer (window.pakita)
  renderer/    Vue app; a browser page with no Node or Electron access
  shared/      the IPC contract, imported by all three
test/e2e/      Playwright tests against the built app
```

## Security rules

- **Every window gets `createSecureWebPreferences()`** (`src/main/security-policy.ts`):
  context isolation, sandbox, no Node integration. Never pass web
  preferences by hand.
- **The renderer has no Node, Electron or network access.** It reaches the
  app only through `window.pakita`, the functions listed in
  `src/shared/ipc-contract.ts`. ESLint refuses `electron`, `node:*` and
  main-process imports in `src/renderer`. Its CSP allows only the app's own
  origin.
- **Every IPC handler goes through `registerIpcHandler`** with a zod schema.
  It rejects a sender that is not the app origin, a sender that is not the
  top-level frame, and a payload its schema does not accept. Never call
  `ipcMain.handle` directly, and never expose `ipcRenderer` or a generic
  `invoke` from the preload.
- **The packaged renderer is served from `app://pakita`**, confined to the
  renderer folder (`resolveRendererFile`). Navigation, new windows,
  `<webview>` and browser permissions are refused app-wide (`security.ts`).
- **No `v-html`** (ESLint error). Lyrics and Bible text are untrusted input
  and are rendered as text only.
- **Credentials stay in the main process.** Tokens are never sent to a
  renderer.
- **Electron Fuses** are set at packaging (`electron-builder.yml`); do not
  turn one back on without a security review.

## Reliability rules

- **Presentation never waits on the network or on the database.** What is on
  screen comes from memory in the main process. Synchronisation and database
  writes run in the background and never replace content that is being
  presented.
- **better-sqlite3 runs only in the database worker thread**
  (`src/main/database/database-worker.ts`), never on the main thread: its
  calls are synchronous, and a long write there would freeze the operator's
  controls.
- **Migrations are append-only** (`src/main/database/migrations.ts`): laptops
  have already run every migration that shipped. A database written by a
  newer app version is refused, not modified.

## Testing notes

- better-sqlite3 ships Node-API binaries, which load under plain Node and
  Electron alike, so database code is unit-tested in vitest against a real
  in-memory SQLite. Code that needs Electron itself is tested in `test/e2e`.
- `PAKITA_TEST_USER_DATA_DIRECTORY` points an unpackaged build at a throwaway
  profile. A packaged build ignores it.
