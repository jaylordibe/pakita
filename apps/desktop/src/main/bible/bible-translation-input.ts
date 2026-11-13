import { z } from 'zod';

/**
 * The details of a translation an import publishes. The server validates
 * them fully; this bounds what reaches it, and decides which details read
 * from a folder are worth suggesting.
 */
export const bibleTranslationInputSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9]{2,12}$/),
    name: z.string().trim().min(1).max(120),
    languageCode: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
    licence: z.string().trim().min(1).max(2000),
    attribution: z.string().trim().min(1).max(200),
    sourceUrl: z
      .url({ protocol: /^https?$/ })
      .max(500)
      .nullable(),
  })
  .strict();
