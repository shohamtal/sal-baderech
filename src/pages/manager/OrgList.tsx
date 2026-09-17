import { useAuth } from '@/auth/AuthProvider';
import { AppShell } from '@/components/Layout';
import { Alert, Card, EmptyState, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { Link, Navigate } from 'react-router-dom';

export default function OrgList() {
  const { ctx } = useAuth();
  const { data, loading, error } = useAsync(async () => {
    const ids = ctx?.manager_org_ids ?? [];
    let q = supabase.from('organizations').select('*').order('name');
    if (!ctx?.is_platform_admin) q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const { data, error } = await q;
    if (error) throw error;
    return data as Organization[];
  }, [ctx?.manager_org_ids?.join(',')]);

  if (loading) return <AppShell title="הארגונים שלי"><PageSpinner /></AppShell>;
  if (data && data.length === 1 && !ctx?.is_platform_admin) return <Navigate to={`/org/${data[0].id}`} replace />;

  return (
    <AppShell title="הארגונים שלי">
      {error && <Alert kind="error">{errorMessage(error)}</Alert>}
      {data?.length === 0 && <EmptyState title="לא נמצאו ארגונים" description="מנהל הפלטפורמה צריך לשייך אותך לארגון." />}
      <div className="space-y-3">
        {data?.map((o) => (
          <Link key={o.id} to={`/org/${o.id}`} className="block">
            <Card>
              <div className="text-lg font-bold">{o.name}</div>
              {o.city && <div className="text-sm text-slate-500">{o.city}</div>}
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
