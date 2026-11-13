import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as Handlebars from 'handlebars';
import { deriveOAuthServerKeys } from '../../common/util/oauth-keys.util';

export type OAuthPageView = 'login' | 'consent' | 'message';

/**
 * Renders the MCP OAuth sign-in and consent pages — the only HTML the API
 * serves — with the headers a credential page needs:
 *
 * - never framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), so no
 *   other site can overlay it to harvest a password or a click;
 * - a per-response CSP nonce for its one style block, and nothing else may
 *   load — no script at all;
 * - `form-action` allowing this origin plus the client's registered redirect
 *   origin: the browser applies `form-action` to the redirect that follows a
 *   form post, and the consent post ends at the client.
 *
 * Handlebars `{{ }}` escapes, so a client name or redirect URI chosen by a
 * self-registered client renders as text, never markup.
 */
@Injectable()
export class OAuthPagesService implements OnModuleInit {
  private readonly appName: string;
  private readonly formTokenKey: Buffer;
  private layout!: HandlebarsTemplateDelegate;
  private readonly views = new Map<OAuthPageView, HandlebarsTemplateDelegate>();

  constructor(configService: ConfigService) {
    this.appName = configService.getOrThrow<string>('serviceName');
    this.formTokenKey = deriveOAuthServerKeys(
      configService.getOrThrow<string>('jwt.secret'),
    ).formTokenKey;
  }

  onModuleInit(): void {
    const directory = path.join(__dirname, 'views');
    const compile = (name: string) =>
      Handlebars.compile(
        fs.readFileSync(path.join(directory, `${name}.hbs`), 'utf8'),
        { strict: false },
      );
    this.layout = compile('layout');
    for (const view of ['login', 'consent', 'message'] as const) {
      this.views.set(view, compile(view));
    }
  }

  render(
    response: Response,
    view: OAuthPageView,
    data: { title: string } & Record<string, unknown>,
    options: { status?: number; redirectUri?: string } = {},
  ): void {
    const nonce = randomBytes(16).toString('base64');
    const context = { ...data, appName: this.appName, nonce };
    const content = this.views.get(view)!(context);
    const html = this.layout({ ...context, content });

    const formActions = ["'self'"];
    if (options.redirectUri && URL.canParse(options.redirectUri)) {
      formActions.push(new URL(options.redirectUri).origin);
    }
    const directives = [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      "script-src 'none'",
      "frame-src 'none'",
      "connect-src 'none'",
      "img-src 'self'",
      `form-action ${formActions.join(' ')}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ];
    response
      .status(options.status ?? 200)
      .setHeader('Content-Security-Policy', directives.join('; '))
      .setHeader('X-Frame-Options', 'DENY')
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Referrer-Policy', 'no-referrer')
      .type('html')
      .send(html);
  }

  /**
   * The anti-forgery token for one sign-in attempt's forms: an HMAC of its
   * interaction id. A forged cross-site post cannot carry it — it never sees
   * the page — and the provider's SameSite=Lax interaction cookie, which binds
   * the attempt to the browser that started it, is not sent with one either.
   */
  formToken(interactionUid: string): string {
    return createHmac('sha256', this.formTokenKey)
      .update(`mcp-oauth-form:${interactionUid}`)
      .digest('base64url');
  }

  isValidFormToken(interactionUid: string, presented: unknown): boolean {
    if (typeof presented !== 'string') return false;
    const expected = Buffer.from(this.formToken(interactionUid));
    const actual = Buffer.from(presented);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
