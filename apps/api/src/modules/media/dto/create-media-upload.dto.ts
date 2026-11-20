import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FilePurpose } from '../../../common/enums/file-purpose.enum';
import { FILE_PURPOSE_POLICIES } from '../../files/file-purpose.policy';

const BACKGROUND_VIDEO_POLICY =
  FILE_PURPOSE_POLICIES[FilePurpose.BACKGROUND_VIDEO];

/** The video about to be uploaded, as the laptop read it from disk. */
export class CreateMediaUploadDto {
  /** The file's name on the laptop; stored in a safe display form. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  /** Exact size in bytes; storage refuses a body of any other size. */
  @IsInt()
  @Min(1)
  @Max(BACKGROUND_VIDEO_POLICY.maxBytes)
  sizeBytes!: number;

  @ApiProperty({ enum: [...BACKGROUND_VIDEO_POLICY.accepted.keys()] })
  @IsIn([...BACKGROUND_VIDEO_POLICY.accepted.keys()])
  contentType!: string;

  /**
   * Lowercase hex SHA-256 of the bytes. Storage that verifies it refuses
   * other bytes, and every laptop that downloads the video checks it.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'sha256 must be 64 hex characters' })
  sha256!: string;
}
