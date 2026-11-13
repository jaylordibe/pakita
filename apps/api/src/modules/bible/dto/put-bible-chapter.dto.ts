import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MAX_VERSES_PER_CHAPTER = 200;
// Room for the longest verses real translations hold: the additions to Greek
// Esther run past 4000 characters in a single verse (eBible.org's WEB, 8:13).
export const MAX_VERSE_LENGTH = 8000;

export class BibleVerseInputDto {
  @IsInt()
  @Min(1)
  @Max(MAX_VERSES_PER_CHAPTER)
  number!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_VERSE_LENGTH)
  text!: string;
}

/** One chapter of a draft translation, replacing whatever it held. */
export class PutBibleChapterDto {
  /** The book's name in the translation's language, e.g. "Juan". */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  bookName!: string;

  @ApiProperty({
    type: () => [BibleVerseInputDto],
    minItems: 1,
    maxItems: MAX_VERSES_PER_CHAPTER,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VERSES_PER_CHAPTER)
  @ValidateNested({ each: true })
  @Type(() => BibleVerseInputDto)
  verses!: BibleVerseInputDto[];
}
