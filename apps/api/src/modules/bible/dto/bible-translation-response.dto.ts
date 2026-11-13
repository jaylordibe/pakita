import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type { BibleTranslation } from '@prisma/client';

export class BibleTranslationResponseDto {
  id!: string;
  code!: string;
  name!: string;
  languageCode!: string;
  licence!: string;
  attribution!: string;
  sourceUrl!: string | null;
  isPublished!: boolean;
  publishedAt!: Date | null;
  /** SHA-256 of the canonical content; null until published. */
  contentHash!: string | null;
  verseCount!: number;
  createdAt!: Date;
  updatedAt!: Date;

  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;

  constructor(row: BibleTranslation) {
    Object.assign(this, row);
  }
}

export class BibleBookResponseDto {
  code!: string;
  name!: string;
  position!: number;
}

export class BibleVerseResponseDto {
  bookCode!: string;
  chapter!: number;
  verse!: number;
  text!: string;
}

/**
 * A published translation's whole text, in canonical order (book position,
 * chapter, verse). `contentHash` is the SHA-256 of that order's canonical
 * form (src/common/util/bible-content-hash.util.ts); a client verifies it.
 */
export class BibleContentResponseDto {
  translation!: BibleTranslationResponseDto;
  books!: BibleBookResponseDto[];
  verses!: BibleVerseResponseDto[];
}
