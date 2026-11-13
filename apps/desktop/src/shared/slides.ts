import type { components } from './api/openapi';

export type Song = components['schemas']['SongResponseDto'];

/** One screen of text on the projector. */
export interface Slide {
  /** The section it comes from, e.g. "Chorus" — shown to the operator only. */
  readonly sectionLabel: string;
  readonly text: string;
  /** Shown small beneath the text, e.g. a Bible reference and attribution. */
  readonly caption?: string;
}

/**
 * Splits a section's lyrics into slides: a blank line starts a new slide.
 * Line endings were normalised by the server; surrounding blank lines and
 * whitespace-only lines are ignored.
 */
export function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * The slides of one arrangement of a song, in presentation order. Returns
 * null when the arrangement does not belong to the song (a stale reference).
 */
export function buildSongSlides(
  song: Song,
  arrangementId?: string,
): Slide[] | null {
  const arrangement = arrangementId
    ? song.arrangements.find((candidate) => candidate.id === arrangementId)
    : song.arrangements.find((candidate) => candidate.isDefault);
  if (!arrangement) {
    return null;
  }
  const sectionsById = new Map(
    song.sections.map((section) => [section.id, section]),
  );
  const slides: Slide[] = [];
  for (const sectionId of arrangement.sectionIds) {
    const section = sectionsById.get(sectionId);
    if (!section) {
      return null;
    }
    for (const text of splitIntoSlides(section.lyrics)) {
      slides.push({ sectionLabel: section.label, text });
    }
  }
  return slides;
}

export interface PassageVerse {
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

/** "John 3:16", "John 3:16–18" or "John 3:16–4:2". */
export function formatReference(
  bookName: string,
  verses: readonly PassageVerse[],
): string {
  const first = verses[0];
  const last = verses.at(-1);
  if (!first || !last) return bookName;
  const start = `${bookName} ${first.chapter}:${first.verse}`;
  if (first === last) return start;
  return first.chapter === last.chapter
    ? `${start}–${last.verse}`
    : `${start}–${last.chapter}:${last.verse}`;
}

/**
 * One slide per verse, numbered, each captioned with its reference and the
 * translation's attribution (which its licence may require on screen).
 */
export function buildPassageSlides(
  bookName: string,
  attribution: string,
  verses: readonly PassageVerse[],
): Slide[] {
  return verses.map((verse) => {
    const reference = formatReference(bookName, [verse]);
    return {
      sectionLabel: reference,
      text: `${verse.verse} ${verse.text}`,
      caption: `${reference} · ${attribution}`,
    };
  });
}
