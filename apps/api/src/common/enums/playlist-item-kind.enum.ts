// What a playlist entry presents. No migration for a new kind: the column is
// plain text (its fields are checked by `playlist_items_song_or_passage`).
export enum PlaylistItemKind {
  SONG = 'song',
  PASSAGE = 'passage',
}
