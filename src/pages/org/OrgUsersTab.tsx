import { UserActionsModal, type EditableUser } from '@/components/UserActions';
import { VolunteerStatusBadge } from '@/components/StatusBadge';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageSpinner, Select } from '@/components/ui';
import { formatDate, formatPhone } from '@/lib/format';
import { errorMessage } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { OrgUser, VolunteerStatus } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useMemo, useState, type FormEvent } from 'react';
import { useOrg } from './OrgArea';

/** Everyone attached to this organization: its managers and its volunteers. */
export default function OrgUsersTab() {
  const { org } = useOrg();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'MANAGERS'>('ALL');
  const [editing, setEditing] = useState<EditableUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managerEmail, setManagerEmail] = useState('');

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('org_list_users', { p_org_id: org.id });
    if (error) throw error;
    return (data ?? []) as OrgUser[];
  }, [org.id]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((u) => {
      if (filter === 'MANAGERS' && u.role !== 'ORGANIZATION_MANAGER') return false;
      if (filter === 'PENDING' && u.volunteer_status !== 'PENDING') return false;
      if (filter === 'APPROVED' && u.volunteer_status !== 'APPROVED') return false;
      if (!term) return true;
      return [u.full_name, u.email, u.phone, u.campaign_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [data, q, filter]);

  const pending = (data ?? []).filter((u) => u.volunteer_status === 'PENDING').length;

  async function setStatus(u: OrgUser, status: VolunteerStatus) {
    if (!u.campaign_volunteer_id) return;
    if (status === 'REVOKED' && !confirm(`לבטל את ההרשאה של ${u.full_name}? משלוחים שטרם נמסרו ישוחררו למאגר.`)) return;
    setBusy(u.campaign_volunteer_id);
    setError(null);
    const { error } = await supabase.rpc('set_volunteer_status', { p_cv_id: u.campaign_volunteer_id, p_status: status });
    setBusy(null);
    if (error) return setError(errorMessage(error));
    reload();
  }

  async function addManager(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase
      .from('organization_managers')
      .insert({ organization_id: org.id, email: managerEmail.trim().toLowerCase() });
    if (error) return setError(errorMessage(error));
    setManagerEmail('');
    reload();
  }

  if (loading) return <PageSpinner />;
  if (loadError) return <Alert kind="error">{errorMessage(loadError)}</Alert>;

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      {pending > 0 && filter !== 'PENDING' && (
        <Alert kind="warning">
          {pending} מתנדבים ממתינים לאישור.{' '}
          <button type="button" className="underline" onClick={() => setFilter('PENDING')}>הצגה</button>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Input placeholder="חיפוש לפי שם, אימייל או טלפון" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[14rem] flex-1" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-48">
          <option value="ALL">הכול</option>
          <option value="PENDING">ממתינים לאישור</option>
          <option value="APPROVED">מתנדבים מאושרים</option>
          <option value="MANAGERS">מנהלי הארגון</option>
        </Select>
      </div>

      {rows.length === 0 && <EmptyState title="לא נמצאו משתמשים" />}

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">שם</th>
              <th className="px-3 py-2">תפקיד</th>
              <th className="px-3 py-2">קמפיין</th>
              <th className="px-3 py-2">סטטוס</th>
              <th className="px-3 py-2">סלים</th>
              <th className="px-3 py-2">הצטרף</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u, i) => (
              <tr key={`${u.campaign_volunteer_id ?? u.email}-${i}`} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold">{u.full_name ?? u.email ?? '—'}</div>
                  {u.phone && <a href={`tel:${u.phone}`} className="text-xs text-brand-700" dir="ltr">{formatPhone(u.phone)}</a>}
                  {u.email && <div className="text-xs text-slate-500" dir="ltr">{u.email}</div>}
                </td>
                <td className="px-3 py-2">
                  {u.role === 'ORGANIZATION_MANAGER'
                    ? <Badge color="blue">{u.user_id ? 'מנהל ארגון' : 'הוזמן, טרם נרשם'}</Badge>
                    : <Badge color="teal">מתנדב</Badge>}
                </td>
                <td className="px-3 py-2 text-slate-600">{u.campaign_name ?? '—'}</td>
                <td className="px-3 py-2">{u.volunteer_status ? <VolunteerStatusBadge status={u.volunteer_status} /> : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {u.role === 'VOLUNTEER' ? `${u.delivered} נמסרו · ${u.claimed} פעילים` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatDate(u.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.volunteer_status === 'PENDING' && (
                      <>
                        <Button size="sm" variant="success" loading={busy === u.campaign_volunteer_id} onClick={() => setStatus(u, 'APPROVED')}>אישור</Button>
                        <Button size="sm" variant="secondary" loading={busy === u.campaign_volunteer_id} onClick={() => setStatus(u, 'REJECTED')}>דחייה</Button>
                      </>
                    )}
                    {u.volunteer_status === 'APPROVED' && (
                      <Button size="sm" variant="danger" loading={busy === u.campaign_volunteer_id} onClick={() => setStatus(u, 'REVOKED')}>ביטול הרשאה</Button>
                    )}
                    {(u.volunteer_status === 'REJECTED' || u.volunteer_status === 'REVOKED') && (
                      <Button size="sm" variant="secondary" loading={busy === u.campaign_volunteer_id} onClick={() => setStatus(u, 'APPROVED')}>אישור מחדש</Button>
                    )}
                    <button
                      type="button" className="whitespace-nowrap px-2 text-brand-700 underline"
                      onClick={() => setEditing({
                        user_id: u.user_id, email: u.email, full_name: u.full_name,
                        phone: u.phone, volunteer_id: u.volunteer_id,
                        is_anonymous: u.role === 'VOLUNTEER',
                      })}
                    >
                      ניהול
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <h3 className="mb-1 font-bold">הוספת מנהל ארגון</h3>
        <p className="mb-3 text-sm text-slate-500">רק מי שמופיע כאן יכול להיכנס ולנהל את הארגון. המנהל נרשם בדף הכניסה עם אותו אימייל.</p>
        <form onSubmit={addManager} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Field label="אימייל"><Input type="email" dir="ltr" required placeholder="manager@example.com" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} /></Field>
          </div>
          <Button type="submit" size="sm">הוספה</Button>
        </form>
      </Card>

      <UserActionsModal user={editing} open={Boolean(editing)} onClose={() => setEditing(null)} onChanged={reload} />
    </div>
  );
}
