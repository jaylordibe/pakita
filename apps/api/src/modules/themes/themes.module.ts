import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';

@Module({
  imports: [SyncModule],
  controllers: [ThemesController],
  providers: [ThemesService],
})
export class ThemesModule {}
