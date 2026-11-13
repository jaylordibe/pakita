import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Errors } from '../../common/errors/errors';
import { RedisService } from '../../common/redis/redis.service';

/** Password checks an account may take in one window without a success. */
export const MAX_FAILED_SIGN_INS = 10;

/** The window, counted from the first attempt in it. */
export const FAILED_SIGN_IN_WINDOW_SECONDS = 15 * 60;

const KEY_PREFIX = 'sign-in-failures:';

/**
 * Password checks per ACCOUNT, from every address.
 *
 * The throttles on the sign-in routes (`@ThrottleSignIn()`) key on the
 * identifier together with the client address, and on the address alone. Both
 * are blind to one account guessed at from many addresses; this closes that:
 * an account gets `MAX_FAILED_SIGN_INS` password checks per
 * `FAILED_SIGN_IN_WINDOW_SECONDS` until one succeeds, and every further check
 * is refused, right or wrong, until the window ends. Not a lockout: a device
 * the account has signed in from before presents a device token and is
 * counted on its own (`deviceSignInSubject`, OWASP's device cookies), so a
 * stranger's guesses cannot keep the person out; a session they already hold
 * keeps working (refreshing checks no password); and an administrator's reset
 * or the server owner's recovery ends the refusal (`clear`).
 *
 * Each check is RESERVED before the password is compared, in one atomic
 * Redis transaction, so concurrent attempts cannot all read a count below the
 * limit and then all be compared: exactly `MAX_FAILED_SIGN_INS` are.
 *
 * The subject is the account when the identifier names one, so its email and
 * its username share one budget; an identifier that names no account is
 * counted under itself, which makes the two cases look the same from outside.
 * (One consequence, accepted: ten failures under an email followed by one
 * under a username tell the caller whether the two name the same account.)
 * The Redis key is a hash, so no address sits in Redis.
 *
 * A Redis failure propagates: the check fails closed rather than letting an
 * outage switch the limit off.
 */
@Injectable()
export class SignInFailureLimitService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Counts one password check for the subject, refusing with `RATE_LIMITED`
   * when the window's checks are used up. Call before comparing the password.
   */
  async reserveAttempt(subject: string): Promise<void> {
    const key = signInFailureKey(subject);
    // `SET … NX` creates the key with its expiry only when it is absent, so
    // the window starts at the first attempt and later ones never extend it;
    // one transaction, so no key is ever left without an expiry.
    const results = await this.redis.client
      .multi()
      .set(key, '0', 'EX', FAILED_SIGN_IN_WINDOW_SECONDS, 'NX')
      .incr(key)
      .exec();
    const commandError = results?.find(([error]) => error)?.[0];
    if (!results || commandError) {
      throw commandError ?? new Error('Sign-in attempt was not counted');
    }
    const attempts = Number(results[1]?.[1]);
    if (attempts > MAX_FAILED_SIGN_INS) {
      throw Errors.rateLimited(
        'Too many failed sign-ins for this account. Try again in a few minutes.',
      );
    }
  }

  /** Ends the count: a correct password, or a password set by someone else. */
  async clear(subject: string): Promise<void> {
    await this.redis.client.del(signInFailureKey(subject));
  }
}

/** The subject for an identifier: its account when it names one. */
export function signInSubject(
  userId: string | null,
  identifier: string,
): string {
  return userId
    ? accountSignInSubject(userId)
    : `identifier:${identifier.trim().toLowerCase()}`;
}

/**
 * The subject for a device the account has signed in from before
 * (`SignInDeviceTokenService`): its own count, which failures from anywhere
 * else never reach.
 */
export function deviceSignInSubject(userId: string, deviceId: string): string {
  return `device:${userId}:${deviceId}`;
}

/** The subject that counts an account's sign-ins, whichever name was typed. */
export function accountSignInSubject(userId: string): string {
  return `user:${userId}`;
}

/** The Redis key for a subject. Exported for the server owner's recovery script. */
export function signInFailureKey(subject: string): string {
  return `${KEY_PREFIX}${createHash('sha256').update(subject).digest('hex')}`;
}
