import { useEffect, useState } from 'react';

/**
 * The volunteer tutorial, played inside the app.
 *
 * The file is a static asset served next to the app, so it has to carry the
 * deploy base: on GitHub Pages everything lives under /<repo>/ and an absolute
 * "/learn/tutorial.mp4" would 404.
 *
 * Nothing of the clip is fetched until somebody opens it: the <video> element
 * does not exist until then. What every session does pay for is the poster, a
 * single frame at ~18 KB.
 */
const SRC = `${import.meta.env.BASE_URL}learn/tutorial.mp4`;
const POSTER = `${import.meta.env.BASE_URL}learn/tutorial.jpg`;

export function TutorialPlayer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // A phone playing a 3-minute video should not be scrolling the page behind it.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="סרטון הדרכה"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <h2 className="text-base font-bold">סרטון הדרכה למתנדב</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className="rounded-full px-3 py-2 text-xl leading-none text-white/80 hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* The video is 9:16; object-contain keeps it whole on every screen shape. */}
        <video
          className="max-h-full max-w-full rounded-2xl bg-black"
          src={SRC}
          poster={POSTER}
          controls
          autoPlay
          playsInline
          controlsList="nodownload"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

/** Header button: opens the player and owns its own state, so callers just drop it in. */
export function TutorialButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? 'flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25'}
      >
        <span aria-hidden className="text-[10px]">▶</span>
        הדרכה
      </button>
      <TutorialPlayer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The same thing, as a card. A volunteer who has just landed on the link has
 * never seen the app, which is exactly who the clip is for, so it is offered
 * in the page body rather than only from the header.
 */
export function TutorialCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-right shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-500"
      >
        <img src={POSTER} alt="" className="h-16 w-10 shrink-0 rounded-lg object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-slate-800">חדשים כאן? סרטון הדרכה קצר</span>
          <span className="block text-sm text-slate-500">שלוש דקות, וזה כל מה שצריך לדעת</span>
        </span>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-700 text-white">▶</span>
      </button>
      <TutorialPlayer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
