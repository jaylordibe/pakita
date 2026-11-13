import type { Prisma } from '@prisma/client';
import type { Gender } from '../enums/gender.enum';
import { hashPassword } from './password-hashing.util';

/** What an administrator supplies for a new person's account. */
export interface NewAccountFields {
  email: string;
  username?: string;
  /** The first password, chosen by whoever creates the account. */
  password: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: Gender;
  birthday?: Date;
  timezone?: string;
}

/**
 * THE shape of an account somebody else creates. There is no public sign-up:
 * the platform admin (`POST /users`) and a workspace's owner or admins
 * (`POST /workspaces/:workspaceId/accounts`) are the only ways an account comes
 * to exist, and both build the row here so they cannot drift.
 *
 * The creator chose the password, so the account must replace it before it can
 * do anything else (`isPasswordChangeRequired`).
 */
export async function buildNewAccountData(
  fields: NewAccountFields,
  actorId: string,
): Promise<Prisma.UserUncheckedCreateInput> {
  return {
    email: fields.email.toLowerCase(),
    username: fields.username?.toLowerCase(),
    password: await hashPassword(fields.password),
    passwordChangedAt: new Date(),
    isPasswordChangeRequired: true,
    firstName: fields.firstName,
    middleName: fields.middleName,
    lastName: fields.lastName,
    gender: fields.gender,
    birthday: fields.birthday,
    timezone: fields.timezone,
    createdBy: actorId,
    updatedBy: actorId,
  };
}
