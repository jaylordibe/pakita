/**
 * Reads the scripture text out of one USFM book file (the standard format
 * Bible societies and eBible.org publish). https://ubsicap.github.io/usfm/
 *
 * Kept: verse text, including poetry and paragraph breaks (as spaces).
 * Dropped: footnotes, cross references, figures, word-level attributes
 * (Strong's numbers), section headings, titles, introductions and comments.
 */

export interface ParsedVerse {
  readonly number: number;
  readonly text: string;
}

export interface ParsedChapter {
  readonly number: number;
  readonly verses: readonly ParsedVerse[];
}

export interface ParsedBook {
  /** The USFM book code from `\id`, e.g. "JHN". */
  readonly code: string;
  /** The book's name in the text's language (`\toc2`, else `\h`, `\toc1`). */
  readonly name: string;
  readonly chapters: readonly ParsedChapter[];
}

export class UsfmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsfmError';
  }
}

// Notes, figures, quotation references and alternate or published numbering
// (`\vp 1a\vp*`): their whole content goes — it is not the verse's text.
const NOTE_PATTERN = /\\(f|fe|ef|x|ex|fig|rq|ca|va|vp)\b[\s\S]*?\\\1\*/g;
// Milestones (`\qt-s |who="Jesus"\*`, `\zaln-e\*`) and empty markers such
// as `\ts\*` mark a position; they carry no text.
const MILESTONE_PATTERN = /\\[a-z][a-z0-9]*(?:-[se][^\\]*?)?\\\*/g;
// Word-level attributes: `\w gracious|strong="H2603"\w*` keeps "gracious".
const ATTRIBUTE_PATTERN = /\|[^\\]*?(?=\\\+?[a-z][a-z0-9]*\*)/g;
// Character markers, nested (`\+`) or not. An opening marker's single
// separating space goes with it; a closing marker (`\wj*`) leaves the space
// after it alone. The lookahead stops `\w` matching inside `\wj`.
// Any other marker the file closes (`\ndx …\ndx*`, or one this list does
// not know) is a character marker too, so its text is kept.
const CHARACTER_MARKERS = [
  'add',
  'bd',
  'bdit',
  'bk',
  'dc',
  'em',
  'fv',
  'it',
  'jmp',
  'k',
  'lit',
  'nd',
  'ndx',
  'no',
  'ord',
  'pn',
  'png',
  'qac',
  'qs',
  'qt',
  'rb',
  'sc',
  'sig',
  'sls',
  'sup',
  'tl',
  'w',
  'wa',
  'wg',
  'wh',
  'wj',
  'xt',
  'pro',
];
const CLOSED_MARKER_PATTERN = /\\\+?([a-z][a-z0-9]*)\*/g;

function characterMarkerPatterns(source: string): {
  readonly open: RegExp;
  readonly close: RegExp;
} {
  const names = new Set(CHARACTER_MARKERS);
  for (const [, name] of source.matchAll(CLOSED_MARKER_PATTERN)) {
    names.add(name!);
  }
  // Names are lower-case letters and digits: safe inside a pattern.
  const alternatives = [...names].join('|');
  return {
    open: new RegExp(`\\\\\\+?(?:${alternatives})(?![a-z0-9*])\\s?`, 'g'),
    close: new RegExp(`\\\\\\+?(?:${alternatives})\\*`, 'g'),
  };
}
// Paragraph-level markers whose text is part of the scripture text.
const TEXT_PARAGRAPH_MARKERS = new Set([
  'p',
  'm',
  'po',
  'pr',
  'cls',
  'pmo',
  'pm',
  'pmc',
  'pmr',
  'pi',
  'pi1',
  'pi2',
  'pi3',
  'mi',
  'nb',
  'pc',
  'ph',
  'ph1',
  'ph2',
  'ph3',
  'b',
  'q',
  'q1',
  'q2',
  'q3',
  'q4',
  'qr',
  'qc',
  'qm',
  'qm1',
  'qm2',
  'qm3',
  'qd',
  'lh',
  'li',
  'li1',
  'li2',
  'li3',
  'li4',
  'lf',
  'lim',
  'lim1',
  'lim2',
  'tr',
  'th1',
  'th2',
  'th3',
  'th4',
  'tc1',
  'tc2',
  'tc3',
  'tc4',
  'thr1',
  'thr2',
  'tcr1',
  'tcr2',
]);

export function parseUsfmBook(source: string): ParsedBook {
  const withoutNotes = source
    .replace(/\r\n?/g, '\n')
    .replace(NOTE_PATTERN, ' ')
    .replace(MILESTONE_PATTERN, '');
  const characterMarker = characterMarkerPatterns(withoutNotes);
  const cleaned = withoutNotes
    .replace(ATTRIBUTE_PATTERN, '')
    .replace(characterMarker.close, '')
    .replace(characterMarker.open, '');

  let code: string | null = null;
  const names: Record<string, string> = {};
  const chapters = new Map<number, Map<number, string>>();
  let chapter: number | null = null;
  let verse: number | null = null;

  const append = (text: string) => {
    if (chapter === null || verse === null) return;
    const verses = chapters.get(chapter)!;
    verses.set(verse, `${verses.get(verse) ?? ''} ${text}`);
  };

  // Each paragraph-level marker and the text up to the next one.
  const markerPattern = /\\([a-z][a-z0-9]*)\s*([^\\]*)/g;
  for (const [, marker, content = ''] of cleaned.matchAll(markerPattern)) {
    switch (marker) {
      case 'id':
        code = content.trim().split(/\s+/)[0]?.toUpperCase() ?? null;
        break;
      case 'h':
      case 'toc1':
      case 'toc2':
        names[marker] = content.trim();
        break;
      case 'c': {
        const number = Number.parseInt(content.trim(), 10);
        if (!Number.isInteger(number) || number < 1) {
          throw new UsfmError(`Invalid chapter number "${content.trim()}"`);
        }
        chapter = number;
        verse = null;
        if (!chapters.has(chapter)) chapters.set(chapter, new Map());
        break;
      }
      case 'v': {
        if (chapter === null) {
          throw new UsfmError('A verse appears before the first chapter');
        }
        // "16", "16a" or a range "16-17": the verse is numbered by its start.
        const match = /^(\d+)[a-z]?(?:-\d+[a-z]?)?\s*([\s\S]*)$/.exec(content);
        if (!match) {
          throw new UsfmError(
            `Invalid verse number in "${content.slice(0, 20)}"`,
          );
        }
        verse = Number.parseInt(match[1]!, 10);
        append(match[2] ?? '');
        break;
      }
      default:
        if (TEXT_PARAGRAPH_MARKERS.has(marker!)) {
          append(content);
        }
      // Anything else — headings, titles, introductions, comments — is not
      // scripture text and is dropped.
    }
  }

  if (!code) {
    throw new UsfmError('The file has no \\id line, so its book is unknown');
  }
  const name = names.toc2 || names.h || names.toc1 || code;
  return {
    code,
    name,
    chapters: [...chapters.entries()]
      .sort(([first], [second]) => first - second)
      .map(([number, verses]) => ({
        number,
        verses: [...verses.entries()]
          .map(([verseNumber, text]) => ({
            number: verseNumber,
            text: text.replace(/\s+/g, ' ').trim(),
          }))
          .filter((parsed) => parsed.text.length > 0)
          .sort((first, second) => first.number - second.number),
      }))
      .filter((parsed) => parsed.verses.length > 0),
  };
}
