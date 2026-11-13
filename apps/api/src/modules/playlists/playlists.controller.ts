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
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistListQueryDto } from './dto/playlist-list-query.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { PlaylistsService } from './playlists.service';

// `:workspaceId` is the tenant the guard evaluates the workspace-scoped grant
// against; every query below is also scoped by it.
@ApiTags('Playlists')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  @RequirePermission('create', 'Playlist')
  @ApiCreatedResponse({ type: PlaylistResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreatePlaylistDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlaylistResponseDto> {
    return new PlaylistResponseDto(
      await this.playlistsService.create(workspaceId, dto, user.id),
    );
  }

  @Get()
  @RequirePermission('read', 'Playlist', { isDeniedAsNotFound: true })
  @ApiPaginatedResponse(PlaylistResponseDto)
  async findPaginated(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: PlaylistListQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PaginatedResponseDto<PlaylistResponseDto>> {
    const { data, meta } = await this.playlistsService.findPaginated(
      workspaceId,
      query,
      ability,
    );
    return { data: data.map((row) => new PlaylistResponseDto(row)), meta };
  }

  @Get(':playlistId')
  @RequirePermission('read', 'Playlist', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: PlaylistResponseDto })
  async findById(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('playlistId', ParseUUIDPipe) playlistId: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PlaylistResponseDto> {
    return new PlaylistResponseDto(
      await this.playlistsService.findById(workspaceId, playlistId, ability),
    );
  }

  @Patch(':playlistId')
  @RequirePermission('update', 'Playlist', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: PlaylistResponseDto })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('playlistId', ParseUUIDPipe) playlistId: string,
    @Body() dto: UpdatePlaylistDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlaylistResponseDto> {
    return new PlaylistResponseDto(
      await this.playlistsService.update(
        workspaceId,
        playlistId,
        dto,
        ability,
        user.id,
      ),
    );
  }

  @Delete(':playlistId')
  @RequirePermission('delete', 'Playlist', { isDeniedAsNotFound: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('playlistId', ParseUUIDPipe) playlistId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.playlistsService.remove(
      workspaceId,
      playlistId,
      ability,
      user.id,
    );
  }
}
