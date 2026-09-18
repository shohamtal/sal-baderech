import { DeliveryStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, Input, LinkButton, PageSpinner, StatCard } from '@/components/ui';
import { addressLine, fullName } from '@/lib/format';
import { deliveryStatusLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Delivery, DeliveryStatus, OrgDashboard } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useOrg } from './OrgAdmin';

type Row = Delivery & { volunteers: { full_name: string; phone: string } | null };
const ORDER: DeliveryStatus[] = ['AVAILABLE', 'RESERVED', 'IN_PROGRESS', 'DELIVERED', 'UNDELIVERABLE', 'CANCELLED'];

/** Live state of the organization's published campaign, delivery by delivery. */
export default function OrgDashboardTab() {
  const { org } = useOrg();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<DeliveryStatus | 'ALL'>('ALL');

  const { data, loading, error, reload } = useAsync(async () => {
    const { data: dash, error } = await supabase.rpc('org_dashboard', { p_org_id: org.id });
    if (error) throw error;
    const d = dash as OrgDashboard;
    if (!d.campaign) return { dash: d, deliveries: [] as Row[] };
    const { data: rows, error: e2 } = await supabase
      .from('deliveries')
      .select('*, volunteers:reserved_by(full_name, phone)')
      .eq('campaign_id', d.campaign.id)
      .order('status')
      .order('street');
    if (e2) throw e2;
    return { dash: d, deliveries: rows as unknown as Row[] };
  }, [org.id]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.deliveries ?? []).filter((d) => {
      if (only !== 'ALL' && d.status !== only) return false;
      if (!term) return true;
      return [d.full_name, d.first_name, d.last_name, d.street, d.house_number, d.neighborhood, d.volunteers?.full_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [data, q, only]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;

  const campaign = data?.dash.campaign;
  const stats = data?.dash.stats;

  if (!campaign || !stats) {
    return (
      <EmptyState
        title="אין כרגע קמפיין מפורסם"
        description="ארגון יכול לפרסם קמפיין אחד בכל זמן נתון. פרסמו קמפיין כדי לראות כאן את מצב החלוקה."
        action={<LinkButton to={`/${encodeURIComponent(org.slug)}/admin/campaigns`} size="sm">לקמפיינים</LinkButton>}
      />
    );
  }

  const effective = stats.total - stats.cancelled;
  const pct = effective ? Math.round((stats.delivered / effective) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">קמפיין פעיל</div>
            <div className="text-2xl font-bold">{campaign.name}</div>
          </div>
          <div className="text-left">
            <div className="text-sm text-slate-500">נמסרו</div>
            <div className="text-4xl font-bold tabular-nums text-emerald-700">{pct}%</div>
          </div>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton to={`/m/${campaign.id}`} size="sm" variant="secondary">ניהול הקמפיין</LinkButton>
          <LinkButton to={`/m/${campaign.id}/map`} size="sm" variant="secondary">מפה</LinkButton>
          <Button size="sm" variant="ghost" onClick={reload}>רענון</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="סה״כ" value={stats.total} />
        <StatCard label="פנויים" value={stats.available} />
        <StatCard label="שמורים" value={stats.reserved} tone="blue" />
        <StatCard label="בדרך" value={stats.in_progress} tone="amber" />
        <StatCard label="נמסרו" value={stats.delivered} tone="green" />
        <StatCard label="לא נמסרו" value={stats.undeliverable} tone={stats.undeliverable ? 'red' : 'slate'} />
      </div>

      {stats.undeliverable > 0 && (
        <Alert kind="warning">
          {stats.undeliverable} כתובות סומנו כ"לא נמסר" וממתינות להחלטה שלכם. הן מוקפאות ולא ייתפסו על ידי מתנדב אחר.{' '}
          <LinkButton to={`/m/${campaign.id}/deliveries`} variant="ghost" size="sm">לטיפול</LinkButton>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="חיפוש נמען, כתובת או מתנדב" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[14rem] flex-1" />
        <button type="button" onClick={() => setOnly('ALL')}
          className={clsx('rounded-full px-3 py-1.5 text-sm ring-1', only === 'ALL' ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-white ring-slate-300')}>
          הכול ({data!.deliveries.length})
        </button>
        {ORDER.map((s) => {
          const n = data!.deliveries.filter((d) => d.status === s).length;
          if (!n) return null;
          return (
            <button key={s} type="button" onClick={() => setOnly(s)}
              className={clsx('rounded-full px-3 py-1.5 text-sm ring-1', only === s ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-white ring-slate-300')}>
              {deliveryStatusLabel[s]} ({n})
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">נמען</th>
              <th className="px-3 py-2">כתובת</th>
              <th className="px-3 py-2">סטטוס</th>
              <th className="px-3 py-2">מתנדב</th>
              <th className="px-3 py-2">הערה</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{fullName(d)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {d.neighborhood && <span className="text-slate-400">{d.neighborhood} · </span>}
                  {addressLine(d, null)}{d.apartment ? `, דירה ${d.apartment}` : ''}
                </td>
                <td className="px-3 py-2"><DeliveryStatusBadge status={d.status} /></td>
                <td className="px-3 py-2 text-slate-600">{d.volunteers?.full_name ?? '—'}</td>
                <td className="max-w-[16rem] px-3 py-2 text-xs text-slate-500">{d.undeliverable_reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">לא נמצאו משלוחים</div>}
      </div>
    </div>
  );
}
