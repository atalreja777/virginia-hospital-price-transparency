import { fmtUSD } from '../lib/estimate.js';

/**
 * One procedure's price range, drawn from the cheapest hospital to the dearest.
 * The bar is the whole argument: a wide bar means identical care costs wildly
 * different amounts depending only on where you walk in.
 *
 * Laid out as a ledger row — label, rule, figures — rather than a card, so a
 * column of them reads as a table of evidence.
 */
export default function SpreadBar({ label, low, high, ratio, hospitals, max, delay = 0 }) {
  const left = max ? (low / max) * 100 : 0;
  const width = max ? Math.max(1.2, ((high - low) / max) * 100) : 0;

  return (
    <div className="grid sm:grid-cols-[minmax(0,20ch)_1fr_auto] gap-x-6 gap-y-2.5 items-center py-5">
      <div className="min-w-0">
        <div className="text-[0.9375rem] font-medium tracking-[-0.018em] truncate">{label}</div>
        <div className="t-label opacity-35 mt-1 tnum">{hospitals} hospitals</div>
      </div>

      <div className="relative">
        <div className="relative h-[7px] bg-paper-3">
          <div
            className="absolute inset-y-0 bar-grow"
            style={{
              left: `${left}%`, width: `${width}%`, animationDelay: `${delay}ms`,
              background: 'linear-gradient(90deg,var(--color-p1) 0%,var(--color-p3) 52%,var(--color-p5) 100%)',
            }}
          />
        </div>
        <div className="flex justify-between mt-2 t-figure text-[0.75rem] opacity-55">
          <span>{fmtUSD(low, { round: true })}</span>
          <span>{fmtUSD(high, { round: true })}</span>
        </div>
      </div>

      <div className="t-figure text-[1.25rem] text-accent tabular-nums sm:text-right">
        {ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}<span className="opacity-45 text-[0.875rem]">×</span>
      </div>
    </div>
  );
}
