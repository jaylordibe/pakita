import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateUserDto } from '../../../users/dto/create-user.dto';

// A new person's account, created by a workspace's owner or admins, and the
// role they join with. The account fields are exactly `POST /users`'s.
export class CreateWorkspaceAccountDto extends CreateUserDto {
  /**
   * The workspace role the new account joins with. Bounded like adding a
   * member: at or below the creator's own rank, and only `workspace_staff`
   * without role-assignment authority (`ROLE_NOT_ASSIGNABLE`).
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}
