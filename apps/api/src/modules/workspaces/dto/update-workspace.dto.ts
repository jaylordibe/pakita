import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateWorkspaceDto } from './create-workspace.dto';

// `@nestjs/swagger`'s mapped types, not `@nestjs/mapped-types` — the latter
// makes the inherited DTO render empty in /api/docs. The owner is not a
// profile field: it changes through `PUT /workspaces/:id/owner`.
export class UpdateWorkspaceDto extends PartialType(
  OmitType(CreateWorkspaceDto, ['ownerEmail'] as const),
) {}
