import type { SongInput } from './ipc-contract';

// A section is named after its kind ("Verse", "Chorus") until the person
// types a name of their own. There is no number: the editor shows each
// section's place in the order, and a long verse may span several sections.

export type SectionKind = SongInput['sections'][number]['kind'];

/** "verse" → "Verse": a section's name until the person gives it one. */
export function kindName(kind: SectionKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A section's name after its kind changes: a name that is still just the old
 * kind's (or empty) follows the new kind; a name the person typed is kept.
 */
export function nameForKind(
  label: string,
  from: SectionKind,
  to: SectionKind,
): string {
  const name = label.trim();
  return name === '' || name === kindName(from) ? kindName(to) : label;
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
