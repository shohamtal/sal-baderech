/**
 * Who may act on whose account.
 *
 * Kept pure and separate from the request handler so it can be unit-tested:
 * this is the only thing standing between an organization manager and a
 * password reset on someone else's account.
 */
export type AdminActionName = 'set_password' | 'update_email' | 'delete_user';

export interface Actor {
  userId: string;
  isPlatformAdmin: boolean;
  /** Organizations this account manages. */
  orgIds: string[];
}

export interface Decision {
  allowed: boolean;
  /** Machine-readable reason, surfaced to the client as an error code. */
  reason?: 'FORBIDDEN' | 'CANNOT_DELETE_SELF';
}

const DENY: Decision = { allowed: false, reason: 'FORBIDDEN' };

export function authorizeAction(caller: Actor, target: Actor, action: AdminActionName): Decision {
  // Nobody may delete the account they are signed in with, admin or not.
  if (action === 'delete_user' && caller.userId === target.userId) {
    return { allowed: false, reason: 'CANNOT_DELETE_SELF' };
  }

  if (caller.isPlatformAdmin) return { allowed: true };

  // From here on the caller is an organization manager at most.
  if (!caller.orgIds.length) return DENY;

  // A manager must never be able to seize a platform admin's account, which
  // would otherwise be possible whenever an admin also manages an organization.
  if (target.isPlatformAdmin) return DENY;

  // Only accounts that manage organizations are reachable here; volunteers are
  // edited through admin_update_volunteer, under RLS.
  if (!target.orgIds.length) return DENY;

  // Containment, not overlap. Resetting the password of someone who also
  // manages an organization the caller does not would hand over that tenant.
  const callerOrgs = new Set(caller.orgIds);
  if (!target.orgIds.every((id) => callerOrgs.has(id))) return DENY;

  // Removing accounts stays with the platform admin.
  if (action === 'delete_user') return DENY;

  return { allowed: true };
}
