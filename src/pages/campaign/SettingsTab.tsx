import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { campaignStatusHint, campaignStatusLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CampaignStatus } from '@/lib/types';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent } from 'react';
import { useCampaign } from './CampaignArea';

export default function SettingsTab() {
  const { campaign, org, reload } = useCampaign();
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [city, setCity] = useState(campaign.city ?? '');
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);
  const [maxBaskets, setMaxBaskets] = useState(campaign.max_baskets_per_volunteer?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // The organization link is permanent and always points at the published
  // campaign, so it is what managers should share.
  const publicUrl = `${window.location.origin}${window.location.pathname}#/${encodeURIComponent(org.slug)}/home`;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error } = await supabase
      .from('campaigns')
      .update({
        name, description: description || null, city: city || null, status,
        max_baskets_per_volunteer: maxBaskets ? parseInt(maxBaskets, 10) : null,
      })
      .eq('id', campaign.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setSaved(true);
    reload();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('העתיקו את הקישור:', publicUrl);
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`שלום! להרשמה להתנדבות בחלוקת סלי מזון — ${campaign.name}:\n${publicUrl}`)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 font-bold">קישור ציבורי להרשמת מתנדבים</h2>
        <p className="mb-3 text-sm text-slate-500">
          זהו הקישור הקבוע של הארגון, והוא מוביל תמיד לקמפיין המפורסם. שתפו אותו בוואטסאפ או הדפיסו את ה-QR.
          הקישור מאפשר הרשמה בלבד — מתנדבים לא יראו כתובות עד שתאשרו אותם.
        </p>
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <QRCodeSVG value={publicUrl} size={180} />
          </div>
          <Input readOnly dir="ltr" value={publicUrl} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
          <div className="flex w-full gap-2">
            <Button variant="secondary" className="flex-1" onClick={copy}>{copied ? 'הועתק ✓' : 'העתקת קישור'}</Button>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-[#25D366] px-4 font-semibold text-white hover:opacity-90">
              שיתוף בוואטסאפ
            </a>
          </div>
        </div>
        {campaign.status !== 'PUBLISHED' && (
          <Alert kind="warning" className="mt-3">
            הקמפיין במצב "{campaignStatusLabel[campaign.status]}" — הקישור לא יציג אותו. שנו את הסטטוס ל"פורסם".
          </Alert>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold">הגדרות קמפיין</h2>
        <form onSubmit={save} className="space-y-3">
          <Field label="שם"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="תיאור (מוצג בדף ההרשמה)"><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="עיר ברירת מחדל"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="סטטוס" hint={campaignStatusHint[status]}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)}>
              {(Object.keys(campaignStatusLabel) as CampaignStatus[]).map((s) => <option key={s} value={s}>{campaignStatusLabel[s]}</option>)}
            </Select>
          </Field>
          <Field label="מקסימום סלים פעילים למתנדב (ריק = ללא מגבלה)">
            <Input type="number" min={1} max={100} inputMode="numeric" value={maxBaskets} onChange={(e) => setMaxBaskets(e.target.value)} />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          {saved && <Alert kind="success">נשמר</Alert>}
          <Button type="submit" className="w-full" loading={busy}>שמירה</Button>
        </form>
      </Card>
    </div>
  );
}
