import { z } from 'zod';

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

const songSectionSchema: z.ZodType<Schemas['SongSectionResponseDto']> =
  z.object({
    id: z.string(),
    kind: z.enum(['verse', 'chorus', 'bridge', 'intro', 'outro', 'custom']),
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

export const syncChangesSchema: z.ZodType<Schemas['SyncChangesResponseDto']> =
  z.object({
    epoch: z.string().min(1),
    latestVersion: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    songs: z.array(
      z.object({
        id: z.string(),
        syncVersion: z.number().int().positive(),
        isDeleted: z.boolean(),
        song: songSchema.nullable(),
      }),
    ),
  });
export type SyncChanges = z.infer<typeof syncChangesSchema>;

export const errorEnvelopeSchema = z.object({
  errorCode: z.string(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
});
