import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { AuthenticatedOnly } from '../../common/decorators/authenticated-only.decorator';
import { CurrentAbility } from '../../common/decorators/current-ability.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AllowedWhilePasswordChangeRequired } from '../../common/decorators/allowed-while-password-change-required.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { GdprEraseDto } from './dto/gdpr-erase.dto';
import { SetProfileImageDto } from './dto/set-profile-image.dto';
import { UpdateAuthUserEmailDto } from './dto/update-auth-user-email.dto';
import { UpdateAuthUserInfoDto } from './dto/update-auth-user-info.dto';
import { UpdateAuthUserPasswordDto } from './dto/update-auth-user-password.dto';
import { UpdateAuthUsernameDto } from './dto/update-auth-username.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListItemResponseDto } from './dto/user-list-item-response.dto';
import type { AppAbility } from '../../common/authorization/app-ability';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UserPermissionsResponseDto } from './dto/user-permissions-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';
import { LoginResponseDto } from '../auth/dto/login-response.dto';
import { readRefreshTokenContext } from '../auth/refresh-token-context';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // `@AuthenticatedOnly()`: the caller is asking what THEY may do. There is no
  // subject to check a permission against — gating this behind a permission
  // would mean inventing one that every role must hold, which gates nothing.
  @Get('me/permissions')
  @AuthenticatedOnly()
  @ApiOkResponse({ type: UserPermissionsResponseDto })
  async getAuthUserPermissions(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<UserPermissionsResponseDto> {
    return this.usersService.getOwnPermissions(currentUser.id, ability);
  }

  @Get('me')
  @RequirePermission('read', 'User')
  @AllowedWhilePasswordChangeRequired()
  @ApiOkResponse({ type: UserResponseDto })
  async getAuthUser(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findById(currentUser.id);
    return this.usersService.toResponse(user);
  }

  @Patch('me')
  @RequirePermission('update', 'User')
  @ApiOkResponse({ type: UserResponseDto })
  async updateAuthUserInfo(
    @Body() dto: UpdateAuthUserInfoDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updateInfo(
      currentUser.id,
      dto,
      currentUser.id,
    );
    return this.usersService.toResponse(user);
  }

  // The picture saves on its own, never with the profile form. Each change
  // releases the picture it replaces, which the cleanup job deletes from
  // storage, so it gets the same ceiling as the upload before it (`POST
  // /files`) — per user (UserAwareThrottlerGuard).
  @Put('me/profile-image')
  @RequirePermission('update', 'User')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: UserResponseDto })
  async setAuthUserProfileImage(
    @Body() dto: SetProfileImageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.setProfileImage(
      currentUser.id,
      dto.fileId,
      currentUser.id,
    );
    return this.usersService.toResponse(user);
  }

  // Answers the person with no picture, whether or not they had one.
  @Delete('me/profile-image')
  @RequirePermission('update', 'User')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: UserResponseDto })
  async removeAuthUserProfileImage(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.setProfileImage(
      currentUser.id,
      null,
      currentUser.id,
    );
    return this.usersService.toResponse(user);
  }

  @Delete('me')
  @RequirePermission('delete', 'User')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAuthUser(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.softDelete(currentUser.id, currentUser.id);
  }

  // Right-to-be-forgotten / GDPR erase. Distinct from DELETE /me (which is
  // "close my account"): this also anonymizes every PII column so the row
  // can stay for FK integrity without carrying identifying data. Requires
  // re-auth via currentPassword to prevent stolen-token erasure.
  @Post('me/gdpr-erase')
  @RequirePermission('delete', 'User')
  // Checks currentPassword: with a stolen access token this is a password
  // oracle, so it gets a 5/60s ceiling — per user,
  // which is what binds a stolen token (UserAwareThrottlerGuard).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async gdprErase(
    @Body() dto: GdprEraseDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.gdprErase(currentUser.id, dto.currentPassword);
  }

  // Minimal GDPR "right to access" — returns the user's full row as JSON.
  // Extend this as new tables are added (bookings, messages, etc.) so the
  // dump stays complete.
  @Get('me/export')
  @RequirePermission('read', 'User')
  @ApiOkResponse({ type: UserResponseDto })
  async exportAuthUser(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findById(currentUser.id);
    return this.usersService.toResponse(user);
  }

  @Patch('me/username')
  @RequirePermission('update', 'User')
  @ApiOkResponse({ type: UserResponseDto })
  async updateAuthUsername(
    @Body() dto: UpdateAuthUsernameDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updateUsername(
      currentUser.id,
      dto.username,
      currentUser.id,
    );
    return this.usersService.toResponse(user);
  }

  // Other sessions end; the caller gets a fresh session in the response and
  // must replace their stored tokens.
  @Patch('me/email')
  @RequirePermission('update', 'User')
  // Checks currentPassword: with a stolen access token this is a password
  // oracle, so it gets a 5/60s ceiling — per user,
  // which is what binds a stolen token (UserAwareThrottlerGuard).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: LoginResponseDto })
  async updateAuthUserEmail(
    @Body() dto: UpdateAuthUserEmailDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    const { user, tokens } = await this.usersService.updateEmail(
      currentUser.id,
      dto,
      readRefreshTokenContext(request),
    );
    return { ...tokens, user: await this.usersService.toResponse(user) };
  }

  // Other sessions end; the caller gets a fresh session in the response and
  // must replace their stored tokens. The one way to replace a password an
  // administrator chose, so it stays open while that change is required.
  @Patch('me/password')
  @RequirePermission('update', 'User')
  @AllowedWhilePasswordChangeRequired()
  // Checks currentPassword: with a stolen access token this is a password
  // oracle, so it gets a 5/60s ceiling — per user, which is what binds a
  // stolen token (UserAwareThrottlerGuard).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: LoginResponseDto })
  async updateAuthUserPassword(
    @Body() dto: UpdateAuthUserPasswordDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    const { user, tokens } = await this.usersService.updateOwnPassword(
      currentUser.id,
      dto,
      readRefreshTokenContext(request),
    );
    return { ...tokens, user: await this.usersService.toResponse(user) };
  }

  // The only way an account comes to exist: there is no public sign-up. The
  // administrator chooses the first password, and the person must replace it
  // at their first sign-in (`isPasswordChangeRequired`).
  @Post()
  @RequirePermission('create', 'User', { isAdministrative: true })
  // Hashes a password (bcrypt cost 12): bounded so a compromised admin
  // token cannot pin the CPU, loose enough for routine administration.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiCreatedResponse({ type: UserResponseDto })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.create(dto, currentUser.id);
    return this.usersService.toResponse(user);
  }

  @Get()
  @RequirePermission('read', 'User', { isAdministrative: true })
  @ApiPaginatedResponse(UserListItemResponseDto)
  async findPaginated(
    @Query() query: UserListQueryDto,
  ): Promise<PaginatedResponseDto<UserListItemResponseDto>> {
    const { data, meta } = await this.usersService.findPaginated(query);
    return {
      data: await this.usersService.toListResponses(data),
      meta,
    };
  }

  @Get(':id')
  @RequirePermission('read', 'User', { isAdministrative: true })
  @ApiOkResponse({ type: UserResponseDto })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findById(id);
    return this.usersService.toResponse(user);
  }

  @Patch(':id')
  @RequirePermission('update', 'User', { isAdministrative: true })
  @ApiOkResponse({ type: UserResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.update(id, dto, currentUser.id);
    return this.usersService.toResponse(user);
  }

  // An administrator's reset for someone who lost their password: their
  // sessions end, and they must choose their own at the next sign-in.
  @Patch(':id/password')
  @RequirePermission('resetPassword', 'User', { isAdministrative: true })
  // Hashes a password (bcrypt cost 12): bounded so a compromised admin
  // token cannot pin the CPU, loose enough for routine administration.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ type: UserResponseDto })
  async updatePassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePasswordDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.updatePasswordAsAdmin(
      id,
      dto.newPassword,
      currentUser.id,
    );
    return this.usersService.toResponse(user);
  }

  @Delete(':id')
  @RequirePermission('delete', 'User', { isAdministrative: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.remove(id, currentUser.id);
  }

  // ── Support operations ─────────────────────────────────────────────────
  // Each carries its OWN permission rather than riding on `update User`, so
  // support can help an account holder without being able to change their
  // email.

  @Post(':id/revoke-sessions')
  @RequirePermission('revokeSession', 'User', { isAdministrative: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.revokeAllSessions(id, currentUser.id);
  }
}
