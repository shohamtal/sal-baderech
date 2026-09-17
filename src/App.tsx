import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PageSpinner } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/supabase';
import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';

const CampaignLanding = lazy(() => import('@/pages/public/CampaignLanding'));
const LoginPage = lazy(() => import('@/pages/public/LoginPage'));
const HomePage = lazy(() => import('@/pages/public/HomePage'));
const VolunteerCampaigns = lazy(() => import('@/pages/volunteer/VolunteerCampaigns'));
const VolunteerCampaign = lazy(() => import('@/pages/volunteer/VolunteerCampaign'));
const RequestCluster = lazy(() => import('@/pages/volunteer/RequestCluster'));
const AdminOrganizations = lazy(() => import('@/pages/admin/AdminOrganizations'));
const AdminOrganization = lazy(() => import('@/pages/admin/AdminOrganization'));
const OrgList = lazy(() => import('@/pages/manager/OrgList'));
const OrgCampaigns = lazy(() => import('@/pages/manager/OrgCampaigns'));
const CampaignManage = lazy(() => import('@/pages/manager/CampaignManage'));

function ConfigError() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">חסרה הגדרת Supabase</h1>
      <p className="mt-2 text-slate-600">
        יש להגדיר את משתני הסביבה <code>VITE_SUPABASE_URL</code> ו-<code>VITE_SUPABASE_ANON_KEY</code> (ראו קובץ .env.example).
      </p>
    </div>
  );
}

function RequireAuth({ children, role }: { children: React.ReactNode; role?: 'admin' | 'manager' | 'volunteer' }) {
  const { session, loading, ctx } = useAuth();
  if (loading) return <PageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === 'admin' && !ctx?.is_platform_admin) return <Navigate to="/" replace />;
  if (role === 'manager' && !ctx?.is_platform_admin && !ctx?.manager_org_ids?.length) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LegacyCampaignRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/c/${slug}`} replace />;
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigError />;
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* Public campaign URL: registration only — never authorization. */}
            <Route path="/c/:slug" element={<CampaignLanding />} />
            <Route path="/campaign/:slug" element={<LegacyCampaignRedirect />} />

            {/* Volunteer */}
            <Route path="/v" element={<RequireAuth><VolunteerCampaigns /></RequireAuth>} />
            <Route path="/v/:campaignId" element={<RequireAuth><VolunteerCampaign /></RequireAuth>} />
            <Route path="/v/:campaignId/request" element={<RequireAuth><RequestCluster /></RequireAuth>} />

            {/* Platform admin */}
            <Route path="/admin" element={<RequireAuth role="admin"><AdminOrganizations /></RequireAuth>} />
            <Route path="/admin/org/:orgId" element={<RequireAuth role="admin"><AdminOrganization /></RequireAuth>} />

            {/* Organization manager */}
            <Route path="/org" element={<RequireAuth role="manager"><OrgList /></RequireAuth>} />
            <Route path="/org/:orgId" element={<RequireAuth role="manager"><OrgCampaigns /></RequireAuth>} />
            <Route path="/m/:campaignId/*" element={<RequireAuth role="manager"><CampaignManage /></RequireAuth>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}
