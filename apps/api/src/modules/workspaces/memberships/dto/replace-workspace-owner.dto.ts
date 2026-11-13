import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ReplaceWorkspaceOwnerDto {
  /**
   * The email of the existing account that becomes the workspace's sole owner.
   * It must be an ordinary account (`PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE`).
   * Every current owner becomes `workspace_admin`.
   */
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;
}
