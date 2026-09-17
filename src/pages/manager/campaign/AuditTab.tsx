import { Alert, Button, EmptyState, PageSpinner } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { auditActionLabel, errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AuditLog } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useCampaign } from '../CampaignManage';

export default function AuditTab() {
  const { campaign } = useCampaign();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    return data as AuditLog[];
  }, [campaign.id]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">יומן פעולות</h2>
        <Button variant="ghost" size="sm" onClick={reload}>רענון</Button>
      </div>
      {data?.length === 0 && <EmptyState title="אין רשומות עדיין" />}
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">זמן</th>
              <th className="px-3 py-2">פעולה</th>
              <th className="px-3 py-2">פרטים</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatDate(l.created_at)}</td>
                <td className="px-3 py-2 font-medium">{auditActionLabel[l.action] ?? l.action}</td>
                <td className="px-3 py-2 text-slate-600" dir="ltr">
                  {Object.entries(l.metadata ?? {})
                    .filter(([k]) => k !== 'delivery_ids')
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
