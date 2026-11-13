import { Module } from '@nestjs/common';
import { BibleTranslationsController } from './bible-translations.controller';
import { BibleTranslationsService } from './bible-translations.service';

@Module({
  controllers: [BibleTranslationsController],
  providers: [BibleTranslationsService],
})
export class BibleModule {}
