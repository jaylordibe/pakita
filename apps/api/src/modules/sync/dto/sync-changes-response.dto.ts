import { PlaylistResponseDto } from '../../playlists/dto/playlist-response.dto';
import { SongResponseDto } from '../../songs/dto/song-response.dto';
import { ThemeResponseDto } from '../../themes/dto/theme-response.dto';

export class SyncedSongDto {
  id!: string;
  syncVersion!: number;
  /** A deletion: remove the song locally. `song` is then null. */
  isDeleted!: boolean;
  song!: SongResponseDto | null;
}

export class SyncedThemeDto {
  id!: string;
  syncVersion!: number;
  /** A deletion: remove the theme locally. `theme` is then null. */
  isDeleted!: boolean;
  theme!: ThemeResponseDto | null;
}

export class SyncedPlaylistDto {
  id!: string;
  syncVersion!: number;
  /** A deletion: remove the playlist locally. `playlist` is then null. */
  isDeleted!: boolean;
  playlist!: PlaylistResponseDto | null;
}

/**
 * One page of a workspace's changes, oldest first. A page holds at most
 * `limit` changes in all, across songs, themes and playlists; every change
 * has its own version, so `nextCursor` never splits one.
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
  themes!: SyncedThemeDto[];
  playlists!: SyncedPlaylistDto[];
}
