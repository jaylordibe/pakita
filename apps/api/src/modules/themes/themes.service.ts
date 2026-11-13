import { Injectable } from '@nestjs/common';
import type { Prisma, Theme } from '@prisma/client';
import type { AppAbility } from '../../common/authorization/app-ability';
import { buildOrderBy } from '../../common/dto/meta-query.dto';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { Errors } from '../../common/errors/errors';
import { rejectNullFields } from '../../common/util/reject-null-fields.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AbilityScopedQueryService } from '../authorization/ability-scoped-query.service';
import { PermissionCheckService } from '../authorization/permission-check.service';
import { SyncVersionService } from '../sync/sync-version.service';
import { CreateThemeDto } from './dto/create-theme.dto';
import { ThemeListQueryDto } from './dto/theme-list-query.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';

const THEME_SORTABLE_COLUMNS = ['name', 'createdAt', 'updatedAt'] as const;

/**
 * A workspace's themes. Every write is one transaction that claims the
 * workspace's next sync version for each theme it changes — making a theme
 * the default also changes the previous default.
 */
@Injectable()
export class ThemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityScopedQueryService: AbilityScopedQueryService,
    private readonly permissionCheckService: PermissionCheckService,
    private readonly syncVersionService: SyncVersionService,
  ) {}

  async create(
    workspaceId: string,
    dto: CreateThemeDto,
    actorId: string,
  ): Promise<Theme> {
    return this.prisma.$transaction(async (transaction) => {
      // The counter's row lock also serialises default changes.
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      if (dto.isDefault) {
        await this.clearDefault(transaction, workspaceId, actorId);
      }
      return transaction.theme.create({
        data: {
          ...dto,
          isDefault: dto.isDefault ?? false,
          workspaceId,
          syncVersion,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    });
  }

  async findPaginated(
    workspaceId: string,
    query: ThemeListQueryDto,
    ability: AppAbility,
  ): Promise<{ data: Theme[]; meta: PaginationMeta }> {
    this.abilityScopedQueryService.assertWorkspaceReachable(
      ability,
      'read',
      'Theme',
      workspaceId,
    );
    const { page, perPage } = query;
    const where = this.abilityScopedQueryService.buildWhereOrEmpty(
      ability,
      'read',
      'Theme',
      {
        workspaceId,
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' as const },
        }),
      },
    );
    const [data, total] = await this.prisma.$transaction([
      this.prisma.scoped.theme.findMany({
        where,
        orderBy: buildOrderBy(query, THEME_SORTABLE_COLUMNS, 'name'),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.scoped.theme.count({ where }),
    ]);
    return {
      data,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /** A theme the caller cannot read is not found (404), never forbidden. */
  async findById(
    workspaceId: string,
    themeId: string,
    ability: AppAbility,
  ): Promise<Theme> {
    const theme = await this.prisma.scoped.theme.findFirst({
      where: this.abilityScopedQueryService.buildWhereOrEmpty(
        ability,
        'read',
        'Theme',
        { id: themeId, workspaceId },
      ),
    });
    if (!theme) throw Errors.resourceNotFound('Theme');
    return theme;
  }

  async update(
    workspaceId: string,
    themeId: string,
    dto: UpdateThemeDto,
    ability: AppAbility,
    actorId: string,
  ): Promise<Theme> {
    rejectNullFields(dto, [
      'name',
      'background',
      'backgroundColor',
      'textColor',
      'font',
      'textScale',
      'textAlign',
      'isDefault',
    ]);
    const existing = await this.findById(workspaceId, themeId, ability);
    this.assertMayAct(ability, 'update', existing);
    return this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      // Under the counter's lock: a theme deleted since it was read is not
      // revived (nor made the default).
      await this.assertStillLive(transaction, themeId);
      if (dto.isDefault) {
        await this.clearDefault(transaction, workspaceId, actorId, themeId);
      }
      return transaction.theme.update({
        where: { id: themeId },
        data: { ...dto, syncVersion, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft delete, so the deletion still reaches desktops as a tombstone. The
   * playlists that used the theme fall back to the workspace default, each as
   * a change of its own, so they stay editable and desktops learn of it.
   */
  async remove(
    workspaceId: string,
    themeId: string,
    ability: AppAbility,
    actorId: string,
  ): Promise<void> {
    const existing = await this.findById(workspaceId, themeId, ability);
    this.assertMayAct(ability, 'delete', existing);
    await this.prisma.$transaction(async (transaction) => {
      const syncVersion = await this.syncVersionService.claimNextVersion(
        transaction,
        workspaceId,
      );
      await this.assertStillLive(transaction, themeId);
      const users = await transaction.playlist.findMany({
        where: { workspaceId, themeId, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const playlist of users) {
        await transaction.playlist.update({
          where: { id: playlist.id },
          data: {
            themeId: null,
            updatedBy: actorId,
            syncVersion: await this.syncVersionService.claimNextVersion(
              transaction,
              workspaceId,
            ),
          },
        });
      }
      await transaction.theme.update({
        where: { id: themeId },
        data: {
          isDefault: false,
          deletedAt: new Date(),
          deletedBy: actorId,
          updatedBy: actorId,
          syncVersion,
        },
      });
    });
  }

  private async assertStillLive(
    transaction: Prisma.TransactionClient,
    themeId: string,
  ): Promise<void> {
    const theme = await transaction.theme.findFirst({
      where: { id: themeId, deletedAt: null },
      select: { id: true },
    });
    if (!theme) throw Errors.resourceNotFound('Theme');
  }

  // The previous default changes too, so it gets its own sync version.
  private async clearDefault(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    actorId: string,
    exceptThemeId?: string,
  ): Promise<void> {
    const previous = await transaction.theme.findFirst({
      where: {
        workspaceId,
        isDefault: true,
        deletedAt: null,
        ...(exceptThemeId && { id: { not: exceptThemeId } }),
      },
      select: { id: true },
    });
    if (!previous) return;
    await transaction.theme.update({
      where: { id: previous.id },
      data: {
        isDefault: false,
        updatedBy: actorId,
        syncVersion: await this.syncVersionService.claimNextVersion(
          transaction,
          workspaceId,
        ),
      },
    });
  }

  private assertMayAct(
    ability: AppAbility,
    action: 'update' | 'delete',
    theme: Theme,
  ): void {
    this.permissionCheckService.assertCan(ability, action, 'Theme', {
      id: theme.id,
      workspaceId: theme.workspaceId,
    });
  }
}
