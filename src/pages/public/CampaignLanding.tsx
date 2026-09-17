import { useAuth } from '@/auth/AuthProvider';
import { CampaignStatusBadge, VolunteerStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Card, Field, Input, LinkButton, PageSpinner } from '@/components/ui';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { PublicCampaign } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

/**
 * PUBLIC campaign page. Shows only: organization name, campaign name, description,
 * the registration form and the visitor's own registration status.
 * Nothing here is sensitive; knowing this URL grants nothing else.
 */
export default function CampaignLanding() {
  const { slug = '' } = useParams();
  const { session, ensureSession, refresh } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('get_public_campaign', { p_slug: slug });
    if (error) throw error;
    return ((data as PublicCampaign[]) ?? [])[0] ?? null;
  }, [slug, session?.user.id]);

  if (loading) return <PageSpinner />;
  if (error) return <div className="p-6"><Alert kind="error">{errorMessage(error)}</Alert></div>;
  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-5xl">🤷</div>
        <h1 className="text-xl font-bold">הקמפיין לא נמצא</h1>
        <p className="text-slate-500">בדקו את הקישור שקיבלתם מהארגון.</p>
        <Link to="/" className="text-brand-700 underline">לדף הבית</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <div className="mb-6 text-center">
        <div className="text-5xl">🧺</div>
        <div className="mt-3 text-sm font-medium text-brand-700">{data.organization_name}</div>
        <h1 className="text-2xl font-bold">{data.campaign_name}</h1>
        <div className="mt-2"><CampaignStatusBadge status={data.status} /></div>
      </div>
      {data.description && (
        <Card className="mb-5 whitespace-pre-wrap text-slate-700">{data.description}</Card>
      )}

      {data.my_status ? (
        <RegistrationStatus data={data} onRefresh={async () => { await refresh(); reload(); }} />
      ) : (
        <RegisterForm
          slug={slug}
          campaignOpen={data.status === 'OPEN' || data.status === 'IN_PROGRESS'}
          onRegistered={async () => { await refresh(); reload(); }}
          ensureSession={ensureSession}
          defaultName={data.my_full_name ?? ''}
          defaultPhone={data.my_phone ?? ''}
        />
      )}
    </div>
  );
}

function RegisterForm({
  slug, campaignOpen, onRegistered, ensureSession, defaultName, defaultPhone,
}: {
  slug: string;
  campaignOpen: boolean;
  onRegistered: () => Promise<void>;
  ensureSession: () => Promise<unknown>;
  defaultName: string;
  defaultPhone: string;
}) {
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!campaignOpen) {
    return <Alert kind="warning">הקמפיין אינו פתוח להרשמה כעת.</Alert>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const { error } = await supabase.rpc('register_volunteer', { p_slug: slug, p_full_name: name, p_phone: phone });
      if (error) throw error;
      await onRegistered();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">הרשמה להתנדבות</h2>
      <p className="mb-4 text-sm text-slate-500">
        לאחר ההרשמה מנהל הקמפיין יאשר אותך, ורק אז תוכלו לראות משלוחים.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="שם מלא">
          <Input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="טלפון נייד">
          <Input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" required placeholder="050-0000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          הרשמה
        </Button>
        <p className="text-center text-xs text-slate-400">
          ההרשמה נשמרת במכשיר זה. אם תחליפו מכשיר יש להירשם שוב ולקבל אישור מחדש.
        </p>
      </form>
    </Card>
  );
}

function RegistrationStatus({ data, onRefresh }: { data: PublicCampaign; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const status = data.my_status!;
  return (
    <Card className="space-y-4 text-center">
      <div>
        <div className="text-sm text-slate-500">שלום {data.my_full_name}</div>
        <div className="mt-2"><VolunteerStatusBadge status={status} /></div>
      </div>
      {status === 'PENDING' && (
        <>
          <Alert kind="info" className="text-right">
            ההרשמה שלך נקלטה. מנהל הקמפיין צריך לאשר אותך לפני שתוכלו לצפות במשלוחים.
            <br />
            ברגע שתאושרו, לחצו על "בדיקה מחדש" או פתחו את הקישור שוב.
          </Alert>
          <Button variant="secondary" className="w-full" loading={busy} onClick={async () => { setBusy(true); await onRefresh(); setBusy(false); }}>
            בדיקה מחדש
          </Button>
        </>
      )}
      {status === 'APPROVED' && (
        <>
          <Alert kind="success" className="text-right">אושרת להתנדבות בקמפיין. אפשר להתחיל!</Alert>
          <LinkButton to={`/v/${data.campaign_id}`} size="lg" className="w-full">
            כניסה לקמפיין
          </LinkButton>
        </>
      )}
      {status === 'REJECTED' && <Alert kind="error" className="text-right">ההרשמה לקמפיין זה לא אושרה. לפרטים פנו לארגון.</Alert>}
      {status === 'REVOKED' && <Alert kind="error" className="text-right">ההרשאה שלך לקמפיין זה בוטלה. לפרטים פנו לארגון.</Alert>}
    </Card>
  );
}
