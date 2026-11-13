-- Bible translations (Phase 3): shared by the whole installation, imported
-- as drafts and immutable once published.
-- CreateTable
CREATE TABLE "bible_translations" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "source_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "content_hash" TEXT,
    "verse_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bible_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bible_books" (
    "id" UUID NOT NULL,
    "bible_translation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "bible_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bible_verses" (
    "bible_translation_id" UUID NOT NULL,
    "book_code" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "bible_verses_pkey" PRIMARY KEY ("bible_translation_id","book_code","chapter","verse")
);

-- CreateIndex
CREATE UNIQUE INDEX "bible_translations_code_key" ON "bible_translations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bible_books_bible_translation_id_code_key" ON "bible_books"("bible_translation_id", "code");

-- AddForeignKey
ALTER TABLE "bible_books" ADD CONSTRAINT "bible_books_bible_translation_id_fkey" FOREIGN KEY ("bible_translation_id") REFERENCES "bible_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bible_verses" ADD CONSTRAINT "bible_verses_bible_translation_id_fkey" FOREIGN KEY ("bible_translation_id") REFERENCES "bible_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants Prisma cannot express.
ALTER TABLE "bible_translations" ADD CONSTRAINT "bible_translations_verse_count_check" CHECK ("verse_count" >= 0);
ALTER TABLE "bible_translations" ADD CONSTRAINT "bible_translations_published_check"
  CHECK (NOT "is_published" OR ("published_at" IS NOT NULL AND "content_hash" IS NOT NULL));
ALTER TABLE "bible_books" ADD CONSTRAINT "bible_books_position_check" CHECK ("position" >= 0);
ALTER TABLE "bible_verses" ADD CONSTRAINT "bible_verses_numbers_check" CHECK ("chapter" > 0 AND "verse" > 0);
