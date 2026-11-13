import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import type {
  Song,
  SongArrangement,
  SongArrangementItem,
  SongSection,
} from '@prisma/client';
import { SongSectionKind } from '../../../common/enums/song-section-kind.enum';

export type SongWithContent = Song & {
  sections: SongSection[];
  arrangements: Array<SongArrangement & { items: SongArrangementItem[] }>;
};

export class SongSectionResponseDto {
  id!: string;
  kind!: SongSectionKind;
  label!: string;
  lyrics!: string;
  position!: number;

  constructor(row: SongSection) {
    this.id = row.id;
    this.kind = row.kind as SongSectionKind;
    this.label = row.label;
    this.lyrics = row.lyrics;
    this.position = row.position;
  }
}

export class SongArrangementResponseDto {
  id!: string;
  name!: string;
  isDefault!: boolean;
  position!: number;
  /** Section ids in presentation order; an id may repeat. */
  sectionIds!: string[];

  constructor(row: SongArrangement & { items: SongArrangementItem[] }) {
    this.id = row.id;
    this.name = row.name;
    this.isDefault = row.isDefault;
    this.position = row.position;
    this.sectionIds = [...row.items]
      .sort((first, second) => first.position - second.position)
      .map((arrangementItem) => arrangementItem.songSectionId);
  }
}

export class SongResponseDto {
  id!: string;
  workspaceId!: string;
  title!: string;
  artist!: string | null;
  isArchived!: boolean;
  /** The workspace sync version of the song's latest change. */
  syncVersion!: number;
  createdAt!: Date;
  updatedAt!: Date;
  sections!: SongSectionResponseDto[];
  arrangements!: SongArrangementResponseDto[];

  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;
  @ApiHideProperty() @Exclude() deletedAt!: Date | null;
  @ApiHideProperty() @Exclude() deletedBy!: string | null;

  constructor(row: SongWithContent) {
    const { sections, arrangements, ...song } = row;
    Object.assign(this, song);
    this.sections = [...sections]
      .sort((first, second) => first.position - second.position)
      .map((section) => new SongSectionResponseDto(section));
    this.arrangements = [...arrangements]
      .sort((first, second) => first.position - second.position)
      .map((arrangement) => new SongArrangementResponseDto(arrangement));
  }
}
