import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type { Playlist, PlaylistItem } from '@prisma/client';
import {
  BIBLE_BOOK_CODES,
  type BibleBookCode,
} from '../../../common/constants/bible-books';
import { PlaylistItemKind } from '../../../common/enums/playlist-item-kind.enum';

export type PlaylistWithItems = Playlist & { items: PlaylistItem[] };

export class PlaylistItemResponseDto {
  id!: string;
  position!: number;
  @ApiProperty({ enum: PlaylistItemKind, enumName: 'PlaylistItemKind' })
  kind!: PlaylistItemKind;
  songId!: string | null;
  arrangementName!: string | null;
  bibleTranslationId!: string | null;
  @ApiProperty({
    enum: BIBLE_BOOK_CODES,
    enumName: 'BibleBookCode',
    nullable: true,
  })
  bookCode!: BibleBookCode | null;
  startChapter!: number | null;
  startVerse!: number | null;
  endChapter!: number | null;
  endVerse!: number | null;

  constructor(row: PlaylistItem) {
    this.id = row.id;
    this.position = row.position;
    this.kind = row.kind as PlaylistItemKind;
    this.songId = row.songId;
    this.arrangementName = row.arrangementName;
    this.bibleTranslationId = row.bibleTranslationId;
    this.bookCode = row.bookCode as BibleBookCode | null;
    this.startChapter = row.startChapter;
    this.startVerse = row.startVerse;
    this.endChapter = row.endChapter;
    this.endVerse = row.endVerse;
  }
}

export class PlaylistResponseDto {
  id!: string;
  workspaceId!: string;
  name!: string;
  /** `YYYY-MM-DD`, or null. */
  serviceDate!: string | null;
  themeId!: string | null;
  /** The workspace sync version of the playlist's latest change. */
  syncVersion!: number;
  createdAt!: Date;
  updatedAt!: Date;
  items!: PlaylistItemResponseDto[];

  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;
  @ApiHideProperty() @Exclude() deletedAt!: Date | null;
  @ApiHideProperty() @Exclude() deletedBy!: string | null;

  constructor(row: PlaylistWithItems) {
    const { items, serviceDate, ...playlist } = row;
    Object.assign(this, playlist);
    // A date-only column: Prisma returns UTC midnight of that day.
    this.serviceDate = serviceDate
      ? serviceDate.toISOString().slice(0, 10)
      : null;
    this.items = [...items]
      .sort((first, second) => first.position - second.position)
      .map((playlistItem) => new PlaylistItemResponseDto(playlistItem));
  }
}
