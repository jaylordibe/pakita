import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncVersionService } from './sync-version.service';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncVersionService],
  exports: [SyncVersionService],
})
export class SyncModule {}
