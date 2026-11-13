import type { Prisma, User } from '@prisma/client';
import { nextWholeSecond } from '../../common/util/session-cutoff.util';

/**
 * THE security mutation: end every session an account holds, everywhere.
 *
 * Moves the session cutoff and revokes every refresh family in one statement
 * pair, so neither access tokens nor refresh tokens survive. Pairs with
 * logout-all, support-driven revocation, every credential change,
 * deactivation, deletion, erasure, and the server owner's password recovery
 * (`prisma/reset-password.ts`) — the one write every one of them goes through.
 *
 * `userData` is folded into the SAME `users` update, so the reason for the
 * revocation and the revocation itself are one row version. That is what makes
 * "a password change always ends sessions" a structural property rather than a
 * rule each call site happened to remember: there is no way to write the new
 * password without also writing the cutoff.
 *
 * The caller must already hold the user lock (`lockUserRow`). It is not taken
 * here, because taking it twice in one transaction is harmless but taking it
 * in the wrong ORDER is not, and the caller is the only one who knows what
 * else it holds.
 *
 * A plain function rather than a service method so the owner's recovery
 * script, which runs without the application, uses this same write.
 */
export async function endAllSessionsWithin(
  transaction: Prisma.TransactionClient,
  userId: string,
  actorId: string | null,
  userData: Prisma.UserUpdateInput = {},
): Promise<User> {
  const updated = await transaction.user.update({
    where: { id: userId },
    data: {
      ...userData,
      // Rounded up to the next whole second — see `nextWholeSecond`. A raw
      // timestamp leaves a token minted in the same second as the change
      // valid, because `iat` has no sub-second precision to compare against.
      passwordChangedAt: nextWholeSecond(),
      updatedBy: actorId,
    },
  });
  await transaction.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return updated;
}
