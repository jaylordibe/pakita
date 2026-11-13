import type { BibleContent, BibleTranslationSummary } from '../api/api-schemas';
import { bibleContentHash } from '../bible/bible-content-hash';
import type { DatabaseClient } from '../database/database-client';

export interface BibleSyncDependencies {
  /** The server's translations (validated). */
  listTranslations(): Promise<BibleTranslationSummary[]>;
  /** One published translation's whole text (validated). */
  downloadContent(translationId: string): Promise<BibleContent>;
  readonly database: Pick<
    DatabaseClient,
    | 'listBibleTranslations'
    | 'replaceBibleTranslation'
    | 'removeBibleTranslation'
  >;
  /**
   * `id:contentHash` of downloads that failed verification, kept for the
   * app's lifetime so a bad copy is not downloaded again every few minutes.
   */
  readonly rejectedContent: Set<string>;
}

/** The server sent a translation that is not the one it published. */
export class BibleIntegrityError extends Error {
  constructor(name: string) {
    super(
      `The server’s copy of “${name}” did not match its checksum; it was not saved. Try again later.`,
    );
    this.name = 'BibleIntegrityError';
  }
}

/**
 * Makes the laptop hold exactly the server's published translations.
 *
 * A published translation never changes, so its content hash identifies it:
 * a translation is downloaded only when the laptop lacks that hash, verified
 * against it before anything is written, and stored whole in one
 * transaction. A translation the server no longer lists is removed. A
 * failure with one translation does not stop the others; the first failure
 * is reported once all were tried.
 */
export async function syncBibleTranslations(
  dependencies: BibleSyncDependencies,
): Promise<void> {
  const { database } = dependencies;
  const published = (await dependencies.listTranslations()).filter(
    (
      translation,
    ): translation is BibleTranslationSummary & {
      contentHash: string;
    } => translation.isPublished && translation.contentHash !== null,
  );
  const local = new Map(
    (await database.listBibleTranslations()).map((translation) => [
      translation.id,
      translation,
    ]),
  );

  let firstFailure: unknown = null;
  for (const translation of published) {
    if (local.get(translation.id)?.contentHash === translation.contentHash) {
      continue;
    }
    const contentKey = `${translation.id}:${translation.contentHash}`;
    if (dependencies.rejectedContent.has(contentKey)) {
      firstFailure ??= new BibleIntegrityError(translation.name);
      continue;
    }
    try {
      const content = await dependencies.downloadContent(translation.id);
      const isIntact =
        content.translation.id === translation.id &&
        content.translation.contentHash === translation.contentHash &&
        content.verses.length === translation.verseCount &&
        bibleContentHash(content.verses) === translation.contentHash;
      if (!isIntact) {
        dependencies.rejectedContent.add(contentKey);
        throw new BibleIntegrityError(translation.name);
      }
      await database.replaceBibleTranslation(content);
    } catch (error) {
      firstFailure ??= error;
    }
  }

  const listed = new Set(published.map((translation) => translation.id));
  for (const id of local.keys()) {
    if (!listed.has(id)) {
      await database.removeBibleTranslation(id);
    }
  }
  if (firstFailure !== null) {
    throw firstFailure;
  }
}
