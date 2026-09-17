import { useAuth } from '@/auth/AuthProvider';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

export function AppShell({
  title,
  back,
  children,
  actions,
  wide,
}: {
  title: string;
  back?: string;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}) {
  const { ctx, signOut, session } = useAuth();
  const roleHome = ctx?.is_platform_admin ? '/admin' : ctx?.manager_org_ids?.length ? '/org' : ctx?.volunteer ? '/v' : '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 bg-brand-700 text-white shadow" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className={clsx('mx-auto flex min-h-14 items-center gap-2 px-3', wide ? 'max-w-6xl' : 'max-w-2xl')}>
          {back ? (
            <Link to={back} className="rounded-full p-2 hover:bg-white/10" aria-label="חזרה">
              <span className="text-xl">→</span>
            </Link>
          ) : (
            <Link to={roleHome} className="rounded-full p-2 hover:bg-white/10" aria-label="דף הבית">
              <span className="text-xl">🧺</span>
            </Link>
          )}
          <h1 className="flex-1 truncate text-lg font-bold">{title}</h1>
          {actions}
          {session && (
            <button type="button" onClick={signOut} className="rounded-lg px-2 py-1 text-sm text-white/80 hover:bg-white/10">
              יציאה
            </button>
          )}
        </div>
      </header>
      <main className={clsx('mx-auto w-full flex-1 px-4 pb-24 pt-4', wide ? 'max-w-6xl' : 'max-w-2xl')}>{children}</main>
    </div>
  );
}

export function TabBar({ tabs }: { tabs: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto border-b border-slate-200 bg-white px-2">
      <div className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              clsx(
                'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium',
                isActive ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
