import { Alert, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { useAsync } from '@/lib/useAsync';
import { Link, Navigate, useParams } from 'react-router-dom';

/** Campaign links shared before organization URLs existed still resolve. */
export default function LegacyCampaignLink() {
  const { slug = '' } = useParams();
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await supabase.rpc('get_public_campaign', { p_slug: slug });
    if (error) throw error;
    return ((data as { organization_slug: string }[]) ?? [])[0] ?? null;
  }, [slug]);

  if (loading) return <PageSpinner />;
  if (error) return <div className="p-6"><Alert kind="error">{errorMessage(error)}</Alert></div>;
  if (data?.organization_slug) {
    return <Navigate to={`/${encodeURIComponent(data.organization_slug)}/home`} replace />;
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl">🤷</div>
      <h1 className="text-xl font-bold">הקישור אינו פעיל</h1>
      <p className="text-slate-500">בקשו מהארגון את הקישור המעודכן.</p>
      <Link to="/" className="text-brand-700 underline">לדף הבית</Link>
    </div>
  );
}
