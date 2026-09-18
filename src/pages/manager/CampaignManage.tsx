import { AppShell, TabBar } from '@/components/Layout';
import { CampaignStatusBadge } from '@/components/StatusBadge';
import { Alert, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Campaign, Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { createContext, useContext } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import AuditTab from './campaign/AuditTab';
import CorrectionsTab from './campaign/CorrectionsTab';
import DashboardTab from './campaign/DashboardTab';
import DeliveriesTab from './campaign/DeliveriesTab';
import ImportTab from './campaign/ImportTab';
import MapTab from './campaign/MapTab';
import SettingsTab from './campaign/SettingsTab';
import VolunteersTab from './campaign/VolunteersTab';

interface CampaignCtx {
  campaign: Campaign;
  org: Organization;
  reload: () => void;
}
const Ctx = createContext<CampaignCtx | null>(null);
export function useCampaign(): CampaignCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCampaign outside CampaignManage');
  return v;
}

export default function CampaignManage() {
  const { campaignId = '' } = useParams();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data: campaign, error } = await supabase.from('campaigns').select('*, organizations(*)').eq('id', campaignId).maybeSingle();
    if (error) throw error;
    if (!campaign) return null;
    const { organizations, ...c } = campaign as Campaign & { organizations: Organization };
    return { campaign: c as Campaign, org: organizations };
  }, [campaignId]);

  if (loading) return <AppShell title="טוען..." wide><PageSpinner /></AppShell>;
  if (error) return <AppShell title="שגיאה" wide><Alert kind="error">{errorMessage(error)}</Alert></AppShell>;
  if (!data) return <AppShell title="קמפיין" back="/org" wide><EmptyState title="הקמפיין לא נמצא או שאין לך הרשאה" /></AppShell>;

  const base = `/m/${campaignId}`;
  return (
    <Ctx.Provider value={{ ...data, reload }}>
      <AppShell title={data.campaign.name} back={`/${encodeURIComponent(data.org.slug)}/admin/campaigns`} wide
        actions={<CampaignStatusBadge status={data.campaign.status} />}>
        <TabBar
          tabs={[
            { to: base, label: 'סקירה', end: true },
            { to: `${base}/deliveries`, label: 'משלוחים' },
            { to: `${base}/map`, label: 'מפה' },
            { to: `${base}/volunteers`, label: 'מתנדבים' },
            { to: `${base}/corrections`, label: 'תיקונים' },
            { to: `${base}/import`, label: 'ייבוא' },
            { to: `${base}/audit`, label: 'יומן' },
            { to: `${base}/settings`, label: 'הגדרות ושיתוף' },
          ]}
        />
        <Routes>
          <Route index element={<DashboardTab />} />
          <Route path="deliveries" element={<DeliveriesTab />} />
          <Route path="map" element={<MapTab />} />
          <Route path="volunteers" element={<VolunteersTab />} />
          <Route path="corrections" element={<CorrectionsTab />} />
          <Route path="import" element={<ImportTab />} />
          <Route path="audit" element={<AuditTab />} />
          <Route path="settings" element={<SettingsTab />} />
        </Routes>
      </AppShell>
    </Ctx.Provider>
  );
}
