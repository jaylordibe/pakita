import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';

import { apiConstraints } from '../shared/api/constraints';
import {
  bibleBookCodeValues,
  themeBackgroundValues,
  themeFontValues,
  themeTextAlignValues,
} from '../shared/api/enums';
import { IpcChannel, type IpcChannelName } from '../shared/ipc-contract';
import { AppController } from './app-controller';
import { showDevelopmentDockIcon, windowIcon } from './app-icon';
import { bibleTranslationInputSchema } from './bible/bible-translation-input';
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
const newPasswordLimits = apiConstraints.UpdateAuthUserPasswordDto.newPassword;
const newAccountLimits = apiConstraints.CreateUserDto;
const newAccountInputSchema = z
  .object({
    email: z.email().max(254),
    username: z
      .string()
      .min(newAccountLimits.username.minLength)
      .max(newAccountLimits.username.maxLength)
      .regex(new RegExp(newAccountLimits.username.pattern))
      .nullable(),
    firstName: z
      .string()
      .trim()
      .min(newAccountLimits.firstName.minLength)
      .max(newAccountLimits.firstName.maxLength),
    lastName: z
      .string()
      .trim()
      .min(newAccountLimits.lastName.minLength)
      .max(newAccountLimits.lastName.maxLength),
  })
  .strict();
const invitationLimits = apiConstraints.CreateWorkspaceInvitationDto;
const invitationCodeLimits = apiConstraints.AcceptWorkspaceInvitationDto.token;
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

const bookCode = z.enum(bibleBookCodeValues);
const chapterNumber = z.number().int().min(1).max(200);
const versePosition = z
  .object({ chapter: chapterNumber, verse: z.number().int().min(1).max(200) })
  .strict();

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const themeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    background: z.enum(themeBackgroundValues),
    backgroundColor: hexColour,
    textColor: hexColour,
    font: z.enum(themeFontValues),
    textScale: z.number().int().min(50).max(200),
    textAlign: z.enum(themeTextAlignValues),
    isDefault: z.boolean(),
  })
  .strict();

const playlistItemInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('song'),
      songId: uuid,
      arrangementName: z.string().min(1).max(60).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('passage'),
      bibleTranslationId: uuid,
      bookCode,
      startChapter: chapterNumber,
      startVerse: chapterNumber,
      endChapter: chapterNumber,
      endVerse: chapterNumber,
    })
    .strict(),
]);

const playlistInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    serviceDate: z.iso.date().nullable(),
    themeId: uuid.nullable(),
    items: z.array(playlistItemInputSchema).max(100),
    expectedSyncVersion: z.number().int().positive().optional(),
  })
  .strict();

