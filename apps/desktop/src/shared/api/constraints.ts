// Generated from apps/api/openapi.json by scripts/generate-api-enums.mjs.
// Do not edit: run `pnpm generate:api`.
import type { components } from './openapi';

interface FieldConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

/** Each request and response field's limits, as the API publishes them. */
export const apiConstraints = {
  AcceptWorkspaceInvitationDto: { token: { minLength: 20, maxLength: 200 } },
  AddWorkspaceMembershipDto: { notes: { maxLength: 1000 } },
  BibleVerseInputDto: {
    number: { minimum: 1, maximum: 200 },
    text: { minLength: 1, maxLength: 8000 },
  },
  CreateAppVersionDto: {
    version: { minLength: 1, maxLength: 50 },
    description: { maxLength: 2000 },
    downloadUrl: { maxLength: 2048 },
  },
  CreateBibleTranslationDto: {
    code: { pattern: '^[A-Z0-9]{2,12}$' },
    name: { minLength: 1, maxLength: 120 },
    languageCode: {
      maxLength: 40,
      pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
    },
    licence: { minLength: 1, maxLength: 2000 },
    attribution: { minLength: 1, maxLength: 200 },
    sourceUrl: { maxLength: 500 },
  },
  CreateDeviceTokenDto: {
    token: { minLength: 1, maxLength: 512 },
    deviceOsVersion: { minLength: 1, maxLength: 50 },
  },
  CreatePlaylistDto: {
    name: { minLength: 1, maxLength: 120 },
    serviceDate: { maxLength: 10 },
  },
  CreateSongDto: {
    title: { minLength: 1, maxLength: 200 },
    artist: { maxLength: 200 },
    sections: { minItems: 1 },
    arrangements: { minItems: 1 },
  },
  CreateThemeDto: {
    name: { minLength: 1, maxLength: 60 },
    textScale: { minimum: 50, maximum: 200 },
  },
  CreateUserDto: {
    password: {
      minLength: 8,
      maxLength: 72,
      pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
    },
    username: { minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9._-]+$' },
    firstName: { minLength: 1, maxLength: 100 },
    middleName: { maxLength: 100 },
    lastName: { minLength: 1, maxLength: 100 },
    timezone: { maxLength: 64 },
  },
  CreateWorkspaceAccountDto: {
    password: {
      minLength: 8,
      maxLength: 72,
      pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
    },
    username: { minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9._-]+$' },
    firstName: { minLength: 1, maxLength: 100 },
    middleName: { maxLength: 100 },
    lastName: { minLength: 1, maxLength: 100 },
    timezone: { maxLength: 64 },
  },
  CreateWorkspaceDto: {
    name: { minLength: 2, maxLength: 120 },
    slug: { minLength: 2, maxLength: 60 },
    description: { maxLength: 1000 },
  },
  CreateWorkspaceInvitationDto: {
    identifier: { minLength: 3, maxLength: 254 },
  },
  GdprEraseDto: { currentPassword: { minLength: 8, maxLength: 72 } },
  LoginDto: {
    password: { minLength: 8, maxLength: 72 },
    identifier: { minLength: 3, maxLength: 254 },
    deviceTokens: { maxItems: 10 },
  },
  LogoutDto: { refreshToken: { minLength: 20, maxLength: 512 } },
  PlaylistItemInputDto: {
    arrangementName: { minLength: 1, maxLength: 60 },
    startChapter: { minimum: 1, maximum: 200 },
    startVerse: { minimum: 1, maximum: 200 },
    endChapter: { minimum: 1, maximum: 200 },
    endVerse: { minimum: 1, maximum: 200 },
  },
  PutBibleChapterDto: {
    verses: { minItems: 1, maxItems: 200 },
    bookName: { minLength: 1, maxLength: 60 },
  },
  RefreshTokenDto: { refreshToken: { minLength: 20, maxLength: 512 } },
  SongArrangementInputDto: {
    name: { minLength: 1, maxLength: 60 },
    sectionKeys: { minItems: 1 },
  },
  SongSectionInputDto: {
    key: { pattern: '^[A-Za-z0-9_-]{1,40}$' },
    label: { minLength: 1, maxLength: 60 },
    lyrics: { minLength: 1, maxLength: 10000 },
  },
  UpdateAppVersionDto: {
    version: { minLength: 1, maxLength: 50 },
    description: { maxLength: 2000 },
    downloadUrl: { maxLength: 2048 },
  },
  UpdateAuthUserEmailDto: { currentPassword: { minLength: 8, maxLength: 72 } },
  UpdateAuthUserInfoDto: {
    firstName: { minLength: 1, maxLength: 100 },
    middleName: { maxLength: 100 },
    lastName: { minLength: 1, maxLength: 100 },
    timezone: { maxLength: 64 },
  },
  UpdateAuthUsernameDto: {
    username: { minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9._-]+$' },
  },
  UpdateAuthUserPasswordDto: {
    currentPassword: { minLength: 8, maxLength: 72 },
    newPassword: {
      minLength: 8,
      maxLength: 72,
      pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
    },
  },
  UpdateDeviceTokenDto: {
    token: { minLength: 1, maxLength: 512 },
    deviceOsVersion: { minLength: 1, maxLength: 50 },
  },
  UpdatePasswordDto: {
    newPassword: {
      minLength: 8,
      maxLength: 72,
      pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
    },
  },
  UpdatePlaylistDto: {
    name: { minLength: 1, maxLength: 120 },
    serviceDate: { maxLength: 10 },
    expectedSyncVersion: { minimum: 1 },
  },
  UpdateSongDto: {
    title: { minLength: 1, maxLength: 200 },
    artist: { maxLength: 200 },
    sections: { minItems: 1 },
    arrangements: { minItems: 1 },
  },
  UpdateThemeDto: {
    name: { minLength: 1, maxLength: 60 },
    textScale: { minimum: 50, maximum: 200 },
  },
  UpdateUserDto: {
    username: { minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9._-]+$' },
    firstName: { minLength: 1, maxLength: 100 },
    middleName: { maxLength: 100 },
    lastName: { minLength: 1, maxLength: 100 },
    timezone: { maxLength: 64 },
  },
  UpdateWorkspaceDto: {
    name: { minLength: 2, maxLength: 120 },
    slug: { minLength: 2, maxLength: 60 },
    description: { maxLength: 1000 },
  },
  UpdateWorkspaceMembershipDto: { notes: { maxLength: 1000 } },
} as const satisfies {
  readonly [Schema in keyof components['schemas']]?: Readonly<
    Record<string, FieldConstraints>
  >;
};
