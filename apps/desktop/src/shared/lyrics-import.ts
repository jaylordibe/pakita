import type { SectionKind } from './song-sections';
import { kindName } from './song-sections';

// Turns pasted lyrics into a song's sections and sung order, without changing
// a word: it only decides where sections start and where slides break.
//
// A slide break is a blank line inside a section's lyrics, the one way Pakita
// marks slides (`splitIntoSlides`), so the editor and the projector need
// nothing new, and the operator moves a break by moving the blank line.

/** The longest paste accepted, in characters. */
export const MAX_PASTE_LENGTH = 50_000;

/** The slide sizes offered, in lines; the default is 4. */
export const LINES_PER_SLIDE_CHOICES = [2, 3, 4, 6] as const;
export type LinesPerSlide = (typeof LINES_PER_SLIDE_CHOICES)[number];
export const DEFAULT_LINES_PER_SLIDE: LinesPerSlide = 4;

/**
 * A line longer than this may wrap on the projector. It is only a warning:
 * how much fits depends on the theme, and the line is never changed.
 */
export const LONG_LINE_LENGTH = 40;

export interface ImportedSection {
  readonly key: string;
  readonly kind: SectionKind;
  readonly label: string;
  /** Slides separated by a blank line. */
  readonly lyrics: string;
}

/** Text that was not imported as lyrics, always shown to the operator. */
export interface ImportNotice {
  readonly reason: 'metadata' | 'no-lyrics';
  readonly text: string;
}

export interface LyricsImport {
  readonly sections: readonly ImportedSection[];
  /** Section keys in sung order; a section sung again appears again. */
  readonly sequence: readonly string[];
  readonly notices: readonly ImportNotice[];
}

export interface ImportOptions {
  readonly linesPerSlide: number;
  /** Keep credit and copyright lines as lyrics instead of setting them aside. */
  readonly keepsMetadata?: boolean;
}

interface HeaderName {
  readonly kind: SectionKind;
  readonly name: string;
}

// Words that open a section, written in full. Kinds the API has map to that
// kind; any other becomes a custom section named as written.
const SECTION_WORDS: Readonly<Record<string, HeaderName>> = {
  verse: { kind: 'verse', name: 'Verse' },
  chorus: { kind: 'chorus', name: 'Chorus' },
  bridge: { kind: 'bridge', name: 'Bridge' },
  intro: { kind: 'intro', name: 'Intro' },
  outro: { kind: 'outro', name: 'Outro' },
  ending: { kind: 'outro', name: 'Ending' },
  prechorus: { kind: 'custom', name: 'Pre-Chorus' },
  postchorus: { kind: 'custom', name: 'Post-Chorus' },
  refrain: { kind: 'custom', name: 'Refrain' },
  tag: { kind: 'custom', name: 'Tag' },
  interlude: { kind: 'custom', name: 'Interlude' },
  instrumental: { kind: 'custom', name: 'Instrumental' },
};

// Short forms, recognised only in brackets or before a colon ("[V1]", "C:"),
// where they cannot be an ordinary lyric line.
const SHORT_WORDS: Readonly<Record<string, HeaderName>> = {
  v: SECTION_WORDS['verse']!,
  c: SECTION_WORDS['chorus']!,
  b: SECTION_WORDS['bridge']!,
  pc: SECTION_WORDS['prechorus']!,
};

const WORD = String.raw`(pre[- ]?chorus|post[- ]?chorus|verse|chorus|bridge|intro|outro|ending|refrain|tag|interlude|instrumental|pc|v|c|b)`;
// "1", "2", "x2", "2x", "(x2)", "×2": a number and/or how many times it is sung.
const NUMBER = String.raw`(?:\s*(\d{1,2}))?`;
const TIMES = String.raw`(?:\s*\(?\s*(?:[x×]\s*(\d)|(\d)\s*[x×])\s*\)?)?`;
const BRACKETED = new RegExp(
  String.raw`^[[({]\s*${WORD}${NUMBER}${TIMES}\s*:?\s*[\])}]\s*$`,
  'iu',
);
const WITH_COLON = new RegExp(
  String.raw`^${WORD}${NUMBER}${TIMES}\s*:\s*(.*)$`,
  'iu',
);
const ALONE = new RegExp(String.raw`^${WORD}${NUMBER}${TIMES}$`, 'iu');

