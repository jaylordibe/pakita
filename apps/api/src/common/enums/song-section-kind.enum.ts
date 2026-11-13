// What a block of a song's lyrics is. The operator sees the section's label
// ("Verse 2"); the kind lets the desktop app group and colour sections. A new
// kind needs no migration (the column is plain text).
export enum SongSectionKind {
  VERSE = 'verse',
  CHORUS = 'chorus',
  BRIDGE = 'bridge',
  INTRO = 'intro',
  OUTRO = 'outro',
  CUSTOM = 'custom',
}
