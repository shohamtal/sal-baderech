/**
 * Administrative actions on auth accounts.
 *
 * These need the service-role key, which must never reach the browser, so they
 * run here instead. The caller's own JWT is checked first: the key is only ever
 * used after we have established who is asking and what they may touch.
 *
 * Actions: set_password, update_email, delete_user.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  // Who is asking? Evaluated with the caller's own token, under RLS.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: caller, error: callerErr } = await asCaller.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  const { data: ctx, error: ctxErr } = await asCaller.rpc('get_my_context');
  if (ctxErr) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const isPlatformAdmin = Boolean(ctx?.is_platform_admin);
  const managedOrgIds: string[] = ctx?.manager_org_ids ?? [];

  let body: { action?: string; user_id?: string; password?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'INVALID_REQUEST' }, 400);
  }
  const { action, user_id: targetId, password, email } = body;
  if (!action || !targetId) return json({ error: 'INVALID_REQUEST' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // A manager may only act on accounts that manage one of their own
  // organizations; a platform admin may act on anyone.
  if (!isPlatformAdmin) {
    if (!managedOrgIds.length) return json({ error: 'FORBIDDEN' }, 403);
    const { data: rows, error } = await admin
      .from('organization_managers')
      .select('organization_id')
      .eq('user_id', targetId)
      .in('organization_id', managedOrgIds);
    if (error) return json({ error: 'FORBIDDEN' }, 403);
    if (!rows?.length) return json({ error: 'FORBIDDEN' }, 403);
    // Deleting accounts stays with the platform admin.
    if (action === 'delete_user') return json({ error: 'FORBIDDEN' }, 403);
  }

  // Never let an admin lock themselves out by deleting their own account.
  if (action === 'delete_user' && targetId === caller.user.id) {
    return json({ error: 'CANNOT_DELETE_SELF' }, 400);
  }

  if (action === 'set_password') {
    if (!password || password.length < 8) return json({ error: 'WEAK_PASSWORD' }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'update_email') {
    if (!email || !email.includes('@')) return json({ error: 'INVALID_EMAIL' }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetId, {
      email: email.trim().toLowerCase(),
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'delete_user') {
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'UNKNOWN_ACTION' }, 400);
});
