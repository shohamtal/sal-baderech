import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'plain';

const variantClass: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800 disabled:bg-brand-700/50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
  plain: '',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        size === 'sm' && 'min-h-10 px-3 text-sm',
        size === 'md' && 'min-h-12 px-4 text-base',
        size === 'lg' && 'min-h-14 px-5 text-lg',
        variantClass[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'primary',
  size = 'md',
  className,
  children,
  external,
}: {
  to: string;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = clsx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition select-none',
    size === 'sm' && 'min-h-10 px-3 text-sm',
    size === 'md' && 'min-h-12 px-4 text-base',
    size === 'lg' && 'min-h-14 px-5 text-lg',
    variantClass[variant],
    className,
  );
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'size-6')} viewBox="0 0 24 24" fill="none" aria-label="טוען">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner className="size-8" />
      {label && <div>{label}</div>}
    </div>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={clsx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200', onClick && 'cursor-pointer active:bg-slate-50', className)}
    >
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputClass =
  'block w-full min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, 'py-2', props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputClass, props.className)} />;
}

export function Alert({ kind = 'info', children, className }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; className?: string }) {
  const cls = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    error: 'bg-red-50 text-red-900 ring-red-200',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  }[kind];
  return <div className={clsx('rounded-xl px-4 py-3 text-sm ring-1', cls, className)}>{children}</div>;
}

export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: string }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    purple: 'bg-violet-100 text-violet-800',
    teal: 'bg-brand-100 text-brand-800',
  };
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', map[color] ?? map.slate)}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="text-lg font-semibold text-slate-700">{title}</div>
      {description && <div className="max-w-sm text-sm text-slate-500">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="סגור">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatCard({ label, value, tone = 'slate' }: { label: string; value: number | string; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-800',
    green: 'text-emerald-700',
    blue: 'text-sky-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    teal: 'text-brand-700',
  };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-3xl font-bold tabular-nums', tones[tone])}>{value}</div>
    </div>
  );
}
