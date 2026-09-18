import { useAuth } from '@/auth/AuthProvider';
import { Alert, Badge, Button, Card, Field, Input, Textarea } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { useState, type FormEvent } from 'react';
import { useOrg } from './OrgAdmin';

/** Organization details. Managers may edit the descriptive fields; the slug and
 *  the active flag stay with the platform admin, since both affect shared links. */
export default function OrgSettingsTab() {
  const { org, reload } = useOrg();
  const { ctx } = useAuth();
  const isPlatformAdmin = Boolean(ctx?.is_platform_admin);
  const [v, setV] = useState({
    name: org.name, description: org.description ?? '', city: org.city ?? '', address: org.address ?? '',
    contact_name: org.contact_name ?? '', contact_phone: org.contact_phone ?? '', contact_email: org.contact_email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error } = await supabase.rpc('org_update_details', {
      p_org_id: org.id, p_name: v.name, p_description: v.description, p_city: v.city, p_address: v.address,
      p_contact_name: v.contact_name, p_contact_phone: v.contact_phone, p_contact_email: v.contact_email,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setSaved(true);
    reload();
  }

  async function toggleActive() {
    const next = !org.active;
    if (!next && !confirm('להשבית את הארגון? הקישור הציבורי והרשמת מתנדבים יופסקו.')) return;
    const { error } = await supabase.from('organizations').update({ active: next }).eq('id', org.id);
    if (error) return setError(errorMessage(error));
    reload();
  }

  const volunteerUrl = `${window.location.origin}${window.location.pathname}#/${encodeURIComponent(org.slug)}/home`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-3 font-bold">פרטי הארגון</h2>
        <form onSubmit={save} className="space-y-3">
          <Field label="שם הארגון"><Input required value={v.name} onChange={set('name')} /></Field>
          <Field label="תיאור"><Textarea rows={2} value={v.description} onChange={set('description')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="עיר"><Input value={v.city} onChange={set('city')} /></Field>
            <Field label="כתובת"><Input value={v.address} onChange={set('address')} /></Field>
            <Field label="איש קשר"><Input value={v.contact_name} onChange={set('contact_name')} /></Field>
            <Field label="טלפון"><Input type="tel" dir="ltr" value={v.contact_phone} onChange={set('contact_phone')} /></Field>
          </div>
          <Field label="אימייל ליצירת קשר" hint="פרטי קשר בלבד. הרשאות ניהול נקבעות בלשונית משתמשים.">
            <Input type="email" dir="ltr" value={v.contact_email} onChange={set('contact_email')} />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          {saved && <Alert kind="success">נשמר</Alert>}
          <Button type="submit" className="w-full" loading={busy}>שמירה</Button>
        </form>
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-bold">קישור למתנדבים</h2>
          <p className="mb-3 text-sm text-slate-500">
            זהו הקישור הקבוע של הארגון. הוא תמיד מוביל לקמפיין המפורסם הנוכחי, ולכן אפשר לשתף אותו פעם אחת ולתמיד.
          </p>
          <Input readOnly dir="ltr" value={volunteerUrl} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(volunteerUrl).catch(() => prompt('העתיקו:', volunteerUrl))}>
              העתקת קישור
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`שלום! להתנדבות בחלוקת סלי מזון של ${org.name}:\n${volunteerUrl}`)}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center rounded-xl bg-[#25D366] px-3 text-sm font-semibold text-white hover:opacity-90"
            >
              שיתוף בוואטסאפ
            </a>
          </div>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold">סטטוס הארגון</div>
            <div className="text-sm text-slate-500">
              {isPlatformAdmin ? 'ארגון לא פעיל: הקישורים הציבוריים מפסיקים לעבוד.' : 'רק מנהל הפלטפורמה יכול לשנות זאת.'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={org.active ? 'green' : 'red'}>{org.active ? 'פעיל' : 'לא פעיל'}</Badge>
            {isPlatformAdmin && (
              <Button variant={org.active ? 'danger' : 'success'} size="sm" onClick={toggleActive}>
                {org.active ? 'השבתה' : 'הפעלה'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
