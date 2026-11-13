import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MAX_SONG_ARRANGEMENTS,
  MAX_SONG_SECTIONS,
  SongArrangementInputDto,
  SongSectionInputDto,
} from './song-content.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Every field is optional. `sections` REPLACES the song's content; send
 * `arrangements` with it (they refer to the new section keys), or the song
 * gets one default arrangement of every section in order. `arrangements`
 * cannot be sent without `sections`.
 */
export class UpdateSongDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** `null` clears it. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  artist?: string | null;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SONG_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => SongSectionInputDto)
  sections?: SongSectionInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SONG_ARRANGEMENTS)
  @ValidateNested({ each: true })
  @Type(() => SongArrangementInputDto)
  arrangements?: SongArrangementInputDto[];
}
