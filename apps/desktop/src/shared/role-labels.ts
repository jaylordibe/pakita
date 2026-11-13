import type { ListedAccount } from './ipc-contract';

// How a role, and what an account belongs to, read to a person. One place,
// so the People list and a church's invitations name roles the same way.

/**
 * A role's name as people read it: `workspace_staff` → `staff`,
 * `platform_admin` → `platform admin`. A church role drops its prefix (inside a
 * church every role is the church's); a platform role keeps it, since that is
 * what sets it apart.
 */
export function roleLabel(name: string): string {
  return name.replace(/^workspace_/, '').replace(/_/g, ' ');
}

/**
 * One line saying what an account belongs to, for a list row:
 * `platform admin`, `Grace Church · owner`, `Grace Church · staff +2 more`, or
 * `No church` for an account that belongs to nothing yet.
 */
export function affiliationLabel(
  account: Pick<ListedAccount, 'platformRoles' | 'churches'>,
): string {
  if (account.platformRoles.length > 0) {
    return account.platformRoles.map(roleLabel).join(', ');
  }
  const [first, ...rest] = account.churches;
  if (!first) return 'No church';
  const more = rest.length > 0 ? ` +${rest.length} more` : '';
  return `${churchMembershipLabel(first)}${more}`;
}

/** `Grace Church · owner`, or `Grace Church · staff, suspended`. */
export function churchMembershipLabel(
  church: ListedAccount['churches'][number],
): string {
  const suspended = church.isSuspended ? ', suspended' : '';
  return `${church.name} · ${roleLabel(church.roleName)}${suspended}`;
}
