import { PickType } from '@nestjs/swagger';
import { CreateMediaDto } from './create-media.dto';

/** Renames a video; its bytes never change. */
export class UpdateMediaDto extends PickType(CreateMediaDto, ['name']) {}
