import { CorrectionStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, PageSpinner } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { deliveryFieldLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Correction, DeliveryField } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState } from 'react';
import { useCampaign } from '../CampaignManage';

export default function CorrectionsTab() {
  const { campaign } = useCampaign();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const { data, error } = await supabase
      .from('corrections')
      .select('*, deliveries!inner(id, first_name, last_name, street, house_number, campaign_id), volunteers(id, full_name, phone)')
      .eq('deliveries.campaign_id', campaign.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as unknown as Correction[];
  }, [campaign.id]);

  async function review(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    const { error } = await supabase.rpc('review_correction', { p_correction_id: id, p_approve: approve });
    setBusy(null);
    if (error) return setError(errorMessage(error));
    reload();
  }

  if (loading) return <PageSpinner />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;
  const pending = (data ?? []).filter((c) => c.status === 'PENDING');
  const done = (data ?? []).filter((c) => c.status !== 'PENDING');

  const Item = ({ c }: { c: Correction }) => (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold">
            {[c.deliveries?.first_name, c.deliveries?.last_name].filter(Boolean).join(' ') || 'נמען'} · {c.deliveries?.street} {c.deliveries?.house_number}
          </div>
          <div className="text-xs text-slate-500">
            {c.volunteers?.full_name} · {formatDate(c.created_at)}
          </div>
        </div>
        <CorrectionStatusBadge status={c.status} />
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="font-semibold">{deliveryFieldLabel[c.field_name as DeliveryField] ?? c.field_name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded bg-red-100 px-2 py-0.5 line-through">{c.old_value ?? '—'}</span>
          <span>←</span>
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold">{c.proposed_value ?? '—'}</span>
        </div>
        {c.comment && <div className="mt-2 text-slate-600">💬 {c.comment}</div>}
      </div>
      {c.status === 'PENDING' && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="success" loading={busy === c.id} onClick={() => review(c.id, true)}>אישור ועדכון</Button>
          <Button size="sm" variant="secondary" loading={busy === c.id} onClick={() => review(c.id, false)}>דחייה</Button>
        </div>
      )}
      {c.reviewed_at && <div className="mt-2 text-xs text-slate-400">נבדק {formatDate(c.reviewed_at)}</div>}
    </Card>
  );

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      <section>
        <h2 className="mb-2 font-bold">ממתינים ({pending.length})</h2>
        {pending.length === 0 && <div className="text-sm text-slate-500">אין בקשות תיקון ממתינות.</div>}
        <div className="space-y-2">{pending.map((c) => <Item key={c.id} c={c} />)}</div>
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">היסטוריה ({done.length})</h2>
          <div className="space-y-2">{done.map((c) => <Item key={c.id} c={c} />)}</div>
        </section>
      )}
      {(data ?? []).length === 0 && <EmptyState title="אין בקשות תיקון" description="מתנדבים יכולים לדווח על פרטים שגויים מתוך מסך המשלוחים שלהם." />}
    </div>
  );
}
