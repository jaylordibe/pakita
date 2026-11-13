import { ApiClient, ApiError, type ApiRequest } from '../api/api-client';
import {
  loginResponseSchema,
  passwordSignInResponseSchema,
  type LoginResponse,
} from '../api/api-schemas';
import type { CredentialStore, StoredAccount } from './credential-store';

/** Refresh the access token this long before it expires. */
const EXPIRY_MARGIN_MILLISECONDS = 30_000;

// Server answers meaning the session itself is over: only signing in again
// helps (as opposed to a network problem, which a later retry fixes).
const SESSION_ENDED_CODES = new Set([
  'REFRESH_TOKEN_INVALID',
  'SESSION_INVALIDATED',
  'TOKEN_REVOKED',
  'USER_INACTIVE',
]);

export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in again to synchronise or edit.');
    this.name = 'SignInRequiredError';
  }
}

interface AccessToken {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * The signed-in operator. Holds both tokens in main-process memory (never in
 * a renderer) and persists the refresh token through the CredentialStore;
 * every authenticated request goes through `request`, which refreshes the
 * access token when it is about to expire or the server says it has, and
 * retries once. Create one with `Session.restore`.
 *
 * The account is remembered even when it cannot reach the server, so the
 * laptop's synchronised content stays presentable offline.
 */
export class Session {
  private accessToken: AccessToken | null = null;
  private refreshInFlight: Promise<AccessToken> | null = null;
  /**
   * Bumped by every sign-in and sign-out. A refresh that finishes in a later
   * generation belongs to a session that no longer exists: its result is
   * discarded (and its new token ended), never stored.
   */
  private generation = 0;

  private constructor(
    private readonly api: ApiClient,
    private readonly store: CredentialStore,
    private account: StoredAccount | null,
    private refreshToken: string | null,
    private readonly now: () => number,
  ) {}

  /** The session for `account` (if any), with its stored refresh token. */
  static async restore(
    api: ApiClient,
    store: CredentialStore,
    account: StoredAccount | null,
    now: () => number = Date.now,
  ): Promise<Session> {
    const refreshToken = account ? await store.loadRefreshToken() : null;
    return new Session(api, store, account, refreshToken, now);
  }

  /** The account this laptop holds content for, if any. */
  getAccount(): StoredAccount | null {
    return this.account;
  }

  get isSignedIn(): boolean {
    return this.account !== null && this.refreshToken !== null;
  }

  async signIn(identifier: string, password: string): Promise<StoredAccount> {
    this.generation += 1;
    const generation = this.generation;
    const response = await this.api.request({
      method: 'POST',
      path: '/api/auth/login',
      schema: passwordSignInResponseSchema,
      body: {
        identifier,
        password,
        deviceTokens: this.store.loadDeviceTokens(this.api.origin),
      },
    });
    // Kept even if this sign-in is then discarded below: the device did sign
    // in to that account.
    this.store.saveDeviceToken(
      this.api.origin,
      response.user.id,
      response.deviceToken,
    );
    return this.adopt(response, generation);
  }

  /**
   * Changes the signed-in person's password. The server ends every other
   * session and answers with a fresh one for this laptop, which replaces the
   * current one. It is also how a password an administrator chose is
   * replaced, which lifts `isPasswordChangeRequired`.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<StoredAccount> {
    const generation = this.generation;
    const response = await this.request({
      method: 'PATCH',
      path: '/api/users/me/password',
      schema: loginResponseSchema,
      body: { currentPassword, newPassword },
    });
    if (generation !== this.generation) {
      // Signed out (or in again) while the change was on its way.
      void this.endServerSession(response.refreshToken);
      throw new SignInRequiredError();
    }
    // A new generation, as a sign-in starts one: a refresh still in flight
    // spent the old token, and must not overwrite the session issued here.
    this.generation += 1;
    return this.adopt(response, this.generation);
  }

  /** Makes a session the server just issued this laptop's session. */
  private async adopt(
    response: LoginResponse,
    generation: number,
  ): Promise<StoredAccount> {
    if (generation !== this.generation) {
      // Signed out (or in again) while this request was on its way.
      void this.endServerSession(response.refreshToken);
      throw new SignInRequiredError();
    }
    const account: StoredAccount = {
      origin: this.api.origin,
      userId: response.user.id,
      email: response.user.email,
      displayName:
        `${response.user.firstName} ${response.user.lastName}`.trim(),
      isPasswordChangeRequired: response.user.isPasswordChangeRequired,
    };
    this.account = account;
    this.refreshToken = response.refreshToken;
    this.accessToken = this.toAccessToken(response);
    await this.store.save(account, response.refreshToken);
    return account;
  }

