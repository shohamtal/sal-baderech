import { Alert, Button, Field, Input, Modal } from '@/components/ui';
import { callAdminUsers, generatePassword } from '@/lib/adminApi';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { useState } from 'react';

export interface EditableUser {
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  volunteer_id: string | null;
  /** Anonymous accounts have no password to reset. */
  is_anonymous?: boolean;
}

/**
 * Edit one account. Contact details go straight to the table under RLS;
 * anything touching the auth account goes through the Edge Function.
 */
export function UserActionsModal({
  user, open, onClose, onChanged, allowDelete,
}: {
  user: EditableUser | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  allowDelete?: boolean;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  if (!user) return null;
  const id = `${user.user_id ?? ''}|${user.volunteer_id ?? ''}`;
  if (key !== id) {
    setKey(id);
    setName(user.full_name ?? '');
    setPhone(user.phone ?? '');
    setEmail(user.email ?? '');
    setPassword('');
    setError(null);
    setDone(null);
  }

  async function run(label: string, fn: () => Promise<void>, message: string) {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const hasAuthAccount = Boolean(user.user_id);
  const canHavePassword = hasAuthAccount && !user.is_anonymous;

  return (
    <Modal open={open} onClose={onClose} title="ניהול משתמש">
      <div className="space-y-5">
        {user.volunteer_id && (
          <section className="space-y-3">
            <h3 className="font-bold">פרטי קשר</h3>
            <Field label="שם מלא"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="טלפון"><Input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Button
              size="sm"
              loading={busy === 'details'}
              onClick={() => run('details', async () => {
                const { error } = await supabase.rpc('admin_update_volunteer', {
                  p_volunteer_id: user.volunteer_id, p_full_name: name, p_phone: phone,
                });
                if (error) throw error;
              }, 'פרטי הקשר עודכנו')}
            >
              שמירת פרטים
            </Button>
          </section>
        )}

        {canHavePassword && (
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <h3 className="font-bold">סיסמה</h3>
            <Field label="סיסמה חדשה" hint="לפחות 8 תווים. מסרו אותה למשתמש ובקשו שישנה אותה.">
              <Input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPassword(generatePassword())}>
                יצירת סיסמה
              </Button>
              <Button
                size="sm"
                disabled={password.length < 8}
                loading={busy === 'password'}
                onClick={() => run('password', () => callAdminUsers({
                  action: 'set_password', user_id: user.user_id!, password,
                }), `הסיסמה עודכנה. מסרו למשתמש: ${password}`)}
              >
                קביעת סיסמה
              </Button>
            </div>
          </section>
        )}

        {canHavePassword && (
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <h3 className="font-bold">כתובת אימייל</h3>
            <Field label="אימייל" hint="שינוי האימייל משנה גם את שם המשתמש לכניסה.">
              <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button
              size="sm" variant="secondary"
              disabled={!email.includes('@') || email === user.email}
              loading={busy === 'email'}
              onClick={() => run('email', () => callAdminUsers({
                action: 'update_email', user_id: user.user_id!, email,
              }), 'כתובת האימייל עודכנה')}
            >
              עדכון אימייל
            </Button>
          </section>
        )}

        {!hasAuthAccount && (
          <Alert kind="info">המשתמש עדיין לא נרשם למערכת, ולכן אין חשבון לנהל. ההזמנה ממתינה.</Alert>
        )}

        {allowDelete && hasAuthAccount && (
          <section className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="font-bold text-red-700">מחיקת חשבון</h3>
            <p className="text-sm text-slate-500">המחיקה אינה הפיכה. משלוחים שנמסרו יישארו רשומים.</p>
            <Button
              size="sm" variant="danger"
              loading={busy === 'delete'}
              onClick={() => {
                if (!confirm('למחוק את החשבון לצמיתות?')) return;
                run('delete', async () => {
                  await callAdminUsers({ action: 'delete_user', user_id: user.user_id! });
                  onClose();
                }, 'החשבון נמחק');
              }}
            >
              מחיקה
            </Button>
          </section>
        )}

        {error && <Alert kind="error">{error}</Alert>}
        {done && <Alert kind="success" className="whitespace-pre-wrap break-all">{done}</Alert>}
      </div>
    </Modal>
  );
}
