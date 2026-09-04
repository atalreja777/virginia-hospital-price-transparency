import { useState } from 'react';

/**
 * A quiet, dismissible admission that this is transcribed data, not audited
 * data. Shown on every route rather than buried on one page, because the
 * caveat matters most on exactly the pages that show a number.
 */
export default function ResearchPreviewBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('previewBannerDismissed') === '1'; } catch { return false; }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('previewBannerDismissed', '1'); } catch { /* private mode */ }
  };

  // Fixed to the bottom rather than stacked under the fixed top nav — every
  // page already sizes its own top padding around Nav's exact height, and a
  // second fixed bar up there would sit on top of that content rather than
  // pushing it down. The bottom edge has nothing else full-width pinned to it.
  return (
    <div role="note" className="fixed bottom-0 inset-x-0 z-40 no-print bg-[var(--color-mid-tint)] border-t rule">
      <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-2 flex items-center gap-3">
        <p className="t-small opacity-80 flex-1 min-w-0">
          Research preview. Prices are transcribed from hospital files and may contain source
          errors; verify with the hospital before deciding.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this notice"
          className="shrink-0 w-7 h-7 rounded-full grid place-items-center opacity-60 hover:opacity-100 hover:bg-black/5 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