  /**
   * Ends the session on the server (best effort: offline, the token simply
   * expires) and forgets the account on this laptop.
   */
  async signOut(): Promise<void> {
    this.generation += 1;
    const { refreshToken } = this;
    this.accessToken = null;
    this.refreshToken = null;
    this.account = null;
    this.store.clear();
    // A refresh still in flight was started with this token: if the server
    // has already rotated it, that refresh ends its own new token when it
    // returns (see `refresh`), so either way no session outlives this call.
    if (refreshToken) {
      await this.endServerSession(refreshToken);
    }
  }

  private async endServerSession(refreshToken: string): Promise<void> {
    await this.api
      .request<void>({
        method: 'POST',
        path: '/api/auth/logout',
        body: { refreshToken },
      })
      .catch(() => undefined);
  }

  /** An authenticated request, refreshing the access token as needed. */
  async request<Result>(
    request: Omit<ApiRequest<Result>, 'accessToken'>,
  ): Promise<Result> {
    const token = await this.validAccessToken();
    try {
      return await this.api.request({ ...request, accessToken: token.value });
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === 'TOKEN_EXPIRED') {
        this.accessToken = null;
        const refreshed = await this.validAccessToken();
        return this.api.request({ ...request, accessToken: refreshed.value });
      }
      throw error;
    }
  }

  private async validAccessToken(): Promise<AccessToken> {
    if (
      this.accessToken &&
      this.accessToken.expiresAt - EXPIRY_MARGIN_MILLISECONDS > this.now()
    ) {
      return this.accessToken;
    }
    // One refresh at a time: refresh tokens rotate, so two concurrent
    // refreshes would spend the same token twice and end the session.
    this.refreshInFlight ??= this.refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refresh(): Promise<AccessToken> {
    const generation = this.generation;
    const { refreshToken } = this;
    if (!this.account || !refreshToken) {
      throw new SignInRequiredError();
    }
    try {
      const response = await this.api.request({
        method: 'POST',
        path: '/api/auth/refresh',
        schema: loginResponseSchema,
        body: { refreshToken },
      });
      if (generation !== this.generation) {
        // Signed out (or in as someone else) meanwhile: the token just
        // issued belongs to no one now. End it rather than keep it.
        void this.endServerSession(response.refreshToken);
        throw new SignInRequiredError();
      }
      this.refreshToken = response.refreshToken;
      this.accessToken = this.toAccessToken(response);
      await this.store.saveRefreshToken(response.refreshToken);
      return this.accessToken;
    } catch (error) {
      if (generation !== this.generation) {
        // Whatever happened, it happened to a session that no longer exists.
        throw new SignInRequiredError();
      }
      if (
        error instanceof ApiError &&
        error.errorCode !== null &&
        SESSION_ENDED_CODES.has(error.errorCode)
      ) {
        // Keep the account (its content stays presentable); drop the token.
        this.refreshToken = null;
        this.store.clearRefreshToken();
        throw new SignInRequiredError();
      }
      throw error;
    }
  }

  private toAccessToken(response: LoginResponse): AccessToken {
    return {
      value: response.accessToken,
      expiresAt: this.now() + response.expiresIn * 1000,
    };
  }
}
