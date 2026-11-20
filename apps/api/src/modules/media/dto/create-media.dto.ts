import { Transform } from 'class-transformer';
import {
  IsInt,
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
 * Finishes an upload: the API checks what storage holds for `fileId`, then
 * adds the video. The measurements are the uploading laptop's; every laptop
 * checks the file again when it plays it.
 */
export class CreateMediaDto {
  /** The id `POST …/media/uploads` returned. */
  @IsUUID()
  fileId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Pixels; at most 1920 on the long side and 1080 on the short side. */
  @IsInt()
  @Min(1)
  @Max(MEDIA_MAX_LONG_SIDE)
  width!: number;

  /** Pixels; at most 1920 on the long side and 1080 on the short side. */
  @IsInt()
  @Min(1)
  @Max(MEDIA_MAX_LONG_SIDE)
  height!: number;

  /** Milliseconds; at most an hour. */
  @IsInt()
  @Min(1)
  @Max(60 * 60 * 1000)
  durationMs!: number;
}
