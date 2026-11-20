-- Background videos.
--
-- `media` is workspace content synchronised to desktops like themes: every
-- write claims the workspace's next sync version, and deletion is soft so it
-- reaches desktops as a tombstone. A theme may show one as its background.
--
-- A video is uploaded straight to storage (`awaiting_upload`), so a file row
-- now also carries an expiry while it waits for its bytes, and the SHA-256
-- the upload declared.

-- AlterTable
ALTER TABLE "file_assets" ADD COLUMN "sha256" TEXT;

-- `expires_at` is set exactly while a file is `ready` (attachable until then)
-- or `awaiting_upload` (completable until then).
ALTER TABLE "file_assets" DROP CONSTRAINT "file_assets_expires_at_when_ready_check";
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_expires_at_when_unattached_check"
    CHECK (("status" = 'ready' OR "status" = 'awaiting_upload') = ("expires_at" IS NOT NULL));

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_asset_id" UUID,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "sync_version" INTEGER NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "themes" ADD COLUMN "background_media_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "media_file_asset_id_key" ON "media"("file_asset_id");

-- CreateIndex
CREATE INDEX "media_workspace_id_sync_version_idx" ON "media"("workspace_id", "sync_version");

-- CreateIndex: the foreign key's own index, used by the in-use check on delete.
CREATE INDEX "themes_background_media_id_idx" ON "themes"("background_media_id");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_background_media_id_fkey" FOREIGN KEY ("background_media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Invariants Prisma cannot express ─────────────────────────────────────────
-- A live video holds its file; a deleted one has released it.
ALTER TABLE "media" ADD CONSTRAINT "media_file_while_live"
    CHECK (("deleted_at" IS NULL) = ("file_asset_id" IS NOT NULL));
ALTER TABLE "media" ADD CONSTRAINT "media_sha256_hex"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "media" ADD CONSTRAINT "media_positive_measures"
    CHECK ("size_bytes" > 0 AND "width" > 0 AND "height" > 0 AND "duration_ms" > 0);
