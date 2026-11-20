import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type { Media } from '@prisma/client';

/**
 * A background video. Carries no URL: a laptop asks for one
 * (`GET …/media/:id/download`) when it downloads the bytes.
 */
export class MediaResponseDto {
  id!: string;
  workspaceId!: string;
  name!: string;
  /** Lowercase hex SHA-256 of the bytes; verify the download against it. */
  sha256!: string;
  sizeBytes!: number;
  /** `video/mp4` or `video/webm`. */
  contentType!: string;
  width!: number;
  height!: number;
  durationMs!: number;
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
  }
}
