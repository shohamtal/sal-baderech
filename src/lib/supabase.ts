import { createClient } from '@supabase/supabase-js';

// Note: an unset GitHub Actions secret becomes an EMPTY STRING at build time, not
// undefined, so `??` is not enough here — empty values must fall back too, otherwise
// createClient() throws at module load and the app white-screens before it can render
// the configuration-error screen.
const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const SUPABASE_URL = rawUrl;
export const SUPABASE_ANON_KEY = rawKey;

/** False when either value is missing/blank; App renders a setup screen instead. */
export const isSupabaseConfigured = Boolean(rawUrl && rawKey);

// Placeholders keep createClient() from throwing when unconfigured. They are never
// reached: App short-circuits to the setup screen when isSupabaseConfigured is false.
// The anon/publishable key is public by design; every sensitive rule is enforced by RLS.
export const supabase = createClient(
  rawUrl || 'http://127.0.0.1:54321',
  rawKey || 'unconfigured-placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);
