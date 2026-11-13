import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IpcChannel, IpcEvent, type PakitaApi } from '../shared/ipc-contract';

// The operator window's ONLY access to the app: named functions, one per
// channel in the IPC contract. Never expose `ipcRenderer` itself or a generic
// `invoke(channel, …)`: either would let page script reach every handler.

const invoke = (channel: string, payload?: unknown) =>
  ipcRenderer.invoke(channel, payload);

function subscribe<Payload>(
  channel: string,
  listener: (payload: Payload) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: Payload) =>
    listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const pakita: PakitaApi = {
  app: {
    getVersion: () => invoke(IpcChannel.appGetVersion),
    getState: () => invoke(IpcChannel.appGetState),
  },
  database: {
    getHealth: () => invoke(IpcChannel.databaseGetHealth),
  },
  server: {
    connect: (address) => invoke(IpcChannel.serverConnect, address),
  },
  account: {
    signIn: (identifier, password) =>
      invoke(IpcChannel.accountSignIn, { identifier, password }),
    signOut: () => invoke(IpcChannel.accountSignOut),
  },
  workspaces: {
    list: () => invoke(IpcChannel.workspacesList),
    select: (workspaceId) => invoke(IpcChannel.workspaceSelect, workspaceId),
  },
  sync: {
    now: () => invoke(IpcChannel.syncNow),
    getStatus: () => invoke(IpcChannel.syncGetStatus),
    rebuild: () => invoke(IpcChannel.syncRebuild),
    onStatus: (listener) => subscribe(IpcEvent.syncStatus, listener),
  },
  library: {
    listSongs: (search, isArchived) =>
      invoke(IpcChannel.libraryListSongs, { search, isArchived }),
    getSong: (songId) => invoke(IpcChannel.libraryGetSong, songId),
  },
  songs: {
    create: (input) => invoke(IpcChannel.songsCreate, input),
    update: (songId, input) =>
      invoke(IpcChannel.songsUpdate, { songId, input }),
    copy: (songId, targetWorkspaceId) =>
      invoke(IpcChannel.songsCopy, { songId, targetWorkspaceId }),
  },
  bible: {
    listTranslations: () => invoke(IpcChannel.bibleListTranslations),
    listBooks: (translationId) =>
      invoke(IpcChannel.bibleListBooks, translationId),
    getChapter: (translationId, bookCode, chapter) =>
      invoke(IpcChannel.bibleGetChapter, { translationId, bookCode, chapter }),
    search: (translationId, search) =>
      invoke(IpcChannel.bibleSearch, { translationId, search }),
    chooseImportFolder: () => invoke(IpcChannel.bibleChooseImportFolder),
    import: (input) => invoke(IpcChannel.bibleImport, input),
    onImportProgress: (listener) =>
      subscribe(IpcEvent.bibleImportProgress, listener),
  },
  themes: {
    list: () => invoke(IpcChannel.themesList),
    get: (themeId) => invoke(IpcChannel.themesGet, themeId),
    create: (input) => invoke(IpcChannel.themesCreate, input),
    update: (themeId, input) =>
      invoke(IpcChannel.themesUpdate, { themeId, input }),
    delete: (themeId) => invoke(IpcChannel.themesDelete, themeId),
  },
  playlists: {
    list: () => invoke(IpcChannel.playlistsList),
    get: (playlistId) => invoke(IpcChannel.playlistsGet, playlistId),
    create: (input) => invoke(IpcChannel.playlistsCreate, input),
    update: (playlistId, input) =>
      invoke(IpcChannel.playlistsUpdate, { playlistId, input }),
    delete: (playlistId) => invoke(IpcChannel.playlistsDelete, playlistId),
  },
  displays: {
    list: () => invoke(IpcChannel.displaysList),
    choose: (displayId) => invoke(IpcChannel.displaysChoose, displayId),
    onChanged: (listener) => subscribe(IpcEvent.displaysChanged, listener),
  },
  live: {
    start: (songId, arrangementId) =>
      invoke(IpcChannel.liveStart, { songId, arrangementId }),
    startPassage: (passage) => invoke(IpcChannel.liveStartPassage, passage),
    startPlaylist: (playlistId, entryIndex) =>
      invoke(IpcChannel.liveStartPlaylist, { playlistId, entryIndex }),
    next: () => invoke(IpcChannel.liveNext),
    previous: () => invoke(IpcChannel.livePrevious),
    goTo: (index) => invoke(IpcChannel.liveGoTo, index),
    toggleBlackout: () => invoke(IpcChannel.liveToggleBlackout),
    stop: () => invoke(IpcChannel.liveStop),
    getState: () => invoke(IpcChannel.liveGetState),
    onState: (listener) => subscribe(IpcEvent.liveState, listener),
  },
};

contextBridge.exposeInMainWorld('pakita', pakita);