async function start(): Promise<void> {
  showDevelopmentDockIcon();
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
  controller.startUpdateChecks();

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
  handle(IpcChannel.appGetUpdate, noPayload, () => controller.getUpdate());
  handle(IpcChannel.appOpenUpdate, noPayload, () => controller.openUpdate());
  // Write-only, and short: the operator copies a one-time password or code.
  handle(IpcChannel.appCopyText, z.string().min(1).max(500), (text) => {
    clipboard.writeText(text);
  });
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
  handle(
    IpcChannel.accountChangePassword,
    z
      .object({
        // Checked, not set: any length the server would compare.
        currentPassword: z.string().min(1).max(200),
        newPassword: z
          .string()
          .min(newPasswordLimits.minLength)
          .max(newPasswordLimits.maxLength),
      })
      .strict(),
    ({ currentPassword, newPassword }) =>
      controller.changePassword(currentPassword, newPassword),
  );
  handle(IpcChannel.accountGetCapabilities, noPayload, () =>
    controller.getCapabilities(),
  );
  handle(IpcChannel.accountsList, noPayload, () => controller.listAccounts());
  handle(IpcChannel.accountsCreate, newAccountInputSchema, (input) =>
    controller.createAccount(input),
  );
  handle(IpcChannel.accountsResetPassword, uuid, (accountId) =>
    controller.resetAccountPassword(accountId),
  );
  handle(IpcChannel.invitationsListRoles, noPayload, () =>
    controller.listInvitableRoles(),
  );
  handle(IpcChannel.invitationsList, noPayload, () =>
    controller.listInvitations(),
  );
  handle(
    IpcChannel.invitationsCreate,
    z
      .object({
        identifier: z
          .string()
          .trim()
          .min(invitationLimits.identifier.minLength)
          .max(invitationLimits.identifier.maxLength),
        roleId: uuid,
      })
      .strict(),
    ({ identifier, roleId }) => controller.createInvitation(identifier, roleId),
  );
  handle(IpcChannel.invitationsReissue, uuid, (invitationId) =>
    controller.reissueInvitation(invitationId),
  );
  handle(IpcChannel.invitationsRevoke, uuid, (invitationId) =>
    controller.revokeInvitation(invitationId),
  );
  handle(
    IpcChannel.invitationsAccept,
    z
      .string()
      .trim()
      .min(invitationCodeLimits.minLength)
      .max(invitationCodeLimits.maxLength),
    (code) => controller.acceptInvitation(code),
  );
  handle(IpcChannel.workspacesList, noPayload, () =>
    controller.listWorkspaces(),
  );
  handle(IpcChannel.workspaceSelect, uuid, (workspaceId) =>
    controller.selectWorkspace(workspaceId),
  );
  handle(
    IpcChannel.workspacesCreate,
    z.string().trim().min(2).max(120),
    (name) => controller.createWorkspace(name),
  );
  handle(IpcChannel.syncNow, noPayload, () => controller.syncNow());
  handle(IpcChannel.syncGetStatus, noPayload, () => controller.getSyncStatus());
  handle(IpcChannel.syncRebuild, noPayload, () =>
    controller.rebuildLocalCopy(),
  );
  handle(
    IpcChannel.songsCopy,
    z.object({ songId: uuid, targetWorkspaceId: uuid }).strict(),
    ({ songId, targetWorkspaceId }) =>
      controller.copySong(songId, targetWorkspaceId),
  );
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
  handle(IpcChannel.bibleListTranslations, noPayload, () =>
    controller.listBibleTranslations(),
  );
  handle(IpcChannel.bibleListBooks, uuid, (translationId) =>
    controller.listBibleBooks(translationId),
  );
  handle(
    IpcChannel.bibleGetChapter,
    z
      .object({ translationId: uuid, bookCode, chapter: chapterNumber })
      .strict(),
    ({ translationId, bookCode: code, chapter }) =>
      controller.getBibleChapter(translationId, code, chapter),
  );
  handle(
    IpcChannel.bibleSearch,
    z.object({ translationId: uuid, search: z.string().max(200) }).strict(),
    ({ translationId, search }) =>
      controller.searchBible(translationId, search),
  );
  handle(IpcChannel.bibleChooseImportFolder, noPayload, () =>
    controller.chooseBibleImportFolder(),
  );
  handle(IpcChannel.bibleImport, bibleTranslationInputSchema, (input) =>
    controller.importBible(input),
  );
  handle(IpcChannel.themesList, noPayload, () => controller.listThemes());
  handle(IpcChannel.themesGet, uuid, (themeId) => controller.getTheme(themeId));
  handle(IpcChannel.themesCreate, themeInputSchema, (input) =>
    controller.createTheme(input),
  );
  handle(
    IpcChannel.themesUpdate,
    z.object({ themeId: uuid, input: themeInputSchema }).strict(),
    ({ themeId, input }) => controller.updateTheme(themeId, input),
  );
  handle(IpcChannel.themesDelete, uuid, (themeId) =>
    controller.deleteTheme(themeId),
  );
  handle(IpcChannel.playlistsList, noPayload, () => controller.listPlaylists());
  handle(IpcChannel.playlistsGet, uuid, (playlistId) =>
    controller.getPlaylist(playlistId),
  );
  handle(IpcChannel.playlistsCreate, playlistInputSchema, (input) =>
    controller.createPlaylist(input),
  );
  handle(
    IpcChannel.playlistsUpdate,
    z.object({ playlistId: uuid, input: playlistInputSchema }).strict(),
    ({ playlistId, input }) => controller.updatePlaylist(playlistId, input),
  );
  handle(IpcChannel.playlistsDelete, uuid, (playlistId) =>
    controller.deletePlaylist(playlistId),
  );
  handle(
    IpcChannel.liveStartPlaylist,
    z
      .object({ playlistId: uuid, entryIndex: z.number().int().min(0).max(99) })
      .strict(),
    ({ playlistId, entryIndex }) =>
      controller.startPlaylist(playlistId, entryIndex),
  );
  handle(
    IpcChannel.liveStartPassage,
    z
      .object({
        translationId: uuid,
        bookCode,
        start: versePosition,
        end: versePosition,
      })
      .strict(),
    (passage) => controller.startPassage(passage),
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
    minWidth: 900,
    minHeight: 600,
    title: 'Pakita',
    icon: windowIcon,
    // The interface's darkest surface (--bg in the renderer's style.css), so
    // the window never flashes white before the page paints.
    backgroundColor: '#0b0a18',
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
