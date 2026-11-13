import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PlaylistItemInputDto } from './playlist-item-input.dto';

export const MAX_PLAYLIST_ITEMS = 100;

export class CreatePlaylistDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** The service's date, `YYYY-MM-DD`; `null` for none. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsDateString({ strict: true })
  @MaxLength(10)
  serviceDate?: string | null;

  /** The theme to present with; the workspace default when `null`. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  themeId?: string | null;

  /** In presentation order. */
  @IsArray()
  @ArrayMaxSize(MAX_PLAYLIST_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemInputDto)
  items!: PlaylistItemInputDto[];
}
