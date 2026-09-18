import { Breadcrumbs } from '@/components/Breadcrumbs';
import { AppShell, TabBar } from '@/components/Layout';
import { Route, Routes, useLocation } from 'react-router-dom';
import OrganizationsTab from './OrganizationsTab';
import PlatformUsersTab from './PlatformUsersTab';

const SECTION: Record<string, string> = { users: 'משתמשים' };

/** Platform administration. Reachable only by a platform admin (see RequireAuth). */
export default function PlatformAdmin() {
  const { pathname } = useLocation();
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  const section = SECTION[last] ?? 'ארגונים';

  return (
    <AppShell title="ניהול הפלטפורמה" wide>
      <Breadcrumbs items={[{ label: 'הפלטפורמה', to: '/admin' }, { label: section }]} />
      <TabBar
        tabs={[
          { to: '/admin', label: 'ארגונים', end: true },
          { to: '/admin/users', label: 'משתמשים' },
        ]}
      />
      <Routes>
        <Route index element={<OrganizationsTab />} />
        <Route path="users" element={<PlatformUsersTab />} />
      </Routes>
    </AppShell>
  );
}
