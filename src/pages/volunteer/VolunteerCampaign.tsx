import { AppShell } from '@/components/Layout';
import { DeliveryMap, MapLegend } from '@/components/DeliveryMap';
import { DeliveryStatusBadge, VolunteerStatusBadge, deliveryStatusHex } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, LinkButton, Modal, PageSpinner, Select, Textarea, Input } from '@/components/ui';
import { addressLine, fullName } from '@/lib/format';
import { deliveryFieldLabel, deliveryStatusLabel, errorMessage } from '@/lib/labels';
import { googleMapsUrl, wazeUrl } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { DELIVERY_FIELDS, type Campaign, type CampaignVolunteer, type Delivery, type DeliveryField } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function VolunteerCampaign() {
  const { campaignId = '' } = useParams();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [{ data: campaign, error: e1 }, { data: cv, error: e2 }] = await Promise.all([
      supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle(),
      supabase.from('campaign_volunteers').select('*').eq('campaign_id', campaignId).maybeSingle(),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    let deliveries: Delivery[] = [];
    if ((cv as CampaignVolunteer | null)?.status === 'APPROVED') {
      // RLS returns only deliveries claimed by this volunteer.
      const { data: d, error: e3 } = await supabase
        .from('deliveries')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('street')
        .order('house_number');
      if (e3) throw e3;
      deliveries = d as Delivery[];
    }
    return { campaign: campaign as Campaign | null, cv: cv as CampaignVolunteer | null, deliveries };
  }, [campaignId]);

  const active = useMemo(
    () => (data?.deliveries ?? []).filter((d) => d.status === 'RESERVED' || d.status === 'IN_PROGRESS'),
    [data],
  );
  const delivered = useMemo(() => (data?.deliveries ?? []).filter((d) => d.status === 'DELIVERED'), [data]);

  if (loading) return <AppShell title="טוען..." back="/v"><PageSpinner /></AppShell>;
  if (error) return <AppShell title="שגיאה" back="/v"><Alert kind="error">{errorMessage(error)}</Alert></AppShell>;
  if (!data?.campaign || !data.cv) {
    return (
      <AppShell title="קמפיין" back="/v">
        <EmptyState title="אין לך גישה לקמפיין זה" description="ייתכן שעדיין לא נרשמת או שההרשמה לא אושרה." />
      </AppShell>
    );
  }

  const { campaign, cv } = data;

  if (cv.status !== 'APPROVED') {
    return (
      <AppShell title={campaign.name} back="/v">
        <Card className="space-y-3 text-center">
          <VolunteerStatusBadge status={cv.status} />
          {cv.status === 'PENDING' && <p className="text-slate-600">ההרשמה ממתינה לאישור מנהל הקמפיין. נסו שוב מאוחר יותר.</p>}
          {cv.status === 'REJECTED' && <p className="text-slate-600">ההרשמה לקמפיין זה לא אושרה.</p>}
          {cv.status === 'REVOKED' && <p className="text-slate-600">ההרשאה שלך לקמפיין זה בוטלה.</p>}
          <Button variant="secondary" onClick={reload}>בדיקה מחדש</Button>
        </Card>
      </AppShell>
    );
  }

  const campaignActive = campaign.status === 'OPEN' || campaign.status === 'IN_PROGRESS';
  const total = active.length + delivered.length;

  return (
    <AppShell title={campaign.name} back="/v">
      <div className="mb-4 rounded-2xl bg-brand-700 p-4 text-white shadow">
        <div className="text-sm opacity-80">המשלוחים שלי</div>
        <div className="text-3xl font-bold tabular-nums">
          {delivered.length} / {total} <span className="text-base font-normal">נמסרו</span>
        </div>
        {total > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/30">
            <div className="h-full bg-white" style={{ width: `${(delivered.length / total) * 100}%` }} />
          </div>
        )}
      </div>

      {campaignActive ? (
        <LinkButton to={`/v/${campaignId}/request`} size="lg" className="mb-4 w-full">
          🧺 {total === 0 ? 'קבלת סלים לחלוקה' : 'קבלת סלים נוספים'}
        </LinkButton>
      ) : (
        <Alert kind="warning" className="mb-4">הקמפיין אינו פעיל כעת.</Alert>
      )}

      {actionError && <Alert kind="error" className="mb-4">{actionError}</Alert>}

      {total > 0 && (
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setView('list')} className={clsx('flex-1 rounded-xl py-2 text-sm font-semibold', view === 'list' ? 'bg-brand-100 text-brand-800' : 'bg-white ring-1 ring-slate-200')}>
            רשימה
          </button>
          <button type="button" onClick={() => setView('map')} className={clsx('flex-1 rounded-xl py-2 text-sm font-semibold', view === 'map' ? 'bg-brand-100 text-brand-800' : 'bg-white ring-1 ring-slate-200')}>
            מפה
          </button>
        </div>
      )}

      {view === 'map' && total > 0 && (
        <div className="mb-4 space-y-2">
          <DeliveryMap
            points={data.deliveries
              .filter((d) => d.latitude != null && d.longitude != null)
              .map((d) => ({
                id: d.id,
                latitude: d.latitude!,
                longitude: d.longitude!,
                color: deliveryStatusHex[d.status],
                popup: (
                  <div className="text-sm">
                    <div className="font-bold">{fullName(d)}</div>
                    <div>{addressLine(d, campaign.city)}</div>
                    <div className="text-slate-500">{deliveryStatusLabel[d.status]}</div>
                  </div>
                ),
              }))}
          />
          <MapLegend items={(['RESERVED', 'IN_PROGRESS', 'DELIVERED'] as const).map((s) => ({ color: deliveryStatusHex[s], label: deliveryStatusLabel[s] }))} />
          {data.deliveries.some((d) => d.latitude == null) && (
            <div className="text-xs text-slate-500">חלק מהמשלוחים ללא מיקום במפה — השתמשו בניווט לפי כתובת.</div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {active.map((d) => (
          <DeliveryCard key={d.id} d={d} campaign={campaign} onChanged={reload} onError={setActionError} />
        ))}
        {delivered.length > 0 && (
          <details className="mt-4" open={active.length === 0}>
            <summary className="cursor-pointer py-2 font-semibold text-slate-600">נמסרו ({delivered.length})</summary>
            <div className="space-y-3 pt-2">
              {delivered.map((d) => (
                <DeliveryCard key={d.id} d={d} campaign={campaign} onChanged={reload} onError={setActionError} />
              ))}
            </div>
          </details>
        )}
        {total === 0 && <EmptyState title="עדיין אין לך משלוחים" description="לחצו על הכפתור למעלה כדי לבחור כמה סלים לחלק." />}
      </div>
    </AppShell>
  );
}

function DeliveryCard({ d, campaign, onChanged, onError }: { d: Delivery; campaign: Campaign; onChanged: () => void; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const address = addressLine(d, campaign.city);
  const navTarget = { latitude: d.latitude, longitude: d.longitude, address };
  const done = d.status === 'DELIVERED';

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    onError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function navigate() {
    // Opening navigation marks the basket as IN_PROGRESS (idempotent).
    if (d.status === 'RESERVED') {
      supabase.rpc('start_delivery', { p_delivery_id: d.id }).then(() => onChanged());
    }
    window.open(wazeUrl(navTarget), '_blank', 'noopener');
  }

  return (
    <Card className={clsx(done && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{fullName(d)}</div>
          <div className="text-xl font-semibold text-slate-800">{d.street} {d.house_number}</div>
          {d.city && d.city !== campaign.city && <div className="text-sm text-slate-500">{d.city}</div>}
        </div>
        <DeliveryStatusBadge status={d.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-base">
        {d.apartment && <Detail label="דירה" value={d.apartment} />}
        {d.floor && <Detail label="קומה" value={d.floor} />}
        {d.entrance && <Detail label="כניסה" value={d.entrance} />}
        {d.building_code && <Detail label="קוד" value={d.building_code} mono />}
        {d.phone && (
          <div className="col-span-2 flex gap-2">
            <dt className="text-slate-500">טלפון:</dt>
            <dd><a href={`tel:${d.phone}`} className="font-semibold text-brand-700 underline" dir="ltr">{d.phone}</a></dd>
          </div>
        )}
      </dl>
      {d.notes && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">📝 {d.notes}</div>}

      {!done && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button size="lg" variant="plain" className="col-span-2 bg-[#33ccff] text-slate-900 hover:bg-[#1ab8f0]" onClick={navigate}>
            🚗 ניווט עם Waze
          </Button>
          <Button size="lg" variant="success" className="col-span-2" loading={busy === 'delivered'}
            onClick={() => run('delivered', async () => { const { error } = await supabase.rpc('mark_delivered', { p_delivery_id: d.id }); if (error) throw error; })}>
            ✅ נמסר
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCorrectionOpen(true)}>✏️ דיווח תיקון</Button>
          <Button variant="secondary" size="sm" loading={busy === 'release'}
            onClick={() => { if (confirm('לשחרר את המשלוח הזה בחזרה למאגר?')) run('release', async () => { const { error } = await supabase.rpc('release_delivery', { p_delivery_id: d.id }); if (error) throw error; }); }}>
            ↩️ שחרור
          </Button>
          <a href={googleMapsUrl(navTarget)} target="_blank" rel="noopener noreferrer" className="col-span-2 text-center text-xs text-slate-500 underline">
            Waze לא נפתח? ניווט עם Google Maps
          </a>
        </div>
      )}
      {done && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setCorrectionOpen(true)}>✏️ דיווח תיקון</Button>
        </div>
      )}
      <CorrectionModal open={correctionOpen} onClose={() => setCorrectionOpen(false)} d={d} onSubmitted={() => { setCorrectionOpen(false); onChanged(); }} />
    </Card>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{label}:</dt>
      <dd className={clsx('font-semibold', mono && 'font-mono tracking-wider')} dir={mono ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}

function CorrectionModal({ open, onClose, d, onSubmitted }: { open: boolean; onClose: () => void; d: Delivery; onSubmitted: () => void }) {
  const [field, setField] = useState<DeliveryField>('apartment');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.rpc('submit_correction', {
        p_delivery_id: d.id, p_field_name: field, p_proposed_value: value, p_comment: comment,
      });
      if (error) throw error;
      setOk(true);
      setTimeout(() => { setOk(false); setValue(''); setComment(''); onSubmitted(); }, 900);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const current = (d as unknown as Record<string, string | null>)[field] ?? '';

  return (
    <Modal open={open} onClose={onClose} title="דיווח על תיקון">
      <p className="mb-4 text-sm text-slate-500">התיקון יישלח למנהל הקמפיין לאישור. הנתונים לא ישתנו עד לאישור.</p>
      <div className="space-y-4">
        <Field label="שדה">
          <Select value={field} onChange={(e) => setField(e.target.value as DeliveryField)}>
            {DELIVERY_FIELDS.map((f) => <option key={f} value={f}>{deliveryFieldLabel[f]}</option>)}
          </Select>
        </Field>
        <Field label="ערך נוכחי">
          <Input value={current} disabled />
        </Field>
        <Field label="ערך מוצע">
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="הערה">
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="למשל: המשפחה אמרה שהדירה היא 5" />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        {ok && <Alert kind="success">הבקשה נשלחה</Alert>}
        <Button className="w-full" size="lg" loading={busy} onClick={submit} disabled={!value && !comment}>שליחת בקשה</Button>
      </div>
    </Modal>
  );
}
