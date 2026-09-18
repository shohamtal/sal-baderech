import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PageSpinner } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/supabase';
import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

const OrgHome = lazy(() => import('@/pages/volunteer/OrgHome'));
const LoginPage = lazy(() => import('@/pages/public/LoginPage'));
const HomePage = lazy(() => import('@/pages/public/HomePage'));
const PlatformAdmin = lazy(() => import('@/pages/admin/PlatformAdmin'));
const OrgAdmin = lazy(() => import('@/pages/org/OrgAdmin'));
const CampaignManage = lazy(() => import('@/pages/manager/CampaignManage'));
const LegacyCampaignLink = lazy(() => import('@/pages/public/LegacyCampaignLink'));

function ConfigError() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">חסרה הגדרת Supabase</h1>
      <p className="mt-2 text-slate-600">
        יש להגדיר את משתני הסביבה <code>VITE_SUPABASE_URL</code> ו-<code>VITE_SUPABASE_ANON_KEY</code> (ראו .env.example).
      </p>
    </div>
  );
}

/**
 * UX-only gate. Every rule here is enforced again by RLS, so bypassing it
 * yields empty screens rather than data.
 */
function RequireAuth({ children, role }: { children: ReactNode; role?: 'admin' | 'manager' }) {
  const { session, loading, ctx } = useAuth();
  if (loading) return <PageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === 'admin' && !ctx?.is_platform_admin) return <Navigate to="/" replace />;
  if (role === 'manager' && !ctx?.is_platform_admin && !ctx?.manager_org_ids?.length) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
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

            {/* Platform administration */}
            <Route path="/admin/*" element={<RequireAuth role="admin"><PlatformAdmin /></RequireAuth>} />

            {/* Campaign console, reached from an organization's campaigns tab */}
            <Route path="/m/:campaignId/*" element={<RequireAuth role="manager"><CampaignManage /></RequireAuth>} />

            {/* Organization-scoped. Static routes above always win over these. */}
            <Route path="/:orgSlug/home" element={<OrgHome />} />
            <Route path="/:orgSlug/admin/*" element={<RequireAuth role="manager"><OrgAdmin /></RequireAuth>} />

            <Route path="/c/:slug" element={<LegacyCampaignLink />} />
            <Route path="/campaign/:slug" element={<LegacyCampaignLink />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}