interface Header {
  readonly kind: SectionKind;
  readonly label: string;
  readonly baseName: string;
  readonly times: number;
  /** Lyrics written on the header's own line, after a colon. */
  readonly firstLine: string | null;
}

/** Reads a line that is only a section heading, or returns null. */
export function parseHeader(line: string): Header | null {
  const bracketed = BRACKETED.exec(line);
  const withColon = bracketed ? null : WITH_COLON.exec(line);
  const alone = bracketed || withColon ? null : ALONE.exec(line);
  const match = bracketed ?? withColon ?? alone;
  if (!match) return null;
  const word = match[1]!.toLowerCase().replace(/[- ]/gu, '');
  const named = SECTION_WORDS[word] ?? (alone ? undefined : SHORT_WORDS[word]);
  // A bare short form ("C", "B 2") is too likely to be a lyric.
  if (!named) return null;
  const number = match[2];
  const times = Number(match[3] ?? match[4] ?? 1);
  const rest = withColon ? (match[5] ?? '').trim() : '';
  return {
    kind: named.kind,
    label: number ? `${named.name} ${number}` : named.name,
    baseName: named.name,
    times: Math.max(1, times),
    firstLine: rest === '' ? null : rest,
  };
}

const METADATA = new RegExp(
  String.raw`^(?:©|\(c\)\s|copyright\b|ccli\b|all rights reserved|(?:words|lyrics|music|words\s*(?:and|&)\s*music)\s+by\b|written\s+by\b|composed\s+by\b)`,
  'iu',
);

/** Whether a line is a credit or copyright line rather than a lyric. */
export function isMetadataLine(line: string): boolean {
  return METADATA.test(line);
}

/**
 * Line endings to "\n", each line trimmed, runs of blank lines to one, and
 * invisible marks a paste can carry (byte-order mark, zero-width space)
 * removed. Words, punctuation, case and letters are kept as they are.
 */
export function normalizeLyrics(text: string): string[] {
  const lines = text
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/gu, '\n')
    .replace(/[\uFEFF\u200B]/gu, '')
    .replace(/\u00A0/gu, ' ')
    .split('\n')
    .map((line) => line.trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (line === '' && (kept.length === 0 || kept.at(-1) === '')) continue;
    kept.push(line);
  }
  while (kept.at(-1) === '') kept.pop();
  return kept;
}

/**
 * Cuts lyrics into slides of at most `linesPerSlide` lines. A blank line the
 * lyrics already have stays a break; a line is never split; no slide is empty.
 */
export function paginate(
  lines: readonly string[],
  linesPerSlide: number,
): string {
  const size = Math.max(1, Math.floor(linesPerSlide));
  const slides: string[] = [];
  let block: string[] = [];
  const flush = (): void => {
    for (let start = 0; start < block.length; start += size) {
      slides.push(block.slice(start, start + size).join('\n'));
    }
    block = [];
  };
  for (const line of lines) {
    if (line === '') flush();
    else block.push(line);
  }
  flush();
  return slides.join('\n\n');
}

/** The lines of some lyrics that may wrap on the projector. */
export function longLinesOf(lyrics: string): string[] {
  return lyrics
    .split('\n')
    .filter((line) => [...line].length > LONG_LINE_LENGTH);
}

interface Block {
  readonly header: Header | null;
  readonly lines: string[];
}

/** Sets aside credit and copyright lines at the very start and end only. */
function takeMetadata(lines: string[], notices: ImportNotice[]): string[] {
  let start = 0;
  let end = lines.length;
  const atStart: string[] = [];
  const atEnd: string[] = [];
  while (
    start < end &&
    (lines[start] === '' || isMetadataLine(lines[start]!))
  ) {
    if (lines[start] !== '') atStart.push(lines[start]!);
    start += 1;
  }
  while (
    end > start &&
    (lines[end - 1] === '' || isMetadataLine(lines[end - 1]!))
  ) {
    if (lines[end - 1] !== '') atEnd.unshift(lines[end - 1]!);
    end -= 1;
  }
  for (const text of [...atStart, ...atEnd]) {
    notices.push({ reason: 'metadata', text });
  }
  return lines.slice(start, end);
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end);
}

