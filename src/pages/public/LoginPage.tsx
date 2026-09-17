import { useAuth } from '@/auth/AuthProvider';
import { Alert, Button, Field, Input } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { session, ctx, loading, refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!loading && session && !session.user.is_anonymous && ctx) {
    return <Navigate to="/" replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'login') {
        // If a volunteer anonymous session exists on this device, replace it.
        if (session?.user.is_anonymous) await supabase.auth.signOut();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await refresh();
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        if (data.session) {
          await refresh();
        } else {
          setInfo('נשלח אליך אימייל לאישור. לאחר האישור ניתן להתחבר.');
          setMode('login');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        });
        if (error) throw error;
        setInfo('נשלח אימייל לאיפוס סיסמה.');
        setMode('login');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <Link to="/" className="mb-6 text-center text-4xl">🧺</Link>
      <h1 className="mb-1 text-center text-2xl font-bold">
        {mode === 'login' ? 'כניסת מנהלים' : mode === 'signup' ? 'הרשמת מנהל' : 'איפוס סיסמה'}
      </h1>
      <p className="mb-6 text-center text-sm text-slate-500">
        {mode === 'signup'
          ? 'השתמשו בכתובת האימייל שהוזמנה על ידי מנהל הפלטפורמה.'
          : 'מנהלי ארגונים ומנהלי פלטפורמה בלבד. מתנדבים נכנסים דרך קישור הקמפיין.'}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="אימייל">
          <Input type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== 'reset' && (
          <Field label="סיסמה" hint={mode === 'signup' ? 'לפחות 8 תווים' : undefined}>
            <Input
              type="password"
              dir="ltr"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {info && <Alert kind="success">{info}</Alert>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {mode === 'login' ? 'התחברות' : mode === 'signup' ? 'הרשמה' : 'שליחת קישור איפוס'}
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        {mode !== 'login' && (
          <button type="button" className="text-brand-700 underline" onClick={() => setMode('login')}>
            חזרה להתחברות
          </button>
        )}
        {mode === 'login' && (
          <>
            <button type="button" className="text-brand-700 underline" onClick={() => setMode('signup')}>
              מנהל חדש? הרשמה
            </button>
            <button type="button" className="text-slate-500 underline" onClick={() => setMode('reset')}>
              שכחתי סיסמה
            </button>
          </>
        )}
      </div>
    </div>
  );
}
