import {
  app,
  type BrowserWindow,
  dialog,
  net,
  safeStorage,
  screen,
} from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
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
  IpcEvent,
  type LiveState,
  type PassageRequest,
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
import { ApiClient, ApiError } from './api/api-client';
import {
  bibleContentSchema,
  bibleTranslationListSchema,
  bibleTranslationSchema,
  serverInfoSchema,
  songSchema,
  syncChangesSchema,
  workspacePageSchema,
} from './api/api-schemas';
import { parseServerAddress } from './api/server-address';
import { CredentialStore, type StoredAccount } from './auth/credential-store';
import { Session, SignInRequiredError } from './auth/session';
import { obtainTurnstileToken } from './auth/turnstile-window';
import {
  readUsfmFolder,
  type TranslationUploader,
  uploadTranslation,
  type UsfmFolder,
} from './bible/bible-import';
import { checkCompatibility } from './compatibility';
import { DatabaseClient } from './database/database-client';
import { LiveSession } from './presentation/live-session';
import { Projector } from './presentation/projector';
import { AppSettingsStore } from './storage/app-settings';
import { syncBibleTranslations } from './sync/bible-sync';
import { SyncEngine } from './sync/sync-engine';

/** How often a signed-in laptop checks for changes in the background. */
const BACKGROUND_SYNC_INTERVAL_MILLISECONDS = 2 * 60_000;
/** A whole translation is a few megabytes; allow a slow church connection. */
const BIBLE_DOWNLOAD_TIMEOUT_MILLISECONDS = 5 * 60_000;
/** Ten times a complete Bible with every verse at a typical length. */
const MAX_BIBLE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
/** Publishing hashes the whole translation on the server. */
const PUBLISH_TIMEOUT_MILLISECONDS = 2 * 60_000;
/** A chapter refused for rate limiting is retried this often, this late. */
const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_DELAY_MILLISECONDS = 15_000;
/** Verses in a chapter are at most this many (Psalm 119 has 176). */
const MAX_CHAPTER_VERSE = 200;

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
  /** Bible downloads that failed verification (see bible-sync). */
  private readonly rejectedBibleContent = new Set<string>();
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
    if (previous && previous.userId !== account.userId) {
      // Someone else signed in on this laptop: the previous account's content
      // and church choice go, exactly as on sign-out.
      this.stopBackgroundSync();
      await this.database?.close();
      this.database = null;
      this.syncEngine = null;
      rmSync(this.accountDirectory(previous), { recursive: true, force: true });
      this.settings.update({ workspaceId: null });
    }
    // Signing in again as the same person keeps the database already open.
    if (!this.database) {
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
    };
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
      throw new Error('That arrangement has no slides.');
    }
    this.live.start(song.title, slides);
    this.projector.open();
    return this.broadcastLiveState();
  }

  /** Presents a passage from the laptop's copy of a translation. */
  async startPassage(passage: PassageRequest): Promise<LiveState> {
    if (!this.database) {
      throw new Error('There is no Bible on this laptop yet.');
    }
    const translation = (await this.database.listBibleTranslations()).find(
      (candidate) => candidate.id === passage.translationId,
    );
    const book = translation
      ? (await this.database.listBibleBooks(translation.id)).find(
          (candidate) => candidate.code === passage.bookCode,
        )
      : undefined;
    if (!translation || !book) {
      throw new Error('That translation is no longer on this laptop.');
    }
    const verses = await this.database.getBiblePassage(
      translation.id,
      book.code,
      passage.start,
      passage.end,
    );
    if (verses.length === 0) {
      throw new Error('That passage has no verses in this translation.');
    }
    this.live.start(
      `${formatReference(book.name, verses)} (${translation.code})`,
      buildPassageSlides(book.name, translation.attribution, verses),
    );
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

  isProjectorContents(contentsId: number): boolean {
    return this.projector.isProjectorContents(contentsId);
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
    if (this.settings.get().workspaceId) {
      this.startBackgroundSync();
      void this.syncNow();
    }
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
