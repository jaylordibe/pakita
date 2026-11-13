import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AssignPlatformRoleDto } from './dto/assign-platform-role.dto';
import { UserRolesService } from './user-roles.service';

// Granting a platform role is the most privileged action in the system, so it
// gets its own tight throttle on top of the global one.
//
// WORKSPACE roles are never assigned here — they are a `workspace_memberships`
// row. `loadPlatformRole` refuses one on the way in, and `AbilityFactory`
// refuses to compile it on the way out.
@ApiTags('Roles')
@Controller('users/:userId/roles')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class UserRolesController {
  constructor(private readonly userRolesService: UserRolesService) {}

  @Post()
  @RequirePermission('assignRole', 'User', { isAdministrative: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AssignPlatformRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.userRolesService.assign(userId, dto.roleId, currentUser.id);
  }

  @Delete(':roleId')
  @RequirePermission('assignRole', 'User', { isAdministrative: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.userRolesService.revoke(userId, roleId, currentUser.id);
  }
}
