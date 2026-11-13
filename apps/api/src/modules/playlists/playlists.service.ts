import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AppAbility } from '../../common/authorization/app-ability';
import { buildOrderBy } from '../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { PlaylistItemKind } from '../../common/enums/playlist-item-kind.enum';
import { Errors } from '../../common/errors/errors';
import { rejectNullFields } from '../../common/util/reject-null-fields.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { PermissionCheckService } from '../authorization/permission-check.service';
import { SyncVersionService } from '../sync/sync-version.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistItemInputDto } from './dto/playlist-item-input.dto';
import { PlaylistListQueryDto } from './dto/playlist-list-query.dto';
import type { PlaylistWithItems } from './dto/playlist-response.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';

export const PLAYLIST_CONTENT_INCLUDE = {
  items: true,
} as const satisfies Prisma.PlaylistInclude;

const PLAYLIST_SORTABLE_COLUMNS = [
  'name',
  'serviceDate',
  'createdAt',
  'updatedAt',
] as const;

type Problem = { field: string; constraints: string[] };

/**
 * A workspace's playlists. A playlist is written whole with its items in one
 * transaction that claims the workspace's next sync version, like a song.
 *
 * What an item refers to is checked when the playlist is written: the song
 * and theme belong to this workspace and the translation is published. Any of
 * them can be deleted later; the desktop then shows that item as not ready.
 */
