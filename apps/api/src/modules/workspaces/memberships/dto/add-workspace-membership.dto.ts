import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Adds someone who ALREADY has an account; an unknown email is a 404, never a
// silently created account. A new person's account is created deliberately,
// with a first password, by a workspace's owner or admins
// (`POST /workspaces/:workspaceId/accounts`), or the person is invited
// (`POST /workspaces/:workspaceId/invitations`).
export class AddWorkspaceMembershipDto {
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsUUID()
  roleId!: string;

  // Staff annotation, applied at creation. Silently ignored unless the caller
  // may `update` the membership — enforced in the service, not here, because
  // the DTO cannot see the ability.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
