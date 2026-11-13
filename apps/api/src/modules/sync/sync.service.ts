import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppAbility } from '../../common/authorization/app-ability';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { SONG_CONTENT_INCLUDE } from '../songs/songs.service';
import { SongResponseDto } from '../songs/dto/song-response.dto';
import { SyncChangesQueryDto } from './dto/sync-changes-query.dto';
import { SyncChangesResponseDto } from './dto/sync-changes-response.dto';
import { SyncVersionService } from './sync-version.service';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly syncVersionService: SyncVersionService,
  ) {}

  /**
   * The workspace's changes after `cursor`, oldest first. Read in one
   * repeatable-read transaction, so the page and `latestVersion` describe
   * the same moment.
   */
  async findChanges(
    workspaceId: string,
    query: SyncChangesQueryDto,
    ability: AppAbility,
  ): Promise<SyncChangesResponseDto> {
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'Song',
      workspaceId,
    );
    // Outside the read transaction, so the read sees a stable epoch.
    await this.syncVersionService.ensureCounter(workspaceId);

    return this.prisma.$transaction(
      async (transaction) => {
        const position = await transaction.workspaceSyncState.findUniqueOrThrow(
          {
            where: { workspaceId },
            select: { version: true, epoch: true },
          },
        );
        // Deleted songs included on purpose: they are the tombstones. Read
        // without the soft-delete filter, but still scoped by the ability.
        const rows = await transaction.song.findMany({
          where: this.abilityScopedQueryService.buildWhereOrEmpty(
            ability,
            'read',
            'Song',
            { workspaceId, syncVersion: { gt: query.cursor } },
          ),
          include: SONG_CONTENT_INCLUDE,
          orderBy: { syncVersion: 'asc' },
          take: query.limit + 1,
        });
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        const lastRow = page.at(-1);
        return {
          epoch: position.epoch,
          latestVersion: position.version,
          nextCursor: lastRow ? lastRow.syncVersion : query.cursor,
          hasMore,
          songs: page.map((row) => ({
            id: row.id,
            syncVersion: row.syncVersion,
            isDeleted: row.deletedAt !== null,
            song: row.deletedAt === null ? new SongResponseDto(row) : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
