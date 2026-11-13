import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED_KEY } from '../../../common/decorators/allowed-while-password-change-required.decorator';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { Errors } from '../../../common/errors/errors';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    // Throws on a missing, invalid or revoked token; `JwtStrategy` has set
    // `request.user` once it returns.
    await super.canActivate(context);

    // Here rather than per route, so a new route is refused by default: an
    // account whose password an administrator chose reaches only the routes
    // marked `@AllowedWhilePasswordChangeRequired()`.
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    if (
      user.isPasswordChangeRequired &&
      !this.reflector.get<boolean>(
        ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED_KEY,
        context.getHandler(),
      )
    ) {
      throw Errors.passwordChangeRequired();
    }
    return true;
  }
}
