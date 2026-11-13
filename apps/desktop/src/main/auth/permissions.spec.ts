import { createMongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { describe, expect, it } from 'vitest';

import { canImportBibles } from './permissions';

// Rules packed as the API packs them (users.service.ts: packRules).
const packed = (rules: Parameters<typeof createMongoAbility>[0]) =>
  packRules(createMongoAbility(rules).rules);

describe('canImportBibles', () => {
  it('allows the platform administrator (manage all)', () => {
    expect(
      canImportBibles(packed([{ action: 'manage', subject: 'all' }])),
    ).toBe(true);
  });

  it('refuses a church member, who may only read translations', () => {
    const rules = packed([
      { action: 'read', subject: 'BibleTranslation' },
      { action: 'manage', subject: 'Song', conditions: { workspaceId: 'w1' } },
    ]);
    expect(canImportBibles(rules)).toBe(false);
  });

  it('refuses when there are no rules', () => {
    expect(canImportBibles([])).toBe(false);
  });
});
