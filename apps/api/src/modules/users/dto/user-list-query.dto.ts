import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { MetaQueryDto } from '../../../common/dto/meta-query.dto';
import { toOptionalBoolean } from '../../../common/util/query-boolean.util';

export class UserListQueryDto extends MetaQueryDto {
  /**
   * `false`: live accounts only; `true`: deleted (and erased) ones only.
   * Absent means both, so a deleted account stays findable for recovery.
   */
  @IsOptional()
  @Type(() => String)
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isDeleted?: boolean;
}
