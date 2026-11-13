import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AllowedWhilePasswordChangeRequired } from '../../common/decorators/allowed-while-password-change-required.decorator';
import { AuthenticatedOnly } from '../../common/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ThrottleSignIn } from '../../common/decorators/throttle-sign-in.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PasswordSignInResponseDto } from './dto/password-sign-in-response.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { readRefreshTokenContext } from './refresh-token-context';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Accounts are created by an administrator (`POST /users`); there is no
  // public sign-up. Beyond these throttles, failed sign-ins are also limited
  // per account from every address (`SignInFailureLimitService`).
  @Post('login')
  @Public()
  @ThrottleSignIn()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PasswordSignInResponseDto })
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<PasswordSignInResponseDto> {
    return this.authService.login(dto, readRefreshTokenContext(request));
  }

  /**
   * Exchanges a refresh token for a new access + refresh pair.
   *
   * `@Public()` by necessity: a client arrives here precisely because its
   * access token has expired, so it has no bearer credential to present. The
   * refresh token in the body IS the credential. A legitimate client
   * refreshes once per access-token lifetime, so 10/min per IP is ample.
   */
  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    return this.authService.refresh(
      dto.refreshToken,
      readRefreshTokenContext(request),
    );
  }

  // Ends THIS device's session: blocklists the access token this request
  // arrived on and revokes the refresh chain it belongs to. Other devices stay
  // signed in. The client should also discard both tokens locally.
  //
  // Sending `refreshToken` is optional but strongly recommended — without it
  // only the access token dies, and the refresh token can mint a new one.
  @Post('logout')
  @AuthenticatedOnly()
  @AllowedWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    await this.authService.logout(currentUser, dto.refreshToken);
  }

  // "Sign me out everywhere" — invalidates every active access token via the
  // passwordChangedAt mechanism AND revokes every refresh token the user holds.
  // Use when the user suspects their account is compromised but isn't ready to
  // change their password yet.
  @Post('logout-all')
  @AuthenticatedOnly()
  @AllowedWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.authService.logoutAll(currentUser.id);
  }
}
