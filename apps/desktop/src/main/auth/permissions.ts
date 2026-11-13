import { createMongoAbility } from '@casl/ability';
import { type PackRule, unpackRules } from '@casl/ability/extra';

// What the signed-in person may do, rebuilt from the packed CASL rules of
// `GET /api/users/me/permissions` exactly as the API documents
// (apps/api/src/common/authorization/README.md, "Client-side ability sync").
// It only decides what the interface offers: the server checks every request.

type PackedRules = readonly (readonly unknown[])[];

/** Whether these rules let the person import (create) a Bible translation. */
export function canImportBibles(rules: PackedRules): boolean {
  const ability = createMongoAbility(
    unpackRules(rules as unknown as PackRule<never>[]),
  );
  return ability.can('create', 'BibleTranslation');
}
