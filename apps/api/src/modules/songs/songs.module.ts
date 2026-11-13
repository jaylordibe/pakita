import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';

@Module({
  imports: [SyncModule],
  controllers: [SongsController],
  providers: [SongsService],
})
export class SongsModule {}
