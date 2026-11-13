import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Lowercase, digits, and single hyphens; must start and end alphanumeric.
// Mirrors the shape of a URL path segment so a workspace can be addressed by
// slug without escaping.
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(WORKSPACE_SLUG_PATTERN, {
    message:
      'slug must be lowercase alphanumeric words separated by single hyphens',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * The email of the existing account that will own the workspace. It must be
   * an ordinary account: a platform account never belongs to a workspace
   * (`PLATFORM_ACCOUNT_CANNOT_JOIN_WORKSPACE`). An unknown email is
   * `RESOURCE_NOT_FOUND`. The creator does not become a member.
   */
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  ownerEmail!: string;
}
