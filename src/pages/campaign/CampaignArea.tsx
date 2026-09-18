import { Breadcrumbs } from '@/components/Breadcrumbs';
import { TabBar } from '@/components/Layout';
import { CampaignStatusBadge } from '@/components/StatusBadge';
import { Alert, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Campaign, Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useOrg } from '../org/OrgArea';
import AuditTab from './AuditTab';
import CorrectionsTab from './CorrectionsTab';
import DashboardTab from './DashboardTab';
import DeliveriesTab from './DeliveriesTab';
import ImportTab from './ImportTab';
import MapTab from './MapTab';
import SettingsTab from './SettingsTab';

interface CampaignCtx {
  campaign: Campaign;
  org: Organization;
  reload: () => void;
  /** URL prefix for this campaign's tabs. */
  base: string;
}
const Ctx = createContext<CampaignCtx | null>(null);
export function useCampaign(): CampaignCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCampaign outside CampaignArea');
  return v;
}

/** One campaign, at /:orgSlug/campaigns/:campaignSlug. */
export default function CampaignArea() {
  const { campaignSlug = '' } = useParams();
  const { org, base: orgBase, crumbs } = useOrg();

  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase
      .from('campaigns').select('*')
      .eq('organization_id', org.id).eq('slug', campaignSlug).maybeSingle();
    if (error) throw error;
    return data as Campaign | null;
  }, [org.id, campaignSlug]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;
  if (!data) return <EmptyState title="הקמפיין לא נמצא" description="ייתכן ששמו שונה או שנמחק." />;

  const base = `${orgBase}/campaigns/${encodeURIComponent(campaignSlug)}`;
  const trail = [...crumbs, { label: 'קמפיינים', to: `${orgBase}/campaigns` }, { label: data.name, to: `${base}/overview` }];

  return (
    <Ctx.Provider value={{ campaign: data, org, reload, base }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{data.name}</h2>
          <CampaignStatusBadge status={data.status} />
        </div>
      </div>
      <TabBar
        tabs={[
          { to: `${base}/overview`, label: 'סקירה' },
          { to: `${base}/deliveries`, label: 'משלוחים' },
          { to: `${base}/map`, label: 'מפה' },
          { to: `${base}/fix-suggestions`, label: 'בקשות תיקון' },
          { to: `${base}/import`, label: 'ייבוא' },
          { to: `${base}/log`, label: 'יומן' },
          { to: `${base}/settings`, label: 'הגדרות' },
        ]}
      />
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Tab trail={trail} label="סקירה"><DashboardTab /></Tab>} />
        <Route path="deliveries" element={<Tab trail={trail} label="משלוחים"><DeliveriesTab /></Tab>} />
        <Route path="map" element={<Tab trail={trail} label="מפה"><MapTab /></Tab>} />
        <Route path="fix-suggestions" element={<Tab trail={trail} label="בקשות תיקון"><CorrectionsTab /></Tab>} />
        <Route path="import" element={<Tab trail={trail} label="ייבוא"><ImportTab /></Tab>} />
        <Route path="log" element={<Tab trail={trail} label="יומן"><AuditTab /></Tab>} />
        <Route path="settings" element={<Tab trail={trail} label="הגדרות"><SettingsTab /></Tab>} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </Ctx.Provider>
  );
}

function Tab({ trail, label, children }: { trail: { label: string; to?: string }[]; label: string; children: ReactNode }) {
  return (
    <>
      <Breadcrumbs items={[...trail, { label }]} />
      {children}
    </>
  );
}
