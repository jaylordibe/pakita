import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hands out the per-workspace version every content change is stamped with.
 *
 * `claimNextVersion` MUST run inside the transaction that writes the change:
 * it takes the workspace counter row's lock, and holding it until commit is
 * what makes versions within a workspace commit in the order they are
 * numbered (see `WorkspaceSyncState` in the Prisma schema). Edits in one
 * workspace therefore serialise — negligible at a church's editing rate.
 */
@Injectable()
export class SyncVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async claimNextVersion(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<number> {
    const [row] = await transaction.$queryRaw<Array<{ version: number }>>`
      INSERT INTO "workspace_sync_states" ("workspace_id", "version", "updated_at")
      VALUES (${workspaceId}::uuid, 1, now())
      ON CONFLICT ("workspace_id") DO UPDATE
        SET "version" = "workspace_sync_states"."version" + 1,
            "updated_at" = now()
      RETURNING "version"
    `;
    if (!row) {
      throw new Error('workspace_sync_states upsert returned no row');
    }
    return row.version;
  }

  /**
   * Creates the workspace's counter (version 0, a fresh epoch) if it does not
   * exist yet, so a workspace with no content still has a stable epoch for
   * desktops to remember.
   */
  async ensureCounter(workspaceId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "workspace_sync_states" ("workspace_id", "version", "updated_at")
      VALUES (${workspaceId}::uuid, 0, now())
      ON CONFLICT ("workspace_id") DO NOTHING
    `;
  }
}
