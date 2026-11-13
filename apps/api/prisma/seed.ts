import '../src/config/app-timezone';
import 'dotenv/config';
import { expand } from 'dotenv-expand';
import * as dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { seedPermissions, seedRoles } from './rbac-seeder';
import {
  assertAccountPassword,
  type SeedUser,
  upsertSeedUser,
} from './account-seeder';

// Load .env (with ${VAR} expansion) before touching process.env, matching
// how the runtime app bootstraps via @nestjs/config + prisma.config.ts.
expand(dotenv.config({ override: false }));

type SeedPrefix =
  | 'ADMIN'
  | 'ENGINEER'
  | 'TECHNICAL_SUPPORT'
  | 'APP_SUPPORT'
  | 'USER';

function readSeedUser(
  prefix: SeedPrefix,
  firstName: string,
  lastName: string,
  platformRoles: readonly SeededRoleName[],
): SeedUser {
  const emailKey = `SEED_${prefix}_EMAIL`;
  const passwordKey = `SEED_${prefix}_PASSWORD`;
  const email = process.env[emailKey];
  const password = process.env[passwordKey];

  if (!email || !password) {
    throw new Error(
      `${emailKey} and ${passwordKey} must be set before running the seeder. ` +
        `Set them in .env for local dev or in your deploy environment for staging/prod.`,
    );
  }

  // A typo'd env var must not install a 4-char admin password.
  assertAccountPassword(password, passwordKey);

  return {
    label: prefix.toLowerCase(),
    email,
    password,
    firstName,
    lastName,
    platformRoles,
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Cannot seed.');
  }

  // Platform roles are STAFF roles. The ordinary seed user deliberately gets
  // NONE — that is the shape of a real account, and seeding one proves the
  // claim that a user with no platform role and no membership is fully
  // functional. Self-service capability comes from
  // AUTHENTICATED_USER_PERMISSIONS, which the ability factory grants to every
  // authenticated caller rather than from any row in `user_roles`.
  const admin = readSeedUser('ADMIN', 'Admin', 'User', [
    SeededRoleName.PLATFORM_ADMIN,
  ]);
  // Everyone below is for development, and optional: a church server seeds
  // only its first administrator (deploy/create-admin.sh). One account per
  // remaining platform role, each a separate person who never joins a church,
  // and one ordinary account with no role at all.
  const optional = (
    prefix: SeedPrefix,
    firstName: string,
    lastName: string,
    platformRoles: readonly SeededRoleName[],
  ): SeedUser | null =>
    process.env[`SEED_${prefix}_EMAIL`] ||
    process.env[`SEED_${prefix}_PASSWORD`]
      ? readSeedUser(prefix, firstName, lastName, platformRoles)
      : null;
  const others = [
    optional('ENGINEER', 'Platform', 'Engineer', [
      SeededRoleName.PLATFORM_ENGINEER,
    ]),
    optional('TECHNICAL_SUPPORT', 'Technical', 'Support', [
      SeededRoleName.PLATFORM_TECHNICAL_SUPPORT,
    ]),
    optional('APP_SUPPORT', 'App', 'Support', [
      SeededRoleName.PLATFORM_APP_SUPPORT,
    ]),
    optional('USER', 'Regular', 'User', []),
  ].filter((seedUser): seedUser is SeedUser => seedUser !== null);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // Order matters: roles reference permissions, users reference roles.
    await seedPermissions(prisma);
    await seedRoles(prisma);
    await upsertSeedUser(prisma, admin);
    for (const seedUser of others) {
      await upsertSeedUser(prisma, seedUser);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[seed] failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
