import { Injectable } from '@nestjs/common';
import type { BibleTranslation, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AppAbility } from '../../common/authorization/app-ability';
import {
  BIBLE_BOOK_CODES,
  type BibleBookCode,
  bibleBookPosition,
} from '../../common/constants/bible-books';
import { Errors } from '../../common/errors/errors';
import { bibleContentHash } from '../../common/util/bible-content-hash.util';
import { lockBibleTranslationRow } from '../../common/util/row-lock.util';
import { PrismaService } from '../../prisma/prisma.service';
import { BibleContentResponseDto } from './dto/bible-translation-response.dto';
import { BibleTranslationResponseDto } from './dto/bible-translation-response.dto';
import { CreateBibleTranslationDto } from './dto/create-bible-translation.dto';
import { PutBibleChapterDto } from './dto/put-bible-chapter.dto';

/** Comfortably above any Bible with its deuterocanon (~37,000 verses). */
export const MAX_VERSES_PER_TRANSLATION = 50_000;
const MAX_CHAPTER = 200;
// Reading and hashing a whole Bible takes about a second; Prisma's 5-second
// default would fail it on a slow server.
const PUBLISH_TRANSACTION_OPTIONS = { timeout: 60_000 } as const;

/**
 * The installation's Bible translations. A translation is built as a draft,
 * one chapter per request, then published; once published it is immutable,
 * so a desktop downloads it once and verifies its hash.
 */
