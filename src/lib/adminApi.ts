import { supabase, SUPABASE_URL } from './supabase';

/**
 * Account actions that need the service-role key run in the `admin-users` Edge
 * Function. The browser only ever sends the caller's own token; the function
 * re-checks who they are before touching anything.
 */
type AdminAction =
  | { action: 'set_password'; user_id: string; password: string }
  | { action: 'update_email'; user_id: string; email: string }
  | { action: 'delete_user'; user_id: string }
  /** Housekeeping: removes sign-ups that never produced a volunteer profile. */
  | { action: 'purge_abandoned' };

export async function callAdminUsers(payload: AdminAction): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('NOT_AUTHENTICATED');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
}

/** Readable, reasonably strong, and easy to dictate over the phone. */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
