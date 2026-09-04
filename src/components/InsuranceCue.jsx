import { useEffect, useState } from 'react';
import { fmtUSD } from '../lib/estimate.js';

/**
 * The prompt to add insurance, and afterwards the place to change it.
 *
 * It slides in from the corner a moment after the prices land, rather than on
 * arrival: the visitor came to see numbers, and something that covers them
 * before they appear gets dismissed unread. Once details are in, the same card
 * becomes a compact readout of what was entered and a way back in.
 *
 * Dismissing it is remembered for the session, so it never nags.
 */
export default function InsuranceCue({ onOpen, brand, preview, hasBenefits }) {
  const [shown, setShown] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('cueDismissed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    const t = setTimeout(() => setShown(true), 1400);
    return () => clearTimeout(t);
  }, [dismissed]);

  const dismiss = () => {
    setShown(false);
    setDismissed(true);
    try { sessionStorage.setItem('cueDismissed', '1'); } catch { /* private mode */ }
  };

  // Once details are entered the card is useful rather than promotional, so it
  // stays available even if the prompt was dismissed earlier.
  const configured = !!brand || hasBenefits;
  if (dismissed && !configured) return null;

  return (
    <div
      className={`fixed z-50 right-4 bottom-16 sm:right-6 sm:bottom-20 w-[min(21rem,calc(100vw-2rem))] no-print
                  transition-all duration-500 ${shown || configured ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'}`}
      style={{ transitionTimingFunction: 'cubic-bezier(.16,1,.3,1)' }}
    >
      <div className="rounded-[22px] bg-ink text-paper p-5 shadow-[0_18px_50px_-12px_rgb(20_18_15/0.45)]">
        {configured ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="t-label opacity-45">Your insurance</div>
                <div className="font-semibold tracking-[-0.014em] mt-1 truncate">
                  {brand || 'Benefits entered'}
                </div>
              </div>
              <span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: 'var(--color-accent-dk)' }} />
            </div>

            {preview && (
              <div className="mt-4 pt-4 border-t border-hair">
                <div className="t-label opacity-45">You would pay, at the cheapest</div>
                <div className="t-num text-[1.75rem] mt-1" style={{ color: 'var(--color-accent-dk)' }}>
                  {fmtUSD(preview.cheapest, { round: true })}
                </div>
              </div>
            )}

            <button onClick={onOpen}
                    className="btn btn-ghost w-full justify-center mt-4 !py-2 !text-[0.8125rem] border-hair hover:bg-ink-3">
              Change
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold tracking-[-0.014em] text-[1rem] leading-snug">
                See what <span style={{ color: 'var(--color-accent-dk)' }}>you</span> would pay
              </p>
              <button onClick={dismiss} aria-label="Dismiss"
                      className="w-7 h-7 -mt-1 -mr-1 rounded-full grid place-items-center opacity-45 hover:opacity-100 hover:bg-ink-3 transition">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <p className="t-small opacity-65 mt-2">
              Add your plan and these prices become your actual share — deductible,
              coinsurance and all. Takes about thirty seconds.
            </p>
            <button onClick={onOpen} className="btn btn-accent w-full justify-center mt-4 !py-2.5">
              Add your insurance
            </button>
          </>
        )}
      </div>
    </div>
  );
}
