import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { deriveKey } from '../../common/util/key-derivation.util';

const KEY_LABEL = 'auth/sign-in-device-token/v1';
const NONCE_BYTES = 16;

/**
 * Device tokens for password sign-in: OWASP's "device cookie" defence against
 * the lockout an account-wide failure limit invites
 * (https://owasp.org/www-community/Slow_Down_Online_Guessing_Attacks_with_Device_Cookies).
 *
 * A successful password sign-in is answered with a token naming the account
 * and a random device id, signed with a key derived from `JWT_SECRET`. A
 * client presenting that token for the same account later is a device the
 * account has signed in from, so its attempts are counted per device rather
 * than per account (`SignInFailureLimitService`): strangers guessing at the
 * account cannot keep that device out, and the device itself still gets only
 * the per-account number of attempts.
 *
 * Stateless: the token is `<account id>.<device id>.<signature>`. It grants
 * nothing alone — the password is still checked — so it is not revocable;
 * rotating `JWT_SECRET` invalidates every one.
 */
@Injectable()
export class SignInDeviceTokenService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    this.key = deriveKey(
      configService.getOrThrow<string>('jwt.secret'),
      KEY_LABEL,
      32,
    );
  }

  /** A new token for a device that has just signed in to this account. */
  issue(userId: string): string {
    const deviceId = randomBytes(NONCE_BYTES).toString('base64url');
    return `${userId}.${deviceId}.${this.sign(userId, deviceId)}`;
  }

  /**
   * The device id of the first token that is genuine and names this account,
   * or null. A token for another account is ignored, not refused: a laptop
   * shared by several people presents all of theirs.
   */
  deviceIdFor(userId: string, tokens: readonly string[]): string | null {
    for (const token of tokens) {
      const [tokenUserId, deviceId, signature, ...rest] = token.split('.');
      if (
        rest.length === 0 &&
        tokenUserId === userId &&
        deviceId &&
        signature &&
        isSameSignature(signature, this.sign(userId, deviceId))
      ) {
        return deviceId;
      }
    }
    return null;
  }

  private sign(userId: string, deviceId: string): string {
    return createHmac('sha256', this.key)
      .update(`${userId}.${deviceId}`)
      .digest('base64url');
  }
}

function isSameSignature(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