@Injectable()
export class BibleTranslationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Published translations; an importer also sees its drafts. */
  async findAll(ability: AppAbility): Promise<BibleTranslation[]> {
    const canImport = ability.can('create', 'BibleTranslation');
    return this.prisma.bibleTranslation.findMany({
      where: canImport ? {} : { isPublished: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async create(
    dto: CreateBibleTranslationDto,
    actorId: string,
  ): Promise<BibleTranslation> {
    const translation = await this.prisma.bibleTranslation.create({
      data: { ...dto, createdBy: actorId, updatedBy: actorId },
    });
    await this.auditService.record({
      action: 'bible_translation.created',
      actorId,
      metadata: { bibleTranslationId: translation.id, code: translation.code },
    });
    return translation;
  }

  async putChapter(
    translationId: string,
    bookCode: string,
    chapter: number,
    dto: PutBibleChapterDto,
    actorId: string,
  ): Promise<void> {
    if (!isBibleBookCode(bookCode)) {
      throw Errors.validationFailed([
        { field: 'bookCode', constraints: ['unknown USFM book code'] },
      ]);
    }
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > MAX_CHAPTER) {
      throw Errors.validationFailed([
        { field: 'chapter', constraints: [`chapter must be 1–${MAX_CHAPTER}`] },
      ]);
    }
    const numbers = dto.verses.map((verse) => verse.number);
    if (new Set(numbers).size !== numbers.length) {
      throw Errors.validationFailed([
        { field: 'verses', constraints: ['each verse number appears once'] },
      ]);
    }
    await this.prisma.$transaction(async (transaction) => {
      // Under the lock: publication cannot slip in between this check and
      // the write, and concurrent chapters count each other's verses.
      const translation = await this.findDraft(transaction, translationId);
      const otherVerses = await transaction.bibleVerse.count({
        where: {
          bibleTranslationId: translation.id,
          NOT: { bookCode, chapter },
        },
      });
      if (otherVerses + dto.verses.length > MAX_VERSES_PER_TRANSLATION) {
        throw Errors.validationFailed([
          {
            field: 'verses',
            constraints: [
              `a translation holds at most ${MAX_VERSES_PER_TRANSLATION} verses`,
            ],
          },
        ]);
      }
      await transaction.bibleBook.upsert({
        where: {
          bibleTranslationId_code: {
            bibleTranslationId: translation.id,
            code: bookCode,
          },
        },
        create: {
          bibleTranslationId: translation.id,
          code: bookCode,
          name: dto.bookName,
          position: bibleBookPosition(bookCode),
        },
        update: { name: dto.bookName },
      });
      await transaction.bibleVerse.deleteMany({
        where: { bibleTranslationId: translation.id, bookCode, chapter },
      });
      await transaction.bibleVerse.createMany({
        data: dto.verses.map((verse) => ({
          bibleTranslationId: translation.id,
          bookCode,
          chapter,
          verse: verse.number,
          text: verse.text,
        })),
      });
      await transaction.bibleTranslation.update({
        where: { id: translation.id },
        data: { updatedBy: actorId },
      });
    });
  }

  /** Freezes a draft: records its verse count and content hash. */
  async publish(
    translationId: string,
    actorId: string,
  ): Promise<BibleTranslation> {
    // One transaction under the translation's lock: the hash is computed
    // over exactly the content that is frozen with it.
    const published = await this.prisma.$transaction(async (transaction) => {
      const translation = await this.findDraft(transaction, translationId);
      const { verses } = await this.loadContent(transaction, translation.id);
      if (verses.length === 0) {
        throw Errors.resourceConflict(
          'A translation with no verses cannot be published',
        );
      }
      return transaction.bibleTranslation.update({
        where: { id: translation.id },
        data: {
          isPublished: true,
          publishedAt: new Date(),
          contentHash: bibleContentHash(verses),
          verseCount: verses.length,
          updatedBy: actorId,
        },
      });
    }, PUBLISH_TRANSACTION_OPTIONS);
    await this.auditService.record({
      action: 'bible_translation.published',
      actorId,
      metadata: {
        bibleTranslationId: published.id,
        code: published.code,
        verseCount: published.verseCount,
        contentHash: published.contentHash,
      },
    });
    return published;
  }

  async findContent(translationId: string): Promise<BibleContentResponseDto> {
    const translation = await this.prisma.bibleTranslation.findFirst({
      where: { id: translationId, isPublished: true },
    });
    if (!translation) throw Errors.resourceNotFound('BibleTranslation');
    const { books, verses } = await this.loadContent(
      this.prisma,
      translation.id,
    );
    return {
      translation: new BibleTranslationResponseDto(translation),
      books,
      verses,
    };
  }

  async remove(translationId: string, actorId: string): Promise<void> {
    const translation = await this.prisma.bibleTranslation.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw Errors.resourceNotFound('BibleTranslation');
    await this.prisma.bibleTranslation.delete({
      where: { id: translation.id },
    });
    await this.auditService.record({
      action: 'bible_translation.deleted',
      actorId,
      metadata: { bibleTranslationId: translation.id, code: translation.code },
    });
  }

  /** The draft, locked for the rest of the transaction. */
  private async findDraft(
    transaction: Prisma.TransactionClient,
    translationId: string,
  ): Promise<BibleTranslation> {
    await lockBibleTranslationRow(transaction, translationId);
    const translation = await transaction.bibleTranslation.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw Errors.resourceNotFound('BibleTranslation');
    if (translation.isPublished) {
      throw Errors.resourceConflict(
        'A published translation cannot be changed; delete it and import it again',
      );
    }
    return translation;
  }

  // The canonical order: book position, chapter, verse.
  private async loadContent(
    client: Prisma.TransactionClient,
    translationId: string,
  ) {
    const books = await client.bibleBook.findMany({
      where: { bibleTranslationId: translationId },
      select: { code: true, name: true, position: true },
      orderBy: { position: 'asc' },
    });
    const positionByCode = new Map(
      books.map((book) => [book.code, book.position]),
    );
    const verses = (
      await client.bibleVerse.findMany({
        where: { bibleTranslationId: translationId },
        select: { bookCode: true, chapter: true, verse: true, text: true },
      })
    ).sort(
      (first, second) =>
        positionByCode.get(first.bookCode)! -
          positionByCode.get(second.bookCode)! ||
        first.chapter - second.chapter ||
        first.verse - second.verse,
    );
    return { books, verses };
  }
}

function isBibleBookCode(code: string): code is BibleBookCode {
  return (BIBLE_BOOK_CODES as readonly string[]).includes(code);
}
