import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Media, Prisma } from '@prisma/client';
import type { AppAbility } from '../../common/authorization/app-ability';
import { buildOrderBy } from '../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { FilePurpose } from '../../common/enums/file-purpose.enum';
import { MediaKind } from '../../common/enums/media-kind.enum';
import { Errors } from '../../common/errors/errors';
import {
  FileStorageService,
  type SignedReadUrl,
} from '../../common/storage/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { PermissionCheckService } from '../authorization/permission-check.service';
import { FilesService, type DirectUpload } from '../files/files.service';
import { SyncVersionService } from '../sync/sync-version.service';
import { CreateMediaUploadDto } from './dto/create-media-upload.dto';
import { CreateMediaDto, MEDIA_MAX_SHORT_SIDE } from './dto/create-media.dto';
import { MediaListQueryDto } from './dto/media-list-query.dto';
import { UpdateMediaDto } from './dto/update-media.dto';

const MEDIA_SORTABLE_COLUMNS = ['name', 'createdAt', 'updatedAt'] as const;
// A download URL lives as long as a signed URL may (clamped centrally); a
// large file over a slow connection resumes with a fresh one.
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

const hexToBase64 = (hex: string): string =>
  Buffer.from(hex, 'hex').toString('base64');
const base64ToHex = (base64: string): string =>
  Buffer.from(base64, 'base64').toString('hex');

/**
 * A workspace's background videos. The bytes go from the uploading laptop
 * straight to storage (`createUpload`), are checked by `FilesService` when the
 * video is added (`create`), and reach every other laptop through a signed
 * download URL. Every write is one transaction that claims the workspace's
 * next sync version; that counter's row lock also serialises the storage
 * quota and the in-use check against theme writes.
 */
