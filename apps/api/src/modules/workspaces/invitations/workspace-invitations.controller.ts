import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AppAbility } from '../../../common/authorization/app-ability';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { CurrentAbility } from '../../../common/decorators/current-ability.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { MetaQueryDto } from '../../../common/dto/meta-query.dto';
import { PaginatedResponseDto } from '../../../common/dto/paginated-response.dto';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import {
  IssuedWorkspaceInvitationResponseDto,
  WorkspaceInvitationResponseDto,
} from './dto/workspace-invitation-response.dto';
import { CreateWorkspaceInvitationDto } from './dto/create-workspace-invitation.dto';

@ApiTags('Workspace Invitations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/invitations')
export class WorkspaceInvitationsController {
  constructor(private readonly service: WorkspaceInvitationsService) {}

  // Answers whether an identifier names an account, so it is held tighter
  // than the global budget.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('create', 'WorkspaceInvitation')
  @ApiCreatedResponse({ type: IssuedWorkspaceInvitationResponseDto })
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateWorkspaceInvitationDto,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IssuedWorkspaceInvitationResponseDto> {
    const { invitation, token } = await this.service.create(
      workspaceId,
      dto,
      ability,
      user.id,
    );
    // The one time the code is shown: the inviter passes it on. Holding it
    // lets the inviter redeem nothing — only the invited account can.
    return new IssuedWorkspaceInvitationResponseDto(invitation, token);
  }

  @Get()
  @RequirePermission('read', 'WorkspaceInvitation', {
    isDeniedAsNotFound: true,
  })
  @ApiPaginatedResponse(WorkspaceInvitationResponseDto)
  async findPaginated(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: MetaQueryDto,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PaginatedResponseDto<WorkspaceInvitationResponseDto>> {
    const { data, meta } = await this.service.findPaginated(
      workspaceId,
      query,
      ability,
    );
    return {
      data: data.map((row) => new WorkspaceInvitationResponseDto(row)),
      meta,
    };
  }

  /**
   * Re-issues a pending invitation on a fresh code, which it returns; the old
   * code stops working.
   *
   * Guarded by `create WorkspaceInvitation`, not `delete`: re-issuing is the
   * same authority as inviting — same person, same role, same workspace — and
   * gating it behind `delete` would leave a manager able to raise an
   * invitation they could not repair when the code was lost.
   *
   * 200, not 201: nothing new comes into existence. The invitation is the same
   * row, carrying a rotated secret.
   */
  @Post(':invitationId/resend')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('create', 'WorkspaceInvitation')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: IssuedWorkspaceInvitationResponseDto })
  async resend(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IssuedWorkspaceInvitationResponseDto> {
    const { invitation, token } = await this.service.resend(
      workspaceId,
      invitationId,
      ability,
      user.id,
    );
    return new IssuedWorkspaceInvitationResponseDto(invitation, token);
  }

  @Delete(':invitationId')
  @RequirePermission('delete', 'WorkspaceInvitation')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.revoke(workspaceId, invitationId, ability, user.id);
  }
}
