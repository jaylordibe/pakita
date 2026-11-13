import * as bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import {
  accountPasswordMessage,
  isAccountPassword,
} from '../src/common/util/account-password.util';
import { assignPlatformRole } from './rbac-seeder';

// Creates the accounts the seeders need, with a hashed password
// that passes the account password rule. Shared by `prisma/seed.ts` (the
// SEED_* admin and user) and `prisma/sample-church.ts` (the sample church's
// people), so both make an account the same way.

// Same cost factor as UsersService. Keep in sync if that constant changes.
const BCRYPT_ROUNDS = 12;

export interface SeedUser {
  label: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  // PLATFORM-scope roles granted through `user_roles`. Empty for an ordinary
  // account — platform roles are staff roles, and self-service capability comes
  // from AUTHENTICATED_USER_PERMISSIONS rather than from a row here.
  platformRoles: readonly SeededRoleName[];
}

/** Refuses a password the API itself would refuse (the seeders bypass its validation). */
export function assertAccountPassword(password: string, field: string): void {
  if (!isAccountPassword(password)) {
    throw new Error(accountPasswordMessage(field));
  }
}

export async function upsertSeedUser(
  prisma: PrismaClient,
  user: SeedUser,
): Promise<void> {
  const email = user.email.toLowerCase();
  // `findFirst`: email is unique only among live rows (partial index).
  const existing = await prisma.user.findFirst({ where: { email } });

  // Platform roles never go to a deleted account: restoring one by seeding
  // would hand the administrator role to whatever the row was before.
  if (existing?.deletedAt && user.platformRoles.length > 0) {
    throw new Error(
      `${email} belongs to a deleted account; refusing to give it ${user.platformRoles.join(', ')}. Use another email.`,
    );
  }

  let userId: string;
  if (existing) {
    // Idempotent re-run: don't clobber anything. If an operator has
    // manually rotated the seeded admin's password, a repeat seed should
    // not reset it.
    console.log(
      `[seed] ${user.label}: already exists (${email}) — leaving as is.`,
    );
    userId = existing.id;
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(user.password, BCRYPT_ROUNDS),
        passwordChangedAt: new Date(),
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
    console.log(
      `[seed] ${user.label}: created ${created.email} (${created.id})`,
    );
    userId = created.id;
  }

  // Role links are reconciled on every run even for a pre-existing user, so a
  // seeded admin that predates RBAC picks up its `user_roles` rows.
  if (user.platformRoles.length === 0) return;
  for (const roleName of user.platformRoles) {
    await assignPlatformRole(prisma, userId, roleName);
  }
  console.log(
    `[seed] ${user.label}: platform role(s) ${user.platformRoles.join(', ')} in sync`,
  );
}
