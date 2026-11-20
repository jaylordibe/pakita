import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The longest side a background video may have, in pixels (1080p). */
export const MEDIA_MAX_LONG_SIDE = 1920;
/** The shorter side's limit, in pixels (1080p). */
export const MEDIA_MAX_SHORT_SIDE = 1080;

/**
 * Adds an uploaded background. A video (`POST …/media/uploads`): the API
 * checks what storage holds for `fileId`, and `width`, `height` and
 * `durationMs` are required — the uploading laptop's measurements, which
 * every laptop checks again when it plays it. An image (`POST /files`,
 * purpose `background_image`): the measurements are the API's own, and any
 * sent are ignored. Which one it is follows from the file.
 */
export class CreateMediaDto {
  /** The id `POST …/media/uploads` (video) or `POST /files` (image) returned. */
  @IsUUID()
  fileId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** A video's pixels; at most 1920 on the long side, 1080 on the short. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MEDIA_MAX_LONG_SIDE)
  width?: number;

  /** A video's pixels; at most 1920 on the long side, 1080 on the short. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MEDIA_MAX_LONG_SIDE)
  height?: number;

  /** A video's length in milliseconds; at most an hour. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60 * 60 * 1000)
  durationMs?: number;
}
