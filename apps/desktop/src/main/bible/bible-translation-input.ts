import { z } from 'zod';

import { apiConstraints } from '../../shared/api/constraints';

const limits = apiConstraints.CreateBibleTranslationDto;

/**
 * The details of a translation an import publishes, held to the limits the
 * API publishes (generated from its OpenAPI document). They decide which
 * details read from a folder are worth suggesting, and bound what reaches the
 * server.
 */
export const bibleTranslationInputSchema = z
  .object({
    // The server stores codes in capitals; accept them typed in either case.
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(new RegExp(limits.code.pattern)),
    name: z
      .string()
      .trim()
      .min(limits.name.minLength)
      .max(limits.name.maxLength),
    languageCode: z
      .string()
      .trim()
      .max(limits.languageCode.maxLength)
      .regex(new RegExp(limits.languageCode.pattern)),
    licence: z
      .string()
      .trim()
      .min(limits.licence.minLength)
      .max(limits.licence.maxLength),
    attribution: z
      .string()
      .trim()
      .min(limits.attribution.minLength)
      .max(limits.attribution.maxLength),
    sourceUrl: z
      .url({ protocol: /^https?$/ })
      .max(limits.sourceUrl.maxLength)
      .nullable(),
  })
  .strict();
