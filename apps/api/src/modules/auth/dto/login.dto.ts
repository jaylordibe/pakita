import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsCheckedPassword } from '../../../common/decorators/is-checked-password.decorator';

export class LoginDto {
  // Email address OR username — both are accepted. Usernames can never
  // contain '@' (enforced by CreateUserDto's pattern), so the two namespaces
  // can't collide. Matched case-insensitively (both are stored lowercase).
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsCheckedPassword()
  password!: string;

  /**
   * The `deviceToken`s earlier sign-ins on this device were given, for any
   * accounts (a shared laptop holds several). One for the account signing in
   * marks a device it has used before, which a stranger's failed guesses at
   * the account cannot lock out (`SignInDeviceTokenService`).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  deviceTokens?: string[];
}
