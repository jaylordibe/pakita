import { createMongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { describe, expect, it } from 'vitest';

import { capabilitiesOf, NO_CAPABILITIES } from './permissions';

// Rules packed as the API packs them (users.service.ts: packRules).
const packed = (rules: Parameters<typeof createMongoAbility>[0]) =>
  packRules(createMongoAbility(rules).rules);

describe('capabilitiesOf', () => {
  it('allows the platform administrator everything (manage all)', () => {
    expect(
      capabilitiesOf(packed([{ action: 'manage', subject: 'all' }]), 'w1'),
    ).toEqual({
      canImportBibles: true,
      canManageAccounts: true,
      canInviteMembers: true,
    });
  });

  it('lets a church owner invite to their church only', () => {
    const rules = packed([
      { action: 'read', subject: 'BibleTranslation' },
      {
        action: 'create',
        subject: 'WorkspaceInvitation',
        conditions: { workspaceId: 'w1' },
      },
    ]);
    expect(capabilitiesOf(rules, 'w1')).toEqual({
      canImportBibles: false,
      canManageAccounts: false,
      canInviteMembers: true,
    });
    expect(capabilitiesOf(rules, 'w2').canInviteMembers).toBe(false);
    expect(capabilitiesOf(rules, null).canInviteMembers).toBe(false);
  });

  it('needs both creating accounts and setting passwords to manage accounts', () => {
    const createOnly = packed([
      { action: 'read', subject: 'User' },
      { action: 'create', subject: 'User' },
    ]);
    expect(capabilitiesOf(createOnly, null).canManageAccounts).toBe(false);
    const both = packed([
      { action: 'read', subject: 'User' },
      { action: 'create', subject: 'User' },
      { action: 'resetPassword', subject: 'User' },
    ]);
    expect(capabilitiesOf(both, null).canManageAccounts).toBe(true);
  });

  it('refuses everything when there are no rules', () => {
    expect(capabilitiesOf([], 'w1')).toEqual(NO_CAPABILITIES);
  });
});