/** Splits the lines into blocks: at headings, or else at blank lines. */
function toBlocks(lines: readonly string[]): Block[] {
  const headers = lines.map(parseHeader);
  if (headers.every((header) => header === null)) {
    const blocks: Block[] = [];
    let current: string[] = [];
    for (const line of [...lines, '']) {
      if (line !== '') current.push(line);
      else if (current.length > 0) {
        blocks.push({ header: null, lines: current });
        current = [];
      }
    }
    return blocks;
  }
  const blocks: Block[] = [];
  let current: Block = { header: null, lines: [] };
  lines.forEach((line, index) => {
    const header = headers[index];
    if (!header) {
      current.lines.push(line);
      return;
    }
    blocks.push(current);
    current = {
      header,
      lines: header.firstLine === null ? [] : [header.firstLine],
    };
  });
  blocks.push(current);
  return blocks
    .map((block) => ({ header: block.header, lines: trimBlank(block.lines) }))
    .filter((block) => block.header !== null || block.lines.length > 0);
}

interface Draft {
  key: string;
  kind: SectionKind;
  label: string;
  baseName: string;
  lines: string[];
  /** Named by the paste ("[Chorus]"), not given a name by the importer. */
  isLabelled: boolean;
}

const sameLines = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((line, index) => line === b[index]);
const withoutBreaks = (lines: readonly string[]) =>
  lines.filter((line) => line !== '');

/** Reads pasted lyrics into sections, their sung order and what was left out. */
export function importLyrics(
  text: string,
  options: ImportOptions,
): LyricsImport {
  const notices: ImportNotice[] = [];
  const normalized = normalizeLyrics(text);
  const lines = options.keepsMetadata
    ? normalized
    : takeMetadata(normalized, notices);

  const drafts: Draft[] = [];
  const sequence: string[] = [];
  const sing = (key: string, times: number): void => {
    for (let count = 0; count < times; count += 1) sequence.push(key);
  };

  for (const { header, lines: blockLines } of toBlocks(lines)) {
    const words = withoutBreaks(blockLines);
    if (header && words.length === 0) {
      // "[Chorus]" with nothing under it: sing that section again.
      const label = header.label.toLowerCase();
      const earlier =
        drafts.find((draft) => draft.label.toLowerCase() === label) ??
        drafts.findLast(
          (draft) => draft.isLabelled && draft.baseName === header.baseName,
        );
      if (earlier) sing(earlier.key, header.times);
      else notices.push({ reason: 'no-lyrics', text: header.label });
      continue;
    }
    const same = drafts.find(
      (draft) =>
        sameLines(withoutBreaks(draft.lines), words) &&
        (!header || draft.kind === header.kind),
    );
    if (same) {
      // Unnamed lyrics sung again are the chorus.
      if (!header && !same.isLabelled && same.kind === 'verse') {
        same.kind = 'chorus';
        same.label = kindName('chorus');
        same.baseName = kindName('chorus');
      }
      sing(same.key, header?.times ?? 1);
      continue;
    }
    const draft: Draft = {
      key: `paste-${drafts.length + 1}`,
      kind: header?.kind ?? 'verse',
      label: header?.label ?? kindName('verse'),
      baseName: header?.baseName ?? kindName('verse'),
      lines: blockLines,
      isLabelled: header !== null,
    };
    drafts.push(draft);
    sing(draft.key, header?.times ?? 1);
  }

  return {
    sections: drafts.map(({ key, kind, label, lines: draftLines }) => ({
      key,
      kind,
      label,
      lyrics: paginate(draftLines, options.linesPerSlide),
    })),
    sequence,
    notices,
  };
}
