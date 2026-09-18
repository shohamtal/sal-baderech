import { Breadcrumbs } from '@/components/Breadcrumbs';
import { AppShell, TabBar } from '@/components/Layout';
import type { ReactNode } from 'react';
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
        <Route index element={<Page crumb="ארגונים"><OrganizationsTab /></Page>} />
        <Route path="users" element={<Page crumb="משתמשים"><PlatformUsersTab /></Page>} />
      </Routes>
    </AppShell>
  );
}

function Page({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <>
      <Breadcrumbs items={[{ label: 'הפלטפורמה', to: '/admin' }, { label: crumb }]} />
      {children}
    </>
  );
}
