import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceInvitationDto {
  /**
   * The email or username of the account to invite. Pakita has no public
   * sign-up, so the person must already have an account (an administrator
   * creates it).
   */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  identifier!: string;

  @IsUUID()
  roleId!: string;
}
