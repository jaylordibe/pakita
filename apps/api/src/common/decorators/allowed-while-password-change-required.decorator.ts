import { SetMetadata } from '@nestjs/common';

export const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED_KEY =
  'isAllowedWhilePasswordChangeRequired';

// The routes a session may still call while its account's password is one an
// administrator chose (`User.isPasswordChangeRequired`): changing it, reading
// the account, and signing out. `JwtAuthGuard` refuses every other
// authenticated route with PASSWORD_CHANGE_REQUIRED. Keep this list that
// short: each route here is one a person who never chose their own password
// can use.
export const AllowedWhilePasswordChangeRequired = (): MethodDecorator =>
  SetMetadata(ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, true);
