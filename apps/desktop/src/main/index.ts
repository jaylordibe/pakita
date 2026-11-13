import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';

import { IpcChannel, type IpcChannelName } from '../shared/ipc-contract';
import { AppController } from './app-controller';
import { registerIpcHandler } from './ipc-registry';
import {
  installWebContentsGuards,
  registerAppSchemePrivileges,
  serveRendererFromAppScheme,
} from './security';
import {
  APP_ORIGIN,
  createSecureWebPreferences,
  createTrustedOrigins,
} from './security-policy';

// electron-vite sets this only while `pnpm dev` runs; a packaged app never
// trusts a development server. An empty value means "none", not a URL.
const developmentServerUrl = app.isPackaged
  ? undefined
  : process.env.ELECTRON_RENDERER_URL || undefined;
const trustedOrigins = createTrustedOrigins(developmentServerUrl);

// The end-to-end tests run against a throwaway profile. Honoured only in an
// unpackaged build, so it can never redirect a church's real data.
if (!app.isPackaged && process.env.PAKITA_TEST_USER_DATA_DIRECTORY) {
  app.setPath('userData', process.env.PAKITA_TEST_USER_DATA_DIRECTORY);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppSchemePrivileges();
  void app.whenReady().then(start);
}

let operatorWindow: BrowserWindow | null = null;

function pageUrl(page: 'index' | 'projector'): string {
  return developmentServerUrl
    ? `${developmentServerUrl}/${page}.html`
    : `${APP_ORIGIN}/${page}.html`;
}

// ── IPC payload schemas: the shape and size of what a renderer may send ──
const uuid = z.uuid();
const songInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    artist: z.string().max(200).nullable(),
    sections: z
      .array(
        z
          .object({
            key: z.string().min(1).max(40),
            kind: z.enum([
              'verse',
              'chorus',
              'bridge',
              'intro',
              'outro',
              'custom',
            ]),
            label: z.string().min(1).max(60),
            lyrics: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    arrangements: z
      .array(
        z
          .object({
            name: z.string().min(1).max(60),
            isDefault: z.boolean(),
            sectionKeys: z.array(z.string().max(40)).min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();

async function start(): Promise<void> {
  installWebContentsGuards(trustedOrigins);
  serveRendererFromAppScheme(join(__dirname, '../renderer'));

  const controller = new AppController({
    userDataDirectory: app.getPath('userData'),
    databaseWorkerPath: join(__dirname, 'database-worker.js'),
    projectorPreloadPath: join(__dirname, '../preload/projector.js'),
    loadProjectorPage: (window) => window.loadURL(pageUrl('projector')),
    getOperatorWindow: () => operatorWindow,
  });
  controller.initialize();

  // Close the database cleanly before the process exits: hold the quit once,
  // let the worker finish its statement and close, then quit for real.
  let isShutDown = false;
  app.on('before-quit', (event) => {
    if (isShutDown) return;
    event.preventDefault();
    void controller.shutdown().finally(() => {
      isShutDown = true;
      app.quit();
    });
  });

  // Every channel belongs to the operator window, except reading the live
  // state, which the projector does too.
  const isOperator = (senderId: number) =>
    operatorWindow !== null &&
    !operatorWindow.isDestroyed() &&
    operatorWindow.webContents.id === senderId;
  const handle = <Schema extends z.ZodType, Result>(
    channel: IpcChannelName,
    schema: Schema,
    handler: (payload: z.infer<Schema>) => Result | Promise<Result>,
    isAllowedSender: (senderId: number) => boolean = isOperator,
  ) =>
    registerIpcHandler(ipcMain, channel, {
      schema,
      trustedOrigins,
      isAllowedSender,
      handle: handler,
    });
  const noPayload = z.undefined();

  handle(IpcChannel.appGetVersion, noPayload, () => app.getVersion());
  handle(IpcChannel.appGetState, noPayload, () => controller.getState());
  handle(IpcChannel.databaseGetHealth, noPayload, () =>
    controller.getDatabaseHealth(),
  );
  handle(IpcChannel.serverConnect, z.string().max(500), (address) =>
    controller.connect(address),
  );
  handle(
    IpcChannel.accountSignIn,
    z
      .object({
        identifier: z.string().min(1).max(320),
        password: z.string().min(1).max(200),
      })
      .strict(),
    ({ identifier, password }) => controller.signIn(identifier, password),
  );
  handle(IpcChannel.accountSignOut, noPayload, () => controller.signOut());
  handle(IpcChannel.workspacesList, noPayload, () =>
    controller.listWorkspaces(),
  );
  handle(IpcChannel.workspaceSelect, uuid, (workspaceId) =>
    controller.selectWorkspace(workspaceId),
  );
  handle(IpcChannel.syncNow, noPayload, () => controller.syncNow());
  handle(IpcChannel.syncGetStatus, noPayload, () => controller.getSyncStatus());
  handle(
    IpcChannel.libraryListSongs,
    z.object({ search: z.string().max(200), isArchived: z.boolean() }).strict(),
    ({ search, isArchived }) => controller.listSongs(search, isArchived),
  );
  handle(IpcChannel.libraryGetSong, uuid, (songId) =>
    controller.getSong(songId),
  );
  handle(IpcChannel.songsCreate, songInputSchema, (input) =>
    controller.createSong(input),
  );
  handle(
    IpcChannel.songsUpdate,
    z.object({ songId: uuid, input: songInputSchema }).strict(),
    ({ songId, input }) => controller.updateSong(songId, input),
  );
  handle(IpcChannel.displaysList, noPayload, () => controller.listDisplays());
  handle(IpcChannel.displaysChoose, z.number().int().nullable(), (displayId) =>
    controller.chooseDisplay(displayId),
  );
  handle(
    IpcChannel.liveStart,
    z.object({ songId: uuid, arrangementId: uuid.nullable() }).strict(),
    ({ songId, arrangementId }) => controller.startLive(songId, arrangementId),
  );
  handle(IpcChannel.liveNext, noPayload, () => controller.next());
  handle(IpcChannel.livePrevious, noPayload, () => controller.previous());
  handle(IpcChannel.liveGoTo, z.number().int().min(0).max(100_000), (index) =>
    controller.goTo(index),
  );
  handle(IpcChannel.liveToggleBlackout, noPayload, () =>
    controller.toggleBlackout(),
  );
  handle(IpcChannel.liveStop, noPayload, () => controller.stopLive());
  handle(
    IpcChannel.liveGetState,
    noPayload,
    () => controller.liveState(),
    (senderId) =>
      isOperator(senderId) || controller.isProjectorContents(senderId),
  );

  app.on('second-instance', () => {
    if (operatorWindow) {
      if (operatorWindow.isMinimized()) {
        operatorWindow.restore();
      }
      operatorWindow.focus();
    }
  });

  operatorWindow = createOperatorWindow();
}

function createOperatorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Pakita',
    show: false,
    webPreferences: createSecureWebPreferences(
      join(__dirname, '../preload/index.js'),
    ),
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    operatorWindow = null;
    // The operator window is the app: closing it ends the presentation too.
    app.quit();
  });
  void window.loadURL(pageUrl('index'));
  return window;
}

app.on('window-all-closed', () => {
  app.quit();
});
