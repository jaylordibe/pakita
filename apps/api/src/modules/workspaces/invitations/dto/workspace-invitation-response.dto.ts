import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { WorkspaceInvitationStatus } from '../../../../common/enums/workspace-invitation-status.enum';

export class WorkspaceInvitationRoleDto {
  id!: string;
  name!: string;
  rank!: number;
}

/**
 * The invited account, by name only: the inviter typed its email or username
 * and sees whose name it is, but never learns an address it did not supply.
 */
export class WorkspaceInvitationInviteeDto {
  id!: string;
  firstName!: string;
  lastName!: string;
}

export interface WorkspaceInvitationRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  workspaceId: string;
  invitedUserId: string | null;
  roleId: string;
  tokenHash: string;
  status: string;
  invitedBy: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  role: WorkspaceInvitationRoleDto;
  invitedUser: WorkspaceInvitationInviteeDto | null;
}

export class WorkspaceInvitationResponseDto {
  id!: string;
  createdAt!: Date;
  updatedAt!: Date;
  @ApiHideProperty() @Exclude() createdBy!: string | null;
  @ApiHideProperty() @Exclude() updatedBy!: string | null;

  // The digest of a live credential. `@Exclude()` keeps it out of the JSON and
  // `@ApiHideProperty()` keeps it out of the schema — class-transformer and the
  // Swagger plugin are independent layers, so both are required. Publishing it
  // would let anyone who can list invitations mount an offline search for the
  // token: SHA-256 over a known 43-character alphabet is not a slow hash.
  @ApiHideProperty() @Exclude() tokenHash!: string;

  workspaceId!: string;
  /** Null only on history whose account has since been removed. */
  invitedUserId!: string | null;
  roleId!: string;
  status!: WorkspaceInvitationStatus;
  invitedBy!: string | null;
  expiresAt!: Date;
  acceptedAt!: Date | null;
  acceptedBy!: string | null;
  revokedAt!: Date | null;
  revokedBy!: string | null;
  role!: WorkspaceInvitationRoleDto;
  /** Null only on history whose account has since been removed. */
  invitedUser!: WorkspaceInvitationInviteeDto | null;

  constructor(row: WorkspaceInvitationRow) {
    const { status, ...rest } = row;
    Object.assign(this, rest);
    this.status = status as WorkspaceInvitationStatus;
  }
}

/**
 * A new or re-issued invitation, with its one-time code. The code is shown
 * only in this response — the server keeps only its hash — so the inviter
 * copies it here and passes it to the invited person. Only that person's
 * account can redeem it.
 */
export class IssuedWorkspaceInvitationResponseDto extends WorkspaceInvitationResponseDto {
  token!: string;

  constructor(row: WorkspaceInvitationRow, token: string) {
    super(row);
    this.token = token;
  }
}
