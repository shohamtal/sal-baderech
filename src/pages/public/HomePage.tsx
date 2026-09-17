import { useAuth } from '@/auth/AuthProvider';
import { LinkButton, PageSpinner } from '@/components/ui';
import { Navigate } from 'react-router-dom';

export default function HomePage() {
  const { session, loading, ctx } = useAuth();
  if (loading) return <PageSpinner />;
  if (session && ctx) {
    if (ctx.is_platform_admin) return <Navigate to="/admin" replace />;
    if (ctx.manager_org_ids?.length) return <Navigate to="/org" replace />;
    if (ctx.volunteer) return <Navigate to="/v" replace />;
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-6xl">🧺</div>
      <h1 className="text-3xl font-bold text-brand-800">סל בדרך</h1>
      <p className="max-w-sm text-slate-600">מערכת לניהול חלוקת סלי מזון לנזקקים — לארגונים, מנהלים ומתנדבים.</p>
      <div className="w-full max-w-xs space-y-3">
        <p className="text-sm text-slate-500">מתנדבים: היכנסו דרך הקישור שקיבלתם מהארגון.</p>
        <LinkButton to="/login" variant="secondary" className="w-full">
          כניסת מנהלים
        </LinkButton>
      </div>
    </div>
  );
}
