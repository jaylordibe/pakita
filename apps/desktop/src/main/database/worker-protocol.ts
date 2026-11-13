import { z } from 'zod';

// Messages between the main process and the database worker thread. Both
// sides validate what they receive, so a malformed message is an error, not
// undefined behaviour. Song payloads were validated by the main process
// against the API schema before they were sent here.

const requestId = z.number().int().nonnegative();
const workspaceId = z.string().min(1);

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
