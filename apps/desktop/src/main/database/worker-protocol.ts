import { z } from 'zod';

// Messages between the main process and the database worker thread. Both
// sides validate what they receive, so a malformed message is an error, not
// undefined behaviour.

export const DatabaseWorkerRequest = z.discriminatedUnion('type', [
  z.object({
    requestId: z.number().int().nonnegative(),
    type: z.literal('health'),
  }),
  z.object({
    requestId: z.number().int().nonnegative(),
    type: z.literal('close'),
  }),
]);
export type DatabaseWorkerRequest = z.infer<typeof DatabaseWorkerRequest>;

export const DatabaseWorkerResponse = z.discriminatedUnion('isSuccess', [
  z.object({
    requestId: z.number().int().nonnegative(),
    isSuccess: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    requestId: z.number().int().nonnegative(),
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

export const DatabaseWorkerData = z.object({ databasePath: z.string().min(1) });
