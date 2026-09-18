import { AppShell } from '@/components/Layout';
import { Alert, Badge, Button, Card, Field, Input, LinkButton, PageSpinner, Textarea } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Organization, OrganizationManager } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

export default function AdminOrganization() {
  const { orgId = '' } = useParams();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const [{ data: org, error: e1 }, { data: managers, error: e2 }] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('organization_managers').select('*').eq('organization_id', orgId).order('email'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { org: org as Organization | null, managers: managers as OrganizationManager[] };
  }, [orgId]);

  async function addManager(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('organization_managers').insert({ organization_id: orgId, email: email.trim().toLowerCase() });
    if (error) return setError(errorMessage(error));
    setEmail('');
    reload();
  }

  async function removeManager(m: OrganizationManager) {
    if (!confirm(`להסיר את ${m.email} מניהול הארגון?`)) return;
    const { error } = await supabase.from('organization_managers').delete().eq('id', m.id);
    if (error) return setError(errorMessage(error));
    reload();
  }

  async function toggleActive() {
    if (!data?.org) return;
    const next = !data.org.active;
    if (!next && !confirm('להשבית את הארגון? קישורי הקמפיינים והרשמת מתנדבים יופסקו.')) return;
    const { error } = await supabase.from('organizations').update({ active: next }).eq('id', orgId);
    if (error) return setError(errorMessage(error));
    reload();
  }

  if (loading) return <AppShell title="ארגון" back="/admin"><PageSpinner /></AppShell>;
  if (loadError) return <AppShell title="ארגון" back="/admin"><Alert kind="error">{errorMessage(loadError)}</Alert></AppShell>;
  if (!data?.org) return <AppShell title="ארגון" back="/admin"><Alert kind="error">הארגון לא נמצא.</Alert></AppShell>;
  const { org, managers } = data;

  return (
    <AppShell title={org.name} back="/admin" wide actions={<Badge color={org.active ? 'green' : 'red'}>{org.active ? 'פעיל' : 'לא פעיל'}</Badge>}>
      {error && <Alert kind="error" className="mb-3">{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <OrgForm org={org} onSaved={reload} />
        <div className="space-y-4">
          <Card>
            <h2 className="mb-1 font-bold">מנהלי הארגון</h2>
            <p className="mb-2 text-sm text-slate-500">רק מי שמופיע כאן יכול להיכנס ולנהל את הארגון.</p>
            <ul className="mb-3 space-y-2 text-sm">
              {managers.length === 0 && <li className="text-slate-500">אין מנהלים עדיין.</li>}
              {managers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span dir="ltr">{m.email}</span>
                  <span className="flex items-center gap-2">
                    <Badge color={m.user_id ? 'green' : 'amber'}>{m.user_id ? 'מחובר' : 'ממתין להרשמה'}</Badge>
                    <button type="button" className="text-xs text-red-600 underline" onClick={() => removeManager(m)}>הסרה</button>
                  </span>
                </li>
              ))}
            </ul>
            <form onSubmit={addManager} className="flex gap-2">
              <Input type="email" dir="ltr" required placeholder="manager@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" size="sm">הוספה</Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">המנהל נרשם בדף הכניסה עם אימייל זה. ההרשאה נקשרת אוטומטית לאחר אישור האימייל.</p>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">קמפיינים</div>
              <div className="text-sm text-slate-500">צפייה וניהול הקמפיינים של הארגון</div>
            </div>
            <LinkButton to={`/org/${org.id}`} variant="secondary" size="sm">לקמפיינים</LinkButton>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">{org.active ? 'השבתת הארגון' : 'הפעלת הארגון'}</div>
              <div className="text-sm text-slate-500">ארגון לא פעיל: הקישורים הציבוריים מפסיקים לעבוד.</div>
            </div>
            <Button variant={org.active ? 'danger' : 'success'} size="sm" onClick={toggleActive}>{org.active ? 'השבתה' : 'הפעלה'}</Button>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function OrgForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [v, setV] = useState({
    name: org.name, description: org.description ?? '', city: org.city ?? '', address: org.address ?? '',
    contact_name: org.contact_name ?? '', contact_phone: org.contact_phone ?? '', contact_email: org.contact_email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const payload = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim() === '' ? null : val.trim()]));
    const { error } = await supabase.from('organizations').update(payload).eq('id', org.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setSaved(true);
    onSaved();
  }

  return (
    <Card>
      <h2 className="mb-3 font-bold">פרטי הארגון</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="שם"><Input required value={v.name} onChange={set('name')} /></Field>
        <Field label="תיאור"><Textarea rows={2} value={v.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="עיר"><Input value={v.city} onChange={set('city')} /></Field>
          <Field label="כתובת"><Input value={v.address} onChange={set('address')} /></Field>
          <Field label="איש קשר"><Input value={v.contact_name} onChange={set('contact_name')} /></Field>
          <Field label="טלפון"><Input type="tel" dir="ltr" value={v.contact_phone} onChange={set('contact_phone')} /></Field>
        </div>
        <Field
          label="אימייל ליצירת קשר"
          hint="פרטי קשר בלבד. כדי לתת הרשאת ניהול יש להוסיף את האימייל ברשימת מנהלי הארגון."
        >
          <Input type="email" dir="ltr" value={v.contact_email} onChange={set('contact_email')} />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="success">נשמר</Alert>}
        <Button type="submit" className="w-full" loading={busy}>שמירה</Button>
      </form>
    </Card>
  );
}
