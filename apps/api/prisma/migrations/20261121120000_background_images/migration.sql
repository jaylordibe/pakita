-- Still images as theme backgrounds, beside videos, in the same library.
--
-- Every row so far is a video. An image has no duration; a video always has
-- one. File rows now carry the SHA-256 of what the API stored, so laptops can
-- verify an image they download as they verify a video.

-- AlterTable
ALTER TABLE "media" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'video';
ALTER TABLE "media" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "media" ALTER COLUMN "duration_ms" DROP NOT NULL;

-- ── Invariants Prisma cannot express ─────────────────────────────────────────
ALTER TABLE "media" DROP CONSTRAINT "media_positive_measures";
ALTER TABLE "media" ADD CONSTRAINT "media_positive_measures"
    CHECK ("size_bytes" > 0 AND "width" > 0 AND "height" > 0
           AND ("duration_ms" IS NULL OR "duration_ms" > 0));
-- A video has a duration; an image has none.
ALTER TABLE "media" ADD CONSTRAINT "media_duration_when_video"
    CHECK (("kind" = 'video') = ("duration_ms" IS NOT NULL));
