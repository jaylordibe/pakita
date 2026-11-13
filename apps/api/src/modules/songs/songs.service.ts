import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AppAbility } from '../../common/authorization/app-ability';
import { buildOrderBy } from '../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { Errors } from '../../common/errors/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { PermissionCheckService } from '../authorization/permission-check.service';
import { SyncVersionService } from '../sync/sync-version.service';
import { CreateSongDto } from './dto/create-song.dto';
import {
  SongArrangementInputDto,
  SongSectionInputDto,
} from './dto/song-content.dto';
import { SongListQueryDto } from './dto/song-list-query.dto';
import type { SongWithContent } from './dto/song-response.dto';
import { UpdateSongDto } from './dto/update-song.dto';

export const SONG_CONTENT_INCLUDE = {
  sections: true,
  arrangements: { include: { items: true } },
} as const satisfies Prisma.SongInclude;

const SONG_SORTABLE_COLUMNS = ['title', 'createdAt', 'updatedAt'] as const;

const DEFAULT_ARRANGEMENT_NAME = 'Default';

/**
 * A workspace's song library. Every write is one transaction that also claims
 * the workspace's next sync version, so desktops receive the song — sections
 * and arrangements included — as one consistent change.
 */
@Injectable()
export class SongsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly permissionCheckService: PermissionCheckService,
    private readonly syncVersionService: SyncVersionService,
  ) {}

  async create(
    workspaceId: string,
    dto: CreateSongDto,
    actorId: string,
  ): Promise<SongWithContent> {
    const arrangements = resolveArrangements(dto.sections, dto.arrangements);
    const songId = await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      const song = await transaction.song.create({
        data: {
          workspaceId,
          title: dto.title,
          artist: dto.artist || null,
          syncVersion,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await writeContent(transaction, song.id, dto.sections, arrangements);
      return song.id;
    });
    return this.loadById(workspaceId, songId);
  }

  async findPaginated(
    workspaceId: string,
    query: SongListQueryDto,
    ability: AppAbility,
  ): Promise<{ data: SongWithContent[]; meta: PaginationMeta }> {
    // A stranger to the workspace gets 404, not an empty library.
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'Song',
      workspaceId,
    );
    const { page, perPage } = query;
    const where = this.abilityScopedQueryService.buildWhereOrEmpty(
      ability,
      'read',
      'Song',
      {
        workspaceId,
        isArchived: query.isArchived ?? false,
        ...buildSearchFilter(query.search),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scoped.song.findMany({
        where,
        include: SONG_CONTENT_INCLUDE,
        orderBy: buildOrderBy(query, SONG_SORTABLE_COLUMNS, 'title'),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.scoped.song.count({ where }),
    ]);
    return {
      data,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /** A song the caller cannot read is not found (404), never forbidden. */
  async findById(
    workspaceId: string,
    songId: string,
    ability: AppAbility,
  ): Promise<SongWithContent> {
    const song = await this.prisma.scoped.song.findFirst({
      where: this.abilityScopedQueryService.buildWhereOrEmpty(
        ability,
        'read',
        'Song',
        { id: songId, workspaceId },
      ),
      include: SONG_CONTENT_INCLUDE,
    });
    if (!song) throw Errors.resourceNotFound('Song');
    return song;
  }

  async update(
    workspaceId: string,
    songId: string,
    dto: UpdateSongDto,
    ability: AppAbility,
    actorId: string,
  ): Promise<SongWithContent> {
    const existing = await this.findById(workspaceId, songId, ability);
    this.assertMayAct(ability, 'update', existing);
    if (dto.arrangements && !dto.sections) {
      throw Errors.validationFailed([
        {
          field: 'arrangements',
          constraints: ['arrangements can only be sent together with sections'],
        },
      ]);
    }
    const arrangements = dto.sections
      ? resolveArrangements(dto.sections, dto.arrangements)
      : undefined;

    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      await transaction.song.update({
        where: { id: songId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.artist !== undefined && { artist: dto.artist || null }),
          ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
          syncVersion,
          updatedBy: actorId,
        },
      });
      if (dto.sections && arrangements) {
        // Content is replaced as a whole: arrangements refer to sections, so
        // the two are only ever consistent when written together.
        await transaction.songArrangement.deleteMany({ where: { songId } });
        await transaction.songSection.deleteMany({ where: { songId } });
        await writeContent(transaction, songId, dto.sections, arrangements);
      }
    });
    return this.loadById(workspaceId, songId);
  }

  /** Soft delete, so the deletion still reaches desktops as a tombstone. */
  async remove(
    workspaceId: string,
    songId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<void> {
    const existing = await this.findById(workspaceId, songId, ability);
    this.assertMayAct(ability, 'delete', existing);
    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      await transaction.song.update({
        where: { id: songId },
        data: {
          deletedAt: new Date(),
          deletedBy: actorId,
          updatedBy: actorId,
          syncVersion,
        },
      });
    });
  }

  // The caller can already read the song (findById passed), so refusing the
  // write is a 403, not a 404.
  private assertMayAct(
    ability: AppAbility,
    action: 'update' | 'delete',
    song: SongWithContent,
  ): void {
    this.permissionCheckService.assertCan(ability, action, 'Song', {
      id: song.id,
      workspaceId: song.workspaceId,
    });
  }

  // After a write, inside the caller's authority already proven by the write.
  private async loadById(
    workspaceId: string,
    songId: string,
  ): Promise<SongWithContent> {
    return this.prisma.scoped.song.findFirstOrThrow({
      where: { id: songId, workspaceId },
      include: SONG_CONTENT_INCLUDE,
    });
  }
}

