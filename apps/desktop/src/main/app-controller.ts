import {
  app,
  type BrowserWindow,
  dialog,
  net,
  shell,
  safeStorage,
  screen,
} from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { z } from 'zod';

import {
  type AccountCapabilities,
  type AccountSummary,
  type AppState,
  type BibleBook,
  type BibleImportPreview,
  type BibleSearchHit,
  type BibleTranslation,
  type BibleTranslationInput,
  type BibleVerse,
  type DatabaseHealth,
  type DisplayInfo,
  type InvitableRole,
  type InvitationSummary,
  IpcEvent,
  type IssuedInvitation,
  type IssuedPassword,
  type ChurchOwner,
  type ListedAccount,
  type ListPage,
  type ListPageQuery,
  type ManagedAccount,
  type NewAccountInput,
  type NewChurchInput,
  type NewMemberAccountInput,
  type LiveState,
  type MediaFileState,
  type MediaItem,
  type MediaUploadInput,
  type PassageRequest,
  type PickedImage,
  type PickedVideo,
  type PlaylistInput,
  type PlaylistSummary,
  type PlaylistView,
  type Theme,
  type ThemeInput,
  type ThemeSummary,
  type ServerBibleTranslation,
  type ServerConnection,
  type Song,
  type SongInput,
  type SongSummary,
  type SyncStatus,
  type WorkspaceSummary,
} from '../shared/ipc-contract';
import {
  buildPassageSlides,
  buildSongSlides,
  formatReference,
} from '../shared/slides';
import {
  DEFAULT_THEME_LOOK,
  type LocalBackground,
  lookOf,
  type ThemeLook,
} from '../shared/theme-look';
import { ApiClient, ApiError } from './api/api-client';
import {
  acceptedInvitationSchema,
  bibleContentSchema,
  bibleTranslationListSchema,
  bibleTranslationSchema,
  serverBibleTranslationListSchema,
  invitationPageSchema,
  type invitationSchema,
  issuedInvitationSchema,
  type Media,
  mediaDownloadSchema,
  mediaSchema,
  mediaUploadSchema,
  uploadedFileSchema,
  membershipPageSchema,
  membershipSchema,
  playlistSchema,
  rolePageSchema,
  serverInfoSchema,
  songSchema,
  syncChangesSchema,
  themeSchema,
  userPageSchema,
  userPermissionsSchema,
  type userSchema,
  userSchema as managedUserSchema,
  workspaceSchema,
  workspaceListPageSchema,
  workspacePageSchema,
} from './api/api-schemas';
import { parseServerAddress } from './api/server-address';
import { CredentialStore, type StoredAccount } from './auth/credential-store';
import { Session, SignInRequiredError } from './auth/session';
import { capabilitiesOf, NO_CAPABILITIES } from './auth/permissions';
import { generateTemporaryPassword } from './auth/temporary-password';
import {
  readUsfmFolder,
  type TranslationUploader,
  uploadTranslation,
  type UsfmFolder,
} from './bible/bible-import';
import { readSuggestedDetails } from './bible/ebible-details';
import { checkCompatibility } from './compatibility';
import { DatabaseClient } from './database/database-client';
import {
  isMediaType,
  MEDIA_EXTENSIONS,
  MEDIA_FILE_NAME,
  MediaFolder,
  TYPE_BY_EXTENSION,
} from './media/media-folder';
import { MediaSync } from './media/media-sync';
import {
  PickedFiles,
  PickedImages,
  uploadPickedVideo,
} from './media/media-upload';
import { putFile } from './media/put-file';
import { LiveSession } from './presentation/live-session';
import {
  buildDeck,
  type LoadedPassage,
  resolvePlaylist,
} from './presentation/playlist-deck';
import { Projector } from './presentation/projector';
import { AppSettingsStore } from './storage/app-settings';
import { slugOf } from './slug';
import { syncBibleTranslations } from './sync/bible-sync';
import {
  type AvailableUpdate,
  findUpdate,
  isReleasePage,
} from './updates/update-check';
import { SyncEngine } from './sync/sync-engine';

/** How often a signed-in laptop checks for changes in the background. */
const BACKGROUND_SYNC_INTERVAL_MILLISECONDS = 2 * 60_000;
const DATABASE_REOPEN_INTERVAL_MILLISECONDS = 60_000;
const UPDATE_CHECK_DELAY_MILLISECONDS = 30_000;
const UPDATE_CHECK_INTERVAL_MILLISECONDS = 12 * 60 * 60_000;
/** A whole translation is a few megabytes; allow a slow church connection. */
const BIBLE_DOWNLOAD_TIMEOUT_MILLISECONDS = 5 * 60_000;
/** Ten times a complete Bible with every verse at a typical length. */
const MAX_BIBLE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
/** Publishing hashes the whole translation on the server. */
const PUBLISH_TIMEOUT_MILLISECONDS = 2 * 60_000;
/** A chapter refused for rate limiting is retried this often, this late. */
/** How many rows a page of a server-searched list holds. */
const SERVER_LIST_PAGE_SIZE = 50;
/** How many accounts an owner picker suggests at once. */
const POSSIBLE_OWNER_SUGGESTIONS = 8;
const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_DELAY_MILLISECONDS = 15_000;
/** Verses in a chapter are at most this many (Psalm 119 has 176). */
const MAX_CHAPTER_VERSE = 200;
// A bound on paging an administrative list: 100 pages of 100 rows, far beyond
// any church server, so a server that miscounts cannot keep the loop going.
const MAX_LIST_PAGES = 100;

export interface AppControllerOptions {
  readonly userDataDirectory: string;
  readonly databaseWorkerPath: string;
  readonly projectorPreloadPath: string;
  readonly loadProjectorPage: (window: BrowserWindow) => Promise<void>;
  readonly getOperatorWindow: () => BrowserWindow | null;
}

/**
 * Everything the operator can do, in one place. The IPC handlers in index.ts
 * validate each request's payload and call the matching method here.
 *
 * Presenting reads only the local database and memory: no method on the
 * presentation path waits on the network.
 */
export class AppController {
  private readonly settings: AppSettingsStore;
  private readonly credentials: CredentialStore;
  private api: ApiClient | null = null;
  private session: Session | null = null;
  private database: DatabaseClient | null = null;
  private syncEngine: SyncEngine | null = null;
  private readonly live = new LiveSession();
  private readonly projector: Projector;
  private backgroundSyncTimer: NodeJS.Timeout | null = null;
  /** The USFM folder read by `chooseBibleImportFolder`, awaiting import. */
  private pendingBibleImport: UsfmFolder | null = null;
  private isImportingBible = false;
  private lastDatabaseReopen = 0;
  private availableUpdate: AvailableUpdate | null = null;
  private updateCheckTimer: NodeJS.Timeout | null = null;
  private databaseReopenTimer: NodeJS.Timeout | null = null;
  /** Bible downloads that failed verification (see bible-sync). */
  private readonly rejectedBibleContent = new Set<string>();
  /** This account's downloaded videos (see MediaFolder). */
  private mediaFolder: MediaFolder | null = null;
  private mediaSync: MediaSync | null = null;
  private readonly pickedFiles: PickedFiles;
  private readonly pickedImages = new PickedImages();
  /** Settles once the remembered session (and its token) is loaded. */
  private sessionReady: Promise<void> = Promise.resolve();

