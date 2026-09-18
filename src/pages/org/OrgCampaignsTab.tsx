import { CampaignStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageSpinner, Textarea } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Campaign } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOrg } from './OrgAdmin';

export default function OrgCampaignsTab() {
  const { org } = useOrg();
  const orgId = org.id;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const { data: campaigns, error } = await supabase
      .from('campaigns').select('*').eq('organization_id', orgId).order('created_at', { ascending: false });
    if (error) throw error;
    return { campaigns: campaigns as Campaign[] };
  }, [orgId]);

  return (
    <>
      {loading && <PageSpinner />}
      {error && <Alert kind="error">{errorMessage(error)}</Alert>}
      {data && (
        <>
          {!org.active && <Alert kind="warning" className="mb-4">הארגון אינו פעיל. קישורי הקמפיינים לא יעבדו.</Alert>}
          <Alert kind="info" className="mb-4">אפשר לפרסם קמפיין אחד בכל זמן נתון. כדי לפרסם קמפיין חדש יש לסיים את הנוכחי.</Alert>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">קמפיינים</h2>
            <Button size="sm" onClick={() => setOpen(true)}>+ קמפיין חדש</Button>
          </div>
          {data.campaigns.length === 0 && <EmptyState title="אין קמפיינים עדיין" description="צרו קמפיין ראשון, למשל: פסח 2027." />}
          <div className="space-y-3">
            {data.campaigns.map((c) => (
              <Link key={c.id} to={`/m/${c.id}`} className="block">
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold">{c.name}</div>
                    {c.description && <div className="line-clamp-1 text-sm text-slate-500">{c.description}</div>}
                  </div>
                  <CampaignStatusBadge status={c.status} />
                </Card>
              </Link>
            ))}
          </div>
          <NewCampaignModal open={open} onClose={() => setOpen(false)} orgId={orgId} defaultCity={org.city} onCreated={(id) => { reload(); navigate(`/m/${id}`); }} />
        </>
      )}
    </>
  );
}

function NewCampaignModal({ open, onClose, orgId, defaultCity, onCreated }: { open: boolean; onClose: () => void; orgId: string; defaultCity: string | null; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState(defaultCity ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ organization_id: orgId, name, description: description || null, city: city || null })
      .select('id')
      .single();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onCreated(data.id);
  }

  return (
    <Modal open={open} onClose={onClose} title="קמפיין חדש">
      <form onSubmit={submit} className="space-y-4">
        <Field label="שם הקמפיין"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="פסח 2027" /></Field>
        <Field label="תיאור (יוצג למתנדבים בדף ההרשמה)"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="עיר (ברירת מחדל לכתובות ולניווט)"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>יצירה</Button>
      </form>
    </Modal>
  );
}
