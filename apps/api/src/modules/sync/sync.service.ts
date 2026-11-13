import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppAbility } from '../../common/authorization/app-ability';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { PlaylistResponseDto } from '../playlists/dto/playlist-response.dto';
import { PLAYLIST_CONTENT_INCLUDE } from '../playlists/playlists.service';
import { SONG_CONTENT_INCLUDE } from '../songs/songs.service';
import { SongResponseDto } from '../songs/dto/song-response.dto';
import { ThemeResponseDto } from '../themes/dto/theme-response.dto';
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
        // Deleted rows included on purpose: they are the tombstones. Read
        // without the soft-delete filter, but still scoped by the ability.
        // Each table yields at most limit + 1 changes after the cursor; the
        // first `limit` of them all, by version, are exactly the next page.
        const take = query.limit + 1;
        const changedSince = { workspaceId, syncVersion: { gt: query.cursor } };
        const songs = await transaction.song.findMany({
          where: this.abilityScopedQueryService.buildWhereOrEmpty(
            ability,
            'read',
            'Song',
            changedSince,
          ),
          include: SONG_CONTENT_INCLUDE,
          orderBy: { syncVersion: 'asc' },
          take,
        });
        const themes = await transaction.theme.findMany({
          where: this.abilityScopedQueryService.buildWhereOrEmpty(
            ability,
            'read',
            'Theme',
            changedSince,
          ),
          orderBy: { syncVersion: 'asc' },
          take,
        });
        const playlists = await transaction.playlist.findMany({
          where: this.abilityScopedQueryService.buildWhereOrEmpty(
            ability,
            'read',
            'Playlist',
            changedSince,
          ),
          include: PLAYLIST_CONTENT_INCLUDE,
          orderBy: { syncVersion: 'asc' },
          take,
        });
        const versions = [...songs, ...themes, ...playlists]
          .map((row) => row.syncVersion)
          .sort((first, second) => first - second);
        const hasMore = versions.length > query.limit;
        const lastVersion = versions.slice(0, query.limit).at(-1);
        const isOnPage = (row: { syncVersion: number }) =>
          lastVersion !== undefined && row.syncVersion <= lastVersion;
        return {
          epoch: position.epoch,
          latestVersion: position.version,
          nextCursor: lastVersion ?? query.cursor,
          hasMore,
          songs: songs.filter(isOnPage).map((row) => ({
            id: row.id,
            syncVersion: row.syncVersion,
            isDeleted: row.deletedAt !== null,
            song: row.deletedAt === null ? new SongResponseDto(row) : null,
          })),
          themes: themes.filter(isOnPage).map((row) => ({
            id: row.id,
            syncVersion: row.syncVersion,
            isDeleted: row.deletedAt !== null,
            theme: row.deletedAt === null ? new ThemeResponseDto(row) : null,
          })),
          playlists: playlists.filter(isOnPage).map((row) => ({
            id: row.id,
            syncVersion: row.syncVersion,
            isDeleted: row.deletedAt !== null,
            playlist:
              row.deletedAt === null ? new PlaylistResponseDto(row) : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
