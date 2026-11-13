# AGENTS.md — apps/desktop

Rules for Pakita's desktop app: Electron (main process), a sandboxed preload,
and a Vue 3 renderer, built with electron-vite and packaged with
electron-builder. Workspace rules are in the root [`AGENTS.md`](../../AGENTS.md).

## Canonical commands

Run from `apps/desktop` (or `pnpm --filter @pakita/desktop <script>` from the
root).

| Purpose | Command | Notes |
|---|---|---|
| Run in development | `pnpm dev` | Renderer from the Vite dev server, with hot reload; a main-process or preload change rebuilds and restarts the app |
| Build | `pnpm build` | Writes `out/` |
| Type check | `pnpm typecheck` | Main + preload, renderer (`vue-tsc`), and the e2e tests |
| Lint / format check | `pnpm lint` | Evidence is `lint`, never `lint:fix`; Prettier runs inside it |
| Unit tests | `pnpm test` | Pure code only (vitest) |
| App tests | `pnpm test:e2e` | Builds, then drives the real app with Playwright against a real API (see below) |
| Turnstile sign-in test | `PAKITA_E2E_TURNSTILE=1 pnpm exec playwright test turnstile` | Opt-in: needs the internet (Cloudflare's test keys) |
| API types | `pnpm generate:api` | Regenerates `src/shared/api/openapi.ts`, `enums.ts` and `constraints.ts` from `apps/api/openapi.json`; CI fails when stale |
| Package (unpacked) | `pnpm package:dir` | Proves packaging; publishes nothing, never signs |
| Packaged smoke test | `pnpm smoke:package` | Launches the package from `package:dir` and waits for its database |

Every change: `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm test:e2e`.

`pnpm test:e2e` starts the built API (`apps/api/dist`) against a throwaway
database on the API's **test** stack: run `pnpm --filter @pakita/api
stack:up` (or its `pretest:e2e`) and `pnpm --filter @pakita/api build` first
(`test/e2e/support/test-api.ts`).

## Layout

```
src/
  main/        Electron main process: windows, security, IPC, database client
    bible/     USFM parsing and the translation import
    database/  better-sqlite3 in a worker thread, migrations
    presentation/  live session, projector window, playlist decks
    sync/      workspace content and Bible synchronisation
  preload/     the ONLY bridge to the renderer (window.pakita)
  renderer/    Vue app; a browser page with no Node or Electron access
  shared/      the IPC contract, slides, and the generated API types —
               imported by main, preload and renderer alike
test/e2e/      Playwright tests against the built app
test/fixtures/ shared test data (a tiny USFM translation)
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
  and are rendered as text only (the projector uses `textContent`).
- **Credentials stay in the main process.** Tokens are never sent to a
  renderer. The refresh token is stored only through the system keychain
  (`safeStorage`); where none exists (Linux `basic_text`) it is not stored.
- **Only the Turnstile check window loads remote content**
  (`src/main/auth/turnstile-window.ts`): no preload, its own session, and a
  navigation policy limited to the church server and Cloudflare's challenge
  origin (`setNavigationPolicy`).
- **The server address must be HTTPS**, except for a server on this computer
  (`parseServerAddress`).
- **Electron Fuses** are set at packaging (`electron-builder.yml`); do not
  turn one back on without a security review.

## Contract rules

- **The API's types are generated, never written by hand**
  (`src/shared/api/openapi.ts`, from `apps/api/openapi.json`). The main
  process validates every server response with the zod schemas in
  `src/main/api/api-schemas.ts`, each typed against those generated types,
  so an API change this app does not follow fails `pnpm typecheck`.
- **A list of allowed values the API publishes is generated, never copied**
  (`src/shared/api/enums.ts`, e.g. the USFM book codes an import may send).
- **A field's limits are generated, never copied**
  (`src/shared/api/constraints.ts`: the lengths, patterns and ranges the API
  publishes, e.g. the longest verse it accepts).
- **Compatibility:** `REQUIRED_API_LEVEL` (`src/main/compatibility.ts`)
  against the server's `apiLevel`, and this app's version against the
  server's `minimumDesktopVersion`; the operator is told which side to update.

## Reliability rules

- **Presentation never waits on the network.** A presentation's slides are
  copied from the local database once, when it starts
  (`LiveSession`), and held in main-process memory; synchronisation writes
  only the database, so it can never change what is on screen. The operator
  sees new content by starting the song again. The theme is resolved at the
  same moment and held with the slides. A playlist is presented as one deck
  of every entry the laptop holds (`playlist-deck.ts`), and each entry shows
  whether it is ready before the service.
- **A theme never loads anything remote.** Its fonts are bundled
  (`src/renderer/src/fonts.css`) and its backgrounds are drawn in CSS
  (`src/shared/theme-look.ts`, the one definition the projector and the
  previews share). A new font must carry a licence compatible with AGPLv3
  (the bundled ones are SIL OFL 1.1), and its licence file is added to
  `extraResources` in `electron-builder.yml`.
- **A laptop that holds an account opens its content without the network or
  the keychain** (`AppController.initialize`): the database opens from files;
  the session (whose refresh token lives in the keychain) follows in the
  background.
- **A Bible translation is stored whole or not at all.** Bible sync
  (`src/main/sync/bible-sync.ts`) downloads a published translation only when
  the laptop lacks its content hash, verifies the hash before writing, and
  replaces it in one transaction; a translation the server stops listing is
  removed. Presenting a passage reads only the local copy.
- **A Bible import is parsed on the administrator's laptop**
  (`src/main/bible/`): USFM files from a chosen folder, sent chapter by
  chapter to a draft that is published at the end. A failure before
  publishing deletes the draft (or the next import of that code does); the
  server never parses an uploaded file. Bible downloads wait while a
  presentation is live.
- **The projector never falls back onto the operator's screen.** A chosen
  display that disappears hides the output until it returns
  (`placeProjector`).
- **better-sqlite3 runs only in the database worker thread**
  (`src/main/database/database-worker.ts`), never on the main thread: its
  calls are synchronous, and a long write there would freeze the operator's
  controls.
- **A crashed database worker is reopened**, at most once a minute
  (`AppController.reopenDatabase`); a presentation continues meanwhile from
  memory. **"Re-download all"** (`rebuildLocalCopy`) is the operator's repair:
  a full resynchronisation that keeps the current copy until it completes.
- **Migrations are append-only** (`src/main/database/migrations.ts`): laptops
  have already run every migration that shipped. A database written by a
  newer app version is refused, not modified.

## Interface design

- **The operator interface follows [`DESIGN.md`](DESIGN.md)** ("The Booth by
  Stage Light": dark, indigo-tinted, brand colour only on the selection, the
  primary action and the on-air state). Its tokens and shared controls live
  once, in `src/renderer/src/style.css`; components keep only what is
  particular to them. Icons are drawn with `AppIcon`, never Unicode glyphs.
- **DESIGN.md's colours and radii are checked against `style.css`**
  (`scripts/design-tokens.spec.ts`, part of `pnpm test`). Change the CSS
  first, then DESIGN.md. `.impeccable/design.json` is generated from both by
  `/impeccable document`; regenerate it rather than editing it.

## Testing notes

- better-sqlite3 ships Node-API binaries, which load under plain Node and
  Electron alike (so packaging rebuilds nothing: `npmRebuild: false`), and
  database code is unit-tested in vitest against a real in-memory SQLite.
  Code that needs Electron itself is tested in `test/e2e`.
- `PAKITA_TEST_USER_DATA_DIRECTORY` points an unpackaged build at a throwaway
  profile. A packaged build ignores it.
