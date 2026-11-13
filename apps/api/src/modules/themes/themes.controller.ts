import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AppAbility } from '../../common/authorization/app-ability';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { CurrentAbility } from '../../common/decorators/current-ability.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateThemeDto } from './dto/create-theme.dto';
import { ThemeListQueryDto } from './dto/theme-list-query.dto';
import { ThemeResponseDto } from './dto/theme-response.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { ThemesService } from './themes.service';

// `:workspaceId` is the tenant the guard evaluates the workspace-scoped grant
// against; every query below is also scoped by it.
@ApiTags('Themes')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Post()
  @RequirePermission('create', 'Theme')
  @ApiCreatedResponse({ type: ThemeResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateThemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ThemeResponseDto> {
    return new ThemeResponseDto(
      await this.themesService.create(workspaceId, dto, user.id),
    );
  }

  @Get()
  @RequirePermission('read', 'Theme', { isDeniedAsNotFound: true })
  @ApiPaginatedResponse(ThemeResponseDto)
  async findPaginated(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: ThemeListQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PaginatedResponseDto<ThemeResponseDto>> {
    const { data, meta } = await this.themesService.findPaginated(
      workspaceId,
      query,
      ability,
    );
    return { data: data.map((row) => new ThemeResponseDto(row)), meta };
  }

  @Get(':themeId')
  @RequirePermission('read', 'Theme', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: ThemeResponseDto })
  async findById(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('themeId', ParseUUIDPipe) themeId: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<ThemeResponseDto> {
    return new ThemeResponseDto(
      await this.themesService.findById(workspaceId, themeId, ability),
    );
  }

  @Patch(':themeId')
  @RequirePermission('update', 'Theme', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: ThemeResponseDto })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('themeId', ParseUUIDPipe) themeId: string,
    @Body() dto: UpdateThemeDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ThemeResponseDto> {
    return new ThemeResponseDto(
      await this.themesService.update(
        workspaceId,
        themeId,
        dto,
        ability,
        user.id,
      ),
    );
  }

  @Delete(':themeId')
  @RequirePermission('delete', 'Theme', { isDeniedAsNotFound: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('themeId', ParseUUIDPipe) themeId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.themesService.remove(workspaceId, themeId, ability, user.id);
  }
}
