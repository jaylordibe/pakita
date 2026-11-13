import { app, type BrowserWindow, net, safeStorage, screen } from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AccountSummary,
  type AppState,
  type DatabaseHealth,
  type DisplayInfo,
  IpcEvent,
  type LiveState,
  type ServerConnection,
  type Song,
  type SongInput,
  type SongSummary,
  type SyncStatus,
  type WorkspaceSummary,
} from '../shared/ipc-contract';
import { buildSongSlides } from '../shared/slides';
import { ApiClient } from './api/api-client';
import {
  serverInfoSchema,
  songSchema,
  syncChangesSchema,
  workspacePageSchema,
} from './api/api-schemas';
import { parseServerAddress } from './api/server-address';
import { CredentialStore, type StoredAccount } from './auth/credential-store';
import { Session, SignInRequiredError } from './auth/session';
import { obtainTurnstileToken } from './auth/turnstile-window';
import { checkCompatibility } from './compatibility';
import { DatabaseClient } from './database/database-client';
import { LiveSession } from './presentation/live-session';
import { Projector } from './presentation/projector';
import { AppSettingsStore } from './storage/app-settings';
import { SyncEngine } from './sync/sync-engine';

/** How often a signed-in laptop checks for changes in the background. */
const BACKGROUND_SYNC_INTERVAL_MILLISECONDS = 2 * 60_000;

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
  /** Settles once the remembered session (and its token) is loaded. */
  private sessionReady: Promise<void> = Promise.resolve();

  constructor(private readonly options: AppControllerOptions) {
    this.settings = new AppSettingsStore(options.userDataDirectory);
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
    const turnstileToken = info.isBotCheckRequired
      ? await obtainTurnstileToken(api.origin, this.options.getOperatorWindow())
      : null;
    const previous = session.getAccount();
    const account = await session.signIn(identifier, password, turnstileToken);
    // Signing in again as the same person keeps the database already open.
    if (!this.database || previous?.userId !== account.userId) {
      await this.database?.close();
      this.openDatabase(account);
    }
    this.startSync();
    return this.summarise(account);
  }

  /** Signs out and removes this account's content from the laptop. */
  async signOut(): Promise<void> {
    await this.sessionReady;
    const account = this.session?.getAccount() ?? null;
    this.stopBackgroundSync();
    await this.session?.signOut();
    await this.database?.close();
    this.database = null;
    this.syncEngine = null;
    if (account) {
      rmSync(this.accountDirectory(account), { recursive: true, force: true });
    }
    this.settings.update({ workspaceId: null });
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
    return this.syncEngine.syncWorkspace(workspaceId);
  }

  // ── Library (offline) and editing (online) ────────────────────────────

  async listSongs(search: string, isArchived: boolean): Promise<SongSummary[]> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return [];
    return this.database.listSongs(workspaceId, search, isArchived);
  }

  async getSong(songId: string): Promise<Song | null> {
    const { workspaceId } = this.settings.get();
    if (!this.database || !workspaceId) return null;
    const stored = await this.database.getSong(workspaceId, songId);
    if (stored === null) return null;
    const parsed = songSchema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  }

  async createSong(input: SongInput): Promise<Song> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const song = await this.requireSession().request({
      method: 'POST',
      path: `/api/workspaces/${workspaceId}/songs`,
      schema: songSchema,
      body: input,
    });
    await this.syncNow();
    return song;
  }

  async updateSong(songId: string, input: SongInput): Promise<Song> {
    await this.sessionReady;
    const workspaceId = this.requireWorkspace();
    const song = await this.requireSession().request({
      method: 'PATCH',
      path: `/api/workspaces/${workspaceId}/songs/${songId}`,
      schema: songSchema,
      body: input,
    });
    await this.syncNow();
    return song;
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

  chooseDisplay(displayId: number): void {
    this.settings.update({ projectorDisplayId: displayId });
    if (this.live.isLive) this.projector.place();
    this.notifyDisplaysChanged();
  }

  /** Builds the deck from the laptop's copy and goes live. Never waits on the network. */
  async startLive(
    songId: string,
    arrangementId: string | null,
  ): Promise<LiveState> {
    const song = await this.getSong(songId);
    if (!song) {
      throw new Error('That song is not on this laptop. Synchronise first.');
    }
    const slides = buildSongSlides(song, arrangementId ?? undefined);
    if (!slides || slides.length === 0) {
      throw new Error('That arrangement has no slides.');
    }
    this.live.start(song.title, slides);
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

  stopLive(): LiveState {
    this.live.stop();
    this.projector.close();
    return this.broadcastLiveState();
  }

  liveState(): LiveState {
    return this.live.snapshot(this.projector.getStatus());
  }

  async shutdown(): Promise<void> {
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
    this.database = new DatabaseClient(
      this.options.databaseWorkerPath,
      join(directory, 'pakita.sqlite'),
    );
  }

  /** Wires synchronisation to the open database and current session. */
  private startSync(): void {
    const { database, session } = this;
    if (!database || !session?.getAccount()) return;
    this.syncEngine = new SyncEngine(
      {
        fetchChanges: (workspaceId, cursor, limit) =>
          session.request({
            method: 'GET',
            path: `/api/workspaces/${workspaceId}/sync/changes?cursor=${cursor}&limit=${limit}`,
            schema: syncChangesSchema,
          }),
        database,
        now: () => new Date(),
      },
      (status) => this.send(IpcEvent.syncStatus, status),
    );
    if (this.settings.get().workspaceId) {
      this.startBackgroundSync();
      void this.syncNow();
    }
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
    };
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
