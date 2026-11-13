import '../src/config/app-timezone';
import 'dotenv/config';
import { expand } from 'dotenv-expand';
import * as dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { buildRedisConnectionOptions } from '../src/common/redis/redis-connection';
import { hashPassword } from '../src/common/util/password-hashing.util';
import { lockUserRow } from '../src/common/util/row-lock.util';
import configuration from '../src/config/configuration';
import { endAllSessionsWithin } from '../src/modules/auth/end-all-sessions';
import {
  accountSignInSubject,
  signInFailureKey,
} from '../src/modules/auth/sign-in-failure-limit.service';
import { assertAccountPassword } from './account-seeder';

// The server owner's way back in when nobody who can reset passwords in the
// app can sign in: run on the server itself (deploy/reset-password.sh), which
// is what authorises it. Sets the account's password, ends every session it
// holds, lifts any failed-sign-in refusal on it (someone may be guessing at
// it — the likely reason the owner is here), and records the reset in the
// audit log.
//
// The person running it chose this password, so the account is NOT asked to
// replace it at the next sign-in (`isPasswordChangeRequired` stays false).
//
// Reads RESET_EMAIL and RESET_PASSWORD from the environment, never from
// arguments, so neither appears in a process listing.

expand(dotenv.config({ override: false }));

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.RESET_EMAIL?.trim().toLowerCase();
  const password = process.env.RESET_PASSWORD;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }
  if (!email || !password) {
    throw new Error('RESET_EMAIL and RESET_PASSWORD must both be set.');
  }
  assertAccountPassword(password, 'RESET_PASSWORD');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    // Hashed before the transaction, as every credential change is: bcrypt is
    // deliberately slow, and the row lock must not be held across it.
    const passwordHash = await hashPassword(password);
    const userId = await prisma.$transaction(async (transaction) => {
      // `findFirst`: email is unique only among live rows (partial index).
      const user = await transaction.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      if (!user) {
        throw new Error(`No account uses ${email}.`);
      }
      await lockUserRow(transaction, user.id);
      await endAllSessionsWithin(transaction, user.id, null, {
        password: passwordHash,
        isPasswordChangeRequired: false,
      });
      await transaction.auditLog.create({
        data: {
          action: 'password.reset.by_server_owner',
          actorId: null,
          targetUserId: user.id,
        },
      });
      return user.id;
    });
    // After the commit: the new password is what the next sign-in checks.
    const redis = new Redis(
      buildRedisConnectionOptions(new ConfigService(configuration())),
    );
    try {
      await redis.del(signInFailureKey(accountSignInSubject(userId)));
    } finally {
      redis.disconnect();
    }
    console.log(
      `Password set for ${email} (${userId}); every session it held has ended.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
