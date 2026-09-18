import { Alert, Button, Card, LinkButton, PageSpinner, StatCard } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CampaignStats } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useCampaign } from './CampaignArea';

export default function DashboardTab() {
  const { campaign, org, base } = useCampaign();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('campaign_stats', { p_campaign_id: campaign.id });
    if (error) throw error;
    return data as CampaignStats;
  }, [campaign.id]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;
  if (!data) return null;

  const effective = data.total - data.cancelled;
  const pct = effective ? Math.round((data.delivered / effective) * 100) : 0;
  const orgBase = `/${encodeURIComponent(org.slug)}`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-500">סה"כ סלים</div>
            <div className="text-4xl font-bold tabular-nums">{data.total}</div>
          </div>
          <div className="text-left">
            <div className="text-sm text-slate-500">נמסרו</div>
            <div className="text-4xl font-bold tabular-nums text-emerald-700">{pct}%</div>
          </div>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={reload}>רענון</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="פנויים" value={data.available} />
        <StatCard label="שמורים" value={data.reserved} tone="blue" />
        <StatCard label="בדרך" value={data.in_progress} tone="amber" />
        <StatCard label="נמסרו" value={data.delivered} tone="green" />
        <StatCard label="לא נמסרו" value={data.undeliverable} tone={data.undeliverable ? 'red' : 'slate'} />
        <StatCard label="בוטלו" value={data.cancelled} tone="red" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="מתנדבים פעילים" value={data.volunteers_approved} tone="teal" />
        <StatCard label="מתנדבים ממתינים" value={data.volunteers_pending} tone={data.volunteers_pending ? 'amber' : 'slate'} />
        <StatCard label="תיקונים ממתינים" value={data.corrections_pending} tone={data.corrections_pending ? 'amber' : 'slate'} />
      </div>

      {data.total === 0 && (
        <Alert kind="info">
          עדיין אין משלוחים. <LinkButton to={`${base}/import`} variant="ghost" size="sm">ייבוא נמענים מקובץ</LinkButton>
        </Alert>
      )}
      {data.volunteers_pending > 0 && (
        <Alert kind="warning">
          יש {data.volunteers_pending} מתנדבים שממתינים לאישור.{' '}
          <LinkButton to={`${orgBase}/users`} variant="ghost" size="sm">לניהול המשתמשים בארגון</LinkButton>
        </Alert>
      )}
      {data.undeliverable > 0 && (
        <Alert kind="warning">
          {data.undeliverable} כתובות סומנו כ"לא נמסר" והוקפאו — הן לא ייתפסו על ידי מתנדב אחר עד שתחליטו.{' '}
          <LinkButton to={`${base}/deliveries`} variant="ghost" size="sm">לטיפול</LinkButton>
        </Alert>
      )}
      {data.corrections_pending > 0 && (
        <Alert kind="warning">
          יש {data.corrections_pending} בקשות תיקון ממתינות. <LinkButton to={`${base}/fix-suggestions`} variant="ghost" size="sm">לבדיקה</LinkButton>
        </Alert>
      )}
      {data.missing_coords > 0 && (
        <Alert kind="info">
          ל-{data.missing_coords} משלוחים אין מיקום במפה. <LinkButton to={`${base}/deliveries`} variant="ghost" size="sm">להשלמת מיקומים</LinkButton>
        </Alert>
      )}
      {campaign.status === 'DRAFT' && (
        <Alert kind="info">
          הקמפיין בטיוטה — הקישור הציבורי אינו פעיל ומתנדבים אינם יכולים להירשם.{' '}
          <LinkButton to={`${base}/settings`} variant="ghost" size="sm">פרסום הקמפיין</LinkButton>
        </Alert>
      )}
    </div>
  );
}
