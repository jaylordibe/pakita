import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { Errors } from '../../common/errors/errors';
import { RedisService } from '../../common/redis/redis.service';
import { hashPassword } from '../../common/util/password-hashing.util';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PasswordSignInResponseDto } from './dto/password-sign-in-response.dto';
import type { RefreshTokenContext } from './refresh-token.service';
import { RefreshTokenService } from './refresh-token.service';
import { SignInDeviceTokenService } from './sign-in-device-token.service';
import {
  deviceSignInSubject,
  SignInFailureLimitService,
  signInSubject,
} from './sign-in-failure-limit.service';
import { LOGOUT_KEY_PREFIX } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  // Compared against when the identifier matches no account, so an unknown
  // identifier costs the same bcrypt work as a wrong password. Computed lazily
  // so it uses the configured cost factor.
  private dummyHash: string | null = null;

  constructor(
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly auditService: AuditService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly signInFailureLimit: SignInFailureLimitService,
    private readonly signInDeviceTokens: SignInDeviceTokenService,
  ) {}

  async login(
    dto: LoginDto,
    context: RefreshTokenContext = {},
  ): Promise<PasswordSignInResponseDto> {
    const user = await this.verifyCredentials(
      dto.identifier,
      dto.password,
      dto.deviceTokens,
    );
    // The cutoff read with the password check authorises the session; a
    // revocation committing before issue is refused inside `startSession`.
    const tokens = await this.refreshTokenService.startSession(
      user.id,
      user.passwordChangedAt,
      context,
    );
    return {
      ...tokens,
      user: await this.usersService.toResponse(user),
      deviceToken: this.signInDeviceTokens.issue(user.id),
    };
  }

  /**
   * Exchanges a refresh token for a fresh pair. The user is re-read under the
   * rotation lock, so deactivation, deletion or a credential change ends the
   * session at its next refresh.
   */
  async refresh(
    presentedToken: string,
    context: RefreshTokenContext = {},
  ): Promise<LoginResponseDto> {
    const { user, tokens } = await this.refreshTokenService.refreshSession(
      presentedToken,
      context,
    );
    return { ...tokens, user: await this.usersService.toResponse(user) };
  }

  /**
   * The one password check every sign-in path goes through: the REST login and
   * the MCP OAuth sign-in page. Returns the user only when the password matches
   * an active account; it creates no session or token, so each caller decides
   * what a successful check grants (an account whose password an administrator
   * chose gets a session that can only change it: `JwtAuthGuard`).
   *
   * An unknown identifier, an inactive account and a wrong password all answer
   * `INVALID_CREDENTIALS` after the same bcrypt work, so neither the response
   * nor its timing says whether the account exists. Each counts as a failed
   * sign-in for the account (`SignInFailureLimitService`), and too many refuse
   * every check for it, right or wrong, until the window ends — except from a
   * device that presents a device token for the account (`deviceTokens`),
   * whose attempts are counted for that device alone.
   */
  async verifyCredentials(
    identifier: string,
    password: string,
    deviceTokens: readonly string[] = [],
  ): Promise<User> {
    // Soft-deleted accounts resolve to null, the same as an unknown identifier.
    const user = await this.usersService.findByEmailOrUsername(identifier);
    const deviceId = user
      ? this.signInDeviceTokens.deviceIdFor(user.id, deviceTokens)
      : null;
    const subject =
      user && deviceId
        ? deviceSignInSubject(user.id, deviceId)
        : signInSubject(user?.id ?? null, identifier);
    // Reserved before the comparison, so concurrent guesses cannot all slip
    // under the limit while their comparisons run.
    await this.signInFailureLimit.reserveAttempt(subject);
    const passwordMatches = await bcrypt.compare(
      password,
      user?.password ?? (await this.getDummyHash()),
    );
    if (!user || !user.isActive || !passwordMatches) {
      throw Errors.invalidCredentials();
    }
    await this.signInFailureLimit.clear(subject);
    return user;
  }

  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await hashPassword('dummy-password-for-timing');
    }
    return this.dummyHash;
  }

  /**
   * Ends this device's session: revokes the presented refresh chain and
   * blocklists the current access token's `jti` until it expires. Other
   * devices stay signed in.
   */
  async logout(
    currentUser: AuthenticatedUser,
    presentedRefreshToken?: string,
  ): Promise<void> {
    if (presentedRefreshToken) {
      await this.refreshTokenService.revokeByToken(presentedRefreshToken);
    }

    if (!currentUser.jti || !currentUser.exp) {
      await this.auditService.record({
        action: 'auth.logout.no_jti',
        actorId: currentUser.id,
        targetUserId: currentUser.id,
      });
      return;
    }
    const ttlSeconds = Math.max(
      1,
      currentUser.exp - Math.floor(Date.now() / 1000),
    );
    await this.redis.client.set(
      `${LOGOUT_KEY_PREFIX}${currentUser.jti}`,
      '1',
      'EX',
      ttlSeconds,
    );
    await this.auditService.record({
      action: 'auth.logout',
      actorId: currentUser.id,
      targetUserId: currentUser.id,
      metadata: { jti: currentUser.jti },
    });
  }

  /**
   * Logout-everywhere: moves the session cutoff (kills access tokens) and
   * revokes every refresh family, in one transaction.
   */
  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.endAllSessions(userId, userId);
    await this.auditService.record({
      action: 'auth.logout_all',
      actorId: userId,
      targetUserId: userId,
    });
  }
}