  constructor(private readonly options: AppControllerOptions) {
    this.settings = new AppSettingsStore(options.userDataDirectory);
    // Normalised copies of picked videos, kept only while they upload; a
    // previous run's leftovers go now.
    const conversions = join(app.getPath('temp'), 'pakita-videos');
    rmSync(conversions, { recursive: true, force: true });
    this.pickedFiles = new PickedFiles(conversions);
    this.credentials = new CredentialStore(
      options.userDataDirectory,
      safeStorage,
    );
    this.projector = new Projector({
      preloadPath: options.projectorPreloadPath,
      loadPage: options.loadProjectorPage,
      getChosenDisplayId: () => this.settings.get().projectorDisplayId,
      onStatusChange: () => this.broadcastLiveState(),
      currentState: () => this.liveState(),
    });
    screen.on('display-added', () => this.notifyDisplaysChanged());
    screen.on('display-removed', () => this.notifyDisplaysChanged());
  }

  /**
   * Restores the remembered server and account. The account's local database
   * opens first, from files alone, so its content is presentable at once —
   * offline, and even while the system keychain (which holds the refresh
   * token) is still answering. The session follows in the background.
   */
  initialize(): void {
    const { serverOrigin } = this.settings.get();
    const account = this.credentials.loadAccount();
    const isAccountOnServer =
      account !== null && account.origin === serverOrigin;
    if (account && isAccountOnServer) {
      this.openDatabase(account);
    }
    if (serverOrigin) {
      this.sessionReady = this.useServer(
        serverOrigin,
        isAccountOnServer ? account : null,
      ).then(() => {
        if (account && isAccountOnServer) this.startSync();
      });
    }
  }

  // ── State ─────────────────────────────────────────────────────────────

  getState(): AppState {
    const account =
      this.session?.getAccount() ??
      (this.database ? this.credentials.loadAccount() : null);
    return {
      serverOrigin: this.settings.get().serverOrigin,
      account: account ? this.summarise(account) : null,
      workspaceId: this.settings.get().workspaceId,
    };
  }

  /**
   * Checks GitHub for a newer published release now and then, and tells the
   * operator. Packaged builds only; nothing is downloaded or installed.
   */
  startUpdateChecks(): void {
    if (!app.isPackaged || this.updateCheckTimer) return;
    const check = async () => {
      const update = await findUpdate(app.getVersion(), (input, init) =>
        net.fetch(input, init),
      );
      if (update && update.version !== this.availableUpdate?.version) {
        this.availableUpdate = update;
        this.send(IpcEvent.updateAvailable, update);
      }
    };
    this.updateCheckTimer = setTimeout(() => {
      void check();
      this.updateCheckTimer = setInterval(
        () => void check(),
        UPDATE_CHECK_INTERVAL_MILLISECONDS,
      );
      this.updateCheckTimer.unref();
    }, UPDATE_CHECK_DELAY_MILLISECONDS);
    this.updateCheckTimer.unref();
  }

  getUpdate(): AvailableUpdate | null {
    return this.availableUpdate;
  }

  async openUpdate(): Promise<void> {
    const url = this.availableUpdate?.url;
    if (url && isReleasePage(url)) await shell.openExternal(url);
  }

  async getDatabaseHealth(): Promise<DatabaseHealth | null> {
    return this.database ? this.database.getHealth() : null;
  }

  // ── Server and account (online) ───────────────────────────────────────

  async connect(address: string): Promise<ServerConnection> {
    await this.sessionReady;
    const parsed = parseServerAddress(address);
    if (!parsed.isValid) {
      throw new Error(parsed.reason);
    }
    const account = this.session?.getAccount() ?? null;
    if (account && account.origin !== parsed.origin) {
      throw new Error('Sign out before connecting to a different server.');
    }
    const client = new ApiClient(parsed.origin, (input, init) =>
      net.fetch(input, init),
    );
    const info = await client.request({
      method: 'GET',
      path: '/api/public/server-info',
      schema: serverInfoSchema,
    });
    const compatibility = checkCompatibility(info, app.getVersion());
    this.settings.update({ serverOrigin: parsed.origin });
    await this.useServer(parsed.origin, account);
    return {
      origin: parsed.origin,
      serverVersion: info.serverVersion,
      compatibility,
    };
  }

  async signIn(identifier: string, password: string): Promise<AccountSummary> {
    await this.sessionReady;
    const { api, session } = this.requireServer();
    const info = await api.request({
      method: 'GET',
      path: '/api/public/server-info',
      schema: serverInfoSchema,
    });
    const compatibility = checkCompatibility(info, app.getVersion());
    if (compatibility.status !== 'compatible') {
      throw new Error(compatibility.message ?? 'Incompatible server.');
    }
    const previous = session.getAccount();
    const account = await session.signIn(identifier, password);
    if (previous && previous.userId !== account.userId) {
      // Someone else signed in on this laptop: the previous account's content
      // and church choice go, exactly as on sign-out.
      this.cancelDatabaseReopen();
      this.stopBackgroundSync();
      await this.database?.close();
      this.database = null;
      this.syncEngine = null;
      this.stopMedia();
      rmSync(this.accountDirectory(previous), { recursive: true, force: true });
      this.settings.update({ workspaceId: null });
    }
    // Signing in again as the same person keeps the database already open.
    if (!this.database) {
      this.openDatabase(account);
    }
    // On a password an administrator chose, the server answers nothing else
    // until it is replaced (`changePassword` starts synchronising then).
    if (account.isPasswordChangeRequired) {
      // Signed in again after an administrator's reset: whatever was
      // synchronising before stops until the new password is chosen.
      this.stopBackgroundSync();
      this.syncEngine = null;
      this.mediaSync?.stop();
      this.mediaSync = null;
    } else {
      this.startSync();
    }
    return this.summarise(account);
  }

  /**
   * Replaces the signed-in person's password. The server ends every other
   * session and this laptop continues on the fresh one it returns.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<AccountSummary> {
    await this.sessionReady;
    const wasRequired =
      this.requireSession().getAccount()?.isPasswordChangeRequired;
    const account = await this.requireSession().changePassword(
      currentPassword,
      newPassword,
    );
    if (wasRequired) {
      this.startSync();
    }
    return this.summarise(account);
  }

  /** What the signed-in person may administer; nothing offline. */
  async getCapabilities(): Promise<AccountCapabilities> {
    await this.sessionReady;
    if (!this.session?.isSignedIn) return NO_CAPABILITIES;
    try {
      const { rules } = await this.session.request({
        method: 'GET',
        path: '/api/users/me/permissions',
        schema: userPermissionsSchema,
      });
      return capabilitiesOf(rules, this.settings.get().workspaceId);
    } catch {
      return NO_CAPABILITIES;
    }
  }

  // ── Accounts (the platform administrator) ─────────────────────────────

  async listAccounts(query: ListPageQuery): Promise<ListPage<ListedAccount>> {
    await this.sessionReady;
    const page = await this.requestListPage(
      '/api/users',
      { isDeleted: 'false', sortBy: 'firstName', sortOrder: 'asc' },
      query,
      userPageSchema,
    );
    return { items: page.data.map(toListedAccount), hasMore: page.hasMore };
  }

  /**
   * Creates an account with a generated one-time password, returned once so
   * the administrator can pass it on; the person replaces it at sign-in.
   */
  async createAccount(input: NewAccountInput): Promise<IssuedPassword> {
    await this.sessionReady;
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.requireSession().request({
      method: 'POST',
      path: '/api/users',
      schema: managedUserSchema,
      body: {
        email: input.email,
        ...(input.username ? { username: input.username } : {}),
        firstName: input.firstName,
        lastName: input.lastName,
        password: temporaryPassword,
      },
    });
    return { account: toManagedAccount(user), temporaryPassword };
  }

