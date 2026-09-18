import { AppShell, TabBar } from '@/components/Layout';
import { Route, Routes } from 'react-router-dom';
import OrganizationsTab from './OrganizationsTab';
import PlatformUsersTab from './PlatformUsersTab';

/** Platform administration. Reachable only by a platform admin (see RequireAuth). */
export default function PlatformAdmin() {
  return (
    <AppShell title="ניהול הפלטפורמה" wide>
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
