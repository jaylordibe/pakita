// The one definition of every IPC channel the renderers may use and what each
// carries. The preloads expose exactly these; the main process registers a
// validated handler for each request channel. Nothing else crosses the
// boundary.

import type { components } from './api/openapi';
import type { Slide, Song } from './slides';
import type { ThemeLook } from './theme-look';

export type { Slide, Song };

/** Requests from the operator window (renderer → main, with a reply). */
export const IpcChannel = {
  appGetVersion: 'app:get-version',
  appGetState: 'app:get-state',
  appGetUpdate: 'app:get-update',
  appOpenUpdate: 'app:open-update',
  appCopyText: 'app:copy-text',
  databaseGetHealth: 'database:get-health',
  serverConnect: 'server:connect',
  accountSignIn: 'account:sign-in',
  accountSignOut: 'account:sign-out',
  accountChangePassword: 'account:change-password',
  accountGetCapabilities: 'account:get-capabilities',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsResetPassword: 'accounts:reset-password',
  invitationsListRoles: 'invitations:list-roles',
  invitationsList: 'invitations:list',
  invitationsCreate: 'invitations:create',
  invitationsReissue: 'invitations:reissue',
  invitationsRevoke: 'invitations:revoke',
  invitationsAccept: 'invitations:accept',
  workspacesList: 'workspaces:list',
  workspaceSelect: 'workspace:select',
  workspacesCreate: 'workspaces:create',
  workspacesRename: 'workspaces:rename',
  workspacesDelete: 'workspaces:delete',
  workspacesReplaceOwner: 'workspaces:replace-owner',
  membersCreateAccount: 'members:create-account',
  syncNow: 'sync:now',
  syncGetStatus: 'sync:get-status',
  syncRebuild: 'sync:rebuild',
  libraryListSongs: 'library:list-songs',
  libraryGetSong: 'library:get-song',
  songsCreate: 'songs:create',
  songsUpdate: 'songs:update',
  songsCopy: 'songs:copy',
  displaysList: 'displays:list',
  displaysChoose: 'displays:choose',
  bibleListTranslations: 'bible:list-translations',
  bibleListBooks: 'bible:list-books',
  bibleGetChapter: 'bible:get-chapter',
  bibleSearch: 'bible:search',
  bibleChooseImportFolder: 'bible:choose-import-folder',
  bibleImport: 'bible:import',
  bibleListServerTranslations: 'bible:list-server-translations',
  themesList: 'themes:list',
  themesGet: 'themes:get',
  themesCreate: 'themes:create',
  themesUpdate: 'themes:update',
  themesDelete: 'themes:delete',
  playlistsList: 'playlists:list',
  playlistsGet: 'playlists:get',
  playlistsCreate: 'playlists:create',
  playlistsUpdate: 'playlists:update',
  playlistsDelete: 'playlists:delete',
  liveStart: 'live:start',
  liveStartPlaylist: 'live:start-playlist',
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
  updateAvailable: 'app:update-available',
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
  /**
   * The password was chosen by an administrator and must be replaced before
   * anything else (`account.changePassword`).
   */
  readonly isPasswordChangeRequired: boolean;
}

/**
 * The administrative actions the signed-in person may take. All false
 * offline or signed out: each needs the server.
 */
export interface AccountCapabilities {
  /**
   * The server's staff (a platform role): runs the server and never belongs
   * to a church, so the app opens the Server screen instead of a church.
   */
  readonly isPlatformAccount: boolean;
  /** Import a Bible translation (the platform administrator). */
  readonly canImportBibles: boolean;
  /** Create accounts and set their passwords (the platform administrator). */
  readonly canManageAccounts: boolean;
  /** Create, rename and delete churches, and name their owners (the platform administrator). */
  readonly canManageChurches: boolean;
  /** Invite people to the open church. */
  readonly canInviteMembers: boolean;
  /** Create accounts for new people who join the open church (its owner and admins). */
  readonly canCreateMemberAccounts: boolean;
}

/** An account on the church server, as an administrator sees it. */
export interface ManagedAccount {
  readonly id: string;
  readonly email: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly isActive: boolean;
  /** Still on a password an administrator chose. */
  readonly isPasswordChangeRequired: boolean;
}

