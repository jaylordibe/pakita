import { PartialType } from '@nestjs/swagger';
import { CreateThemeDto } from './create-theme.dto';

/**
 * Every field is optional. `isDefault: true` makes this the default;
 * `isDefault: false` leaves the workspace with no default theme.
 */
export class UpdateThemeDto extends PartialType(CreateThemeDto) {}
