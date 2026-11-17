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
 * The song's sections in the order `sequence` (an arrangement's section keys)
 * first sings them, then any it does not sing, in their existing order. Each
 * section appears once, however often it is sung.
 */
export function sectionsInSungOrder<Section extends { readonly key: string }>(
  sections: readonly Section[],
  sequence: readonly string[],
): Section[] {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const ordered = new Map<string, Section>();
  for (const key of sequence) {
    const section = byKey.get(key);
    if (section) ordered.set(key, section);
  }
  for (const section of sections) {
    if (!ordered.has(section.key)) ordered.set(section.key, section);
  }
  return [...ordered.values()];
}
