import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AppAbility } from '../../../common/authorization/app-ability';
import { CurrentAbility } from '../../../common/decorators/current-ability.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { WorkspaceMembershipsService } from './workspace-memberships.service';
import { CreateWorkspaceAccountDto } from './dto/create-workspace-account.dto';
import { WorkspaceMembershipResponseDto } from './dto/workspace-membership-response.dto';

// Accounts a workspace's owner or admins create for their own people. Each
// joins the workspace in the same step; the response is that membership.
@ApiTags('Workspace Memberships')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/accounts')
export class WorkspaceAccountsController {
  constructor(private readonly service: WorkspaceMembershipsService) {}

  @Post()
  @RequirePermission('createAccount', 'WorkspaceMembership')
  // Hashes a password (bcrypt cost 12), like `POST /users`.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiCreatedResponse({ type: WorkspaceMembershipResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateWorkspaceAccountDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceMembershipResponseDto> {
    return new WorkspaceMembershipResponseDto(
      await this.service.createAccount(workspaceId, dto, ability, user.id),
    );
  }
}
