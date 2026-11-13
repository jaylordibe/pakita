import { IsUUID } from 'class-validator';

export class CopySongDto {
  /** The workspace that receives the copy (another branch, or this one). */
  @IsUUID()
  targetWorkspaceId!: string;
}
