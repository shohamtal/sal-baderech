import { DeliveryMap, MapLegend } from '@/components/DeliveryMap';
import { DeliveryStatusBadge, deliveryStatusHex } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageSpinner, Select, Textarea } from '@/components/ui';
import { addressLine, fullName } from '@/lib/format';
import { deliveryFieldLabel, deliveryStatusLabel, errorMessage } from '@/lib/labels';
import { googleMapsUrl, wazeUrl } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { DELIVERY_FIELDS, type Delivery, type DeliveryField } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useMemo, useState } from 'react';

/** The volunteer's own baskets: navigate, deliver, or report a failed attempt. */
export default function TasksTab({ campaignId, campaignCity }: { campaignId: string; campaignCity: string | null }) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const { data, error } = await supabase
      .from('deliveries').select('*').eq('campaign_id', campaignId).order('street').order('house_number');
    if (error) throw error;
    return data as Delivery[];
  }, [campaignId]);

  const active = useMemo(() => (data ?? []).filter((d) => d.status === 'RESERVED' || d.status === 'IN_PROGRESS'), [data]);
  const done = useMemo(() => (data ?? []).filter((d) => d.status === 'DELIVERED'), [data]);
  const failed = useMemo(() => (data ?? []).filter((d) => d.status === 'UNDELIVERABLE'), [data]);

  if (loading) return <PageSpinner />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;

  const total = (data ?? []).length;
  if (total === 0) {
    return <EmptyState title="עדיין לא לקחת כתובות" description="עברו ללשונית ״בחירת כתובות״ כדי לקבל מקבץ." />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-brand-700 p-4 text-white shadow">
        <div className="text-sm opacity-80">המשימות שלי</div>
        <div className="text-3xl font-bold tabular-nums">
          {done.length} / {total} <span className="text-base font-normal">נמסרו</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/30">
          <div className="h-full bg-white transition-all" style={{ width: `${(done.length / total) * 100}%` }} />
        </div>
        {failed.length > 0 && <div className="mt-2 text-sm opacity-90">{failed.length} דווחו כלא נמסרו</div>}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex gap-2">
        {(['list', 'map'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={clsx('flex-1 rounded-xl py-2 text-sm font-semibold',
              view === v ? 'bg-brand-100 text-brand-800' : 'bg-white ring-1 ring-slate-200')}>
            {v === 'list' ? 'רשימה' : 'מפה'}
          </button>
        ))}
      </div>

      {view === 'map' && (
        <div className="space-y-2">
          <DeliveryMap
            points={(data ?? [])
              .filter((d) => d.latitude != null && d.longitude != null)
              .map((d) => ({
                id: d.id, latitude: d.latitude!, longitude: d.longitude!,
                color: deliveryStatusHex[d.status],
                popup: (
                  <div className="text-sm">
                    <div className="font-bold">{fullName(d)}</div>
                    <div>{addressLine(d, campaignCity)}</div>
                    <div className="text-slate-500">{deliveryStatusLabel[d.status]}</div>
                  </div>
                ),
              }))}
          />
          <MapLegend items={(['RESERVED', 'IN_PROGRESS', 'DELIVERED', 'UNDELIVERABLE'] as const)
            .map((s) => ({ color: deliveryStatusHex[s], label: deliveryStatusLabel[s] }))} />
        </div>
      )}

      <div className="space-y-3">
        {active.map((d) => <TaskCard key={d.id} d={d} city={campaignCity} onChanged={reload} onError={setError} />)}

        {failed.length > 0 && (
          <details open>
            <summary className="cursor-pointer py-2 font-semibold text-slate-600">לא נמסרו ({failed.length})</summary>
            <div className="space-y-3 pt-2">
              {failed.map((d) => <TaskCard key={d.id} d={d} city={campaignCity} onChanged={reload} onError={setError} />)}
            </div>
          </details>
        )}

        {done.length > 0 && (
          <details open={active.length === 0}>
            <summary className="cursor-pointer py-2 font-semibold text-slate-600">נמסרו ({done.length})</summary>
            <div className="space-y-3 pt-2">
              {done.map((d) => <TaskCard key={d.id} d={d} city={campaignCity} onChanged={reload} onError={setError} />)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function TaskCard({ d, city, onChanged, onError }: {
  d: Delivery; city: string | null; onChanged: () => void; onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [correction, setCorrection] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const address = addressLine(d, city);
  const target = { latitude: d.latitude, longitude: d.longitude, address };
  const closed = d.status === 'DELIVERED' || d.status === 'UNDELIVERABLE';

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    onError(null);
    try { await fn(); onChanged(); } catch (e) { onError(errorMessage(e)); } finally { setBusy(null); }
  }

  function navigate() {
    if (d.status === 'RESERVED') supabase.rpc('start_delivery', { p_delivery_id: d.id }).then(() => onChanged());
    window.open(wazeUrl(target), '_blank', 'noopener');
  }

  return (
    <Card className={clsx(closed && 'opacity-75')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{fullName(d)}</div>
          <div className="text-xl font-semibold text-slate-800">{d.street} {d.house_number}</div>
          {d.neighborhood && <div className="text-sm text-slate-500">{d.neighborhood}</div>}
        </div>
        <DeliveryStatusBadge status={d.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-base">
        {d.apartment && <Detail label="דירה" value={d.apartment} />}
        {d.floor && <Detail label="קומה" value={d.floor} />}
        {d.entrance && <Detail label="כניסה" value={d.entrance} />}
        {d.building_code && <Detail label="קוד" value={d.building_code} mono />}
        {d.household_size != null && <Detail label="נפשות" value={String(d.household_size)} />}
        {(d.phone || d.phone2) && (
          <div className="col-span-2 flex flex-wrap gap-2">
            <dt className="text-slate-500">טלפון:</dt>
            {[d.phone, d.phone2].filter(Boolean).map((t) => (
              <dd key={t as string}>
                <a href={`tel:${t}`} className="font-semibold text-brand-700 underline" dir="ltr">{t}</a>
              </dd>
            ))}
          </div>
        )}
      </dl>
      {d.notes && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">📝 {d.notes}</div>}
      {d.undeliverable_reason && (
        <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
          דווח כלא נמסר: {d.undeliverable_reason}
        </div>
      )}

      {!closed && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button size="lg" variant="plain" className="col-span-2 bg-[#33ccff] text-slate-900 hover:bg-[#1ab8f0]" onClick={navigate}>
            🚗 ניווט עם Waze
          </Button>
          <Button size="lg" variant="success" className="col-span-2" loading={busy === 'delivered'}
            onClick={() => run('delivered', async () => {
              const { error } = await supabase.rpc('mark_delivered', { p_delivery_id: d.id });
              if (error) throw error;
            })}>
            ✅ נמסר
          </Button>
          <Button variant="secondary" size="sm" className="col-span-2" onClick={() => setFailOpen(true)}>
            ⚠️ לא הצלחתי למסור
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCorrection(true)}>✏️ דיווח תיקון</Button>
          <Button variant="secondary" size="sm" loading={busy === 'release'}
            onClick={() => {
              if (!confirm('לשחרר את הכתובת בחזרה למאגר? מתנדב אחר יוכל לקחת אותה.')) return;
              run('release', async () => {
                const { error } = await supabase.rpc('release_delivery', { p_delivery_id: d.id });
                if (error) throw error;
              });
            }}>
            ↩️ שחרור
          </Button>
          <a href={googleMapsUrl(target)} target="_blank" rel="noopener noreferrer"
            className="col-span-2 text-center text-xs text-slate-500 underline">
            Waze לא נפתח? ניווט עם Google Maps
          </a>
        </div>
      )}

      {closed && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setCorrection(true)}>✏️ דיווח תיקון</Button>
        </div>
      )}

      <UndeliverableModal open={failOpen} onClose={() => setFailOpen(false)} delivery={d}
        onDone={() => { setFailOpen(false); onChanged(); }} />
      <CorrectionModal open={correction} onClose={() => setCorrection(false)} d={d}
        onSubmitted={() => { setCorrection(false); onChanged(); }} />
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

const REASONS = [
  'לא נמצא אף אחד בבית',
  'לא הצלחתי להשיג בטלפון',
  'הכתובת לא קיימת או שגויה',
  'אין גישה לבניין',
  'המשפחה סירבה לקבל',
  'אחר',
];

/** Reporting a failed attempt freezes the address so nobody repeats the trip. */
function UndeliverableModal({ open, onClose, delivery, onDone }: {
  open: boolean; onClose: () => void; delivery: Delivery; onDone: () => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const text = [reason, detail.trim()].filter(Boolean).join(' — ');
    const { error } = await supabase.rpc('mark_undeliverable', { p_delivery_id: delivery.id, p_reason: text });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onDone();
  }

  return (
    <Modal open={open} onClose={onClose} title="לא הצלחתי למסור">
      <p className="mb-4 text-sm text-slate-500">
        הכתובת תוקפא ותישאר רשומה עליך, כדי שמתנדב אחר לא ייסע אליה שוב. רכז הארגון יחליט מה לעשות הלאה.
      </p>
      <div className="space-y-4">
        <Field label="הסיבה">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="פרטים נוספים (לא חובה)">
          <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="למשל: דפקתי פעמיים, השכן אמר שהם בחו״ל" />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button className="w-full" size="lg" loading={busy} onClick={submit}>דיווח</Button>
      </div>
    </Modal>
  );
}

function CorrectionModal({ open, onClose, d, onSubmitted }: {
  open: boolean; onClose: () => void; d: Delivery; onSubmitted: () => void;
}) {
  const [field, setField] = useState<DeliveryField>('apartment');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('submit_correction', {
      p_delivery_id: d.id, p_field_name: field, p_proposed_value: value, p_comment: comment,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setOk(true);
    setTimeout(() => { setOk(false); setValue(''); setComment(''); onSubmitted(); }, 900);
  }

  const current = (d as unknown as Record<string, string | null>)[field] ?? '';
  return (
    <Modal open={open} onClose={onClose} title="דיווח על תיקון">
      <p className="mb-4 text-sm text-slate-500">התיקון יישלח לרכז לאישור. הנתונים לא ישתנו עד שיאושר.</p>
      <div className="space-y-4">
        <Field label="שדה">
          <Select value={field} onChange={(e) => setField(e.target.value as DeliveryField)}>
            {DELIVERY_FIELDS.map((f) => <option key={f} value={f}>{deliveryFieldLabel[f]}</option>)}
          </Select>
        </Field>
        <Field label="ערך נוכחי"><Input value={current} disabled /></Field>
        <Field label="ערך מוצע"><Input value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="הערה"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {error && <Alert kind="error">{error}</Alert>}
        {ok && <Alert kind="success">הבקשה נשלחה</Alert>}
        <Button className="w-full" size="lg" loading={busy} onClick={submit} disabled={!value && !comment}>שליחת בקשה</Button>
      </div>
    </Modal>
  );
}
