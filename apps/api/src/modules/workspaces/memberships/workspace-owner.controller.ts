import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { WorkspaceMembershipsService } from './workspace-memberships.service';
import { ReplaceWorkspaceOwnerDto } from './dto/replace-workspace-owner.dto';
import { WorkspaceMembershipResponseDto } from './dto/workspace-membership-response.dto';

// The workspace's owner, as a single resource. `PUT` replaces it: the named
// account becomes the sole owner and every current owner becomes an admin.
// Held by the platform admin (any workspace) and by a workspace's own owner;
// checked against `Workspace`, because the workspace is what changes hands.
@ApiTags('Workspace Memberships')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/owner')
export class WorkspaceOwnerController {
  constructor(private readonly service: WorkspaceMembershipsService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('transferOwnership', 'Workspace')
  @ApiOkResponse({ type: WorkspaceMembershipResponseDto })
  async replace(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: ReplaceWorkspaceOwnerDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMembershipResponseDto> {
    return new WorkspaceMembershipResponseDto(
      await this.service.replaceOwner(workspaceId, dto.email, user.id),
    );
  }
}
