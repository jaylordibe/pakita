import { LoginResponseDto } from './login-response.dto';

// `POST /auth/login`'s answer: the session, plus a device token for this
// device's later sign-ins.
export class PasswordSignInResponseDto extends LoginResponseDto {
  /**
   * Keep it with this device and send it in `deviceTokens` at the next
   * sign-in: a device the account has signed in from is not locked out by
   * someone else's failed guesses. Not a credential on its own — the password
   * is still checked — and replaced by every sign-in.
   */
  declare deviceToken: string;
}
