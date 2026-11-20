import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SyncModule } from '../sync/sync.module';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';

@Module({
  imports: [SyncModule, MediaModule],
  controllers: [ThemesController],
  providers: [ThemesService],
})
export class ThemesModule {}
