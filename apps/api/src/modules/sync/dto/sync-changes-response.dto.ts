import { SongResponseDto } from '../../songs/dto/song-response.dto';

export class SyncedSongDto {
  id!: string;
  syncVersion!: number;
  /** A deletion: remove the song locally. `song` is then null. */
  isDeleted!: boolean;
  song!: SongResponseDto | null;
}

/**
 * One page of a workspace's changes, oldest first.
 *
 * The desktop keeps `epoch` and `nextCursor`. When `epoch` differs from the
 * one it kept, or its cursor is above `latestVersion`, the server's history
 * was replaced (a backup was restored): it must discard its copy and
 * resynchronise from cursor 0.
 */
export class SyncChangesResponseDto {
  epoch!: string;
  latestVersion!: number;
  /** Pass as `cursor` to fetch the next page. */
  nextCursor!: number;
  hasMore!: boolean;
  songs!: SyncedSongDto[];
}
