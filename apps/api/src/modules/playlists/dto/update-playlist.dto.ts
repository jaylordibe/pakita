import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreatePlaylistDto } from './create-playlist.dto';

/** Every field is optional; `items` replaces the whole running order. */
export class UpdatePlaylistDto extends PartialType(CreatePlaylistDto) {
  /**
   * The `syncVersion` this edit was made from. When the playlist has changed
   * since, the edit is refused (409) instead of overwriting that change.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedSyncVersion?: number;
}
