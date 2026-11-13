import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ThemeBackground,
  ThemeFont,
  ThemeTextAlign,
} from '../../../common/enums/theme.enum';

const HEX_COLOUR = /^#[0-9a-f]{6}$/;
const toLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateThemeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: ThemeBackground, enumName: 'ThemeBackground' })
  @IsEnum(ThemeBackground)
  background!: ThemeBackground;

  /** `#rrggbb`; the colour of a solid background. */
  @Transform(toLowerCase)
  @IsString()
  @Matches(HEX_COLOUR, { message: 'backgroundColor must be #rrggbb' })
  backgroundColor!: string;

  /** `#rrggbb`. */
  @Transform(toLowerCase)
  @IsString()
  @Matches(HEX_COLOUR, { message: 'textColor must be #rrggbb' })
  textColor!: string;

  @ApiProperty({ enum: ThemeFont, enumName: 'ThemeFont' })
  @IsEnum(ThemeFont)
  font!: ThemeFont;

  /** Text size as a percentage of the standard size. */
  @IsInt()
  @Min(50)
  @Max(200)
  textScale!: number;

  @ApiProperty({ enum: ThemeTextAlign, enumName: 'ThemeTextAlign' })
  @IsEnum(ThemeTextAlign)
  textAlign!: ThemeTextAlign;

  /** Makes this the workspace's default theme (and the previous one not). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
