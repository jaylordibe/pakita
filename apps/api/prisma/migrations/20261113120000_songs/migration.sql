-- Songs and the per-workspace sync counter (Phase 2).
--
-- A song is the unit of editing and synchronisation: its sections and
-- arrangements are written in the same transaction and carry the song's
-- `sync_version`. `workspace_sync_states.version` is the counter those
-- versions come from; see the Prisma schema for why taking its row lock keeps
-- them in commit order.
-- CreateTable
CREATE TABLE "workspace_sync_states" (
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "epoch" UUID NOT NULL DEFAULT gen_random_uuid(),

    CONSTRAINT "workspace_sync_states_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "songs" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "sync_version" INTEGER NOT NULL,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_sections" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "song_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lyrics" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "song_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_arrangements" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "song_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "song_arrangements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_arrangement_items" (
    "id" UUID NOT NULL,
    "song_arrangement_id" UUID NOT NULL,
    "song_section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "song_arrangement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "songs_workspace_id_sync_version_idx" ON "songs"("workspace_id", "sync_version");

-- CreateIndex
CREATE INDEX "songs_workspace_id_title_idx" ON "songs"("workspace_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "song_sections_song_id_position_key" ON "song_sections"("song_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "song_arrangements_song_id_position_key" ON "song_arrangements"("song_id", "position");

-- CreateIndex
CREATE INDEX "song_arrangement_items_song_section_id_idx" ON "song_arrangement_items"("song_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "song_arrangement_items_song_arrangement_id_position_key" ON "song_arrangement_items"("song_arrangement_id", "position");

-- AddForeignKey
ALTER TABLE "workspace_sync_states" ADD CONSTRAINT "workspace_sync_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "songs" ADD CONSTRAINT "songs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_sections" ADD CONSTRAINT "song_sections_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_arrangements" ADD CONSTRAINT "song_arrangements_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_arrangement_items" ADD CONSTRAINT "song_arrangement_items_song_arrangement_id_fkey" FOREIGN KEY ("song_arrangement_id") REFERENCES "song_arrangements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "song_arrangement_items" ADD CONSTRAINT "song_arrangement_items_song_section_id_fkey" FOREIGN KEY ("song_section_id") REFERENCES "song_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants Prisma cannot express.
ALTER TABLE "workspace_sync_states" ADD CONSTRAINT "workspace_sync_states_version_check" CHECK ("version" >= 0);
ALTER TABLE "songs" ADD CONSTRAINT "songs_sync_version_check" CHECK ("sync_version" > 0);
ALTER TABLE "song_sections" ADD CONSTRAINT "song_sections_position_check" CHECK ("position" >= 0);
ALTER TABLE "song_arrangements" ADD CONSTRAINT "song_arrangements_position_check" CHECK ("position" >= 0);
ALTER TABLE "song_arrangement_items" ADD CONSTRAINT "song_arrangement_items_position_check" CHECK ("position" >= 0);

-- Exactly one default arrangement per song: at most one here, at least one in
-- the service (every write sends a complete set of arrangements).
CREATE UNIQUE INDEX "song_arrangements_one_default_per_song" ON "song_arrangements"("song_id") WHERE "is_default";
