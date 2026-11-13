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
import { CreateSongDto } from './dto/create-song.dto';
import { SongListQueryDto } from './dto/song-list-query.dto';
import { SongResponseDto } from './dto/song-response.dto';
import { UpdateSongDto } from './dto/update-song.dto';
import { SongsService } from './songs.service';

// `:workspaceId` is the tenant the guard evaluates the workspace-scoped grant
// against; every query below is also scoped by it.
@ApiTags('Songs')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Post()
  @RequirePermission('create', 'Song')
  @ApiCreatedResponse({ type: SongResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateSongDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SongResponseDto> {
    return new SongResponseDto(
      await this.songsService.create(workspaceId, dto, user.id),
    );
  }

  @Get()
  @RequirePermission('read', 'Song', { isDeniedAsNotFound: true })
  @ApiPaginatedResponse(SongResponseDto)
  async findPaginated(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: SongListQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PaginatedResponseDto<SongResponseDto>> {
    const { data, meta } = await this.songsService.findPaginated(
      workspaceId,
      query,
      ability,
    );
    return { data: data.map((row) => new SongResponseDto(row)), meta };
  }

  @Get(':songId')
  @RequirePermission('read', 'Song', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: SongResponseDto })
  async findById(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<SongResponseDto> {
    return new SongResponseDto(
      await this.songsService.findById(workspaceId, songId, ability),
    );
  }

  @Patch(':songId')
  @RequirePermission('update', 'Song', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: SongResponseDto })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('songId', ParseUUIDPipe) songId: string,
    @Body() dto: UpdateSongDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SongResponseDto> {
    return new SongResponseDto(
      await this.songsService.update(
        workspaceId,
        songId,
        dto,
        ability,
        user.id,
      ),
    );
  }

  @Delete(':songId')
  @RequirePermission('delete', 'Song', { isDeniedAsNotFound: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('songId', ParseUUIDPipe) songId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.songsService.remove(workspaceId, songId, ability, user.id);
  }
}
