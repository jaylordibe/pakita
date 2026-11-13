// The one definition of every IPC channel the renderers may use and what each
// carries. The preloads expose exactly these; the main process registers a
// validated handler for each request channel. Nothing else crosses the
// boundary.

import type { components } from './api/openapi';
import type { Slide, Song } from './slides';

export type { Slide, Song };

/** Requests from the operator window (renderer → main, with a reply). */
export const IpcChannel = {
  appGetVersion: 'app:get-version',
  appGetState: 'app:get-state',
  databaseGetHealth: 'database:get-health',
  serverConnect: 'server:connect',
  accountSignIn: 'account:sign-in',
  accountSignOut: 'account:sign-out',
  workspacesList: 'workspaces:list',
  workspaceSelect: 'workspace:select',
  syncNow: 'sync:now',
  syncGetStatus: 'sync:get-status',
  libraryListSongs: 'library:list-songs',
  libraryGetSong: 'library:get-song',
  songsCreate: 'songs:create',
  songsUpdate: 'songs:update',
  displaysList: 'displays:list',
  displaysChoose: 'displays:choose',
  bibleListTranslations: 'bible:list-translations',
  bibleListBooks: 'bible:list-books',
  bibleGetChapter: 'bible:get-chapter',
  bibleSearch: 'bible:search',
  bibleChooseImportFolder: 'bible:choose-import-folder',
  bibleImport: 'bible:import',
  liveStart: 'live:start',
  liveStartPassage: 'live:start-passage',
  liveNext: 'live:next',
  livePrevious: 'live:previous',
  liveGoTo: 'live:go-to',
  liveToggleBlackout: 'live:toggle-blackout',
  liveStop: 'live:stop',
  liveGetState: 'live:get-state',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

/** Notifications pushed by the main process (main → renderers). */
export const IpcEvent = {
  syncStatus: 'sync:status',
  liveState: 'live:state',
  displaysChanged: 'displays:changed',
  bibleImportProgress: 'bible:import-progress',
} as const;

export interface DatabaseHealth {
  readonly journalMode: string;
  readonly schemaVersion: number;
  readonly latestSchemaVersion: number;
}

export interface Compatibility {
  readonly status: 'compatible' | 'update-server' | 'update-desktop';
  /** What the operator should do, in plain words; null when compatible. */
  readonly message: string | null;
}

export interface ServerConnection {
  readonly origin: string;
  readonly serverVersion: string;
  readonly compatibility: Compatibility;
}

export interface AccountSummary {
  readonly origin: string;
  readonly email: string;
  readonly displayName: string;
  /** False when the laptop holds the account's content but must sign in again. */
  readonly isSignedIn: boolean;
}

export interface AppState {
  readonly serverOrigin: string | null;
  readonly account: AccountSummary | null;
  readonly workspaceId: string | null;
}

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface SyncStatus {
  readonly state: 'idle' | 'syncing' | 'offline' | 'sign-in-required' | 'error';
  readonly lastSyncedAt: string | null;
  readonly message: string | null;
}

export interface SongSummary {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  readonly isArchived: boolean;
}

type SongSectionKind = components['schemas']['SongSectionInputDto']['kind'];

export interface SongInput {
  readonly title: string;
  readonly artist: string | null;
  readonly sections: ReadonlyArray<{
    readonly key: string;
    readonly kind: SongSectionKind;
    readonly label: string;
    readonly lyrics: string;
  }>;
  readonly arrangements?: ReadonlyArray<{
    readonly name: string;
    readonly isDefault: boolean;
    readonly sectionKeys: readonly string[];
  }>;
}

export interface BibleTranslation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly languageCode: string;
  readonly attribution: string;
  readonly verseCount: number;
}

export interface BibleBook {
  readonly code: string;
  readonly name: string;
  readonly chapterCount: number;
}