  /** A new one-time password for someone who lost theirs. */
  async resetAccountPassword(accountId: string): Promise<IssuedPassword> {
    await this.sessionReady;
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.requireSession().request({
      method: 'PATCH',
      path: `/api/users/${accountId}/password`,
      schema: managedUserSchema,
      body: { newPassword: temporaryPassword },
    });
    return { account: toManagedAccount(user), temporaryPassword };
  }

  // ── Invitations to the open church ────────────────────────────────────

  /** The roles the signed-in person may give in the open church. */
  async listInvitableRoles(): Promise<InvitableRole[]> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const page = await this.requireSession().request({
      method: 'GET',
      path: `/api/roles?scope=workspace&assignableIn=${workspaceId}&perPage=100`,
      schema: rolePageSchema,
    });
    return [...page.data]
      .sort((first, second) => first.rank - second.rank)
      .map(({ id, name, description }) => ({ id, name, description }));
  }

  async listInvitations(): Promise<InvitationSummary[]> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const invitations = await this.fetchAllPages(
      `/api/workspaces/${workspaceId}/invitations?sortBy=createdAt&sortOrder=desc`,
      invitationPageSchema,
    );
    const now = Date.now();
    return invitations
      .filter(
        (invitation) =>
          invitation.status === 'pending' &&
          Date.parse(invitation.expiresAt) > now,
      )
      .map(toInvitationSummary);
  }

  async createInvitation(
    identifier: string,
    roleId: string,
  ): Promise<IssuedInvitation> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const issued = await this.requireSession().request({
      method: 'POST',
      path: `/api/workspaces/${workspaceId}/invitations`,
      schema: issuedInvitationSchema,
      body: { identifier, roleId },
    });
    return { invitation: toInvitationSummary(issued), code: issued.token };
  }

  async reissueInvitation(invitationId: string): Promise<IssuedInvitation> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const issued = await this.requireSession().request({
      method: 'POST',
      path: `/api/workspaces/${workspaceId}/invitations/${invitationId}/resend`,
      schema: issuedInvitationSchema,
    });
    return { invitation: toInvitationSummary(issued), code: issued.token };
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    await this.requireSession().request<void>({
      method: 'DELETE',
      path: `/api/workspaces/${workspaceId}/invitations/${invitationId}`,
    });
  }

  /** Joins the church an invitation code was issued for. */
  async acceptInvitation(code: string): Promise<string> {
    await this.sessionReady;
    const accepted = await this.requireSession().request({
      method: 'POST',
      path: '/api/invitations/accept',
      schema: acceptedInvitationSchema,
      body: { token: code },
    });
    return accepted.workspaceId;
  }

  /** Signs out and removes this account's content from the laptop. */
  async signOut(): Promise<void> {
    await this.sessionReady;
    const account = this.session?.getAccount() ?? null;
    this.cancelDatabaseReopen();
    this.stopBackgroundSync();
    await this.session?.signOut();
    await this.database?.close();
    this.database = null;
    this.syncEngine = null;
    this.stopMedia();
    if (account) {
      rmSync(this.accountDirectory(account), { recursive: true, force: true });
    }
    this.settings.update({ workspaceId: null });
  }

  /** Every church on the server, for its staff: searched and paged there. */
  async browseWorkspaces(
    query: ListPageQuery,
  ): Promise<ListPage<WorkspaceSummary>> {
    await this.sessionReady;
    const page = await this.requestListPage(
      '/api/workspaces',
      { sortBy: 'name', sortOrder: 'asc' },
      query,
      workspaceListPageSchema,
    );
    return { items: page.data, hasMore: page.hasMore };
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    await this.sessionReady;
    const session = this.requireSession();
    const page = await session.request({
      method: 'GET',
      path: '/api/workspaces?perPage=100',
      schema: workspacePageSchema,
    });
    return page.data;
  }

  /**
   * Creates a church owned by an existing account (the platform
   * administrator, who does not join it). Its web-address name is derived
   * from its name.
   */
  async createWorkspace(input: NewChurchInput): Promise<WorkspaceSummary> {
    await this.sessionReady;
    const workspace = await this.requireSession().request({
      method: 'POST',
      path: '/api/workspaces',
      schema: workspaceSchema,
      body: {
        name: input.name.trim(),
        slug: slugOf(input.name),
        ownerEmail: input.ownerEmail.trim(),
      },
    });
    return { id: workspace.id, name: workspace.name, slug: workspace.slug };
  }

  async renameWorkspace(
    workspaceId: string,
    name: string,
  ): Promise<WorkspaceSummary> {
    await this.sessionReady;
    const workspace = await this.requireSession().request({
      method: 'PATCH',
      path: `/api/workspaces/${workspaceId}`,
      schema: workspaceSchema,
      body: { name: name.trim() },
    });
    return { id: workspace.id, name: workspace.name, slug: workspace.slug };
  }

  /** Deletes a church for everyone on the server. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.sessionReady;
    await this.requireSession().request<void>({
      method: 'DELETE',
      path: `/api/workspaces/${workspaceId}`,
    });
  }

  /** Makes an existing account the church's sole owner. */
  async replaceWorkspaceOwner(
    workspaceId: string,
    email: string,
  ): Promise<void> {
    await this.sessionReady;
    await this.requireSession().request({
      method: 'PUT',
      path: `/api/workspaces/${workspaceId}/owner`,
      schema: membershipSchema,
      body: { email: email.trim() },
    });
  }

  /** The church's owner; null when it has none. */
  async getWorkspaceOwner(workspaceId: string): Promise<ChurchOwner | null> {
    await this.sessionReady;
    const page = await this.requireSession().request({
      method: 'GET',
      path: `/api/workspaces/${workspaceId}/memberships?roleName=workspace_owner&perPage=1`,
      schema: membershipPageSchema,
    });
    const owner = page.data[0]?.user;
    return owner
      ? {
          id: owner.id,
          displayName: `${owner.firstName} ${owner.lastName}`.trim(),
          email: owner.email,
        }
      : null;
  }

  /** Active accounts outside the server's staff that match every word of `term`. */
  async searchPossibleOwners(term: string): Promise<ListedAccount[]> {
    await this.sessionReady;
    const query = new URLSearchParams({
      search: term,
      isDeleted: 'false',
      isActive: 'true',
      isPlatformAccount: 'false',
      sortBy: 'firstName',
      sortOrder: 'asc',
      perPage: String(POSSIBLE_OWNER_SUGGESTIONS),
    });
    const page = await this.requireSession().request({
      method: 'GET',
      path: `/api/users?${query.toString()}`,
      schema: userPageSchema,
    });
    return page.data.map(toListedAccount);
  }

  /**
   * Creates an account for a new person who joins the open church, with a
   * generated one-time password returned once to pass on.
   */
  async createMemberAccount(
    input: NewMemberAccountInput,
  ): Promise<IssuedPassword> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const temporaryPassword = generateTemporaryPassword();
    const membership = await this.requireSession().request({
      method: 'POST',
      path: `/api/workspaces/${workspaceId}/accounts`,
      schema: membershipSchema,
      body: {
        email: input.email,
        ...(input.username ? { username: input.username } : {}),
        firstName: input.firstName,
        lastName: input.lastName,
        password: temporaryPassword,
        roleId: input.roleId,
      },
    });
    const { user } = membership;
    return {
      account: {
        id: user.id,
        email: user.email,
        username: input.username,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
        isActive: true,
        isPasswordChangeRequired: true,
      },
      temporaryPassword,
    };
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    this.settings.update({ workspaceId });
    this.startBackgroundSync();
    await this.syncNow();
  }

  // ── Synchronisation ───────────────────────────────────────────────────

  getSyncStatus(): SyncStatus {
    return (
      this.syncEngine?.getStatus() ?? {
        state: 'idle',
        lastSyncedAt: null,
        message: null,
      }
    );
  }

  async syncNow(): Promise<SyncStatus> {
    await this.sessionReady;
    const { workspaceId } = this.settings.get();
    if (!this.syncEngine || !workspaceId) {
      return this.getSyncStatus();
    }
    const status = await this.syncEngine.syncWorkspace(workspaceId);
    // Videos download after the rows that name them, in the background:
    // a large one never holds up the next synchronisation.
    if (status.state === 'idle') void this.mediaSync?.run();
    return status;
  }

  /**
   * Downloads the workspace's whole history again, for a laptop whose copy
   * seems wrong. The current copy stays presentable until the new one has
   * fully arrived (see ContentStore.beginResync); Bible translations that
   * failed verification are tried again.
   */
  async rebuildLocalCopy(): Promise<SyncStatus> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    if (!this.syncEngine) return this.getSyncStatus();
    this.rejectedBibleContent.clear();
    this.mediaSync?.forgetRejections();
    return this.syncEngine.rebuildWorkspace(workspaceId);
  }

  // ── Library (offline) and editing (online) ────────────────────────────

  async listSongs(search: string, isArchived: boolean): Promise<SongSummary[]> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return [];
    return this.database.listSongs(workspaceId, search, isArchived);
  }

  async getSong(songId: string): Promise<Song | null> {
    const loaded = await this.loadSong(songId);
    return loaded.status === 'found' ? loaded.song : null;
  }

  private async loadSong(
    songId: string,
  ): Promise<
    | { status: 'found'; song: Song }
    | { status: 'missing' }
    | { status: 'unreadable' }
  > {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return { status: 'missing' };
    const stored = await this.database.getSong(workspaceId, songId);
    if (stored === null) return { status: 'missing' };
    const parsed = songSchema.safeParse(stored);
    return parsed.success
      ? { status: 'found', song: parsed.data }
      : { status: 'unreadable' };
  }

  async createSong(input: SongInput): Promise<Song> {
    return this.writeOnline('POST', 'songs', songSchema, input);
  }

  /** Copies a song to another of the person's workspaces (online). */
  async copySong(songId: string, targetWorkspaceId: string): Promise<void> {
    await this.writeOnline('POST', `songs/${songId}/copy`, songSchema, {
      targetWorkspaceId,
    });
  }

  async updateSong(songId: string, input: SongInput): Promise<Song> {
    return this.writeOnline('PATCH', `songs/${songId}`, songSchema, input);
  }

  // ── Bible (offline) and importing (online) ────────────────────────────

  async listBibleTranslations(): Promise<BibleTranslation[]> {
    if (!this.database) return [];
    return (await this.database.listBibleTranslations()).map(
      ({ id, code, name, languageCode, attribution, verseCount }) => ({
        id,
        code,
        name,
        languageCode,
        attribution,
        verseCount,
      }),
    );
  }

  async listBibleBooks(translationId: string): Promise<BibleBook[]> {
    if (!this.database) return [];
    return (await this.database.listBibleBooks(translationId)).map(
      ({ code, name, chapterCount }) => ({ code, name, chapterCount }),
    );
  }

  async getBibleChapter(
    translationId: string,
    bookCode: string,
    chapter: number,
  ): Promise<BibleVerse[]> {
    if (!this.database) return [];
    return this.database.getBiblePassage(
      translationId,
      bookCode,
      { chapter, verse: 1 },
      { chapter, verse: MAX_CHAPTER_VERSE },
    );
  }

  async searchBible(
    translationId: string,
    search: string,
  ): Promise<BibleSearchHit[]> {
    if (!this.database) return [];
    return this.database.searchBible(translationId, search);
  }

  /**
   * Asks the administrator for a folder of USFM files and reads it, so they
   * can check what was found before anything is sent to the server.
   */
  async chooseBibleImportFolder(): Promise<BibleImportPreview | null> {
    await this.sessionReady;
    this.requireSession();
    const window = this.options.getOperatorWindow();
    const options = {
      title: 'Choose the folder holding the translation’s USFM files',
      properties: ['openDirectory' as const],
    };
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const directory = choice.filePaths[0];
    if (choice.canceled || !directory) return null;
    const folder = await readUsfmFolder(directory);
    this.pendingBibleImport = folder;
    return {
      folderName: basename(directory),
      bookCount: folder.books.length,
      verseCount: folder.verseCount,
      firstBook: folder.books[0]!.name,
      lastBook: folder.books.at(-1)!.name,
      skippedCodes: folder.skippedCodes,
      suggested: await readSuggestedDetails(directory),
    };
  }

  /** The translations published on the server, for its administrator. */
  async listServerBibleTranslations(): Promise<ServerBibleTranslation[]> {
    await this.sessionReady;
    const translations = await this.requireSession().request({
      method: 'GET',
      path: '/api/bible-translations',
      schema: serverBibleTranslationListSchema,
    });
    return translations.flatMap(
      ({
        id,
        code,
        name,
        languageCode,
        licence,
        attribution,
        sourceUrl,
        verseCount,
        isPublished,
        publishedAt,
      }) =>
        isPublished && publishedAt
          ? [
              {
                id,
                code,
                name,
                languageCode,
                licence,
                attribution,
                sourceUrl,
                verseCount,
                publishedAt,
              },
            ]
          : [],
    );
  }

  /** Imports the chosen folder as a new translation, publishes it, then syncs. */
  async importBible(input: BibleTranslationInput): Promise<void> {
    await this.sessionReady;
    const session = this.requireSession();
    const folder = this.pendingBibleImport;
    if (!folder) {
      throw new Error('Choose the translation’s folder first.');
    }
    if (this.isImportingBible) {
      throw new Error('An import is already running.');
    }
    this.isImportingBible = true;
    try {
      await uploadTranslation(
        this.translationUploader(session),
        input,
        folder,
        (progress) => this.send(IpcEvent.bibleImportProgress, progress),
      );
      this.pendingBibleImport = null;
    } finally {
      this.isImportingBible = false;
    }
    await this.syncNow();
  }

  // ── Themes and playlists (offline) and editing them (online) ─────────

  async listThemes(): Promise<ThemeSummary[]> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return [];
    return this.database.listThemes(workspaceId);
  }

  async getTheme(themeId: string): Promise<Theme | null> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return null;
    const parsed = themeSchema.safeParse(
      await this.database.getTheme(workspaceId, themeId),
    );
    return parsed.success ? parsed.data : null;
  }

  async createTheme(input: ThemeInput): Promise<Theme> {
    return this.writeOnline('POST', 'themes', themeSchema, input);
  }

  async updateTheme(themeId: string, input: ThemeInput): Promise<Theme> {
    return this.writeOnline('PATCH', `themes/${themeId}`, themeSchema, input);
  }

  async deleteTheme(themeId: string): Promise<void> {
    await this.writeOnline('DELETE', `themes/${themeId}`);
  }

  // ── Background videos ─────────────────────────────────────────────────

  /** The workspace's videos, with what this laptop holds of each. */
  async listMedia(): Promise<MediaItem[]> {
    const folder = this.mediaFolder;
    if (!folder) return [];
    const states = new Map(
      (this.mediaSync?.getStates() ?? []).map((state) => [
        state.mediaId,
        state,
      ]),
    );
    return Promise.all(
      (await this.loadMedia()).map(async (media) => {
        const isHeld =
          isMediaType(media.contentType) &&
          (await folder.has({
            sha256: media.sha256,
            contentType: media.contentType,
          }));
        const url = isHeld ? this.mediaUrlOf(media) : null;
        const file: MediaFileState = isHeld
          ? {
              mediaId: media.id,
              state: 'ready',
              receivedBytes: media.sizeBytes,
              sizeBytes: media.sizeBytes,
              message: null,
            }
          : (states.get(media.id) ?? {
              mediaId: media.id,
              state: 'waiting',
              receivedBytes: 0,
              sizeBytes: media.sizeBytes,
              message: null,
            });
        return {
          id: media.id,
          name: media.name,
          kind: media.kind,
          sha256: media.sha256,
          contentType: media.contentType,
          sizeBytes: media.sizeBytes,
          width: media.width,
          height: media.height,
          durationMs: media.durationMs,
          file,
          url,
          posterUrl:
            media.kind === 'image'
              ? url
              : (await folder.hasPoster(media.sha256))
                ? `pakita-media://files/${media.sha256}.webp`
                : null,
        };
      }),
    );
  }

  /** The system file dialog, for a video to upload. */
  async pickMedia(): Promise<PickedVideo | null> {
    const window = this.options.getOperatorWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a background video',
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'mov', 'webm'] }],
    };
    const chosen = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const path = chosen.filePaths[0];
    if (chosen.canceled || !path) return null;
    return this.pickedFiles.add(path);
  }

  /** Uploads a picked video straight to the church's storage and adds it. */
  async uploadMedia(input: MediaUploadInput): Promise<MediaItem> {
    await this.sessionReady;
    const picked = this.pickedFiles.get(input.token);
    const folder = this.mediaFolder;
    if (!picked || !folder) {
      throw new Error('Choose the video again.');
    }
    const workspaceId = this.requireWorkspace();
    const session = this.requireSession();
    const base = `/api/workspaces/${workspaceId}/media`;
    const media = await uploadPickedVideo(picked, input, {
      folder,
      startUpload: (body) =>
        session.request({
          method: 'POST',
          path: `${base}/uploads`,
          schema: mediaUploadSchema,
          body,
        }),
      putFile,
      createMedia: (body) =>
        session.request({
          method: 'POST',
          path: base,
          schema: mediaSchema,
          body,
        }),
      onProgress: (progress) =>
        this.send(IpcEvent.mediaUploadProgress, progress),
    });
    await this.pickedFiles.forget(input.token);
    await this.syncNow();
    const listed = (await this.listMedia()).find(
      (item) => item.id === media.id,
    );
    if (!listed) throw new Error('The video was added; synchronise to see it.');
    return listed;
  }

  beginNormalizedVideo(): Promise<string> {
    return this.pickedFiles.beginOutput();
  }

  writeNormalizedVideo(
    outputToken: string,
    position: number,
    data: Uint8Array,
  ): Promise<void> {
    return this.pickedFiles.writeOutput(outputToken, position, data);
  }

  finishNormalizedVideo(
    outputToken: string,
    sourceFileName: string,
    contentType: 'video/mp4' | 'video/webm',
  ): Promise<PickedVideo> {
    return this.pickedFiles.finishOutput(
      outputToken,
      sourceFileName,
      contentType,
    );
  }

  discardNormalizedVideo(outputToken: string): Promise<void> {
    return this.pickedFiles.discardOutput(outputToken);
  }

  /** The system file dialog, for an image to upload. */
  async pickImage(): Promise<PickedImage | null> {
    const window = this.options.getOperatorWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    };
    const chosen = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const path = chosen.filePaths[0];
    if (chosen.canceled || !path) return null;
    return this.pickedImages.add(path);
  }

  /**
   * Uploads a picked image through the API, which re-encodes it (dropping
   * its metadata), and adds it. The laptop then downloads the stored image
   * like any other: what it shows is what every laptop shows.
   */
  async uploadImage(token: string, name: string): Promise<MediaItem> {
    await this.sessionReady;
    const picked = this.pickedImages.get(token);
    if (!picked) throw new Error('Choose the image again.');
    const workspaceId = this.requireWorkspace();
    const session = this.requireSession();
    const form = new FormData();
    form.set('purpose', 'background_image');
    form.set(
      'file',
      new Blob([await readFile(picked.path)], { type: picked.contentType }),
      picked.fileName,
    );
    const uploaded = await session.request({
      method: 'POST',
      path: '/api/files',
      schema: uploadedFileSchema,
      formData: form,
    });
    const media = await session.request({
      method: 'POST',
      path: `/api/workspaces/${workspaceId}/media`,
      schema: mediaSchema,
      body: { fileId: uploaded.id, name },
    });
    this.pickedImages.forget(token);
    await this.syncNow();
    const listed = (await this.listMedia()).find(
      (item) => item.id === media.id,
    );
    if (!listed) throw new Error('The image was added; synchronise to see it.');
    return listed;
  }

  async renameMedia(mediaId: string, name: string): Promise<void> {
    await this.writeOnline('PATCH', `media/${mediaId}`, mediaSchema, { name });
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.writeOnline('DELETE', `media/${mediaId}`);
  }

  /** Keeps a still frame the operator window drew from a downloaded video. */
  async saveMediaPoster(sha256: string, webp: Uint8Array): Promise<void> {
    const folder = this.mediaFolder;
    const isKnown = (await this.loadMedia()).some(
      (media) => media.sha256 === sha256,
    );
    if (!folder || !isKnown) return;
    await folder.savePoster(sha256, webp);
  }

  /**
   * The local file a `pakita-media://` URL names: a verified video or still
   * frame in this account's media folder (`files/<sha256>.<ext>`), or a
   * video the operator just picked (`picked/<token>`). Nothing else.
   */
  resolveMediaFile(url: URL): { path: string; contentType: string } | null {
    const name = url.pathname.replace(/^\//, '');
    if (url.hostname === 'files' && this.mediaFolder) {
      const file = MEDIA_FILE_NAME.exec(name);
      return file
        ? {
            path: this.mediaFolder.pathOf(name),
            contentType: TYPE_BY_EXTENSION[file[2]!]!,
          }
        : null;
    }
    if (url.hostname === 'picked') {
      const picked = this.pickedFiles.get(name);
      return picked
        ? { path: picked.path, contentType: picked.contentType }
        : null;
    }
    return null;
  }

  private mediaUrlOf(media: Pick<Media, 'sha256' | 'contentType'>): string {
    const extension = isMediaType(media.contentType)
      ? MEDIA_EXTENSIONS[media.contentType]
      : 'bin';
    return `pakita-media://files/${media.sha256}.${extension}`;
  }

  /** The current workspace's videos, as stored (each validated). */
  private async loadMedia(): Promise<Media[]> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return [];
    return (await this.database.listMedia(workspaceId)).flatMap((stored) => {
      const parsed = mediaSchema.safeParse(stored);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private startMedia(database: DatabaseClient, session: Session): void {
    const folder = this.mediaFolder;
    this.mediaSync?.stop();
    if (!folder) return;
    this.mediaSync = new MediaSync({
      folder,
      listMedia: () => this.loadMedia(),
      listAllHashes: () => database.listMediaHashes(),
      downloadUrl: async (mediaId) => {
        const workspaceId = this.requireWorkspace();
        const download = await session.request({
          method: 'GET',
          path: `/api/workspaces/${workspaceId}/media/${mediaId}/download`,
          schema: mediaDownloadSchema,
        });
        return download.url;
      },
      fetchFunction: (input, init) => net.fetch(input, init),
      isLive: () => this.live.isLive,
      onChange: (states) => this.send(IpcEvent.mediaFiles, states),
    });
  }

  private stopMedia(): void {
    this.mediaSync?.stop();
    this.mediaSync = null;
    this.mediaFolder = null;
  }

  async listPlaylists(): Promise<PlaylistSummary[]> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return [];
    return this.database.listPlaylists(workspaceId);
  }

  /** The playlist with each entry's readiness on this laptop. */
  async getPlaylist(playlistId: string): Promise<PlaylistView | null> {
    const playlist = await this.loadPlaylist(playlistId);
    if (!playlist) return null;
    const entries = await resolvePlaylist(playlist, this.playlistSources());
    return {
      id: playlist.id,
      name: playlist.name,
      serviceDate: playlist.serviceDate,
      themeId: playlist.themeId,
      syncVersion: playlist.syncVersion,
      entries: entries.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        isReady: entry.isReady,
        note: entry.note,
        slideCount: entry.slideCount,
        input: entry.input,
      })),
      backgroundNote: await this.backgroundNoteFor(playlist.themeId),
    };
  }

  /** Why a service would show its theme without the theme's video. */
  private async backgroundNoteFor(
    themeId: string | null,
  ): Promise<string | null> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return null;
    for (const stored of [
      themeId ? await this.database.getTheme(workspaceId, themeId) : null,
      await this.database.getDefaultTheme(workspaceId),
    ]) {
      const parsed = themeSchema.safeParse(stored);
      if (!parsed.success) continue;
      const mediaId = parsed.data.backgroundMediaId;
      if (!mediaId || (await this.localBackgroundOf(mediaId))) return null;
      const state = this.mediaSync
        ?.getStates()
        .find((candidate) => candidate.mediaId === mediaId);
      if (state?.state === 'failed' && state.message) return state.message;
      const percent =
        state?.state === 'downloading' && state.sizeBytes > 0
          ? ` (${Math.floor((state.receivedBytes / state.sizeBytes) * 100)}%)`
          : '';
      const kind =
        (await this.loadMedia()).find((media) => media.id === mediaId)?.kind ===
        'image'
          ? 'image'
          : 'video';
      return `The theme’s background ${kind} is still downloading${percent}. Until it arrives, the theme’s colour shows instead.`;
    }
    return null;
  }

  async createPlaylist(input: PlaylistInput): Promise<PlaylistView | null> {
    const playlist = await this.writeOnline(
      'POST',
      'playlists',
      playlistSchema,
      input,
    );
    return this.getPlaylist(playlist.id);
  }

  async updatePlaylist(
    playlistId: string,
    input: PlaylistInput,
  ): Promise<PlaylistView | null> {
    await this.writeOnline(
      'PATCH',
      `playlists/${playlistId}`,
      playlistSchema,
      input,
    );
    return this.getPlaylist(playlistId);
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.writeOnline('DELETE', `playlists/${playlistId}`);
  }

  // ── Displays and presentation (offline) ───────────────────────────────

  listDisplays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    const chosenId = this.settings.get().projectorDisplayId;
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Display ${index + 1}`,
      width: display.size.width,
      height: display.size.height,
      isPrimary: display.id === primaryId,
      isChosen: display.id === chosenId,
    }));
  }

  /** `null` returns to automatic placement. */
  chooseDisplay(displayId: number | null): void {
    this.settings.update({ projectorDisplayId: displayId });
    if (this.live.isLive) this.projector.place();
    this.notifyDisplaysChanged();
  }

  /** Builds the deck from the laptop's copy and goes live. Never waits on the network. */
  async startLive(
    songId: string,
    arrangementId: string | null,
    slideIndex = 0,
  ): Promise<LiveState> {
    const loaded = await this.loadSong(songId);
    if (loaded.status === 'missing') {
      throw new Error(
        'That song is no longer on this laptop — it may have been deleted.',
      );
    }
    if (loaded.status === 'unreadable') {
      throw new Error(
        'This laptop’s copy of that song cannot be read. Update Pakita.',
      );
    }
    const { song } = loaded;
    const slides = buildSongSlides(song, arrangementId ?? undefined);
    if (!slides) {
      throw new Error(
        'This song changed since you selected it. Select it again.',
      );
    }
    if (slides.length === 0) {
      throw new Error('That version of the song has no slides.');
    }
    const theme = await this.resolveTheme(null);
    this.live.start(song.title, slides, theme.look, theme.themeId);
    // Straight to the chosen slide: the first is never shown on the way.
    this.live.goTo(slideIndex);
    this.projector.open();
    return this.broadcastLiveState();
  }

  /**
   * Presents a passage from the laptop's copy of a translation. A range is
   * presented as chosen. A single verse is presented with its whole chapter,
   * opened at that verse, so Next and Previous carry on through the reading.
   */
  async startPassage(passage: PassageRequest): Promise<LiveState> {
    const isSingleVerse =
      passage.start.chapter === passage.end.chapter &&
      passage.start.verse === passage.end.verse;
    const chapter = passage.start.chapter;
    const loaded = await this.loadPassage(
      isSingleVerse
        ? {
            ...passage,
            start: { chapter, verse: 1 },
            end: { chapter, verse: Number.MAX_SAFE_INTEGER },
          }
        : passage,
    );
    if (!loaded) {
      throw new Error('That passage is not on this laptop.');
    }
    const theme = await this.resolveTheme(null);
    this.live.start(
      `${loaded.reference} (${loaded.translationCode})`,
      loaded.slides,
      theme.look,
      theme.themeId,
    );
    if (isSingleVerse) {
      this.live.goTo(
        Math.max(
          0,
          loaded.slides.findIndex(
            (slide) => slide.verse?.verse === passage.start.verse,
          ),
        ),
      );
    }
    this.projector.open();
    return this.broadcastLiveState();
  }

  /**
   * Presents a whole playlist as one deck, from the entry chosen. Every
   * entry the laptop holds is in the deck, fixed at this moment with the
   * playlist's theme; an entry it lacks is left out.
   */
  async startPlaylist(
    playlistId: string,
    entryIndex: number,
  ): Promise<LiveState> {
    const playlist = await this.loadPlaylist(playlistId);
    if (!playlist) {
      throw new Error('That playlist is no longer on this laptop.');
    }
    const entries = await resolvePlaylist(playlist, this.playlistSources());
    const deck = buildDeck(entries);
    const start = deck.startIndexes[entryIndex];
    if (start === undefined || start === null) {
      throw new Error(
        entries[entryIndex]?.note ?? 'That entry cannot be presented.',
      );
    }
    const theme = await this.resolveTheme(playlist.themeId);
    this.live.start(playlist.name, deck.slides, theme.look, theme.themeId);
    this.live.goTo(start);
    this.projector.open();
    return this.broadcastLiveState();
  }

  next(): LiveState {
    this.live.next();
    return this.broadcastLiveState();
  }

  previous(): LiveState {
    this.live.previous();
    return this.broadcastLiveState();
  }

  goTo(index: number): LiveState {
    this.live.goTo(index);
    return this.broadcastLiveState();
  }

  toggleBlackout(): LiveState {
    this.live.toggleBlackout();
    return this.broadcastLiveState();
  }

  /**
   * Draws what is live with another theme the operator chose, from the
   * laptop's copy (never the network), at the same slide. It lasts until the
   * presentation stops, and is saved nowhere.
   */
  async setLiveTheme(themeId: string): Promise<LiveState> {
    if (!this.live.isLive) {
      throw new Error('Nothing is being presented.');
    }
    const { workspaceId } = this.settings.get();
    const parsed = themeSchema.safeParse(
      this.database && workspaceId
        ? await this.database.getTheme(workspaceId, themeId)
        : null,
    );
    if (!parsed.success) {
      throw new Error('That theme is no longer on this laptop.');
    }
    this.live.changeLook(
      lookOf(
        parsed.data,
        await this.localBackgroundOf(parsed.data.backgroundMediaId),
      ),
      parsed.data.id,
    );
    return this.broadcastLiveState();
  }

  stopLive(): LiveState {
    this.live.stop();
    this.projector.close();
    const state = this.broadcastLiveState();
    // Videos waited while presenting; carry on.
    void this.mediaSync?.run();
    return state;
  }

  liveState(): LiveState {
    return this.live.snapshot(this.projector.getStatus());
  }

  isProjectorContents(contentsId: number): boolean {
    return this.projector.isProjectorContents(contentsId);
  }

  async shutdown(): Promise<void> {
    if (this.updateCheckTimer) clearTimeout(this.updateCheckTimer);
    this.cancelDatabaseReopen();
    this.stopBackgroundSync();
    this.projector.close();
    await this.database?.close();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async useServer(
    origin: string,
    account: StoredAccount | null,
  ): Promise<void> {
    if (this.api?.origin === origin) return;
    this.api = new ApiClient(origin, (input, init) => net.fetch(input, init));
    this.session = await Session.restore(this.api, this.credentials, account);
  }

  private openDatabase(account: StoredAccount): void {
    const directory = this.accountDirectory(account);
    mkdirSync(directory, { recursive: true });
    const client: DatabaseClient = new DatabaseClient(
      this.options.databaseWorkerPath,
      join(directory, 'pakita.sqlite'),
      console.error,
      () => this.reopenDatabase(client, account),
    );
    this.database = client;
    this.mediaFolder = new MediaFolder(join(directory, 'media'));
  }

  /**
   * The database worker stopped by itself (it crashed): open it again, at
   * most once a minute, so a fault that repeats cannot spin, but always
   * eventually. A presentation is
   * unaffected meanwhile — its slides are in memory.
   */
  private reopenDatabase(
    stopped: DatabaseClient,
    account: StoredAccount,
  ): void {
    if (this.databaseReopenTimer) return;
    const delay = Math.max(
      1_000,
      this.lastDatabaseReopen +
        DATABASE_REOPEN_INTERVAL_MILLISECONDS -
        Date.now(),
    );
    this.databaseReopenTimer = setTimeout(() => {
      this.databaseReopenTimer = null;
      // Signed out, replaced or shut down in the meantime: nothing to reopen.
      if (this.database !== stopped) return;
      this.lastDatabaseReopen = Date.now();
      this.openDatabase(account);
      if (this.syncEngine) this.startSync();
    }, delay);
    this.databaseReopenTimer.unref();
  }

  private cancelDatabaseReopen(): void {
    if (this.databaseReopenTimer) clearTimeout(this.databaseReopenTimer);
    this.databaseReopenTimer = null;
  }

  /** Wires synchronisation to the open database and current session. */
  private startSync(): void {
    const { database, session } = this;
    const account = session?.getAccount();
    // Until a password an administrator chose is replaced, the server answers
    // nothing a synchronisation needs.
    if (!database || !session || !account || account.isPasswordChangeRequired)
      return;
    this.syncEngine = new SyncEngine(
      {
        fetchChanges: (workspaceId, cursor, limit) =>
          session.request({
            method: 'GET',
            path: `/api/workspaces/${workspaceId}/sync/changes?cursor=${cursor}&limit=${limit}`,
            schema: syncChangesSchema,
          }),
        database,
        // Parsing and checking a whole translation takes the main process a
        // moment; never during a presentation. The next run catches up.
        syncBibleTranslations: async () => {
          if (this.live.isLive) return;
          await syncBibleTranslations({
            listTranslations: () =>
              session.request({
                method: 'GET',
                path: '/api/bible-translations',
                schema: bibleTranslationListSchema,
              }),
            downloadContent: (translationId) =>
              session.request({
                method: 'GET',
                path: `/api/bible-translations/${translationId}/content`,
                schema: bibleContentSchema,
                timeoutMilliseconds: BIBLE_DOWNLOAD_TIMEOUT_MILLISECONDS,
                maxResponseBytes: MAX_BIBLE_DOWNLOAD_BYTES,
              }),
            database,
            rejectedContent: this.rejectedBibleContent,
          });
        },
        now: () => new Date(),
      },
      (status) => this.send(IpcEvent.syncStatus, status),
    );
    this.startMedia(database, session);
    if (this.settings.get().workspaceId) {
      this.startBackgroundSync();
      void this.syncNow();
    }
  }

  /**
   * Writes to the workspace on the server, then synchronises, so the laptop
   * shows the change as every other laptop will receive it.
   */
  private async writeOnline<Result>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    schema?: z.ZodType<Result>,
    body?: unknown,
  ): Promise<Result> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const result = await this.requireSession().request({
      method,
      path: `/api/workspaces/${workspaceId}/${path}`,
      schema,
      body,
    });
    await this.syncNow();
    return result;
  }

  private async loadPlaylist(playlistId: string) {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return null;
    const parsed = playlistSchema.safeParse(
      await this.database.getPlaylist(workspaceId, playlistId),
    );
    return parsed.success ? parsed.data : null;
  }

  /**
   * A theme by id, else the workspace default, else white on black: the look
   * to draw with, and the theme it came from (null for the built-in one).
   */
  private async resolveTheme(
    themeId: string | null,
  ): Promise<{ look: ThemeLook; themeId: string | null }> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) {
      return { look: DEFAULT_THEME_LOOK, themeId: null };
    }
    for (const stored of [
      themeId ? await this.database.getTheme(workspaceId, themeId) : null,
      await this.database.getDefaultTheme(workspaceId),
    ]) {
      const parsed = themeSchema.safeParse(stored);
      if (parsed.success) {
        return {
          look: lookOf(
            parsed.data,
            await this.localBackgroundOf(parsed.data.backgroundMediaId),
          ),
          themeId: parsed.data.id,
        };
      }
    }
    return { look: DEFAULT_THEME_LOOK, themeId: null };
  }

  /**
   * A theme's background media as this laptop holds it now (verified), or
   * null — then the theme's own colour or gradient shows.
   */
  private async localBackgroundOf(
    mediaId: string | null,
  ): Promise<LocalBackground | null> {
    const folder = this.mediaFolder;
    if (!mediaId || !folder) return null;
    const media = (await this.loadMedia()).find(
      (candidate) => candidate.id === mediaId,
    );
    if (!media || !isMediaType(media.contentType)) return null;
    const isHeld = await folder.has({
      sha256: media.sha256,
      contentType: media.contentType,
    });
    return isHeld ? { kind: media.kind, url: this.mediaUrlOf(media) } : null;
  }

  private async loadPassage(
    passage: PassageRequest,
  ): Promise<LoadedPassage | null> {
    if (!this.database) return null;
    const translation = (await this.database.listBibleTranslations()).find(
      (candidate) => candidate.id === passage.translationId,
    );
    const book = translation
      ? (await this.database.listBibleBooks(translation.id)).find(
          (candidate) => candidate.code === passage.bookCode,
        )
      : undefined;
    if (!translation || !book) return null;
    const verses = await this.database.getBiblePassage(
      translation.id,
      book.code,
      passage.start,
      passage.end,
    );
    if (verses.length === 0) return null;
    return {
      reference: formatReference(book.name, verses),
      translationCode: translation.code,
      slides: buildPassageSlides(translation, book, verses),
    };
  }

  private playlistSources() {
    return {
      song: async (songId: string) => {
        const loaded = await this.loadSong(songId);
        return loaded.status === 'found' ? loaded.song : null;
      },
      passage: (item: {
        bibleTranslationId: string;
        bookCode: string;
        startChapter: number;
        startVerse: number;
        endChapter: number;
        endVerse: number;
      }) =>
        this.loadPassage({
          translationId: item.bibleTranslationId,
          bookCode: item.bookCode,
          start: { chapter: item.startChapter, verse: item.startVerse },
          end: { chapter: item.endChapter, verse: item.endVerse },
        }),
    };
  }

  private translationUploader(session: Session): TranslationUploader {
    const base = '/api/bible-translations';
    return {
      deleteLeftoverDraft: async (code) => {
        const translations = await session.request({
          method: 'GET',
          path: base,
          schema: bibleTranslationListSchema,
        });
        const leftover = translations.find(
          (translation) =>
            !translation.isPublished &&
            translation.code === code.trim().toUpperCase(),
        );
        if (leftover) {
          await session.request({
            method: 'DELETE',
            path: `${base}/${leftover.id}`,
          });
        }
      },
      createDraft: async (input) =>
        (
          await session.request({
            method: 'POST',
            path: base,
            schema: bibleTranslationSchema,
            body: { ...input, sourceUrl: input.sourceUrl ?? undefined },
          })
        ).id,
      putChapter: (translationId, bookCode, chapter, body) =>
        retryWhenRateLimited(() =>
          session.request({
            method: 'PUT',
            path: `${base}/${translationId}/books/${bookCode}/chapters/${chapter}`,
            body,
          }),
        ),
      publish: async (translationId) => {
        await session.request({
          method: 'POST',
          path: `${base}/${translationId}/publish`,
          timeoutMilliseconds: PUBLISH_TIMEOUT_MILLISECONDS,
        });
      },
      deleteDraft: (translationId) =>
        session.request({ method: 'DELETE', path: `${base}/${translationId}` }),
    };
  }

  // One folder per (server, account): two accounts on one laptop, or one
  // account on two servers, never share content.
  private accountDirectory(account: StoredAccount): string {
    const key = createHash('sha256')
      .update(`${account.origin}\n${account.userId}`)
      .digest('hex')
      .slice(0, 24);
    return join(this.options.userDataDirectory, 'accounts', key);
  }

  private startBackgroundSync(): void {
    this.stopBackgroundSync();
    this.backgroundSyncTimer = setInterval(
      () => void this.syncNow(),
      BACKGROUND_SYNC_INTERVAL_MILLISECONDS,
    );
  }

  private stopBackgroundSync(): void {
    if (this.backgroundSyncTimer) clearInterval(this.backgroundSyncTimer);
    this.backgroundSyncTimer = null;
  }

  private broadcastLiveState(): LiveState {
    // Nothing downloads during a presentation (its partial file resumes).
    if (this.live.isLive) this.mediaSync?.stop();
    const state = this.liveState();
    this.send(IpcEvent.liveState, state);
    this.projector.send(state);
    return state;
  }

  private notifyDisplaysChanged(): void {
    this.send(IpcEvent.displaysChanged, null);
  }

  private send(channel: string, payload: unknown): void {
    const window = this.options.getOperatorWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }

  private summarise(account: StoredAccount): AccountSummary {
    return {
      origin: account.origin,
      email: account.email,
      displayName: account.displayName,
      isSignedIn: this.session?.isSignedIn ?? false,
      isPasswordChangeRequired: account.isPasswordChangeRequired,
    };
  }

  /** Every row of a list endpoint, page by page (the API caps a page at 100). */
  /** One page of a server list, searched by `query.search` on the server. */
  private async requestListPage<Row>(
    path: string,
    filters: Record<string, string>,
    query: ListPageQuery,
    schema: z.ZodType<{ data: Row[]; meta: { totalPages: number } }>,
  ): Promise<{ data: Row[]; hasMore: boolean }> {
    const parameters = new URLSearchParams({
      ...filters,
      page: String(query.page),
      perPage: String(SERVER_LIST_PAGE_SIZE),
    });
    const search = query.search.trim();
    if (search) parameters.set('search', search);
    const result = await this.requireSession().request({
      method: 'GET',
      path: `${path}?${parameters.toString()}`,
      schema,
    });
    return {
      data: result.data,
      hasMore: query.page < result.meta.totalPages,
    };
  }

  private async fetchAllPages<Row>(
    path: string,
    schema: z.ZodType<{ data: Row[]; meta: { totalPages: number } }>,
  ): Promise<Row[]> {
    const session = this.requireSession();
    const rows: Row[] = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
      const result = await session.request({
        method: 'GET',
        path: `${path}&perPage=100&page=${page}`,
        schema,
      });
      rows.push(...result.data);
      if (page >= result.meta.totalPages) break;
    }
    return rows;
  }

  private requireServer(): { api: ApiClient; session: Session } {
    if (!this.api || !this.session) {
      throw new Error('Connect to your church server first.');
    }
    return { api: this.api, session: this.session };
  }

  private requireSession(): Session {
    const { session } = this.requireServer();
    if (!session.getAccount()) {
      throw new SignInRequiredError();
    }
    return session;
  }

  private requireWorkspace(): string {
    const { workspaceId } = this.settings.get();
    if (!workspaceId) {
      throw new Error('Choose a workspace first.');
    }
    return workspaceId;
  }
}

async function retryWhenRateLimited<Result>(
  send: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const isRateLimited = error instanceof ApiError && error.status === 429;
      if (!isRateLimited || attempt >= RATE_LIMIT_RETRIES) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_DELAY_MILLISECONDS),
      );
    }
  }
}

function toListedAccount(
  user: z.infer<typeof userPageSchema>['data'][number],
): ListedAccount {
  return {
    ...toManagedAccount(user),
    platformRoles: user.platformRoles,
    churches: user.workspaceMemberships.map((membership) => ({
      id: membership.workspaceId,
      name: membership.workspaceName,
      roleName: membership.roleName,
      isSuspended: membership.status === 'suspended',
    })),
  };
}

function toManagedAccount(user: z.infer<typeof userSchema>): ManagedAccount {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
    isActive: user.isActive,
    isPasswordChangeRequired: user.isPasswordChangeRequired,
  };
}

function toInvitationSummary(
  invitation: z.infer<typeof invitationSchema>,
): InvitationSummary {
  const invitee = invitation.invitedUser;
  return {
    id: invitation.id,
    invitee: invitee
      ? `${invitee.firstName} ${invitee.lastName}`.trim()
      : 'A removed account',
    roleName: invitation.role.name,
    expiresAt: invitation.expiresAt,
  };
}
