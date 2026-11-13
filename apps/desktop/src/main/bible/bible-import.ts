import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { bibleBookCodeValues } from '../../shared/api/enums';
import type {
  BibleImportProgress,
  BibleTranslationInput,
} from '../../shared/ipc-contract';
import { type ParsedBook, parseUsfmBook, UsfmError } from './usfm-parser';

/** Generous bounds for one translation's folder of USFM files. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BOOK_NAME_LENGTH = 60;

const canonicalPosition = new Map<string, number>(
  bibleBookCodeValues.map((code, index) => [code, index]),
);

export interface UsfmFolder {
  /** The books Pakita accepts, in canonical order. */
  readonly books: readonly ParsedBook[];
  readonly verseCount: number;
  /**
   * What was left out: front and back matter (FRT, GLO, …) and any book code
   * the server does not accept.
   */
  readonly skippedCodes: readonly string[];
}

/**
 * Reads a translation from a folder of USFM files (`*.usfm`, `*.sfm`), as
 * published by eBible.org and the Digital Bible Library. Only the folder's
 * own files are read, never its subfolders.
 */
export async function readUsfmFolder(directory: string): Promise<UsfmFolder> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(usfm|sfm)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    throw new Error('That folder has no USFM files (.usfm or .sfm).');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`That folder has more than ${MAX_FILES} USFM files.`);
  }

  const books = new Map<string, ParsedBook>();
  const skippedCodes: string[] = [];
  for (const file of files) {
    let book: ParsedBook;
    try {
      book = parseUsfmBook(await readBookFile(join(directory, file), file));
    } catch (error) {
      if (error instanceof UsfmError) {
        throw new Error(`${file}: ${error.message}`);
      }
      throw error;
    }
    if (!canonicalPosition.has(book.code)) {
      skippedCodes.push(book.code);
      continue;
    }
    if (books.has(book.code)) {
      throw new Error(`${book.code} appears in more than one file.`);
    }
    if (book.chapters.length > 0) {
      books.set(book.code, {
        ...book,
        name: book.name.slice(0, MAX_BOOK_NAME_LENGTH).trim() || book.code,
      });
    }
  }
  if (books.size === 0) {
    throw new Error('That folder has no books of the Bible Pakita can read.');
  }

  const ordered = [...books.values()].sort(
    (first, second) =>
      canonicalPosition.get(first.code)! - canonicalPosition.get(second.code)!,
  );
  return {
    books: ordered,
    verseCount: ordered.reduce(
      (total, book) =>
        total +
        book.chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0),
      0,
    ),
    skippedCodes,
  };
}

/**
 * Reads one file through a single handle — never following a link put in
 * place after the folder was listed — and refuses one too large to be a book.
 */
async function readBookFile(path: string, file: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > MAX_FILE_BYTES) {
      throw new Error(`${file} is not a USFM book Pakita can read.`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

export interface TranslationUploader {
  /**
   * Deletes an unpublished draft with this code, left behind by an import
   * that was interrupted (the app quit, the network dropped).
   */
  deleteLeftoverDraft(code: string): Promise<void>;
  /** Creates the draft and returns its id. */
  createDraft(input: BibleTranslationInput): Promise<string>;
  putChapter(
    translationId: string,
    bookCode: string,
    chapter: number,
    body: {
      bookName: string;
      verses: ReadonlyArray<{ number: number; text: string }>;
    },
  ): Promise<void>;
  publish(translationId: string): Promise<void>;
  deleteDraft(translationId: string): Promise<void>;
}

/**
 * Sends a translation to the server chapter by chapter and publishes it.
 * Publishing is what makes it visible; if anything fails before publishing,
 * the draft is deleted, so a half-imported translation is never left behind.
 * Once the publish request is sent the draft is never deleted: the server may
 * have published it even if the answer was lost.
 */
export async function uploadTranslation(
  uploader: TranslationUploader,
  input: BibleTranslationInput,
  folder: UsfmFolder,
  onProgress: (progress: BibleImportProgress) => void,
): Promise<void> {
  const total = folder.books.reduce(
    (sum, book) => sum + book.chapters.length,
    0,
  );
  await uploader.deleteLeftoverDraft(input.code);
  const translationId = await uploader.createDraft(input);
  let isPublishSent = false;
  try {
    let done = 0;
    for (const book of folder.books) {
      for (const chapter of book.chapters) {
        await uploader.putChapter(translationId, book.code, chapter.number, {
          bookName: book.name,
          verses: chapter.verses,
        });
        done += 1;
        onProgress({ done, total, bookName: book.name });
      }
    }
    isPublishSent = true;
    await uploader.publish(translationId);
  } catch (error) {
    if (!isPublishSent) {
      // If this fails too, the next import of this code removes the draft.
      await uploader.deleteDraft(translationId).catch(() => undefined);
    }
    throw error;
  }
}
