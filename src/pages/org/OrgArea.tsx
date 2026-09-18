import { useAuth } from '@/auth/AuthProvider';
import { Breadcrumbs, type Crumb } from '@/components/Breadcrumbs';
import { AppShell, TabBar } from '@/components/Layout';
import { Alert, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { createContext, useContext } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import CampaignArea from '../campaign/CampaignArea';
import OrgCampaignsTab from './OrgCampaignsTab';
import OrgSettingsTab from './OrgSettingsTab';
import OrgUsersTab from './OrgUsersTab';

interface OrgCtx {
  org: Organization;
  reload: () => void;
  /** URL prefix for everything inside this organization. */
  base: string;
  /** Crumbs above the organization, for nested screens to extend. */
  crumbs: Crumb[];
}
const Ctx = createContext<OrgCtx | null>(null);
export function useOrg(): OrgCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrg outside OrgArea');
  return v;
}

/**
 * Everything an organization owns lives under /:orgSlug.
 * RLS decides visibility: a manager sees only their own organization.
 */
export default function OrgArea() {
  const { orgSlug = '' } = useParams();
  const { ctx } = useAuth();
  const location = useLocation();

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

  const base = `/${encodeURIComponent(orgSlug)}`;
  // A platform admin arrived from the organizations list; a manager did not.
  const crumbs: Crumb[] = ctx?.is_platform_admin
    ? [{ label: 'הפלטפורמה', to: '/admin' }, { label: data.name, to: base }]
    : [{ label: data.name, to: base }];

  const insideCampaign = /\/campaigns\/[^/]+/.test(location.pathname);

  return (
    <Ctx.Provider value={{ org: data, reload, base, crumbs }}>
      <AppShell title={data.name} wide>
        {!insideCampaign && (
          <TabBar
            tabs={[
              { to: `${base}/users`, label: 'משתמשים' },
              { to: `${base}/campaigns`, label: 'קמפיינים', end: true },
              { to: `${base}/settings`, label: 'הגדרות' },
            ]}
          />
        )}
        <Routes>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<OrgPage crumb="משתמשים"><OrgUsersTab /></OrgPage>} />
          <Route path="campaigns" element={<OrgPage crumb="קמפיינים"><OrgCampaignsTab /></OrgPage>} />
          <Route path="campaigns/:campaignSlug/*" element={<CampaignArea />} />
          <Route path="settings" element={<OrgPage crumb="הגדרות"><OrgSettingsTab /></OrgPage>} />
          {/* The organization area used to live under /admin; keep those links working. */}
          <Route path="admin" element={<Navigate to="../users" replace />} />
          <Route path="admin/*" element={<Navigate to="../users" replace />} />
          <Route path="*" element={<Navigate to="users" replace />} />
        </Routes>
      </AppShell>
    </Ctx.Provider>
  );
}

function OrgPage({ crumb, children }: { crumb: string; children: React.ReactNode }) {
  const { crumbs } = useOrg();
  return (
    <>
      <Breadcrumbs items={[...crumbs, { label: crumb }]} />
      {children}
    </>
  );
}
