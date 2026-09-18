import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Omitted for the current page, which is never a link. */
  to?: string;
}

/**
 * Shows where the current screen sits: platform → organization → campaign → tab.
 * The trail is passed in rather than parsed from the URL, because a slug is not
 * a display name.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="מיקום" className="mb-3 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-sm text-slate-500">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.to && !last ? (
                <Link to={c.to} className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-brand-700">
                  {c.label}
                </Link>
              ) : (
                <span className={last ? 'px-1 font-semibold text-slate-800' : 'px-1'} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <span className="text-slate-300">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
