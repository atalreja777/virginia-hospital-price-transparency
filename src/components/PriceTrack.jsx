import { fmtUSD } from '../lib/estimate.js';

const SCALE = ['#0B7A6A', '#5A9A47', '#C98A12', '#DB6B2A', '#C7402F'];

/**
 * Where one hospital sits in the price range of the whole search.
 *
 * A column of numbers makes you do the comparison yourself. This does it for
 * you: the track spans the cheapest to the dearest hospital found, the filled
 * segment is this hospital's own span across its plans, and the marker is its
 * median. You can see "near the cheap end" without reading a single figure.
 *
 * Log-scaled, because a single search can run from $9 to $1,943 and a linear
 * track would pin almost every hospital to the left edge.
 */
export default function PriceTrack({ low, median, high, domainLow, domainHigh, band, delay = 0 }) {
  if (median == null || domainLow == null || domainHigh == null) return null;

  const lo = Math.max(1, domainLow);
  const hi = Math.max(lo * 1.0001, domainHigh);
  const span = Math.log10(hi) - Math.log10(lo);
  const pos = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(1, v)) - Math.log10(lo)) / span) * 100));

  const l = pos(low ?? median);
  const h = pos(high ?? median);
  const m = pos(median);
  const colour = SCALE[band ?? 2];

  return (
    <div className="relative h-[18px] flex items-center" aria-hidden="true">
      {/* full range of this search */}
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-paper-3" />

      {/* this hospital's own span across its plans */}
      <div
        className="absolute h-[3px] rounded-full origin-left"
        style={{
          left: `${l}%`, width: `${Math.max(0.8, h - l)}%`,
          background: colour, opacity: 0.32,
          animation: 'trackGrow .7s cubic-bezier(.16,1,.3,1) both',
          animationDelay: `${delay}ms`,
        }}
      />

      {/* the median, which is the number shown in the row */}
      <div
        className="absolute w-[11px] h-[11px] rounded-full border-2 border-[color:var(--color-card)]"
        style={{
          left: `${m}%`, transform: 'translateX(-50%)',
          background: colour,
          boxShadow: '0 1px 4px rgb(20 18 15 / .28)',
          animation: 'trackPop .5s cubic-bezier(.16,1,.3,1) both',
          animationDelay: `${delay + 160}ms`,
        }}
      />

      <style>{`
        @keyframes trackGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes trackPop { from { opacity: 0; transform: translateX(-50%) scale(.4); }
                              to { opacity: 1; transform: translateX(-50%) scale(1); } }
      `}</style>
    </div>
  );
}
