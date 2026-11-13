import { ApiClient, ApiError, type ApiRequest } from '../api/api-client';
import { loginResponseSchema, type LoginResponse } from '../api/api-schemas';
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

  async signIn(
    identifier: string,
    password: string,
    turnstileToken: string | null,
  ): Promise<StoredAccount> {
    const response = await this.api.request({
      method: 'POST',
      path: '/api/auth/login',
      schema: loginResponseSchema,
      body: { identifier, password },
      headers: turnstileToken ? { 'X-Turnstile-Token': turnstileToken } : {},
    });
    const account: StoredAccount = {
      origin: this.api.origin,
      userId: response.user.id,
      email: response.user.email,
      displayName:
        `${response.user.firstName} ${response.user.lastName}`.trim(),
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
    const { refreshToken } = this;
    this.accessToken = null;
    this.refreshToken = null;
    this.account = null;
    this.store.clear();
    if (refreshToken) {
      await this.api
        .request({
          method: 'POST',
          path: '/api/auth/logout',
          body: { refreshToken },
        })
        .catch(() => undefined);
    }
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
      this.refreshToken = response.refreshToken;
      this.accessToken = this.toAccessToken(response);
      await this.store.saveRefreshToken(response.refreshToken);
      return this.accessToken;
    } catch (error) {
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
