import { DeliveryMap, MapLegend } from '@/components/DeliveryMap';
import { deliveryStatusHex } from '@/components/StatusBadge';
import { Alert, PageSpinner } from '@/components/ui';
import { addressLine, fullName } from '@/lib/format';
import { deliveryStatusLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Delivery, DeliveryStatus } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useState } from 'react';
import { useCampaign } from '../CampaignManage';

const STATUSES: DeliveryStatus[] = ['AVAILABLE', 'RESERVED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED'];

export default function MapTab() {
  const { campaign } = useCampaign();
  const [filter, setFilter] = useState<Set<DeliveryStatus>>(new Set(['AVAILABLE', 'RESERVED', 'IN_PROGRESS', 'DELIVERED']));
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, volunteers:reserved_by(full_name)')
      .eq('campaign_id', campaign.id);
    if (error) throw error;
    return data as unknown as (Delivery & { volunteers: { full_name: string } | null })[];
  }, [campaign.id]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;
  const all = data ?? [];
  const shown = all.filter((d) => filter.has(d.status) && d.latitude != null && d.longitude != null);
  const missing = all.filter((d) => d.latitude == null && d.status !== 'CANCELLED').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const on = filter.has(s);
          const n = all.filter((d) => d.status === s).length;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter((f) => { const n = new Set(f); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
              className={clsx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm ring-1', on ? 'bg-white ring-slate-300' : 'bg-slate-100 text-slate-400 ring-transparent')}
            >
              <span className="inline-block size-3 rounded-full" style={{ background: on ? deliveryStatusHex[s] : '#cbd5e1' }} />
              {deliveryStatusLabel[s]} ({n})
            </button>
          );
        })}
      </div>
      <DeliveryMap
        className="h-[65dvh] w-full overflow-hidden rounded-2xl ring-1 ring-slate-200"
        points={shown.map((d) => ({
          id: d.id,
          latitude: d.latitude!,
          longitude: d.longitude!,
          color: deliveryStatusHex[d.status],
          popup: (
            <div className="text-sm">
              <div className="font-bold">{fullName(d)}</div>
              <div>{addressLine(d, campaign.city)}{d.apartment ? `, דירה ${d.apartment}` : ''}</div>
              <div className="text-slate-500">{deliveryStatusLabel[d.status]}{d.volunteers ? ` · ${d.volunteers.full_name}` : ''}</div>
            </div>
          ),
        }))}
      />
      <MapLegend items={STATUSES.map((s) => ({ color: deliveryStatusHex[s], label: deliveryStatusLabel[s] }))} />
      {missing > 0 && <Alert kind="info">{missing} משלוחים ללא מיקום אינם מוצגים במפה. ניתן להשלים מיקומים בלשונית "משלוחים".</Alert>}
    </div>
  );
}
