import { z } from 'zod';

import { bibleContentSchema } from '../api/api-schemas';

// Messages between the main process and the database worker thread. Both
// sides validate what they receive, so a malformed message is an error, not
// undefined behaviour. Song payloads were validated by the main process
// against the API schema before they were sent here.

const requestId = z.number().int().nonnegative();
const workspaceId = z.string().min(1);
const translationId = z.string().min(1);
const bookCode = z.string().regex(/^[A-Z0-9]{3}$/);
const positive = z.number().int().positive();
const versePosition = z.object({ chapter: positive, verse: positive });

export const syncedSongChangeSchema = z.object({
  id: z.string().min(1),
  syncVersion: z.number().int().positive(),
  isDeleted: z.boolean(),
  song: z
    .object({
      title: z.string(),
      artist: z.string().nullable(),
      isArchived: z.boolean(),
    })
    .passthrough()
    .nullable(),
});

export const syncedThemeChangeSchema = z.object({
  id: z.string().min(1),
  syncVersion: z.number().int().positive(),
  isDeleted: z.boolean(),
  theme: z
    .object({ name: z.string(), isDefault: z.boolean() })
    .passthrough()
    .nullable(),
});

export const syncedPlaylistChangeSchema = z.object({
  id: z.string().min(1),
  syncVersion: z.number().int().positive(),
  isDeleted: z.boolean(),
  playlist: z
    .object({ name: z.string(), serviceDate: z.string().nullable() })
    .passthrough()
    .nullable(),
});

export const DatabaseWorkerRequest = z.discriminatedUnion('type', [
  z.object({ requestId, type: z.literal('health') }),
  z.object({ requestId, type: z.literal('close') }),
  z.object({ requestId, type: z.literal('getSyncState'), workspaceId }),
  z.object({
    requestId,
    type: z.literal('applySyncPage'),
    workspaceId,
    epoch: z.string().min(1),
    nextCursor: z.number().int().nonnegative(),
    songs: z.array(syncedSongChangeSchema),
    themes: z.array(syncedThemeChangeSchema),
    playlists: z.array(syncedPlaylistChangeSchema),
  }),
  z.object({
    requestId,
    type: z.literal('beginResync'),
    workspaceId,
    epoch: z.string().min(1),
  }),
  z.object({ requestId, type: z.literal('finishResync'), workspaceId }),
  z.object({
    requestId,
    type: z.literal('listSongs'),
    workspaceId,
    search: z.string().max(200).default(''),
    isArchived: z.boolean().default(false),
  }),
  z.object({
    requestId,
    type: z.literal('getSong'),
    workspaceId,
    songId: z.string().min(1),
  }),
  z.object({ requestId, type: z.literal('listThemes'), workspaceId }),
  z.object({
    requestId,
    type: z.literal('getTheme'),
    workspaceId,
    themeId: z.string().min(1),
  }),
  z.object({ requestId, type: z.literal('getDefaultTheme'), workspaceId }),
  z.object({ requestId, type: z.literal('listPlaylists'), workspaceId }),
  z.object({
    requestId,
    type: z.literal('getPlaylist'),
    workspaceId,
    playlistId: z.string().min(1),
  }),
  z.object({ requestId, type: z.literal('listBibleTranslations') }),
  z.object({
    requestId,
    type: z.literal('replaceBibleTranslation'),
    content: bibleContentSchema,
  }),
  z.object({
    requestId,
    type: z.literal('removeBibleTranslation'),
    translationId,
  }),
  z.object({ requestId, type: z.literal('listBibleBooks'), translationId }),
  z.object({
    requestId,
    type: z.literal('getBiblePassage'),
    translationId,
    bookCode,
    start: versePosition,
    end: versePosition,
  }),
  z.object({
    requestId,
    type: z.literal('searchBible'),
    translationId,
    search: z.string().max(200),
  }),
]);
export type DatabaseWorkerRequest = z.infer<typeof DatabaseWorkerRequest>;
export type DatabaseWorkerRequestInput = z.input<typeof DatabaseWorkerRequest>;

export const DatabaseWorkerResponse = z.discriminatedUnion('isSuccess', [
  z.object({ requestId, isSuccess: z.literal(true), result: z.unknown() }),
  z.object({
    requestId,
    isSuccess: z.literal(false),
    errorMessage: z.string(),
  }),
]);
export type DatabaseWorkerResponse = z.infer<typeof DatabaseWorkerResponse>;

export const DatabaseHealthResult = z.object({
  journalMode: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  latestSchemaVersion: z.number().int().nonnegative(),
});

export const SyncStateResult = z
  .object({
    epoch: z.string(),
    cursor: z.number().int().nonnegative(),
    isResyncing: z.boolean(),
  })
  .nullable();

export const SongSummaryResult = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    artist: z.string().nullable(),
    isArchived: z.boolean(),
  }),
);

export const DatabaseWorkerData = z.object({ databasePath: z.string().min(1) });

export const BibleTranslationsResult = z.array(
  z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    languageCode: z.string(),
    attribution: z.string(),
    contentHash: z.string(),
    verseCount: z.number().int().nonnegative(),
  }),
);

export const BibleBooksResult = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    position: z.number().int().nonnegative(),
    chapterCount: z.number().int().positive(),
  }),
);

const storedVerse = z.object({
  bookCode: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  text: z.string(),
});

export const BiblePassageResult = z.array(storedVerse);

export const BibleSearchResult = z.array(
  storedVerse.extend({ bookName: z.string() }),
);

export const ThemeSummaryResult = z.array(
  z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() }),
);

export const PlaylistSummaryResult = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    serviceDate: z.string().nullable(),
  }),
);
