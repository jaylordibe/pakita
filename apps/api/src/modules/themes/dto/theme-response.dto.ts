import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type { Theme } from '@prisma/client';
import {
  ThemeBackground,
  ThemeFont,
  ThemeTextAlign,
} from '../../../common/enums/theme.enum';

export class ThemeResponseDto {
  id!: string;
  workspaceId!: string;
  name!: string;
  @ApiProperty({ enum: ThemeBackground, enumName: 'ThemeBackground' })
  background!: ThemeBackground;
  backgroundColor!: string;
  textColor!: string;
  @ApiProperty({ enum: ThemeFont, enumName: 'ThemeFont' })
  font!: ThemeFont;
  textScale!: number;
  @ApiProperty({ enum: ThemeTextAlign, enumName: 'ThemeTextAlign' })
  textAlign!: ThemeTextAlign;
  isDefault!: boolean;
  /** The workspace sync version of the theme's latest change. */
  syncVersion!: number;
  createdAt!: Date;
  updatedAt!: Date;

  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;
  @ApiHideProperty() @Exclude() deletedAt!: Date | null;
  @ApiHideProperty() @Exclude() deletedBy!: string | null;

  constructor(row: Theme) {
    Object.assign(this, row);
    this.background = row.background as ThemeBackground;
    this.font = row.font as ThemeFont;
    this.textAlign = row.textAlign as ThemeTextAlign;
  }
}
