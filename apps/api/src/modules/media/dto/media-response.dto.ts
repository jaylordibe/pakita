import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type { Media } from '@prisma/client';
import { MediaKind } from '../../../common/enums/media-kind.enum';

/**
 * A theme background: a looping video or a still image. Carries no URL: a laptop asks for one
 * (`GET …/media/:id/download`) when it downloads the bytes.
 */
export class MediaResponseDto {
  id!: string;
  workspaceId!: string;
  name!: string;
  @ApiProperty({ enum: MediaKind, enumName: 'MediaKind' })
  kind!: MediaKind;
  /** Lowercase hex SHA-256 of the bytes; verify the download against it. */
  sha256!: string;
  sizeBytes!: number;
  /** `video/mp4`, `video/webm`, `image/jpeg`, `image/png` or `image/webp`. */
  contentType!: string;
  width!: number;
  height!: number;
  /** A video's length; null for an image. */
  durationMs!: number | null;
  /** The workspace sync version of the video's latest change. */
  syncVersion!: number;
  createdAt!: Date;
  updatedAt!: Date;

  @ApiHideProperty() @Exclude() fileAssetId!: string | null;
  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;
  @ApiHideProperty() @Exclude() deletedAt!: Date | null;
  @ApiHideProperty() @Exclude() deletedBy!: string | null;

  constructor(row: Media) {
    Object.assign(this, row);
    this.kind = row.kind as MediaKind;
  }
}
