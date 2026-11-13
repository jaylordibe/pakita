import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SongSectionKind } from '../../../common/enums/song-section-kind.enum';

export const MAX_SONG_SECTIONS = 100;
export const MAX_SONG_ARRANGEMENTS = 20;
export const MAX_ARRANGEMENT_ITEMS = 200;
export const MAX_LYRICS_LENGTH = 10_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Line endings are normalised so a slide split on blank lines behaves the
// same whatever system the lyrics were typed on.
const normaliseLyrics = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : value;

export class SongSectionInputDto {
  /**
   * A client-chosen name for this section, unique within the request, that
   * arrangements use to refer to it. It is not stored: sections get ids.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/, {
    message: 'key must be 1–40 letters, digits, hyphens or underscores',
  })
  key!: string;

  @IsEnum(SongSectionKind)
  kind!: SongSectionKind;

  /** What the operator sees, e.g. "Verse 2". */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  /** The lyrics. A blank line starts a new slide. */
  @Transform(normaliseLyrics)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_LYRICS_LENGTH)
  lyrics!: string;
}

export class SongArrangementInputDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  /** Exactly one arrangement per song is the default. */
  @IsBoolean()
  isDefault!: boolean;

  /** Section keys in presentation order; a key may repeat. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ARRANGEMENT_ITEMS)
  @IsString({ each: true })
  sectionKeys!: string[];
}

/**
 * A song's whole content: its sections, and optionally its arrangements.
 * Without arrangements the song gets one default arrangement presenting every
 * section once, in order.
 */
export class SongContentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SONG_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => SongSectionInputDto)
  sections!: SongSectionInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SONG_ARRANGEMENTS)
  @ValidateNested({ each: true })
  @Type(() => SongArrangementInputDto)
  arrangements?: SongArrangementInputDto[];
}
