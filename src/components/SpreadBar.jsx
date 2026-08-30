import { fmtUSD } from '../lib/estimate.js';

/**
 * One procedure's price range, from the cheaper Virginia hospitals to the dearer.
 *
 * Plotted on a shared logarithmic axis. These procedures span four orders of
 * magnitude — a blood count starts at $8, a joint replacement runs past $45,000 —
 * and on a linear axis every cheap procedure collapses into an invisible sliver
 * against the most expensive one. A log axis keeps both the absolute cost and
 * the size of the gap readable in the same column, which is the whole point of
 * putting them side by side.
 */
export default function SpreadBar({ label, low, high, ratio, hospitals, domain, delay = 0 }) {
  // domain = [min, max] in cents across every bar in the column
  const lo = Math.max(1, domain?.[0] ?? low);
  const hi = Math.max(lo * 1.0001, domain?.[1] ?? high);
  const span = Math.log10(hi) - Math.log10(lo);
  const pos = (v) => ((Math.log10(Math.max(1, v)) - Math.log10(lo)) / span) * 100;

  const left = pos(low);
  const width = Math.max(1.5, pos(high) - left);

  return (
    <div className="grid sm:grid-cols-[minmax(0,17ch)_1fr_auto] gap-x-5 gap-y-2 items-center py-4">
      <div className="min-w-0">
        <div className="text-[0.9375rem] font-medium tracking-[-0.016em] truncate">{label}</div>
        <div className="t-small opacity-35 mt-0.5 tabular-nums">{hospitals} hospitals</div>
      </div>

      <div className="relative">
        <div className="relative h-[9px] rounded-full bg-paper-3/70">
          <div
            className="absolute inset-y-0 rounded-full bar-grow"
            style={{
              left: `${left}%`, width: `${width}%`, animationDelay: `${delay}ms`,
              background: 'linear-gradient(90deg,var(--color-p1),var(--color-p3) 55%,var(--color-p5))',
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5 t-figure text-[0.6875rem] opacity-50">
          <span>{fmtUSD(low, { round: true })}</span>
          <span>{fmtUSD(high, { round: true })}</span>
        </div>
      </div>

      <div className="t-num text-[1.125rem] text-accent sm:text-right tabular-nums">
        {ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}<span className="opacity-40 text-[0.8125rem]">×</span>
      </div>
    </div>
  );
}
