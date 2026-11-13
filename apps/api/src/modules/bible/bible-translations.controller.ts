import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BIBLE_BOOK_CODES } from '../../common/constants/bible-books';
import type { AppAbility } from '../../common/authorization/app-ability';
import { CurrentAbility } from '../../common/decorators/current-ability.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BibleTranslationsService } from './bible-translations.service';
import {
  BibleContentResponseDto,
  BibleTranslationResponseDto,
} from './dto/bible-translation-response.dto';
import { CreateBibleTranslationDto } from './dto/create-bible-translation.dto';
import { PutBibleChapterDto } from './dto/put-bible-chapter.dto';

// The installation's Bible translations. Every signed-in person reads the
// published ones; importing (create → chapters → publish) and deleting is an
// administrator's job (`manage all`).
@ApiTags('Bible translations')
@ApiBearerAuth()
@Controller('bible-translations')
export class BibleTranslationsController {
  constructor(private readonly service: BibleTranslationsService) {}

  // Deliberately not paginated (an exception to the list rule): an
  // installation holds a handful of translations, and every desktop needs the
  // whole list to know which to download and which to remove.
  @Get()
  @RequirePermission('read', 'BibleTranslation')
  @ApiOkResponse({ type: BibleTranslationResponseDto, isArray: true })
  async findAll(
    @CurrentAbility() ability: AppAbility,
  ): Promise<BibleTranslationResponseDto[]> {
    const rows = await this.service.findAll(ability);
    return rows.map((row) => new BibleTranslationResponseDto(row));
  }

  @Post()
  @RequirePermission('create', 'BibleTranslation', { isAdministrative: true })
  @ApiCreatedResponse({ type: BibleTranslationResponseDto })
  async create(
    @Body() dto: CreateBibleTranslationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BibleTranslationResponseDto> {
    return new BibleTranslationResponseDto(
      await this.service.create(dto, user.id),
    );
  }

  @Put(':translationId/books/:bookCode/chapters/:chapter')
  @RequirePermission('create', 'BibleTranslation', { isAdministrative: true })
  // An import sends every chapter of a Bible (about 1,200) in a row; the
  // global limit would stop it partway. Administrators only.
  @Throttle({ default: { limit: 1_500, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The chapter was stored' })
  @ApiParam({
    name: 'bookCode',
    description: 'A USFM book code; the list is in canonical order.',
    enum: BIBLE_BOOK_CODES,
    enumName: 'BibleBookCode',
  })
  async putChapter(
    @Param('translationId', ParseUUIDPipe) translationId: string,
    @Param('bookCode') bookCode: string,
    @Param('chapter', ParseIntPipe) chapter: number,
    @Body() dto: PutBibleChapterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.putChapter(
      translationId,
      bookCode,
      chapter,
      dto,
      user.id,
    );
  }

  @Post(':translationId/publish')
  @RequirePermission('create', 'BibleTranslation', { isAdministrative: true })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BibleTranslationResponseDto })
  async publish(
    @Param('translationId', ParseUUIDPipe) translationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BibleTranslationResponseDto> {
    return new BibleTranslationResponseDto(
      await this.service.publish(translationId, user.id),
    );
  }

  @Get(':translationId/content')
  @RequirePermission('read', 'BibleTranslation')
  // A whole translation is several megabytes to read and send. A desktop
  // downloads one only when its content hash is new.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: BibleContentResponseDto })
  findContent(
    @Param('translationId', ParseUUIDPipe) translationId: string,
  ): Promise<BibleContentResponseDto> {
    return this.service.findContent(translationId);
  }

  @Delete(':translationId')
  @RequirePermission('delete', 'BibleTranslation', { isAdministrative: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('translationId', ParseUUIDPipe) translationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.remove(translationId, user.id);
  }
}
