import { UserActionsModal, type EditableUser } from '@/components/UserActions';
import { Alert, Badge, Button, Card, EmptyState, Input, PageSpinner, Select } from '@/components/ui';
import { callAdminUsers } from '@/lib/adminApi';
import { formatDate, formatPhone } from '@/lib/format';
import { errorMessage, volunteerStatusLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { PendingInvite, PlatformUser } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { useMemo, useState } from 'react';

type RoleFilter = 'ALL' | 'PLATFORM_ADMIN' | 'ORGANIZATION_MANAGER' | 'VOLUNTEER';

/** Every account on the platform, in one table. */
export default function PlatformUsersTab() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [editing, setEditing] = useState<EditableUser | null>(null);

  const [purging, setPurging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [{ data: users, error: e1 }, { data: invites, error: e2 }, { data: abandoned }] = await Promise.all([
      supabase.rpc('admin_list_users'),
      supabase.rpc('admin_list_invites'),
      supabase.rpc('admin_abandoned_signups'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return {
      users: (users ?? []) as PlatformUser[],
      invites: (invites ?? []) as PendingInvite[],
      abandoned: (abandoned as { count: number } | null)?.count ?? 0,
    };
  }, []);

  async function purge() {
    setPurging(true);
    setNotice(null);
    try {
      await callAdminUsers({ action: 'purge_abandoned' });
      setNotice('הרשמות שלא הושלמו נמחקו.');
      reload();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setPurging(false);
    }
  }

  const roleOf = (u: PlatformUser): RoleFilter =>
    u.is_platform_admin ? 'PLATFORM_ADMIN' : u.managed_orgs.length ? 'ORGANIZATION_MANAGER' : 'VOLUNTEER';

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => {
      if (role !== 'ALL' && roleOf(u) !== role) return false;
      if (!term) return true;
      return [u.email, u.full_name, u.phone, ...u.managed_orgs.map((o) => o.name)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [data, q, role]);

  if (loading) return <PageSpinner />;
  if (error) return <Alert kind="error">{errorMessage(error)}</Alert>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="חיפוש לפי שם, אימייל, טלפון או ארגון" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[14rem] flex-1" />
        <Select value={role} onChange={(e) => setRole(e.target.value as RoleFilter)} className="w-52">
          <option value="ALL">כל התפקידים</option>
          <option value="PLATFORM_ADMIN">מנהלי פלטפורמה</option>
          <option value="ORGANIZATION_MANAGER">מנהלי ארגון</option>
          <option value="VOLUNTEER">מתנדבים</option>
        </Select>
      </div>
      <div className="text-sm text-slate-500">{rows.length} מתוך {data?.users.length ?? 0} משתמשים</div>

      {notice && <Alert kind="info">{notice}</Alert>}
      {(data?.abandoned ?? 0) > 0 && (
        <Alert kind="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {data!.abandoned} הרשמות שלא הושלמו — מישהו פתח את טופס ההרשמה ולא שלח אותו. הן אינן משתמשים ואינן מוצגות בטבלה.
          </span>
          <Button size="sm" variant="secondary" loading={purging} onClick={purge}>מחיקה</Button>
        </Alert>
      )}

      {rows.length === 0 && <EmptyState title="לא נמצאו משתמשים" />}

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">משתמש</th>
              <th className="px-3 py-2">תפקיד</th>
              <th className="px-3 py-2">ארגונים</th>
              <th className="px-3 py-2">קמפיינים</th>
              <th className="px-3 py-2">נרשם</th>
              <th className="px-3 py-2">כניסה אחרונה</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.user_id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  {/* An account may have both an email and a volunteer name; show both,
                      so it is obvious that they are the same person. */}
                  <div className="font-semibold">{u.email ?? u.full_name}</div>
                  {u.email && u.full_name && (
                    <div className="text-xs text-slate-600">בהתנדבות: {u.full_name}</div>
                  )}
                  {u.phone && <div className="text-xs text-slate-500" dir="ltr">{formatPhone(u.phone)}</div>}
                </td>
                <td className="px-3 py-2">
                  {/* One account can hold several roles at once, so show them all. */}
                  <div className="flex flex-wrap gap-1">
                    {u.is_platform_admin && <Badge color="purple">מנהל פלטפורמה</Badge>}
                    {u.managed_orgs.length > 0 && <Badge color="blue">מנהל ארגון</Badge>}
                    {u.volunteer_id && <Badge color="teal">מתנדב</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">{u.managed_orgs.map((o) => o.name).join(', ') || '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  {u.campaigns.length === 0 ? '—' : u.campaigns.map((c, i) => (
                    <div key={i} className="whitespace-nowrap text-xs">
                      {c.campaign} · {volunteerStatusLabel[c.status]}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatDate(u.created_at)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'טרם נכנס'}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="whitespace-nowrap text-brand-700 underline"
                    onClick={() => setEditing({
                      user_id: u.user_id, email: u.email, full_name: u.full_name,
                      phone: u.phone, volunteer_id: u.volunteer_id, is_anonymous: u.is_anonymous,
                    })}
                  >
                    ניהול
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data?.invites.length ?? 0) > 0 && (
        <Card>
          <h3 className="mb-2 font-bold">הזמנות שממתינות להרשמה ({data!.invites.length})</h3>
          <p className="mb-2 text-sm text-slate-500">הוזמנו אך עדיין לא נרשמו, ולכן אין להם חשבון לנהל.</p>
          <ul className="space-y-1 text-sm">
            {data!.invites.map((i, idx) => (
              <li key={idx} className="flex flex-wrap items-center gap-2">
                <span dir="ltr">{i.email}</span>
                <Badge color={i.kind === 'PLATFORM_ADMIN' ? 'purple' : 'blue'}>
                  {i.kind === 'PLATFORM_ADMIN' ? 'מנהל פלטפורמה' : `מנהל ${i.organization_name ?? 'ארגון'}`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <UserActionsModal
        user={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onChanged={reload}
        allowDelete
      />
    </div>
  );
}
