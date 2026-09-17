import { DeliveryStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageSpinner, Select, Textarea } from '@/components/ui';
import { addressLine, formatDate, fullName } from '@/lib/format';
import { geocodeSequential } from '@/lib/geocode';
import { deliveryFieldLabel, deliveryStatusLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Delivery, DeliveryStatus } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useCampaign } from '../CampaignManage';

type Row = Delivery & { volunteers: { full_name: string; phone: string } | null };

const EMPTY: Partial<Delivery> = {
  first_name: '', last_name: '', street: '', house_number: '', apartment: '', floor: '', entrance: '',
  building_code: '', city: '', notes: '', phone: '', latitude: null, longitude: null,
};

export default function DeliveriesTab() {
  const { campaign } = useCampaign();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [editing, setEditing] = useState<Partial<Delivery> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ done: number; total: number; found: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, volunteers:reserved_by(full_name, phone)')
      .eq('campaign_id', campaign.id)
      .order('street')
      .order('house_number');
    if (error) throw error;
    return data as unknown as Row[];
  }, [campaign.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((d) => {
      if (status !== 'ALL' && d.status !== status) return false;
      if (!term) return true;
      return [d.first_name, d.last_name, d.street, d.house_number, d.city, d.notes, d.phone, d.volunteers?.full_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [data, q, status]);

  async function save(values: Partial<Delivery>) {
    setError(null);
    const clean = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());
    const payload = {
      first_name: clean(values.first_name), last_name: clean(values.last_name),
      street: clean(values.street) ?? '', house_number: clean(values.house_number) ?? '',
      apartment: clean(values.apartment), floor: clean(values.floor), entrance: clean(values.entrance),
      building_code: clean(values.building_code), city: clean(values.city), notes: clean(values.notes), phone: clean(values.phone),
      latitude: values.latitude == null || values.latitude === ('' as unknown) ? null : Number(values.latitude),
      longitude: values.longitude == null || values.longitude === ('' as unknown) ? null : Number(values.longitude),
    };
    if (!payload.street || !payload.house_number) return setError('רחוב ומספר בית הם שדות חובה.');
    if ((payload.latitude == null) !== (payload.longitude == null)) return setError('יש למלא גם קו רוחב וגם קו אורך, או להשאיר את שניהם ריקים.');
    const res = values.id
      ? await supabase.from('deliveries').update(payload).eq('id', values.id)
      : await supabase.from('deliveries').insert({ ...payload, campaign_id: campaign.id });
    if (res.error) return setError(errorMessage(res.error));
    setEditing(null);
    reload();
  }

  async function setDeliveryStatus(d: Row, next: DeliveryStatus) {
    setError(null);
    if (next === 'AVAILABLE') {
      const { error } = await supabase.rpc('manager_release_delivery', { p_delivery_id: d.id });
      if (error) return setError(errorMessage(error));
    } else {
      const { error } = await supabase.from('deliveries').update({ status: next }).eq('id', d.id);
      if (error) return setError(errorMessage(error));
    }
    reload();
  }

  async function remove(d: Row) {
    if (!confirm(`למחוק את המשלוח ל${fullName(d)} (${d.street} ${d.house_number})? הפעולה אינה הפיכה.`)) return;
    const { error } = await supabase.from('deliveries').delete().eq('id', d.id);
    if (error) return setError(errorMessage(error));
    reload();
  }

  async function geocodeMissing() {
    const missing = (data ?? []).filter((d) => d.latitude == null && d.status !== 'CANCELLED');
    if (!missing.length) return;
    if (!confirm(`לחפש מיקום עבור ${missing.length} כתובות דרך OpenStreetMap? (כשנייה לכל כתובת)`)) return;
    abortRef.current = new AbortController();
    setGeo({ done: 0, total: missing.length, found: 0 });
    let found = 0;
    await geocodeSequential(
      missing,
      (d) => `${d.street} ${d.house_number}, ${d.city ?? campaign.city ?? ''}`,
      async (d, r, i) => {
        if (r) {
          found++;
          await supabase.from('deliveries').update({ latitude: r.latitude, longitude: r.longitude }).eq('id', d.id);
        }
        setGeo({ done: i + 1, total: missing.length, found });
      },
      abortRef.current.signal,
    );
    setGeo(null);
    reload();
  }

  if (loading) return <PageSpinner />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;
  const missingCount = (data ?? []).filter((d) => d.latitude == null && d.status !== 'CANCELLED').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="חיפוש לפי שם, רחוב, מתנדב..." value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 min-w-[12rem]" />
        <Select value={status} onChange={(e) => setStatus(e.target.value as DeliveryStatus | 'ALL')} className="w-40">
          <option value="ALL">כל הסטטוסים</option>
          {(Object.keys(deliveryStatusLabel) as DeliveryStatus[]).map((s) => <option key={s} value={s}>{deliveryStatusLabel[s]}</option>)}
        </Select>
        <Button onClick={() => setEditing({ ...EMPTY, city: campaign.city ?? '' })}>+ משלוח</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <span>{filtered.length} מתוך {data?.length ?? 0}</span>
        {missingCount > 0 && !geo && (
          <Button size="sm" variant="secondary" onClick={geocodeMissing}>📍 השלמת מיקומים ({missingCount})</Button>
        )}
        {geo && (
          <span className="inline-flex items-center gap-2">
            מחפש מיקומים… {geo.done}/{geo.total} (נמצאו {geo.found})
            <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>עצירה</Button>
          </span>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {filtered.length === 0 && <EmptyState title="לא נמצאו משלוחים" description={data?.length ? 'נסו לשנות את החיפוש.' : 'ייבאו קובץ נמענים או הוסיפו משלוח ידנית.'} />}

      <div className="space-y-2">
        {filtered.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold">{fullName(d)}</div>
                <div className="text-slate-700">
                  {addressLine(d, campaign.city)}
                  {d.apartment && ` · דירה ${d.apartment}`}
                  {d.floor && ` · קומה ${d.floor}`}
                  {d.entrance && ` · כניסה ${d.entrance}`}
                  {d.building_code && ` · קוד ${d.building_code}`}
                </div>
                {d.notes && <div className="text-sm text-amber-800">📝 {d.notes}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {d.latitude == null && <span className="rounded bg-slate-100 px-1.5">ללא מיקום</span>}
                  {d.volunteers && <span>מתנדב: {d.volunteers.full_name}</span>}
                  {d.delivered_at && <span>נמסר {formatDate(d.delivered_at)}</span>}
                </div>
              </div>
              <DeliveryStatusBadge status={d.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>עריכה</Button>
              {(d.status === 'RESERVED' || d.status === 'IN_PROGRESS' || d.status === 'DELIVERED') && (
                <Button size="sm" variant="secondary" onClick={() => { if (confirm('להחזיר את המשלוח למאגר הפנויים?')) setDeliveryStatus(d, 'AVAILABLE'); }}>החזרה לפנוי</Button>
              )}
              {d.status === 'AVAILABLE' && (
                <Button size="sm" variant="secondary" onClick={() => setDeliveryStatus(d, 'CANCELLED')}>ביטול</Button>
              )}
              {d.status === 'CANCELLED' && (
                <Button size="sm" variant="secondary" onClick={() => setDeliveryStatus(d, 'AVAILABLE')}>הפעלה מחדש</Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(d)}>מחיקה</Button>
            </div>
          </Card>
        ))}
      </div>

      <DeliveryFormModal editing={editing} onClose={() => setEditing(null)} onSave={save} error={error} />
    </div>
  );
}

function DeliveryFormModal({ editing, onClose, onSave, error }: { editing: Partial<Delivery> | null; onClose: () => void; onSave: (v: Partial<Delivery>) => Promise<void>; error: string | null }) {
  const [values, setValues] = useState<Partial<Delivery>>(editing ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const key = editing?.id ?? (editing ? 'new' : 'none');
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setValues(editing ?? EMPTY); }
  if (!editing) return null;

  const set = (k: keyof Delivery) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave(values);
    setBusy(false);
  }
  const text = (k: keyof Delivery, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Field label={deliveryFieldLabel[k as keyof typeof deliveryFieldLabel] ?? k} key={k}>
      <Input value={(values[k] as string | number | null) ?? ''} onChange={set(k)} {...extra} />
    </Field>
  );

  return (
    <Modal open onClose={onClose} title={editing.id ? 'עריכת משלוח' : 'משלוח חדש'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {text('first_name')}
          {text('last_name')}
          {text('street', { required: true })}
          {text('house_number', { required: true })}
          {text('apartment')}
          {text('floor')}
          {text('entrance')}
          {text('building_code')}
          {text('city')}
          {text('phone', { type: 'tel', dir: 'ltr' })}
          <Field label="קו רוחב"><Input dir="ltr" inputMode="decimal" value={values.latitude ?? ''} onChange={set('latitude')} /></Field>
          <Field label="קו אורך"><Input dir="ltr" inputMode="decimal" value={values.longitude ?? ''} onChange={set('longitude')} /></Field>
        </div>
        <Field label="הערות"><Textarea rows={2} value={values.notes ?? ''} onChange={set('notes')} /></Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>שמירה</Button>
      </form>
    </Modal>
  );
}
