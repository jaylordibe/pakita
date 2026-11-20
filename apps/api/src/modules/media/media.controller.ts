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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AppAbility } from '../../common/authorization/app-ability';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { CurrentAbility } from '../../common/decorators/current-ability.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateMediaUploadDto } from './dto/create-media-upload.dto';
import { CreateMediaDto } from './dto/create-media.dto';
import { MediaDownloadResponseDto } from './dto/media-download-response.dto';
import { MediaListQueryDto } from './dto/media-list-query.dto';
import { MediaResponseDto } from './dto/media-response.dto';
import { MediaUploadResponseDto } from './dto/media-upload-response.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { MediaService } from './media.service';

// `:workspaceId` is the tenant the guard evaluates the workspace-scoped grant
// against; every query below is also scoped by it.
@ApiTags('Media')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Starts uploading a video: returns where to `PUT` its bytes, straight to
   * storage. 409 `MEDIA_QUOTA_EXCEEDED` when the workspace's videos cannot
   * hold it; 413 over 1 GiB; 429 `FILE_QUOTA_EXCEEDED` with too many uploads
   * not yet added.
   */
  @Post('uploads')
  @RequirePermission('create', 'Media')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiCreatedResponse({ type: MediaUploadResponseDto })
  async createUpload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateMediaUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MediaUploadResponseDto> {
    const upload = await this.mediaService.createUpload(
      workspaceId,
      dto,
      user.id,
    );
    return new MediaUploadResponseDto({
      fileId: upload.file.id,
      url: upload.url,
      headers: upload.headers,
      urlExpiresAt: upload.urlExpiresAt,
    });
  }

  /**
   * Adds an uploaded video. 409 `FILE_NOT_UPLOADED` while storage does not
   * hold its bytes yet (send them, then retry); 415 when the bytes are not an
   * MP4 or WebM video.
   */
  @Post()
  @RequirePermission('create', 'Media')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiCreatedResponse({ type: MediaResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateMediaDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MediaResponseDto> {
    return new MediaResponseDto(
      await this.mediaService.create(workspaceId, dto, user.id),
    );
  }

  @Get()
  @RequirePermission('read', 'Media', { isDeniedAsNotFound: true })
  @ApiPaginatedResponse(MediaResponseDto)
  async findPaginated(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: MediaListQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PaginatedResponseDto<MediaResponseDto>> {
    const { data, meta } = await this.mediaService.findPaginated(
      workspaceId,
      query,
      ability,
    );
    return { data: data.map((row) => new MediaResponseDto(row)), meta };
  }

  @Get(':mediaId')
  @RequirePermission('read', 'Media', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: MediaResponseDto })
  async findById(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<MediaResponseDto> {
    return new MediaResponseDto(
      await this.mediaService.findById(workspaceId, mediaId, ability),
    );
  }

  /** A short-lived URL for the video's bytes, to download them. */
  @Get(':mediaId/download')
  @RequirePermission('read', 'Media', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: MediaDownloadResponseDto })
  async createDownloadUrl(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<MediaDownloadResponseDto> {
    return new MediaDownloadResponseDto(
      await this.mediaService.createDownloadUrl(workspaceId, mediaId, ability),
    );
  }

  @Patch(':mediaId')
  @RequirePermission('update', 'Media', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: MediaResponseDto })
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: UpdateMediaDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MediaResponseDto> {
    return new MediaResponseDto(
      await this.mediaService.update(
        workspaceId,
        mediaId,
        dto,
        ability,
        user.id,
      ),
    );
  }

  /** 409 `MEDIA_IN_USE` while a theme shows the video. */
  @Delete(':mediaId')
  @RequirePermission('delete', 'Media', { isDeniedAsNotFound: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deleted.' })
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.mediaService.remove(workspaceId, mediaId, ability, user.id);
  }
}
