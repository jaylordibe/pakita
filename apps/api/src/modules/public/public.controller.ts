import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PingResponseDto } from './dto/ping-response.dto';
import { ServerInfoResponseDto } from './dto/server-info-response.dto';
import {
  API_LEVEL,
  MINIMUM_DESKTOP_VERSION,
  SERVER_VERSION,
} from './desktop-compatibility';
import { sendDesktopTurnstilePage } from './desktop-turnstile-page';

// Guest-mode public surface for the web + mobile apps. Routes here are
// open to anonymous traffic. No `@UseGuards(JwtAuthGuard)`.
//
// **Why a dedicated controller** rather than scattering `@Public()` on
// integration controllers: this is the audit-friendly single place where
// "open to anyone on the internet" lives. When a security review asks
// "what does the public API expose?", they read this one file.
//
// **Throttle policy**: a tighter ceiling than the global default applies
// to every route on this controller via the class-level `@Throttle` below.
// One uniform ceiling for the whole guest surface keeps the policy
// auditable — raise/lower the single number to retune everything at once.
// 10 req/min/IP × 60 × 24 = 14,400 max requests/day from one IP, which
// keeps any upstream paid-quota exposure bounded.
//
// **What belongs here**: thin wrappers over upstream integrations or
// public-data endpoints (places autocomplete, weather, public listings,
// contact form, etc.). Anything that mutates user data or reads
// user-specific data should stay behind JwtAuthGuard.
import { Public } from '../../common/decorators/public.decorator';
import { Errors } from '../../common/errors/errors';
import { TurnstileService } from '../../common/turnstile/turnstile.service';
@ApiTags('Public')
@Controller('public')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class PublicController {
  private readonly mobileSiteKey: string | undefined;

  constructor(
    configService: ConfigService,
    private readonly turnstileService: TurnstileService,
  ) {
    this.mobileSiteKey = configService.get<string>('turnstile.mobileSiteKey');
  }

  // Example route — replace with real public endpoints. Demonstrates the
  // pattern: no JwtAuthGuard, inherits the class-level @Throttle, returns
  // a plain JSON shape. Tag in Swagger groups it under "Public" so the
  // docs page makes the boundary obvious to consumers.
  @Get('ping')
  @Public()
  @ApiOkResponse({ type: PingResponseDto })
  ping(): PingResponseDto {
    return { isOk: true, timestamp: new Date().toISOString() };
  }

  /**
   * What Pakita's desktop app checks before anything else: that it reached a
   * Pakita server, whether the two versions are compatible, and whether
   * signing in needs the bot check. Reveals nothing about the server's data.
   */
  @Get('server-info')
  @Public()
  @ApiOkResponse({ type: ServerInfoResponseDto })
  serverInfo(): ServerInfoResponseDto {
    return {
      product: 'pakita',
      serverVersion: SERVER_VERSION,
      apiLevel: API_LEVEL,
      minimumDesktopVersion: MINIMUM_DESKTOP_VERSION,
      isBotCheckRequired: this.turnstileService.isEnabled(),
    };
  }

  /**
   * The Turnstile check Pakita's desktop app shows in its own window before
   * a password sign-in (docs/decisions/0001-desktop-turnstile.md at the
   * workspace root). Renders the app widget; refuses (503) while the bot
   * check is on without TURNSTILE_MOBILE_SITE_KEY.
   */
  @Get('desktop-turnstile')
  @Public()
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'The Turnstile check page' })
  desktopTurnstile(@Res() response: Response): void {
    if (!this.turnstileService.isEnabled()) {
      throw Errors.badRequest('The bot check is off on this server.');
    }
    if (!this.mobileSiteKey) {
      throw Errors.externalServiceUnavailable(
        'Desktop sign-in is not configured on this server (TURNSTILE_MOBILE_SITE_KEY).',
      );
    }
    sendDesktopTurnstilePage(response, this.mobileSiteKey);
  }

  /**
   * Where the check page goes once solved. The desktop app intercepts this
   * navigation and reads the token from the URL fragment, so the page itself
   * only shows when it is opened some other way.
   */
  @Get('desktop-turnstile/done')
  @Public()
  @ApiProduces('text/html')
  @ApiOkResponse({
    description: 'A page telling the person to return to Pakita',
  })
  desktopTurnstileDone(@Res() response: Response): void {
    response
      .status(200)
      .setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'",
      )
      .setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Pakita</title><p>You can return to Pakita.</p></html>',
      );
  }
}
