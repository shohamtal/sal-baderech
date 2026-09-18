import { supabase } from '@/lib/supabase';
import type { MyContext } from '@/lib/types';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface AuthState {
  session: Session | null;
  /** True until the initial session + context are resolved. */
  loading: boolean;
  ctx: MyContext | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Ensure there is *some* session (creates an anonymous one for volunteers). */
  ensureSession: () => Promise<Session>;
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchContext(): Promise<MyContext> {
  const { data, error } = await supabase.rpc('get_my_context');
  if (error) throw error;
  return data as MyContext;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<MyContext | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Always resolve the session before asking for the caller's roles.
   *
   * Calling the RPC straight from the auth event raced the client's own session
   * update, and the request went out with no Authorization header at all. The
   * 401 then fell through to the "authenticated but no roles" branch, which
   * bounces a manager back to the home page on an otherwise successful login.
   */
  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (!data.session) {
      setCtx(null);
      return;
    }
    try {
      setCtx(await fetchContext());
    } catch {
      // One retry: the token may still have been settling.
      try {
        setCtx(await fetchContext());
      } catch {
        setCtx({ authenticated: true });
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().finally(() => !cancelled && setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') setCtx(null);
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Defer: Supabase warns against awaiting other supabase calls inside this
        // callback. refresh() re-reads the session first, so the RPC always
        // carries a token.
        setTimeout(() => void refresh(), 0);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setCtx(null);
    window.location.hash = '#/';
  }, []);

  const ensureSession = useCallback(async (): Promise<Session> => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    if (!anon.session) throw new Error('NOT_AUTHENTICATED');
    setSession(anon.session);
    return anon.session;
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, loading, ctx, refresh, signOut, ensureSession }),
    [session, loading, ctx, refresh, signOut, ensureSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
