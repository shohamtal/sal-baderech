import { useAuth } from '@/auth/AuthProvider';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

interface Admin { id: string; email: string; user_id: string | null }

export default function OrganizationsTab() {
  const { ctx } = useAuth();
  const [open, setOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const [{ data: orgs, error: e1 }, { data: admins, error: e2 }] = await Promise.all([
      supabase.from('organizations').select('*').order('name'),
      supabase.from('platform_admins').select('id, email, user_id').order('email'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { orgs: orgs as Organization[], admins: admins as Admin[] };
  }, []);

  async function addAdmin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('platform_admins').insert({ email: adminEmail.trim().toLowerCase() });
    if (error) return setError(errorMessage(error));
    setAdminEmail('');
    reload();
  }

  async function removeAdmin(a: Admin) {
    if (!confirm(`להסיר את ${a.email} ממנהלי הפלטפורמה?`)) return;
    const { error } = await supabase.from('platform_admins').delete().eq('id', a.id);
    if (error) return setError(errorMessage(error));
    reload();
  }

  return (
    <>
      {loading && <PageSpinner />}
      {loadError && <Alert kind="error">{errorMessage(loadError)}</Alert>}
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">ארגונים ({data.orgs.length})</h2>
              <Button size="sm" onClick={() => setOpen(true)}>+ ארגון חדש</Button>
            </div>
            {data.orgs.length === 0 && <EmptyState title="אין ארגונים" description="צרו את הארגון הראשון." />}
            <div className="space-y-2">
              {data.orgs.map((o) => (
                <Link key={o.id} to={`/${encodeURIComponent(o.slug)}`} className="block">
                  <Card className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{o.name}</div>
                      <div className="text-sm text-slate-500">{[o.city, o.contact_name, o.contact_phone].filter(Boolean).join(' · ')}</div>
                      <div className="mt-0.5 text-xs text-slate-400" dir="ltr">/{o.slug}</div>
                    </div>
                    <Badge color={o.active ? 'green' : 'red'}>{o.active ? 'פעיל' : 'לא פעיל'}</Badge>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-bold">מנהלי פלטפורמה</h2>
            <Card>
              <ul className="mb-3 space-y-2 text-sm">
                {data.admins.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span dir="ltr">{a.email}</span>
                    <span className="flex items-center gap-2">
                      <Badge color={a.user_id ? 'green' : 'amber'}>{a.user_id ? 'מחובר' : 'ממתין להרשמה'}</Badge>
                      {a.user_id !== ctx?.user_id && <button type="button" className="text-xs text-red-600 underline" onClick={() => removeAdmin(a)}>הסרה</button>}
                    </span>
                  </li>
                ))}
              </ul>
              <form onSubmit={addAdmin} className="flex gap-2">
                <Input type="email" dir="ltr" required placeholder="email@example.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                <Button type="submit" size="sm">הוספה</Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">המנהל החדש יירשם באימייל זה בדף הכניסה, ויקבל הרשאות לאחר אישור האימייל.</p>
            </Card>
          </div>
        </div>
      )}
      <NewOrgModal open={open} onClose={() => setOpen(false)} onCreated={reload} />
    </>
  );
}

function NewOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [v, setV] = useState({ name: '', city: '', contact_name: '', contact_phone: '', contact_email: '', manager_email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: v.name, city: v.city || null, contact_name: v.contact_name || null, contact_phone: v.contact_phone || null, contact_email: v.contact_email || null })
      .select('id')
      .single();
    if (error) { setBusy(false); return setError(errorMessage(error)); }
    if (v.manager_email.trim()) {
      const { error: e2 } = await supabase.from('organization_managers').insert({ organization_id: data.id, email: v.manager_email.trim().toLowerCase() });
      if (e2) { setBusy(false); return setError(errorMessage(e2)); }
    }
    setBusy(false);
    setV({ name: '', city: '', contact_name: '', contact_phone: '', contact_email: '', manager_email: '' });
    onClose();
    onCreated();
  }

  return (
    <Modal open={open} onClose={onClose} title="ארגון חדש">
      <form onSubmit={submit} className="space-y-3">
        <Field label="שם הארגון"><Input required value={v.name} onChange={set('name')} /></Field>
        <Field label="עיר"><Input value={v.city} onChange={set('city')} /></Field>
        <Field label="איש קשר"><Input value={v.contact_name} onChange={set('contact_name')} /></Field>
        <Field label="טלפון"><Input type="tel" dir="ltr" value={v.contact_phone} onChange={set('contact_phone')} /></Field>
        <Field label="אימייל ליצירת קשר" hint="פרטי קשר בלבד — אינו מקנה הרשאות">
          <Input type="email" dir="ltr" value={v.contact_email} onChange={set('contact_email')} />
        </Field>
        <Field
          label="אימייל מנהל הארגון"
          hint="זה השדה שמקנה הרשאת ניהול. המנהל נרשם עם אימייל זה בדף הכניסה."
        >
          <Input type="email" dir="ltr" value={v.manager_email} onChange={set('manager_email')} />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>יצירה</Button>
      </form>
    </Modal>
  );
}
