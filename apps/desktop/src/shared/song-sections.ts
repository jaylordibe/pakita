import type { SongInput } from './ipc-contract';

// A song section's name follows its kind until the person names it
// themselves: a new section is "Verse 1", "Chorus 1", "Verse 2"…; changing a
// section's kind renames it only while it still has such a name.

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

/** Whether `label` is the automatic name of a section of this kind. */
export function isAutomaticLabel(label: string, kind: SectionKind): boolean {
  return automaticNumber(label, kind) !== null;
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
