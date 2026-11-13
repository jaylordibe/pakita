import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  BIBLE_BOOK_CODES,
  type BibleBookCode,
} from '../../../common/constants/bible-books';
import { PlaylistItemKind } from '../../../common/enums/playlist-item-kind.enum';

const MAX_CHAPTER_OR_VERSE = 200;
const isSong = (playlistItem: PlaylistItemInputDto) =>
  playlistItem.kind === PlaylistItemKind.SONG;
const isPassage = (playlistItem: PlaylistItemInputDto) =>
  playlistItem.kind === PlaylistItemKind.PASSAGE;

/**
 * A song (`songId`, optionally `arrangementName`) or a passage within one
 * book (`bibleTranslationId`, `bookCode` and the start and end verses).
 * Fields of the other kind must be absent.
 */
export class PlaylistItemInputDto {
  @ApiProperty({ enum: PlaylistItemKind, enumName: 'PlaylistItemKind' })
  @IsEnum(PlaylistItemKind)
  kind!: PlaylistItemKind;

  @ValidateIf(isSong)
  @IsUUID()
  songId?: string;

  /** The arrangement to present; the song's default when absent. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  arrangementName?: string;

  @ValidateIf(isPassage)
  @IsUUID()
  bibleTranslationId?: string;

  @ApiPropertyOptional({ enum: BIBLE_BOOK_CODES, enumName: 'BibleBookCode' })
  @ValidateIf(isPassage)
  @IsIn(BIBLE_BOOK_CODES)
  bookCode?: BibleBookCode;

  @ValidateIf(isPassage)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAPTER_OR_VERSE)
  startChapter?: number;

  @ValidateIf(isPassage)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAPTER_OR_VERSE)
  startVerse?: number;

  @ValidateIf(isPassage)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAPTER_OR_VERSE)
  endChapter?: number;

  @ValidateIf(isPassage)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAPTER_OR_VERSE)
  endVerse?: number;
}