@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly permissionCheckService: PermissionCheckService,
    private readonly syncVersionService: SyncVersionService,
  ) {}

  async create(
    workspaceId: string,
    dto: CreatePlaylistDto,
    actorId: string,
  ): Promise<PlaylistWithItems> {
    await this.assertReferencesValid(workspaceId, dto.themeId, dto.items);
    const playlistId = await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      const playlist = await transaction.playlist.create({
        data: {
          workspaceId,
          name: dto.name,
          serviceDate: toDateOnly(dto.serviceDate),
          themeId: dto.themeId ?? null,
          syncVersion,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await writeItems(transaction, playlist.id, dto.items);
      return playlist.id;
    });
    return this.loadById(workspaceId, playlistId);
  }

  async findPaginated(
    workspaceId: string,
    query: PlaylistListQueryDto,
    ability: AppAbility,
  ): Promise<{ data: PlaylistWithItems[]; meta: PaginationMeta }> {
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'Playlist',
      workspaceId,
    );
    const { page, perPage } = query;
    const where = this.abilityScopedQueryService.buildWhereOrEmpty(
      ability,
      'read',
      'Playlist',
      {
        workspaceId,
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' as const },
        }),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scoped.playlist.findMany({
        where,
        include: PLAYLIST_CONTENT_INCLUDE,
        orderBy: buildOrderBy(query, PLAYLIST_SORTABLE_COLUMNS, 'updatedAt'),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.scoped.playlist.count({ where }),
    ]);
    return {
      data,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /** A playlist the caller cannot read is not found (404), never forbidden. */
  async findById(
    workspaceId: string,
    playlistId: string,
    ability: AppAbility,
  ): Promise<PlaylistWithItems> {
    const playlist = await this.prisma.scoped.playlist.findFirst({
      where: this.abilityScopedQueryService.buildWhereOrEmpty(
        ability,
        'read',
        'Playlist',
        { id: playlistId, workspaceId },
      ),
      include: PLAYLIST_CONTENT_INCLUDE,
    });
    if (!playlist) throw Errors.resourceNotFound('Playlist');
    return playlist;
  }

  async update(
    workspaceId: string,
    playlistId: string,
    dto: UpdatePlaylistDto,
    ability: AppAbility,
    actorId: string,
  ): Promise<PlaylistWithItems> {
    rejectNullFields(dto, ['name', 'items', 'expectedSyncVersion']);
    const existing = await this.findById(workspaceId, playlistId, ability);
    this.assertMayAct(ability, 'update', existing);
    await this.assertReferencesValid(workspaceId, dto.themeId, dto.items);
    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      // Under the counter's lock, so no other write can slip in between.
      const current = await transaction.playlist.findFirst({
        where: { id: playlistId, deletedAt: null },
        select: { syncVersion: true },
      });
      if (!current) throw Errors.resourceNotFound('Playlist');
      if (
        dto.expectedSyncVersion !== undefined &&
        dto.expectedSyncVersion !== current.syncVersion
      ) {
        throw Errors.resourceConflict(
          'This playlist was changed elsewhere; refresh it and try again',
        );
      }
      await transaction.playlist.update({
        where: { id: playlistId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.serviceDate !== undefined && {
            serviceDate: toDateOnly(dto.serviceDate),
          }),
          ...(dto.themeId !== undefined && { themeId: dto.themeId }),
          syncVersion,
          updatedBy: actorId,
        },
      });
      if (dto.items) {
        await transaction.playlistItem.deleteMany({ where: { playlistId } });
        await writeItems(transaction, playlistId, dto.items);
      }
    });
    return this.loadById(workspaceId, playlistId);
  }

  /** Soft delete, so the deletion still reaches desktops as a tombstone. */
  async remove(
    workspaceId: string,
    playlistId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<void> {
    const existing = await this.findById(workspaceId, playlistId, ability);
    this.assertMayAct(ability, 'delete', existing);
    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      await transaction.playlist.update({
        where: { id: playlistId },
        data: {
          deletedAt: new Date(),
          deletedBy: actorId,
          updatedBy: actorId,
          syncVersion,
        },
      });
    });
  }

  // Each item's fields match its kind, and what it names exists: songs and
  // the theme in THIS workspace (never another's), translations published.
  private async assertReferencesValid(
    workspaceId: string,
    themeId: string | null | undefined,
    items: readonly PlaylistItemInputDto[] | undefined,
  ): Promise<void> {
    const problems: Problem[] = [];
    (items ?? []).forEach((playlistItem, index) =>
      problems.push(...itemShapeProblems(playlistItem, index)),
    );
    if (problems.length > 0) throw Errors.validationFailed(problems);

    const songIds = unique(
      (items ?? []).flatMap((playlistItem) =>
        playlistItem.songId ? [playlistItem.songId] : [],
      ),
    );
    const translationIds = unique(
      (items ?? []).flatMap((playlistItem) =>
        playlistItem.bibleTranslationId
          ? [playlistItem.bibleTranslationId]
          : [],
      ),
    );
    const [songs, translations, theme] = await Promise.all([
      this.prisma.scoped.song.findMany({
        where: { workspaceId, id: { in: songIds } },
        select: { id: true },
      }),
      this.prisma.bibleTranslation.findMany({
        where: { id: { in: translationIds }, isPublished: true },
        select: { id: true },
      }),
      themeId
        ? this.prisma.scoped.theme.findFirst({
            where: { id: themeId, workspaceId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const knownSongs = new Set(songs.map((song) => song.id));
    const knownTranslations = new Set(
      translations.map((translation) => translation.id),
    );
    (items ?? []).forEach((playlistItem, index) => {
      if (playlistItem.songId && !knownSongs.has(playlistItem.songId)) {
        problems.push({
          field: `items[${index}].songId`,
          constraints: ['no such song in this workspace'],
        });
      }
      if (
        playlistItem.bibleTranslationId &&
        !knownTranslations.has(playlistItem.bibleTranslationId)
      ) {
        problems.push({
          field: `items[${index}].bibleTranslationId`,
          constraints: ['no such published Bible translation'],
        });
      }
    });
    if (themeId && !theme) {
      problems.push({
        field: 'themeId',
        constraints: ['no such theme in this workspace'],
      });
    }
    if (problems.length > 0) throw Errors.validationFailed(problems);
  }

  private assertMayAct(
    ability: AppAbility,
    action: 'update' | 'delete',
    playlist: PlaylistWithItems,
  ): void {
    this.permissionCheckService.assertCan(ability, action, 'Playlist', {
      id: playlist.id,
      workspaceId: playlist.workspaceId,
    });
  }

  private async loadById(
    workspaceId: string,
    playlistId: string,
  ): Promise<PlaylistWithItems> {
    return this.prisma.scoped.playlist.findFirstOrThrow({
      where: { id: playlistId, workspaceId },
      include: PLAYLIST_CONTENT_INCLUDE,
    });
  }
}

function itemShapeProblems(
  playlistItem: PlaylistItemInputDto,
  index: number,
): Problem[] {
  const field = (name: string) => `items[${index}].${name}`;
  const passageFields = [
    'bibleTranslationId',
    'bookCode',
    'startChapter',
    'startVerse',
    'endChapter',
    'endVerse',
  ] as const;
  if (playlistItem.kind === PlaylistItemKind.SONG) {
    return passageFields
      .filter((name) => playlistItem[name] !== undefined)
      .map((name) => ({
        field: field(name),
        constraints: ['not allowed on a song item'],
      }));
  }
  const problems: Problem[] = [];
  for (const name of ['songId', 'arrangementName'] as const) {
    if (playlistItem[name] !== undefined) {
      problems.push({
        field: field(name),
        constraints: ['not allowed on a passage item'],
      });
    }
  }
  const isEndBeforeStart =
    playlistItem.endChapter! < playlistItem.startChapter! ||
    (playlistItem.endChapter === playlistItem.startChapter &&
      playlistItem.endVerse! < playlistItem.startVerse!);
  if (isEndBeforeStart) {
    problems.push({
      field: field('endVerse'),
      constraints: ['the passage must end at or after its start'],
    });
  }
  return problems;
}

async function writeItems(
  transaction: Prisma.TransactionClient,
  playlistId: string,
  items: readonly PlaylistItemInputDto[],
): Promise<void> {
  await transaction.playlistItem.createMany({
    data: items.map((playlistItem, position) => ({
      playlistId,
      position,
      kind: playlistItem.kind,
      songId: playlistItem.songId ?? null,
      arrangementName: playlistItem.arrangementName ?? null,
      bibleTranslationId: playlistItem.bibleTranslationId ?? null,
      bookCode: playlistItem.bookCode ?? null,
      startChapter: playlistItem.startChapter ?? null,
      startVerse: playlistItem.startVerse ?? null,
      endChapter: playlistItem.endChapter ?? null,
      endVerse: playlistItem.endVerse ?? null,
    })),
  });
}

function toDateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

const unique = <Value>(values: readonly Value[]) => [...new Set(values)];
