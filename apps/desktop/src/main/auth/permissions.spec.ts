import { createMongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { describe, expect, it } from 'vitest';

import { capabilitiesOf, NO_CAPABILITIES } from './permissions';

// Rules packed as the API packs them (users.service.ts: packRules).
const packed = (rules: Parameters<typeof createMongoAbility>[0]) =>
  packRules(createMongoAbility(rules).rules);

describe('capabilitiesOf', () => {
  it('gives the platform administrator the server, and no church', () => {
    // As the API grants it: unconditional platform rules, none on a church.
    const rules = packed([
      { action: 'read', subject: 'Workspace' },
      { action: 'create', subject: 'Workspace' },
      { action: 'read', subject: 'User' },
      { action: 'create', subject: 'User' },
      { action: 'resetPassword', subject: 'User' },
      { action: 'create', subject: 'BibleTranslation' },
    ]);
    expect(capabilitiesOf(rules, 'w1')).toEqual({
      isPlatformAccount: true,
      canImportBibles: true,
      canManageAccounts: true,
      canManageChurches: true,
      canInviteMembers: false,
      canCreateMemberAccounts: false,
    });
  });

  it('counts every platform role, which reads every church, as a platform account', () => {
    const support = packed([
      { action: 'read', subject: 'User' },
      { action: 'read', subject: 'Workspace' },
    ]);
    expect(capabilitiesOf(support, null)).toEqual({
      ...NO_CAPABILITIES,
      isPlatformAccount: true,
    });
  });

  it('lets a church owner invite and create accounts in their church only, and is no platform account', () => {
    const rules = packed([
      { action: 'read', subject: 'BibleTranslation' },
      { action: 'read', subject: 'Workspace', conditions: { id: 'w1' } },
      {
        action: 'create',
        subject: 'WorkspaceInvitation',
        conditions: { workspaceId: 'w1' },
      },
      {
        action: 'createAccount',
        subject: 'WorkspaceMembership',
        conditions: { workspaceId: 'w1' },
      },
    ]);
    expect(capabilitiesOf(rules, 'w1')).toEqual({
      isPlatformAccount: false,
      canImportBibles: false,
      canManageAccounts: false,
      canManageChurches: false,
      canInviteMembers: true,
      canCreateMemberAccounts: true,
    });
    expect(capabilitiesOf(rules, 'w2').canInviteMembers).toBe(false);
    expect(capabilitiesOf(rules, 'w2').canCreateMemberAccounts).toBe(false);
    expect(capabilitiesOf(rules, null).canCreateMemberAccounts).toBe(false);
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
