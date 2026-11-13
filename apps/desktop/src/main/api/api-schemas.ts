import { z } from 'zod';

import {
  bibleBookCodeValues,
  playlistItemKindValues,
  themeBackgroundValues,
  themeFontValues,
  themeTextAlignValues,
} from '../../shared/api/enums';
import type { components } from '../../shared/api/openapi';

type Schemas = components['schemas'];

// Runtime validation of what the server sends, before the main process acts
// on it or writes it to the local database. Each schema is typed against the
// types generated from the API's openapi.json, so a contract change that this
// file does not follow fails `pnpm typecheck`.

export const serverInfoSchema: z.ZodType<Schemas['ServerInfoResponseDto']> =
  z.object({
    product: z.literal('pakita'),
    serverVersion: z.string(),
    apiLevel: z.number().int().nonnegative(),
    minimumDesktopVersion: z.string(),
    isBotCheckRequired: z.boolean(),
  });

const signedInUserSchema: z.ZodType<
  Pick<Schemas['UserResponseDto'], 'id' | 'email' | 'firstName' | 'lastName'>
> = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});

export const loginResponseSchema: z.ZodType<
  Pick<
    Schemas['LoginResponseDto'],
    'accessToken' | 'refreshToken' | 'expiresIn'
  > & {
    user: z.infer<typeof signedInUserSchema>;
  }
> = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().positive(),
  user: signedInUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

const workspaceSchema: z.ZodType<
  Pick<Schemas['WorkspaceResponseDto'], 'id' | 'name' | 'slug'>
> = z.object({ id: z.string(), name: z.string(), slug: z.string() });
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspacePageSchema = z.object({
  data: z.array(workspaceSchema),
});

type SongSectionKind = Schemas['SongSectionResponseDto']['kind'];
const KNOWN_SECTION_KINDS: readonly string[] = [
  'verse',
  'chorus',
  'bridge',
  'intro',
  'outro',
  'custom',
] satisfies SongSectionKind[];

const songSectionSchema: z.ZodType<Schemas['SongSectionResponseDto']> =
  z.object({
    id: z.string(),
    // A kind added on the server after this build is read as `custom`, so an
    // older desktop keeps synchronising (the slides never depend on it).
    kind: z
      .string()
      .transform((kind) =>
        KNOWN_SECTION_KINDS.includes(kind)
          ? (kind as SongSectionKind)
          : 'custom',
      ),
    label: z.string(),
    lyrics: z.string().max(10_000),
    position: z.number().int().nonnegative(),
  });

const songArrangementSchema: z.ZodType<Schemas['SongArrangementResponseDto']> =
  z.object({
    id: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    position: z.number().int().nonnegative(),
    sectionIds: z.array(z.string()),
  });

export const songSchema: z.ZodType<Schemas['SongResponseDto']> = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  isArchived: z.boolean(),
  syncVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sections: z.array(songSectionSchema),
  arrangements: z.array(songArrangementSchema),
});

const HEX_COLOUR = /^#[0-9a-f]{6}$/;

// A choice added on the server after this build falls back to the plainest
// one, so an older desktop keeps synchronising and presenting.
export const themeSchema: z.ZodType<Schemas['ThemeResponseDto']> = z.object({
  id: z.uuid(),
  workspaceId: z.string(),
  name: z.string().max(60),
  background: z.enum(themeBackgroundValues).catch('solid'),
  backgroundColor: z.string().regex(HEX_COLOUR).catch('#000000'),
  textColor: z.string().regex(HEX_COLOUR).catch('#ffffff'),
  font: z.enum(themeFontValues).catch('sans'),
  textScale: z.number().int().min(50).max(200).catch(100),
  textAlign: z.enum(themeTextAlignValues).catch('center'),
  isDefault: z.boolean(),
  syncVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const position = z.number().int().min(1).max(200);
const playlistItemSchema: z.ZodType<Schemas['PlaylistItemResponseDto']> =
  z.object({
    id: z.string(),
    position: z.number().int().nonnegative(),
    kind: z.enum(playlistItemKindValues),
    songId: z.uuid().nullable(),
    arrangementName: z.string().max(60).nullable(),
    bibleTranslationId: z.uuid().nullable(),
    bookCode: z.enum(bibleBookCodeValues).nullable(),
    startChapter: position.nullable(),
    startVerse: position.nullable(),
    endChapter: position.nullable(),
    endVerse: position.nullable(),
  });

export const playlistSchema: z.ZodType<Schemas['PlaylistResponseDto']> =
  z.object({
    id: z.uuid(),
    workspaceId: z.string(),
    name: z.string().max(120),
    serviceDate: z.iso.date().nullable(),
    themeId: z.uuid().nullable(),
    syncVersion: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // A kind added after this build is left out. Saving the playlist would
    // then drop it on the server, so a release that adds a kind must also
    // raise the server's minimumDesktopVersion.
    items: z
      .array(z.unknown())
      .max(100)
      .transform((items) =>
        items.flatMap((candidate) => {
          const parsed = playlistItemSchema.safeParse(candidate);
          return parsed.success ? [parsed.data] : [];
        }),
      ),
  });

const change = <Key extends string, Content extends z.ZodType>(
  key: Key,
  content: Content,
) =>
  z.object({
    id: z.string(),
    syncVersion: z.number().int().positive(),
    isDeleted: z.boolean(),
    [key]: content.nullable(),
  } as {
    id: z.ZodString;
    syncVersion: z.ZodNumber;
    isDeleted: z.ZodBoolean;
  } & Record<Key, z.ZodNullable<Content>>);

export const syncChangesSchema: z.ZodType<Schemas['SyncChangesResponseDto']> =
  z.object({
    epoch: z.string().min(1),
    latestVersion: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    songs: z.array(change('song', songSchema)),
    themes: z.array(change('theme', themeSchema)),
    playlists: z.array(change('playlist', playlistSchema)),
  });
export type SyncChanges = z.infer<typeof syncChangesSchema>;

export const errorEnvelopeSchema = z.object({
  errorCode: z.string(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
});

export const bibleTranslationSchema: z.ZodType<
  Pick<
    Schemas['BibleTranslationResponseDto'],
    | 'id'
    | 'code'
    | 'name'
    | 'languageCode'
    | 'attribution'
    | 'isPublished'
    | 'contentHash'
    | 'verseCount'
  >
> = z.object({
  id: z.uuid(),
  code: z.string().max(12),
  name: z.string().max(120),
  languageCode: z.string().max(40),
  attribution: z.string().max(200),
  isPublished: z.boolean(),
  contentHash: z.string().nullable(),
  verseCount: z.number().int().nonnegative(),
});
export type BibleTranslationSummary = z.infer<typeof bibleTranslationSchema>;

export const bibleTranslationListSchema = z.array(bibleTranslationSchema);

export const bibleContentSchema: z.ZodType<{
  translation: BibleTranslationSummary;
  books: Schemas['BibleBookResponseDto'][];
  verses: Schemas['BibleVerseResponseDto'][];
}> = z.object({
  translation: bibleTranslationSchema,
  books: z
    .array(
      z.object({
        code: z.string().max(3),
        name: z.string().max(60),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(100),
  verses: z
    .array(
      z.object({
        bookCode: z.string().max(3),
        chapter: z.number().int().positive(),
        verse: z.number().int().positive(),
        text: z.string().max(2000),
      }),
    )
    .max(50_000),
});
export type BibleContent = z.infer<typeof bibleContentSchema>;
