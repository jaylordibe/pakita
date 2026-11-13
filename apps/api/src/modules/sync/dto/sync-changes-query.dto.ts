import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_SYNC_PAGE_SIZE = 200;

export class SyncChangesQueryDto {
  /**
   * The `nextCursor` of the previous page: changes AFTER this version are
   * returned. 0 (the default) starts from the beginning.
   */
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  cursor: number = 0;

  @ApiPropertyOptional({
    default: 100,
    minimum: 1,
    maximum: MAX_SYNC_PAGE_SIZE,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SYNC_PAGE_SIZE)
  limit: number = 100;
}