@Injectable()
export class MediaService {
  private readonly workspaceQuotaBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly permissionCheckService: PermissionCheckService,
    private readonly syncVersionService: SyncVersionService,
    private readonly filesService: FilesService,
    private readonly storage: FileStorageService,
    configService: ConfigService,
  ) {
    this.workspaceQuotaBytes = configService.getOrThrow<number>(
      'media.workspaceQuotaBytes',
    );
  }

  /**
   * Starts an upload: refuses early a video the quota cannot hold (checked
   * again, under the lock, when it is added), then signs a URL for the bytes.
   */
  async createUpload(
    workspaceId: string,
    dto: CreateMediaUploadDto,
    actorId: string,
  ): Promise<DirectUpload> {
    if (!this.storage.isPersistent) {
      throw Errors.externalServiceUnavailable(
        'This server keeps no uploaded files, so it cannot take videos. Its administrator must configure object storage (STORAGE_PROVIDER).',
      );
    }
    const usedBytes = await this.usedBytes(this.prisma, workspaceId);
    if (usedBytes + dto.sizeBytes > this.workspaceQuotaBytes) {
      throw Errors.mediaQuotaExceeded(this.workspaceQuotaBytes, usedBytes);
    }
    return this.filesService.createDirectUpload({
      purpose: FilePurpose.BACKGROUND_VIDEO,
      sizeBytes: dto.sizeBytes,
      contentType: dto.contentType,
      sha256Base64: hexToBase64(dto.sha256),
      fileName: dto.fileName,
      actorId,
    });
  }

  /**
   * Adds an uploaded background. A video: `FilesService` first checks what
   * storage holds (size, and type from the bytes), and the uploading
   * laptop's measurements are required. An image: the API re-encoded it on
   * upload, so its measurements are the stored file's own. Either way the
   * file is attached and the media created in one transaction, within the
   * quota. Which it is follows from the file's purpose, never the request.
   */
  async create(
    workspaceId: string,
    dto: CreateMediaDto,
    actorId: string,
  ): Promise<Media> {
    const purpose = await this.filesService.findOwnPurpose(
      dto.fileId,
      actorId,
      [FilePurpose.BACKGROUND_VIDEO, FilePurpose.BACKGROUND_IMAGE],
    );
    if (!purpose) throw Errors.resourceNotFound('File');
    const isVideo = purpose === FilePurpose.BACKGROUND_VIDEO;
    if (isVideo) {
      const { width, height, durationMs } = dto;
      if (width === undefined || height === undefined || !durationMs) {
        throw Errors.badRequest(
          'A video needs its width, height and durationMs.',
        );
      }
      if (Math.min(width, height) > MEDIA_MAX_SHORT_SIDE) {
        throw Errors.badRequest(
          `A background video may be at most 1920 × ${MEDIA_MAX_SHORT_SIDE} pixels.`,
        );
      }
      // Outside the transaction: it reads storage, which must never hold a
      // database connection.
      await this.filesService.completeDirectUpload(
        dto.fileId,
        actorId,
        FilePurpose.BACKGROUND_VIDEO,
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      // `file_assets` rows are locked last: the counter above first.
      const file = await this.filesService.claimForAttachment(transaction, {
        fileId: dto.fileId,
        actorId,
        purpose,
      });
      const sizeBytes = file.sizeBytes ?? 0;
      const usedBytes = await this.usedBytes(transaction, workspaceId);
      if (usedBytes + sizeBytes > this.workspaceQuotaBytes) {
        throw Errors.mediaQuotaExceeded(this.workspaceQuotaBytes, usedBytes);
      }
      if (!file.sha256 || (!isVideo && (!file.width || !file.height))) {
        // Every upload records its hash, and every image its size; a file
        // without them is a defect, not the client's mistake.
        throw new Error(`File ${file.id} lacks its SHA-256 or dimensions`);
      }
      return transaction.media.create({
        data: {
          workspaceId,
          name: dto.name,
          kind: isVideo ? MediaKind.VIDEO : MediaKind.IMAGE,
          fileAssetId: file.id,
          sha256: base64ToHex(file.sha256),
          sizeBytes,
          contentType: file.contentType,
          width: isVideo ? dto.width! : file.width!,
          height: isVideo ? dto.height! : file.height!,
          durationMs: isVideo ? dto.durationMs! : null,
          syncVersion,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    });
  }

  async findPaginated(
    workspaceId: string,
    query: MediaListQueryDto,
    ability: AppAbility,
  ): Promise<{ data: Media[]; meta: PaginationMeta }> {
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'Media',
      workspaceId,
    );
    const { page, perPage } = query;
    const where = this.abilityScopedQueryService.buildWhereOrEmpty(
      ability,
      'read',
      'Media',
      {
        workspaceId,
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' as const },
        }),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scoped.media.findMany({
        where,
        orderBy: buildOrderBy(query, MEDIA_SORTABLE_COLUMNS, 'name'),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.scoped.media.count({ where }),
    ]);
    return {
      data,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /** A video the caller cannot read is not found (404), never forbidden. */
  async findById(
    workspaceId: string,
    mediaId: string,
    ability: AppAbility,
  ): Promise<Media> {
    const media = await this.prisma.scoped.media.findFirst({
      where: this.abilityScopedQueryService.buildWhereOrEmpty(
        ability,
        'read',
        'Media',
        { id: mediaId, workspaceId },
      ),
    });
    if (!media) throw Errors.resourceNotFound('Media');
    return media;
  }

  /** A signed URL for the bytes, minted only after the read is authorized. */
  async createDownloadUrl(
    workspaceId: string,
    mediaId: string,
    ability: AppAbility,
  ): Promise<SignedReadUrl> {
    const media = await this.findById(workspaceId, mediaId, ability);
    const file = media.fileAssetId
      ? await this.prisma.fileAsset.findUnique({
          where: { id: media.fileAssetId },
          select: { storageKey: true },
        })
      : null;
    if (!file) throw Errors.resourceNotFound('Media');
    try {
      return await this.storage.createSignedReadUrl(
        file.storageKey,
        DOWNLOAD_URL_TTL_SECONDS,
      );
    } catch {
      throw Errors.externalServiceUnavailable(
        'File storage is unavailable. Please try again.',
      );
    }
  }

  async update(
    workspaceId: string,
    mediaId: string,
    dto: UpdateMediaDto,
    ability: AppAbility,
    actorId: string,
  ): Promise<Media> {
    const existing = await this.findById(workspaceId, mediaId, ability);
    this.assertMayAct(ability, 'update', existing);
    return this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      await this.assertStillLive(transaction, mediaId);
      return transaction.media.update({
        where: { id: mediaId },
        data: { name: dto.name, syncVersion, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft delete, so the deletion reaches laptops as a tombstone, and the
   * file released in the same transaction (the cleanup job then deletes its
   * bytes). Refused while a live theme shows the video: clearing a theme's
   * background silently would change what a service looks like.
   */
  async remove(
    workspaceId: string,
    mediaId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<void> {
    const existing = await this.findById(workspaceId, mediaId, ability);
    this.assertMayAct(ability, 'delete', existing);
    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      const live = await this.assertStillLive(transaction, mediaId);
      // Under the counter's lock, which every theme write also takes: no
      // theme can start using the video between this check and the delete.
      const themes = await transaction.theme.findMany({
        where: { backgroundMediaId: mediaId, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (themes.length > 0) {
        throw Errors.mediaInUse(themes.map((theme) => theme.id));
      }
      await transaction.media.update({
        where: { id: mediaId },
        data: {
          fileAssetId: null,
          deletedAt: new Date(),
          deletedBy: actorId,
          updatedBy: actorId,
          syncVersion,
        },
      });
      if (live.fileAssetId) {
        await this.filesService.markDeleting(transaction, [live.fileAssetId]);
      }
    });
  }

  /**
   * Checks that a theme may show `mediaId`: a live video of the same
   * workspace. Call inside the theme write's transaction, after it claimed
   * the sync version, so a concurrent delete cannot slip between.
   */
  async assertUsableAsBackground(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    mediaId: string,
  ): Promise<void> {
    const media = await transaction.media.findFirst({
      where: { id: mediaId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!media) throw Errors.resourceNotFound('Media');
  }

  private async usedBytes(
    client: Prisma.TransactionClient | PrismaService,
    workspaceId: string,
  ): Promise<number> {
    const total = await client.media.aggregate({
      where: { workspaceId, deletedAt: null },
      _sum: { sizeBytes: true },
    });
    return total._sum.sizeBytes ?? 0;
  }

  private async assertStillLive(
    transaction: Prisma.TransactionClient,
    mediaId: string,
  ): Promise<{ fileAssetId: string | null }> {
    const media = await transaction.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      select: { fileAssetId: true },
    });
    if (!media) throw Errors.resourceNotFound('Media');
    return media;
  }

  private assertMayAct(
    ability: AppAbility,
    action: 'update' | 'delete',
    media: Media,
  ): void {
    this.permissionCheckService.assertCan(ability, action, 'Media', {
      id: media.id,
      workspaceId: media.workspaceId,
    });
  }
}