export interface BibleVerse {
  readonly bookCode: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

export interface BibleSearchHit extends BibleVerse {
  readonly bookName: string;
}

export interface VersePosition {
  readonly chapter: number;
  readonly verse: number;
}

/** A passage within one book, from `start` to `end` inclusive. */
export interface PassageRequest {
  readonly translationId: string;
  readonly bookCode: string;
  readonly start: VersePosition;
  readonly end: VersePosition;
}

/** What an administrator states about a translation they import. */
export interface BibleTranslationInput {
  readonly code: string;
  readonly name: string;
  readonly languageCode: string;
  readonly licence: string;
  readonly attribution: string;
  readonly sourceUrl: string | null;
}

/** A folder of USFM files, read and ready to import. */
export interface BibleImportPreview {
  readonly folderName: string;
  readonly bookCount: number;
  readonly verseCount: number;
  readonly firstBook: string;
  readonly lastBook: string;
  readonly skippedCodes: readonly string[];
}

export interface BibleImportProgress {
  readonly done: number;
  readonly total: number;
  readonly bookName: string;
}

export interface DisplayInfo {
  readonly id: number;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly isPrimary: boolean;
  readonly isChosen: boolean;
}

export interface LiveState {
  readonly isLive: boolean;
  readonly title: string | null;
  readonly slides: readonly Slide[];
  readonly index: number;
  readonly isBlackout: boolean;
  /**
   * `showing`: on the chosen display. `display-missing`: that display was
   * disconnected; output resumes when it returns. `windowed`: no second
   * display, so the output is a normal window.
   */
  readonly projector: 'off' | 'showing' | 'display-missing' | 'windowed';
}

/** What the operator window's preload exposes on `window.pakita`. */
export interface PakitaApi {
  readonly app: {
    getVersion(): Promise<string>;
    getState(): Promise<AppState>;
  };
  readonly database: {
    getHealth(): Promise<DatabaseHealth | null>;
  };
  readonly server: {
    connect(address: string): Promise<ServerConnection>;
  };
  readonly account: {
    signIn(identifier: string, password: string): Promise<AccountSummary>;
    signOut(): Promise<void>;
  };
  readonly workspaces: {
    list(): Promise<WorkspaceSummary[]>;
    select(workspaceId: string): Promise<void>;
  };
  readonly sync: {
    now(): Promise<SyncStatus>;
    getStatus(): Promise<SyncStatus>;
    onStatus(listener: (status: SyncStatus) => void): () => void;
  };
  readonly library: {
    listSongs(search: string, isArchived: boolean): Promise<SongSummary[]>;
    getSong(songId: string): Promise<Song | null>;
  };
  readonly songs: {
    create(input: SongInput): Promise<Song>;
    update(songId: string, input: SongInput): Promise<Song>;
  };
  readonly bible: {
    listTranslations(): Promise<BibleTranslation[]>;
    listBooks(translationId: string): Promise<BibleBook[]>;
    getChapter(
      translationId: string,
      bookCode: string,
      chapter: number,
    ): Promise<BibleVerse[]>;
    search(translationId: string, search: string): Promise<BibleSearchHit[]>;
    /** Asks for a folder of USFM files; null when the operator cancels. */
    chooseImportFolder(): Promise<BibleImportPreview | null>;
    /** Imports and publishes the chosen folder, then synchronises. */
    import(input: BibleTranslationInput): Promise<void>;
    onImportProgress(
      listener: (progress: BibleImportProgress) => void,
    ): () => void;
  };
  readonly displays: {
    list(): Promise<DisplayInfo[]>;
    /** `null` returns to automatic placement. */
    choose(displayId: number | null): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  readonly live: {
    start(songId: string, arrangementId: string | null): Promise<LiveState>;
    startPassage(passage: PassageRequest): Promise<LiveState>;
    next(): Promise<LiveState>;
    previous(): Promise<LiveState>;
    goTo(index: number): Promise<LiveState>;
    toggleBlackout(): Promise<LiveState>;
    stop(): Promise<LiveState>;
    getState(): Promise<LiveState>;
    onState(listener: (state: LiveState) => void): () => void;
  };
}

/** What the projector window's preload exposes: read-only. */
export interface ProjectorApi {
  getState(): Promise<LiveState>;
  onState(listener: (state: LiveState) => void): () => void;
}
