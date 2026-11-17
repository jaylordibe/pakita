import type { SongInput } from './ipc-contract';

// A new song section starts with a name from its kind and count ("Verse 1",
// "Verse 2"…). After that the name is the person's: changing a section's
// kind never renames it.

export type SectionKind = SongInput['sections'][number]['kind'];

interface NamedSection {
  readonly kind: SectionKind;
  readonly label: string;
}

/** "verse" → "Verse". */
export function kindName(kind: SectionKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The number in a name given automatically for this kind, else null. */
function automaticNumber(label: string, kind: SectionKind): number | null {
  const match = new RegExp(`^${kindName(kind)} (\\d+)$`, 'u').exec(
    label.trim(),
  );
  return match ? Number(match[1]) : null;
}

/**
 * The automatic name for a section of `kind` among `others` (the song's other
 * sections): it counts the sections of that kind already there, whatever
 * they are called ("Final chorus" counts as a chorus), and goes past any
 * number already in use, so no two sections share a name.
 */
export function automaticLabel(
  kind: SectionKind,
  others: readonly NamedSection[],
): string {
  const sameKind = others.filter((section) => section.kind === kind);
  const highestInUse = Math.max(
    0,
    ...sameKind.map((section) => automaticNumber(section.label, kind) ?? 0),
  );
  return `${kindName(kind)} ${Math.max(sameKind.length, highestInUse) + 1}`;
}

/**
 * An arrangement's sequence after the song's sections are reordered from
 * `before` to `after` (both lists of section keys). An arrangement that plays
 * every section once, in section order, follows the sections to their new
 * order; any other arrangement (repeats, omissions, its own order) was
 * arranged by the person and is kept as it is.
 */
export function followSectionOrder(
  sequence: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] {
  const followsSections =
    sequence.length === before.length &&
    sequence.every((key, index) => key === before[index]);
  return followsSections ? [...after] : [...sequence];
}
