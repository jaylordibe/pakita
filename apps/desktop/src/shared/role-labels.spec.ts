import { describe, expect, it } from 'vitest';

import { affiliationLabel, roleLabel } from './role-labels';

const church = (name: string, roleName: string, isSuspended = false) => ({
  id: name,
  name,
  roleName,
  isSuspended,
});

describe('roleLabel', () => {
  it('drops the church prefix and keeps the platform one', () => {
    expect(roleLabel('workspace_staff')).toBe('staff');
    expect(roleLabel('platform_admin')).toBe('platform admin');
    expect(roleLabel('platform_technical_support')).toBe(
      'platform technical support',
    );
  });
});

describe('affiliationLabel', () => {
  it('names the platform roles of a platform account', () => {
    expect(
      affiliationLabel({
        platformRoles: ['platform_admin', 'platform_engineer'],
        churches: [],
      }),
    ).toBe('platform admin, platform engineer');
  });

  it('names the first church and its role, and counts the rest', () => {
    expect(
      affiliationLabel({
        platformRoles: [],
        churches: [church('Grace Church', 'workspace_owner')],
      }),
    ).toBe('Grace Church · owner');
    expect(
      affiliationLabel({
        platformRoles: [],
        churches: [
          church('Grace Church', 'workspace_staff', true),
          church('Hope Church', 'workspace_admin'),
          church('Zion Church', 'workspace_owner'),
        ],
      }),
    ).toBe('Grace Church · staff, suspended +2 more');
  });

  it('says when an account belongs to nothing yet', () => {
    expect(affiliationLabel({ platformRoles: [], churches: [] })).toBe(
      'No church',
    );
  });
});
