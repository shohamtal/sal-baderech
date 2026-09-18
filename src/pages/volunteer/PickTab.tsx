import { DeliveryMap } from '@/components/DeliveryMap';
import { Alert, Button, Card, EmptyState, Input, PageSpinner } from '@/components/ui';
import { findDeliveryClusters, type ClusterSuggestion } from '@/lib/clustering/clustering';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AvailableDelivery } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useMemo, useState } from 'react';

const PRESETS = [4, 5, 6, 7, 8];
const COLORS = ['#0f766e', '#7c3aed', '#db2777'];

/** Choose how many baskets to take, then claim a suggested cluster atomically. */
export default function PickTab({ campaignId, onClaimed }: { campaignId: string; onClaimed: () => void }) {
  const [count, setCount] = useState(5);
  const [custom, setCustom] = useState('');
  const [selected, setSelected] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('get_available_deliveries', { p_campaign_id: campaignId });
    if (error) throw error;
    return (data ?? []) as AvailableDelivery[];
  }, [campaignId]);

  const suggestions: ClusterSuggestion[] = useMemo(() => {
    if (!data) return [];
    return findDeliveryClusters(
      data.map((a) => ({
        id: a.id, street: a.street, houseNumber: a.house_number,
        neighborhood: a.neighborhood, latitude: a.latitude, longitude: a.longitude,
      })),
      count,
    );
  }, [data, count]);

  const byId = useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data]);
  const current = suggestions[selected] ?? suggestions[0];

  async function claim() {
    if (!current) return;
    setClaiming(true);
    setError(null);
    const { error } = await supabase.rpc('claim_deliveries', {
      p_campaign_id: campaignId, p_delivery_ids: current.deliveryIds,
    });
    setClaiming(false);
    if (error) {
      setError(errorMessage(error));
      reload();
      setSelected(0);
      return;
    }
    onClaimed();
  }

  if (loading) return <PageSpinner label="מחפש כתובות פנויות…" />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 font-semibold">כמה סלים תרצו לחלק?</div>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map((n) => (
            <button
              key={n} type="button"
              onClick={() => { setCount(n); setCustom(''); setSelected(0); }}
              className={clsx(
                'min-h-14 rounded-xl text-xl font-bold ring-1 transition',
                count === n && !custom ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-300',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <span className="whitespace-nowrap">מספר אחר:</span>
          <Input
            type="number" inputMode="numeric" min={1} max={50} className="min-h-10 w-24" value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (n >= 1 && n <= 50) { setCount(n); setSelected(0); }
            }}
          />
          <span className="ms-auto">פנויים: {data?.length ?? 0}</span>
        </div>
      </Card>

      {(data?.length ?? 0) === 0 && (
        <EmptyState
          title="אין כתובות פנויות כרגע"
          description="כל הסלים נתפסו. נסו שוב מאוחר יותר או פנו לרכז."
          action={<Button variant="secondary" onClick={reload}>רענון</Button>}
        />
      )}

      {suggestions.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="font-semibold">הצעות למקבץ</div>
            <button type="button" className="text-sm text-brand-700 underline" onClick={() => { reload(); setSelected(0); }}>רענון</button>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <Suggestion key={s.deliveryIds.join('|')} s={s} index={i} selected={i === selected}
                onSelect={() => setSelected(i)} byId={byId} requested={count} />
            ))}
          </div>

          {current && current.deliveryIds.some((id) => byId.get(id)?.latitude != null) && (
            <DeliveryMap
              className="h-[40dvh] w-full overflow-hidden rounded-2xl ring-1 ring-slate-200"
              points={current.deliveryIds
                .map((id) => byId.get(id)!)
                .filter((a) => a.latitude != null && a.longitude != null)
                .map((a) => ({
                  id: a.id, latitude: a.latitude!, longitude: a.longitude!,
                  color: COLORS[selected % COLORS.length],
                  label: a.house_number,
                  popup: <div>{a.street} {a.house_number}</div>,
                }))}
            />
          )}

          {error && <Alert kind="error">{error}</Alert>}
          <Button size="lg" className="w-full" loading={claiming} onClick={claim}>
            ✅ לוקח את המקבץ הזה ({current?.size} סלים)
          </Button>
          <p className="text-center text-xs text-slate-500">
            הכתובות נשמרות עבורך רק אחרי הלחיצה. אם מתנדב אחר הקדים, תוצג הצעה חדשה.
          </p>
        </>
      )}
    </div>
  );
}

function Suggestion({ s, index, selected, onSelect, byId, requested }: {
  s: ClusterSuggestion; index: number; selected: boolean; onSelect: () => void;
  byId: Map<string, AvailableDelivery>; requested: number;
}) {
  const byStreet = new Map<string, string[]>();
  for (const id of s.deliveryIds) {
    const a = byId.get(id);
    if (!a) continue;
    const list = byStreet.get(a.street) ?? [];
    list.push(a.house_number);
    byStreet.set(a.street, list);
  }
  return (
    <Card onClick={onSelect} className={clsx('transition', selected && 'ring-2 ring-brand-600')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
          <span className="font-bold">הצעה {index + 1}</span>
          <span className="text-sm text-slate-500">· {s.size} סלים{s.size < requested ? ` (מתוך ${requested})` : ''}</span>
        </div>
        <span className="text-xs text-slate-500">
          {s.neighborhoods.length === 1 && `${s.neighborhoods[0]} · `}
          {s.sameStreet ? 'רחוב אחד' : `${s.streets.length} רחובות`}
          {s.radiusMeters != null && ` · ~${s.radiusMeters} מ'`}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {Array.from(byStreet.entries()).map(([street, nums]) => (
          <li key={street} className="flex gap-2">
            <span className="font-semibold">{street}</span>
            <span className="text-slate-600" dir="ltr">
              {nums.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
