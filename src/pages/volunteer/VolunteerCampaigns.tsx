import { useAuth } from '@/auth/AuthProvider';
import { AppShell } from '@/components/Layout';
import { CampaignStatusBadge, VolunteerStatusBadge } from '@/components/StatusBadge';
import { Alert, Card, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Campaign, CampaignVolunteer } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { Link } from 'react-router-dom';

type Row = CampaignVolunteer & { campaigns: Campaign & { organizations: { name: string } | null } };

export default function VolunteerCampaigns() {
  const { ctx } = useAuth();
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await supabase
      .from('campaign_volunteers')
      .select('*, campaigns(*, organizations(name))')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as Row[]).filter((r) => r.campaigns);
  }, []);

  return (
    <AppShell title={`שלום ${ctx?.volunteer?.full_name ?? ''}`}>
      {loading && <PageSpinner />}
      {error && <Alert kind="error">{errorMessage(error)}</Alert>}
      {data && data.length === 0 && (
        <EmptyState title="אין קמפיינים" description="פתחו את קישור הקמפיין שקיבלתם מהארגון כדי להירשם." />
      )}
      <div className="space-y-3">
        {data?.map((r) => (
          <Link key={r.id} to={r.status === 'APPROVED' ? `/v/${r.campaign_id}` : `/c/${r.campaigns.public_slug}`} className="block">
            <Card className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-brand-700">{r.campaigns.organizations?.name}</div>
                <div className="text-lg font-bold">{r.campaigns.name}</div>
                <div className="mt-1"><CampaignStatusBadge status={r.campaigns.status} /></div>
              </div>
              <VolunteerStatusBadge status={r.status} />
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
