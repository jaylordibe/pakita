import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AppAbility } from '../../common/authorization/app-ability';
import { CurrentAbility } from '../../common/decorators/current-ability.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SyncChangesQueryDto } from './dto/sync-changes-query.dto';
import { SyncChangesResponseDto } from './dto/sync-changes-response.dto';
import { SyncService } from './sync.service';

// What desktops pull to keep their offline copy of a workspace. Reading it
// needs the same grant as reading the songs it carries.
@ApiTags('Sync')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('changes')
  @RequirePermission('read', 'Song', { isDeniedAsNotFound: true })
  @ApiOkResponse({ type: SyncChangesResponseDto })
  findChanges(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: SyncChangesQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<SyncChangesResponseDto> {
    return this.syncService.findChanges(workspaceId, query, ability);
  }
}
