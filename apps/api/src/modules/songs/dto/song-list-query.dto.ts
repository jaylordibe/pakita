import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { MetaQueryDto } from '../../../common/dto/meta-query.dto';
import { toOptionalBoolean } from '../../../common/util/query-boolean.util';

export class SongListQueryDto extends MetaQueryDto {
  /** Absent means the active library only (archived songs hidden). */
  @IsOptional()
  @Type(() => String)
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isArchived?: boolean;
}
