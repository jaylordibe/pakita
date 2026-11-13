-- Themes and playlists (Phase 4).
--
-- Both are workspace content synchronised to desktops like songs: every
-- write claims the workspace's next sync version (see the songs migration),
-- and deletion is soft so it reaches desktops as a tombstone. A playlist is
-- written whole with its items.
-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "background_color" TEXT NOT NULL,
    "text_color" TEXT NOT NULL,
    "font" TEXT NOT NULL,
    "text_scale" INTEGER NOT NULL,
    "text_align" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sync_version" INTEGER NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "service_date" DATE,
    "theme_id" UUID,
    "sync_version" INTEGER NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_items" (
    "id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "song_id" UUID,
    "arrangement_name" TEXT,
    "bible_translation_id" UUID,
    "book_code" TEXT,
    "start_chapter" INTEGER,
    "start_verse" INTEGER,
    "end_chapter" INTEGER,
    "end_verse" INTEGER,

    CONSTRAINT "playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "themes_workspace_id_sync_version_idx" ON "themes"("workspace_id", "sync_version");

-- CreateIndex
CREATE INDEX "playlists_workspace_id_sync_version_idx" ON "playlists"("workspace_id", "sync_version");

-- CreateIndex
CREATE INDEX "playlists_workspace_id_service_date_idx" ON "playlists"("workspace_id", "service_date");

-- CreateIndex
CREATE INDEX "playlist_items_song_id_idx" ON "playlist_items"("song_id");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_items_playlist_id_position_key" ON "playlist_items"("playlist_id", "position");

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one live default theme per workspace.
CREATE UNIQUE INDEX "themes_one_default_per_workspace" ON "themes"("workspace_id") WHERE "is_default" AND "deleted_at" IS NULL;

-- Invariants: the text size range, and an item is either a song or a whole
-- passage reference, never a mix.
ALTER TABLE "themes" ADD CONSTRAINT "themes_text_scale_range" CHECK ("text_scale" BETWEEN 50 AND 200);
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_song_or_passage" CHECK (
  ("song_id" IS NOT NULL
    AND "bible_translation_id" IS NULL AND "book_code" IS NULL
    AND "start_chapter" IS NULL AND "start_verse" IS NULL
    AND "end_chapter" IS NULL AND "end_verse" IS NULL)
  OR
  ("song_id" IS NULL AND "arrangement_name" IS NULL
    AND "bible_translation_id" IS NOT NULL AND "book_code" IS NOT NULL
    AND "start_chapter" IS NOT NULL AND "start_verse" IS NOT NULL
    AND "end_chapter" IS NOT NULL AND "end_verse" IS NOT NULL)
);
