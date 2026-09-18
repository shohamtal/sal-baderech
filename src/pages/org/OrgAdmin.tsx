import { AppShell, TabBar } from '@/components/Layout';
import { Alert, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { createContext, useContext } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import OrgCampaignsTab from './OrgCampaignsTab';
import OrgDashboardTab from './OrgDashboardTab';
import OrgSettingsTab from './OrgSettingsTab';
import OrgUsersTab from './OrgUsersTab';

interface OrgCtx { org: Organization; reload: () => void }
const Ctx = createContext<OrgCtx | null>(null);
export function useOrg(): OrgCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrg outside OrgAdmin');
  return v;
}

/**
 * Organization administration at /:orgSlug/admin.
 * RLS decides what is visible: a manager sees only their own organization, a
 * platform admin sees any. An unauthorised slug simply yields no row.
 */
export default function OrgAdmin() {
  const { orgSlug = '' } = useParams();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase.from('organizations').select('*').eq('slug', orgSlug).maybeSingle();
    if (error) throw error;
    return data as Organization | null;
  }, [orgSlug]);

  if (loading) return <AppShell title="טוען…" wide><PageSpinner /></AppShell>;
  if (error) return <AppShell title="שגיאה" wide><Alert kind="error">{errorMessage(error)}</Alert></AppShell>;
  if (!data) {
    return (
      <AppShell title="ארגון" wide>
        <EmptyState title="הארגון לא נמצא או שאין לך הרשאה" description="פנו למנהל הפלטפורמה." />
      </AppShell>
    );
  }

  const base = `/${encodeURIComponent(orgSlug)}/admin`;
  return (
    <Ctx.Provider value={{ org: data, reload }}>
      <AppShell title={data.name} wide>
        <TabBar
          tabs={[
            { to: base, label: 'לוח בקרה', end: true },
            { to: `${base}/users`, label: 'משתמשים' },
            { to: `${base}/campaigns`, label: 'קמפיינים' },
            { to: `${base}/settings`, label: 'הגדרות' },
          ]}
        />
        <Routes>
          <Route index element={<OrgDashboardTab />} />
          <Route path="users" element={<OrgUsersTab />} />
          <Route path="campaigns" element={<OrgCampaignsTab />} />
          <Route path="settings" element={<OrgSettingsTab />} />
        </Routes>
      </AppShell>
    </Ctx.Provider>
  );
}
