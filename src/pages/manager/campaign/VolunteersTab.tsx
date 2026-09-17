import { VolunteerStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, PageSpinner } from '@/components/ui';
import { formatDate, formatPhone } from '@/lib/format';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CampaignVolunteer, VolunteerStatus } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState } from 'react';
import { useCampaign } from '../CampaignManage';

type Row = CampaignVolunteer & { volunteers: { id: string; full_name: string; phone: string }; active_count?: number };

export default function VolunteersTab() {
  const { campaign } = useCampaign();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const [{ data: cvs, error }, { data: deliveries }] = await Promise.all([
      supabase.from('campaign_volunteers').select('*, volunteers(id, full_name, phone)').eq('campaign_id', campaign.id).order('created_at', { ascending: false }),
      supabase.from('deliveries').select('reserved_by, status').eq('campaign_id', campaign.id).not('reserved_by', 'is', null),
    ]);
    if (error) throw error;
    const counts = new Map<string, { active: number; delivered: number }>();
    for (const d of (deliveries ?? []) as { reserved_by: string; status: string }[]) {
      const c = counts.get(d.reserved_by) ?? { active: 0, delivered: 0 };
      if (d.status === 'DELIVERED') c.delivered++;
      else if (d.status === 'RESERVED' || d.status === 'IN_PROGRESS') c.active++;
      counts.set(d.reserved_by, c);
    }
    return { rows: cvs as unknown as Row[], counts };
  }, [campaign.id]);

  async function setStatus(cv: Row, status: VolunteerStatus) {
    if (status === 'REVOKED' && !confirm(`לבטל את ההרשאה של ${cv.volunteers.full_name}? משלוחים שטרם נמסרו ישוחררו למאגר.`)) return;
    setBusy(cv.id);
    setError(null);
    const { error } = await supabase.rpc('set_volunteer_status', { p_cv_id: cv.id, p_status: status });
    setBusy(null);
    if (error) return setError(errorMessage(error));
    reload();
  }

  if (loading) return <PageSpinner />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;
  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING');
  const approved = rows.filter((r) => r.status === 'APPROVED');
  const other = rows.filter((r) => r.status === 'REJECTED' || r.status === 'REVOKED');

  const Row = ({ cv, actions }: { cv: Row; actions: React.ReactNode }) => {
    const c = data?.counts.get(cv.volunteer_id);
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold">{cv.volunteers.full_name}</div>
          <a href={`tel:${cv.volunteers.phone}`} className="text-sm text-brand-700" dir="ltr">{formatPhone(cv.volunteers.phone)}</a>
          <div className="text-xs text-slate-500">
            נרשם {formatDate(cv.created_at)}
            {c && ` · ${c.active} פעילים · ${c.delivered} נמסרו`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VolunteerStatusBadge status={cv.status} />
          {actions}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      <section>
        <h2 className="mb-2 font-bold">ממתינים לאישור ({pending.length})</h2>
        {pending.length === 0 && <div className="text-sm text-slate-500">אין מתנדבים שממתינים.</div>}
        <div className="space-y-2">
          {pending.map((cv) => (
            <Row key={cv.id} cv={cv} actions={
              <>
                <Button size="sm" variant="success" loading={busy === cv.id} onClick={() => setStatus(cv, 'APPROVED')}>אישור</Button>
                <Button size="sm" variant="secondary" loading={busy === cv.id} onClick={() => setStatus(cv, 'REJECTED')}>דחייה</Button>
              </>
            } />
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-bold">מאושרים ({approved.length})</h2>
        {approved.length === 0 && <div className="text-sm text-slate-500">אין מתנדבים מאושרים.</div>}
        <div className="space-y-2">
          {approved.map((cv) => (
            <Row key={cv.id} cv={cv} actions={
              <Button size="sm" variant="danger" loading={busy === cv.id} onClick={() => setStatus(cv, 'REVOKED')}>ביטול הרשאה</Button>
            } />
          ))}
        </div>
      </section>
      {other.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">נדחו / בוטלו ({other.length})</h2>
          <div className="space-y-2">
            {other.map((cv) => (
              <Row key={cv.id} cv={cv} actions={
                <Button size="sm" variant="secondary" loading={busy === cv.id} onClick={() => setStatus(cv, 'APPROVED')}>אישור מחדש</Button>
              } />
            ))}
          </div>
        </section>
      )}
      {rows.length === 0 && <EmptyState title="עדיין לא נרשמו מתנדבים" description="שתפו את קישור הקמפיין (בלשונית 'הגדרות ושיתוף')." />}
    </div>
  );
}