export interface NewAccountInput {
  readonly email: string;
  readonly username: string | null;
  readonly firstName: string;
  readonly lastName: string;
}

/** A new person's account, created by the open church's owner or admins. */
export interface NewMemberAccountInput extends NewAccountInput {
  /** The role they join the church with. */
  readonly roleId: string;
}

/** A new church and the existing account that will own it. */
export interface NewChurchInput {
  readonly name: string;
  readonly ownerEmail: string;
}

/** A Bible translation published on the server. */
export interface ServerBibleTranslation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly languageCode: string;
}

/**
 * A one-time password Pakita generated for an account. Shown to the
 * administrator once, to pass on; the person must replace it at sign-in.
 */
export interface IssuedPassword {
  readonly account: ManagedAccount;
  readonly temporaryPassword: string;
}

/** A role the signed-in person may give in the open church. */
export interface InvitableRole {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface InvitationSummary {
  readonly id: string;
  /** Who was invited (their name), or why that is unknown. */
  readonly invitee: string;
  readonly roleName: string;
  readonly expiresAt: string;
}

/** An invitation with its one-time code, which is never shown again. */
export interface IssuedInvitation {
  readonly invitation: InvitationSummary;
  readonly code: string;
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

/**
 * Details suggested from the chosen folder (an eBible.org download's
 * copyright page), each valid for the server. Absent when not found.
 */
export type BibleImportSuggestion = {
  readonly [Detail in keyof BibleTranslationInput]?: string;
};

/** A folder of USFM files, read and ready to import. */
export interface BibleImportPreview {
  readonly folderName: string;
  readonly bookCount: number;
  readonly verseCount: number;
  readonly firstBook: string;
  readonly lastBook: string;
  readonly skippedCodes: readonly string[];
  readonly suggested: BibleImportSuggestion;
}

export interface BibleImportProgress {
  readonly done: number;
  readonly total: number;
  readonly bookName: string;
}

export type Theme = components['schemas']['ThemeResponseDto'];
export type ThemeInput = components['schemas']['CreateThemeDto'];

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/** A playlist as the API sends it (and the laptop stores it). */
export type Playlist = components['schemas']['PlaylistResponseDto'];
export type PlaylistItemInput = components['schemas']['PlaylistItemInputDto'];

export interface PlaylistInput {
  readonly name: string;
  /** `YYYY-MM-DD`, or null. */
  readonly serviceDate: string | null;
  readonly themeId: string | null;
  readonly items: readonly PlaylistItemInput[];
  /**
   * When updating: the `syncVersion` the edit was made from; a playlist
   * changed since is refused instead of overwritten.
   */
  readonly expectedSyncVersion?: number;
}

export interface PlaylistSummary {
  readonly id: string;
  readonly name: string;
  readonly serviceDate: string | null;
}

/** One playlist entry as this laptop can present it. */
export interface PlaylistEntry {
  readonly kind: PlaylistItemInput['kind'];
  /** A song title or a passage reference. */
  readonly title: string;
  /** The arrangement or the translation, when there is one. */
  readonly detail: string | null;
  /** False when this laptop lacks what the entry needs. */
  readonly isReady: boolean;
  /** Why it is not ready, or what will be presented instead. */
  readonly note: string | null;
  readonly slideCount: number;
  /** The entry as the server holds it, for editing. */
  readonly input: PlaylistItemInput;
}

export interface PlaylistView {
  readonly id: string;
  readonly name: string;
  readonly serviceDate: string | null;
  readonly themeId: string | null;
  readonly syncVersion: number;
  readonly entries: readonly PlaylistEntry[];
}

/** A newer published release of Pakita. */
export interface AvailableUpdate {
  readonly version: string;
  readonly url: string;
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
  /** How the slides are drawn: fixed when the presentation starts. */
  readonly look: ThemeLook;
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
    /** A newer release, once the background check has found one. */
    getUpdate(): Promise<AvailableUpdate | null>;
    /** Opens that release's download page in the browser. */
    openUpdate(): Promise<void>;
    /**
     * Puts text on the system clipboard (a one-time password or code to pass
     * on). Through the main process: the page itself has no clipboard access.
     */
    copyText(text: string): Promise<void>;
    onUpdateAvailable(listener: (update: AvailableUpdate) => void): () => void;
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
    /** Replaces the signed-in person's password; this laptop stays signed in. */
    changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<AccountSummary>;
    getCapabilities(): Promise<AccountCapabilities>;
  };
  /** The church server's accounts (the platform administrator only). */
  readonly accounts: {
    list(): Promise<ManagedAccount[]>;
    /** Creates the account with a generated one-time password. */
    create(input: NewAccountInput): Promise<IssuedPassword>;
    /** Gives the account a new one-time password and ends its sessions. */
    resetPassword(accountId: string): Promise<IssuedPassword>;
  };
  /** Invitations to the open church. */
  readonly invitations: {
    listRoles(): Promise<InvitableRole[]>;
    /** The pending ones. */
    list(): Promise<InvitationSummary[]>;
    /** Invites an existing account, by email or username. */
    create(identifier: string, roleId: string): Promise<IssuedInvitation>;
    /** A fresh code for a pending invitation; the old one stops working. */
    reissue(invitationId: string): Promise<IssuedInvitation>;
    revoke(invitationId: string): Promise<void>;
    /** Joins the church a code was issued for; returns its id. */
    accept(code: string): Promise<string>;
  };
  readonly workspaces: {
    /** The person's churches; every church, for the server's staff. */
    list(): Promise<WorkspaceSummary[]>;
    select(workspaceId: string): Promise<void>;
    /** Creates a church owned by an existing account (the platform administrator). */
    create(input: NewChurchInput): Promise<WorkspaceSummary>;
    rename(workspaceId: string, name: string): Promise<WorkspaceSummary>;
    /** Deletes a church for everyone (the platform administrator). */
    delete(workspaceId: string): Promise<void>;
    /** Makes an existing account the church's sole owner; former owners become admins. */
    replaceOwner(workspaceId: string, email: string): Promise<void>;
  };
  /** The open church's people. */
  readonly members: {
    /** Creates an account that joins the open church, with a one-time password. */
    createAccount(input: NewMemberAccountInput): Promise<IssuedPassword>;
  };
  readonly sync: {
    now(): Promise<SyncStatus>;
    getStatus(): Promise<SyncStatus>;
    /** Downloads everything again, keeping the current copy until done. */
    rebuild(): Promise<SyncStatus>;
    onStatus(listener: (status: SyncStatus) => void): () => void;
  };
  readonly library: {
    listSongs(search: string, isArchived: boolean): Promise<SongSummary[]>;
    getSong(songId: string): Promise<Song | null>;
  };
  readonly songs: {
    create(input: SongInput): Promise<Song>;
    update(songId: string, input: SongInput): Promise<Song>;
    /** Copies the song to another workspace the person belongs to. */
    copy(songId: string, targetWorkspaceId: string): Promise<void>;
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
    /** The translations published on the server (online). */
    listServerTranslations(): Promise<ServerBibleTranslation[]>;
    onImportProgress(
      listener: (progress: BibleImportProgress) => void,
    ): () => void;
  };
  readonly themes: {
    list(): Promise<ThemeSummary[]>;
    get(themeId: string): Promise<Theme | null>;
    create(input: ThemeInput): Promise<Theme>;
    update(themeId: string, input: ThemeInput): Promise<Theme>;
    delete(themeId: string): Promise<void>;
  };
  readonly playlists: {
    list(): Promise<PlaylistSummary[]>;
    /** With each entry's readiness on this laptop. */
    get(playlistId: string): Promise<PlaylistView | null>;
    create(input: PlaylistInput): Promise<PlaylistView | null>;
    update(
      playlistId: string,
      input: PlaylistInput,
    ): Promise<PlaylistView | null>;
    delete(playlistId: string): Promise<void>;
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
    /** Presents the whole playlist, from the entry at `entryIndex`. */
    startPlaylist(playlistId: string, entryIndex: number): Promise<LiveState>;
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