interface ResolvedArrangement {
  readonly name: string;
  readonly isDefault: boolean;
  readonly sectionKeys: readonly string[];
}

/**
 * Checks what the DTO validators cannot see across fields: section keys are
 * unique, every arrangement names existing sections, and exactly one
 * arrangement is the default. Without arrangements, one default arrangement
 * presents every section once, in order.
 */
export function resolveArrangements(
  sections: readonly SongSectionInputDto[],
  arrangements: readonly SongArrangementInputDto[] | undefined,
): ResolvedArrangement[] {
  const problems: Array<{ field: string; constraints: string[] }> = [];
  const keys = new Set<string>();
  sections.forEach((section, index) => {
    if (keys.has(section.key)) {
      problems.push({
        field: `sections[${index}].key`,
        constraints: [`section key "${section.key}" is used more than once`],
      });
    }
    keys.add(section.key);
  });

  if (!arrangements) {
    if (problems.length > 0) throw Errors.validationFailed(problems);
    return [
      {
        name: DEFAULT_ARRANGEMENT_NAME,
        isDefault: true,
        sectionKeys: sections.map((section) => section.key),
      },
    ];
  }

  arrangements.forEach((arrangement, index) => {
    const unknownKeys = arrangement.sectionKeys.filter((key) => !keys.has(key));
    if (unknownKeys.length > 0) {
      problems.push({
        field: `arrangements[${index}].sectionKeys`,
        constraints: [`unknown section key(s): ${unknownKeys.join(', ')}`],
      });
    }
  });
  const defaultCount = arrangements.filter(
    (arrangement) => arrangement.isDefault,
  ).length;
  if (defaultCount !== 1) {
    problems.push({
      field: 'arrangements',
      constraints: [
        `exactly one arrangement must be the default (found ${defaultCount})`,
      ],
    });
  }
  if (problems.length > 0) throw Errors.validationFailed(problems);
  return arrangements.map((arrangement) => ({ ...arrangement }));
}

async function writeContent(
  transaction: Prisma.TransactionClient,
  songId: string,
  sections: readonly SongSectionInputDto[],
  arrangements: readonly ResolvedArrangement[],
): Promise<void> {
  const sectionIdByKey = new Map(
    sections.map((section) => [section.key, randomUUID()]),
  );
  await transaction.songSection.createMany({
    data: sections.map((section, position) => ({
      id: sectionIdByKey.get(section.key)!,
      songId,
      kind: section.kind,
      label: section.label,
      lyrics: section.lyrics,
      position,
    })),
  });
  const arrangementIds = arrangements.map(() => randomUUID());
  await transaction.songArrangement.createMany({
    data: arrangements.map((arrangement, position) => ({
      id: arrangementIds[position]!,
      songId,
      name: arrangement.name,
      isDefault: arrangement.isDefault,
      position,
    })),
  });
  await transaction.songArrangementItem.createMany({
    data: arrangements.flatMap((arrangement, arrangementPosition) =>
      arrangement.sectionKeys.map((key, position) => ({
        songArrangementId: arrangementIds[arrangementPosition]!,
        songSectionId: sectionIdByKey.get(key)!,
        position,
      })),
    ),
  });
}

function buildSearchFilter(search: string | undefined): Prisma.SongWhereInput {
  if (!search) return {};
  return {
    OR: [
      { title: { contains: search, mode: 'insensitive' } },
      { artist: { contains: search, mode: 'insensitive' } },
    ],
  };
}
