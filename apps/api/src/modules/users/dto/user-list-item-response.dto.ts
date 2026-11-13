import { ApiProperty } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { WorkspaceMembershipStatus } from '../../../common/enums/workspace-membership-status.enum';
import { AttachedFileResponseDto } from '../../files/dto/attached-file-response.dto';
import { UserResponseDto } from './user-response.dto';

/** One workspace an account belongs to, as its server's staff see it. */
export class UserListWorkspaceMembershipDto {
  workspaceId!: string;
  workspaceName!: string;
  /** The role's name in that workspace, e.g. `workspace_owner`. */
  roleName!: string;
  /** `active` or `suspended`; a membership the account left is not listed. */
  @ApiProperty({
    enum: [
      WorkspaceMembershipStatus.ACTIVE,
      WorkspaceMembershipStatus.SUSPENDED,
    ],
  })
  status!: WorkspaceMembershipStatus;
}

/**
 * An account in the administrative list (`GET /users`), with what it belongs
 * to: its platform roles, or the workspaces it is a member of. An account
 * holds one or the other, never both (`PlatformAccountPolicy`), so a server's
 * staff can tell the two apart at a glance.
 */
export class UserListItemResponseDto extends UserResponseDto {
  /** Names of the account's platform roles, in name order. */
  @ApiProperty({ type: [String] })
  platformRoles!: string[];

  /**
   * The live workspaces the account is a member of (active or suspended), in
   * workspace name order. A deleted workspace, and a membership the account
   * left, are not listed.
   */
  @ApiProperty({ type: [UserListWorkspaceMembershipDto] })
  workspaceMemberships!: UserListWorkspaceMembershipDto[];

  constructor(
    user: User,
    profileImage: AttachedFileResponseDto | null,
    affiliations: Pick<
      UserListItemResponseDto,
      'platformRoles' | 'workspaceMemberships'
    >,
  ) {
    super(user, profileImage);
    this.platformRoles = affiliations.platformRoles;
    this.workspaceMemberships = affiliations.workspaceMemberships;
  }
}
