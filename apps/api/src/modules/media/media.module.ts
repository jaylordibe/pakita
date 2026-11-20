import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SyncModule } from '../sync/sync.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [SyncModule, FilesModule],
  controllers: [MediaController],
  providers: [MediaService],
  // Themes check that a background video is usable inside their own writes.
  exports: [MediaService],
})
export class MediaModule {}
