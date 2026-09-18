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
const SECTION: Record<string, string> = {
  users: 'משתמשים',
  campaigns: 'קמפיינים',
  settings: 'הגדרות',
};

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

  // A campaign renders its own trail and tabs, one level deeper.
  const insideCampaign = /\/campaigns\/[^/]+/.test(location.pathname);
  const last = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const section = SECTION[last] ?? 'משתמשים';

  return (
    <Ctx.Provider value={{ org: data, reload, base, crumbs }}>
      <AppShell title={data.name} wide>
        {!insideCampaign && (
          <>
            <Breadcrumbs items={[...crumbs, { label: section }]} />
            <TabBar
              tabs={[
                { to: `${base}/users`, label: 'משתמשים' },
                { to: `${base}/campaigns`, label: 'קמפיינים', end: true },
                { to: `${base}/settings`, label: 'הגדרות' },
              ]}
            />
          </>
        )}
        <Routes>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<OrgUsersTab />} />
          <Route path="campaigns" element={<OrgCampaignsTab />} />
          <Route path="campaigns/:campaignSlug/*" element={<CampaignArea />} />
          <Route path="settings" element={<OrgSettingsTab />} />
          {/* The organization area used to live under /admin; keep those links working. */}
          <Route path="admin" element={<Navigate to="../users" replace />} />
          <Route path="admin/*" element={<Navigate to="../users" replace />} />
          <Route path="*" element={<Navigate to="users" replace />} />
        </Routes>
      </AppShell>
    </Ctx.Provider>
  );
}

