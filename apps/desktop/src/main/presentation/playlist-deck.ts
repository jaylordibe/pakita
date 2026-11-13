import type {
  Playlist,
  PlaylistEntry,
  PlaylistItemInput,
  Slide,
  Song,
} from '../../shared/ipc-contract';
import { buildSongSlides } from '../../shared/slides';

/** A passage as the laptop can present it. */
export interface LoadedPassage {
  readonly reference: string;
  readonly translationCode: string;
  readonly slides: readonly Slide[];
}

/** Where a playlist's content comes from: the laptop's own copy only. */
export interface PlaylistSources {
  /** The song, or null when this laptop lacks it (or cannot read it). */
  song(songId: string): Promise<Song | null>;
  /** The passage, or null when this laptop lacks its translation. */
  passage(item: PassageItem): Promise<LoadedPassage | null>;
}

type PlaylistItem = Playlist['items'][number];
export type PassageItem = PlaylistItem & {
  kind: 'passage';
  bibleTranslationId: string;
  bookCode: NonNullable<PlaylistItem['bookCode']>;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

export interface ResolvedEntry extends PlaylistEntry {
  readonly slides: readonly Slide[];
}

/**
 * Works out, entry by entry, what this laptop can present from a playlist —
 * the readiness an operator checks before a service, and the slides a
 * presentation is built from. Reads only local content.
 */
export async function resolvePlaylist(
  playlist: Playlist,
  sources: PlaylistSources,
): Promise<ResolvedEntry[]> {
  const entries: ResolvedEntry[] = [];
  for (const item of playlist.items) {
    entries.push(
      item.kind === 'song'
        ? await resolveSong(item, sources)
        : await resolvePassage(item as PassageItem, sources),
    );
  }
  return entries;
}

async function resolveSong(
  item: PlaylistItem,
  sources: PlaylistSources,
): Promise<ResolvedEntry> {
  const input = toInput(item);
  const song = item.songId ? await sources.song(item.songId) : null;
  if (!song) {
    return notReady(input, 'Song', 'This song is not on this laptop.');
  }
  const named = item.arrangementName
    ? song.arrangements.find(
        (arrangement) => arrangement.name === item.arrangementName,
      )
    : undefined;
  const slides = buildSongSlides(song, named?.id) ?? [];
  const note =
    item.arrangementName && !named
      ? `Arrangement “${item.arrangementName}” no longer exists; the default is presented.`
      : null;
  return {
    kind: 'song',
    title: song.title,
    detail: named?.name ?? null,
    isReady: slides.length > 0,
    note: slides.length > 0 ? note : 'This song has no slides.',
    slideCount: slides.length,
    slides: slides.map((slide) => ({
      ...slide,
      sectionLabel: `${song.title} · ${slide.sectionLabel}`,
    })),
    input,
  };
}

async function resolvePassage(
  item: PassageItem,
  sources: PlaylistSources,
): Promise<ResolvedEntry> {
  const input = toInput(item);
  const passage = await sources.passage(item);
  const fallbackTitle = `${item.bookCode} ${item.startChapter}:${item.startVerse}–${item.endChapter}:${item.endVerse}`;
  if (!passage || passage.slides.length === 0) {
    return notReady(
      input,
      fallbackTitle,
      'This Bible translation is not on this laptop.',
    );
  }
  return {
    kind: 'passage',
    title: passage.reference,
    detail: passage.translationCode,
    isReady: true,
    note: null,
    slideCount: passage.slides.length,
    slides: passage.slides,
    input,
  };
}

function notReady(
  input: PlaylistItemInput,
  title: string,
  note: string,
): ResolvedEntry {
  return {
    kind: input.kind,
    title,
    detail: null,
    isReady: false,
    note,
    slideCount: 0,
    slides: [],
    input,
  };
}

/** The entry in the shape the API takes back, for editing. */
function toInput(item: PlaylistItem): PlaylistItemInput {
  return item.kind === 'song'
    ? {
        kind: 'song',
        songId: item.songId ?? undefined,
        arrangementName: item.arrangementName ?? undefined,
      }
    : {
        kind: 'passage',
        bibleTranslationId: item.bibleTranslationId ?? undefined,
        bookCode: item.bookCode ?? undefined,
        startChapter: item.startChapter ?? undefined,
        startVerse: item.startVerse ?? undefined,
        endChapter: item.endChapter ?? undefined,
        endVerse: item.endVerse ?? undefined,
      };
}

/**
 * One deck of every ready entry's slides, in order, and the slide each
 * entry starts at (null for an entry that is not ready).
 */
export function buildDeck(entries: readonly ResolvedEntry[]): {
  readonly slides: Slide[];
  readonly startIndexes: Array<number | null>;
} {
  const slides: Slide[] = [];
  const startIndexes = entries.map((entry) => {
    if (!entry.isReady) return null;
    const start = slides.length;
    slides.push(...entry.slides);
    return start;
  });
  return { slides, startIndexes };
}
