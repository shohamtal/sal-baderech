import { useAuth } from '@/auth/AuthProvider';
import { VolunteerStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, Field, Input, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { OrgHome as OrgHomeData } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import PickTab from './PickTab';
import TasksTab from './TasksTab';

/**
 * The volunteer's home for one organization: /:orgSlug/home.
 *
 * A permanent link. It always points at whichever campaign the organization has
 * published, so it can be shared once and reused every holiday.
 */
export default function OrgHome() {
  const { orgSlug = '' } = useParams();
  const { session, ensureSession, refresh } = useAuth();
  const [tab, setTab] = useState<'pick' | 'tasks'>('tasks');

  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('get_org_home', { p_slug: orgSlug });
    if (error) throw error;
    return data as OrgHomeData | null;
  }, [orgSlug, session?.user.id]);

  if (loading) return <PageSpinner />;
  if (error) return <div className="p-6"><Alert kind="error">{errorMessage(error)}</Alert></div>;

  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-5xl">🤷</div>
        <h1 className="text-xl font-bold">הארגון לא נמצא</h1>
        <p className="text-slate-500">בדקו את הקישור שקיבלתם.</p>
        <Link to="/" className="text-brand-700 underline">לדף הבית</Link>
      </div>
    );
  }

  const { organization: org, campaign, my_status: status } = data;
  const approved = status === 'APPROVED';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 bg-brand-700 text-white shadow" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex min-h-14 max-w-2xl items-center gap-2 px-4">
          <span className="text-xl">🧺</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm opacity-80">{org.name}</div>
            <div className="truncate font-bold">{campaign?.name ?? 'אין קמפיין פעיל'}</div>
          </div>
          {session && !session.user.is_anonymous === false && status && <VolunteerStatusBadge status={status} />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">
        {!campaign && (
          <Card className="space-y-2 text-center">
            <div className="text-4xl">🗓️</div>
            <h2 className="text-lg font-bold">אין כרגע חלוקה פעילה</h2>
            <p className="text-slate-600">{org.name} עדיין לא פרסמו חלוקה. שמרו את הקישור — הוא יעבוד גם בפעם הבאה.</p>
            {org.contact_phone && (
              <p className="text-sm text-slate-500">
                לשאלות: <a href={`tel:${org.contact_phone}`} className="text-brand-700 underline" dir="ltr">{org.contact_phone}</a>
              </p>
            )}
          </Card>
        )}

        {campaign && !status && (
          <RegisterCard
            orgSlug={orgSlug}
            orgName={org.name}
            description={campaign.description}
            defaultName={data.my_name ?? ''}
            defaultPhone={data.my_phone ?? ''}
            ensureSession={ensureSession}
            onRegistered={async () => { await refresh(); reload(); }}
          />
        )}

        {campaign && status && status !== 'APPROVED' && (
          <Card className="space-y-4 text-center">
            <div><VolunteerStatusBadge status={status} /></div>
            {status === 'PENDING' && (
              <>
                <div className="text-4xl">⏳</div>
                <h2 className="text-lg font-bold">ההרשמה נקלטה</h2>
                <Alert kind="info" className="text-right">
                  רכז הארגון צריך לאשר אותך לפני שתוכלו לראות כתובות. ברגע שתאושרו, לחצו על ״בדיקה מחדש״.
                </Alert>
                <Button variant="secondary" className="w-full" onClick={async () => { await refresh(); reload(); }}>
                  בדיקה מחדש
                </Button>
              </>
            )}
            {status === 'REJECTED' && <p className="text-slate-600">ההרשמה לא אושרה. לפרטים פנו לארגון.</p>}
            {status === 'REVOKED' && <p className="text-slate-600">ההרשאה שלך בוטלה. לפרטים פנו לארגון.</p>}
            {org.contact_phone && (
              <a href={`tel:${org.contact_phone}`} className="block text-brand-700 underline" dir="ltr">{org.contact_phone}</a>
            )}
          </Card>
        )}

        {campaign && approved && (
          <>
            <div className="mb-4 flex gap-2">
              {([['tasks', 'המשימות שלי'], ['pick', 'בחירת כתובות']] as const).map(([k, label]) => (
                <button
                  key={k} type="button" onClick={() => setTab(k)}
                  className={clsx(
                    'min-h-12 flex-1 rounded-xl text-base font-semibold ring-1 transition',
                    tab === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'pick'
              ? <PickTab campaignId={campaign.id} onClaimed={() => setTab('tasks')} />
              : <TasksTab campaignId={campaign.id} campaignCity={campaign.city} />}
          </>
        )}
      </main>
    </div>
  );
}

function RegisterCard({
  orgSlug, orgName, description, defaultName, defaultPhone, ensureSession, onRegistered,
}: {
  orgSlug: string; orgName: string; description: string | null;
  defaultName: string; defaultPhone: string;
  ensureSession: () => Promise<unknown>; onRegistered: () => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const { error } = await supabase.rpc('register_volunteer_for_org', {
        p_org_slug: orgSlug, p_full_name: name, p_phone: phone,
      });
      if (error) throw error;
      await onRegistered();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {description && <Card className="whitespace-pre-wrap text-slate-700">{description}</Card>}
      <Card>
        <h2 className="mb-1 text-lg font-bold">בקשה להתנדבות</h2>
        <p className="mb-4 text-sm text-slate-500">
          אחרי השליחה, רכז {orgName} יאשר אתכם. רק אז יוצגו כתובות לחלוקה.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="שם מלא">
            <Input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="טלפון נייד">
            <Input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" required placeholder="050-0000000"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>שליחת בקשה</Button>
          <p className="text-center text-xs text-slate-400">
            הבקשה נשמרת במכשיר זה. אם תחליפו מכשיר יש להירשם שוב.
          </p>
        </form>
      </Card>
    </div>
  );
}
