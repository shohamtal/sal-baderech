import { describe, expect, it } from 'vitest';
import { authorizeAction, type Actor } from './authorize';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const admin = (id = 'admin'): Actor => ({ userId: id, isPlatformAdmin: true, orgIds: [] });
const manager = (id: string, orgIds: string[]): Actor => ({ userId: id, isPlatformAdmin: false, orgIds });
const volunteer = (id: string): Actor => ({ userId: id, isPlatformAdmin: false, orgIds: [] });

describe('authorizeAction', () => {
  it('lets a platform admin act on anyone', () => {
    expect(authorizeAction(admin(), manager('m', [ORG_A]), 'set_password').allowed).toBe(true);
    expect(authorizeAction(admin(), volunteer('v'), 'update_email').allowed).toBe(true);
    expect(authorizeAction(admin(), manager('m', [ORG_B]), 'delete_user').allowed).toBe(true);
  });

  it('never lets anyone delete the account they are signed in with', () => {
    expect(authorizeAction(admin('same'), admin('same'), 'delete_user')).toEqual({
      allowed: false, reason: 'CANNOT_DELETE_SELF',
    });
    expect(authorizeAction(manager('same', [ORG_A]), manager('same', [ORG_A]), 'delete_user').reason)
      .toBe('CANNOT_DELETE_SELF');
  });

  it('refuses an organization manager acting on a platform admin', () => {
    // The admin also manages ORG_A, which the old overlap check would have allowed.
    const adminWhoAlsoManages: Actor = { userId: 'admin', isPlatformAdmin: true, orgIds: [ORG_A] };
    expect(authorizeAction(manager('m', [ORG_A]), adminWhoAlsoManages, 'set_password').allowed).toBe(false);
    expect(authorizeAction(manager('m', [ORG_A]), adminWhoAlsoManages, 'update_email').allowed).toBe(false);
  });

  it('refuses a target who also manages an organization the caller does not', () => {
    // Overlap on ORG_A is not enough: a reset would hand the caller ORG_B too.
    expect(authorizeAction(manager('m', [ORG_A]), manager('t', [ORG_A, ORG_B]), 'set_password').allowed)
      .toBe(false);
  });

  it('allows a manager to act on a co-manager of exactly their own organizations', () => {
    expect(authorizeAction(manager('m', [ORG_A]), manager('t', [ORG_A]), 'set_password').allowed).toBe(true);
    expect(authorizeAction(manager('m', [ORG_A, ORG_B]), manager('t', [ORG_A]), 'update_email').allowed).toBe(true);
  });

  it('refuses a manager with no organizations, and targets with none', () => {
    expect(authorizeAction(manager('m', []), manager('t', [ORG_A]), 'set_password').allowed).toBe(false);
    // Volunteers are edited through admin_update_volunteer under RLS, not here.
    expect(authorizeAction(manager('m', [ORG_A]), volunteer('v'), 'set_password').allowed).toBe(false);
  });

  it('keeps purging abandoned sign-ups with the platform admin', () => {
    expect(authorizeAction(admin(), admin(), 'purge_abandoned').allowed).toBe(true);
    expect(authorizeAction(manager('m', [ORG_A]), manager('m', [ORG_A]), 'purge_abandoned').allowed).toBe(false);
  });

  it('keeps account deletion with the platform admin', () => {
    expect(authorizeAction(manager('m', [ORG_A]), manager('t', [ORG_A]), 'delete_user').allowed).toBe(false);
  });
});
