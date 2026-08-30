import { useMemo, useRef, useState } from 'react';
import { fmtUSD } from '../lib/estimate.js';
import { approxRoadMiles } from '../lib/geo.js';

const SCALE = ['#0B7A6A', '#5A9A47', '#C98A12', '#DB6B2A', '#C7402F'];
const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

/**
 * Price against distance — the actual trade-off.
 *
 * A list sorted by price hides how far you would have to drive; a list sorted
 * by distance hides what it costs. This plots both at once, so the decision
 * becomes a shape rather than a comparison you hold in your head. The bottom
 * left is cheap and close, and it is shaded, because that is the answer most
 * people are looking for.
 *
 * Price is log-scaled: a search can run from $9 to $1,943, and on a linear axis
 * every affordable hospital would pile onto the floor of the chart.
 */
export default function PriceDistanceChart({ rows, onSelect, selected, estimateFn }) {
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);

  const pts = useMemo(() => {
    const withBoth = rows.filter((r) => r.median != null && r.miles != null);
    if (withBoth.length < 2) return null;

    const prices = withBoth.map((r) => (estimateFn ? estimateFn(r.median).patient : r.median));
    const miles = withBoth.map((r) => r.miles);
    const pLo = Math.max(1, Math.min(...prices)), pHi = Math.max(...prices, pLo * 1.05);
    const mLo = 0, mHi = Math.max(...miles, 5);
    const span = Math.log10(pHi) - Math.log10(pLo);

    return {
      pLo, pHi, mHi,
      items: withBoth.map((r, i) => {
        const price = prices[i];
        const t = span > 0 ? (Math.log10(Math.max(1, price)) - Math.log10(pLo)) / span : 0.5;
        return {
          ...r, price,
          // 0..1 in chart space; y inverted so cheap sits at the bottom
          fx: (r.miles - mLo) / (mHi - mLo || 1),
          fy: 1 - t,
          band: Math.min(4, Math.max(0, Math.floor(t * 5))),
        };
      }),
    };
  }, [rows, estimateFn]);

  if (!pts) {
    return (
      <div className="rounded-[26px] bg-paper-2 p-10 text-center">
        <p className="text-[1.0625rem] font-semibold">Not enough to plot yet</p>
        <p className="t-small opacity-60 mt-2 max-w-[40ch] mx-auto">
          This view charts price against how far you would drive, so it needs your ZIP code
          and at least two hospitals with a published price.
        </p>
      </div>
    );
  }

  const W = 100, H = 100, PADL = 4, PADR = 13, PADT = 5, PADB = 11;
  const X = (f) => PADL + f * (W - PADL - PADR);
  const Y = (f) => PADT + f * (H - PADT - PADB);

  // A few price gridlines, at round numbers inside the range.
  const ticks = [];
  for (const v of [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]) {
    const c = v * 100;
    if (c > pts.pLo * 0.9 && c < pts.pHi * 1.1) {
      const span = Math.log10(pts.pHi) - Math.log10(pts.pLo);
      ticks.push({ v: c, y: Y(1 - (Math.log10(c) - Math.log10(pts.pLo)) / span) });
    }
  }

  const shown = hover ? pts.items.find((i) => i.ccn === hover) : null;

  return (
    <div ref={wrap} className="rounded-[26px] bg-card border rule overflow-hidden">
      <div className="px-5 sm:px-6 pt-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[1.0625rem] font-semibold tracking-[-0.016em]">Price against distance</h3>
          <p className="t-small opacity-55 mt-1 max-w-[46ch]">
            Every hospital placed by what it charges and how far you would drive.
            Bottom left is cheap and close.
          </p>
        </div>
        <div className="flex items-center gap-1.5 t-small opacity-55">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: SCALE[0] }} />cheaper
          <span className="w-2.5 h-2.5 rounded-full ml-2" style={{ background: SCALE[4] }} />dearer
        </div>
      </div>

      <div className="relative px-5 sm:px-6 pb-2">
        <svg viewBox="0 0 100 100" className="w-full h-[27rem] mt-3 overflow-visible" role="img"
             aria-label="Scatter chart of hospital price against driving distance">
          {/* the answer zone */}
          <rect x={X(0)} y={Y(0.55)} width={X(0.42) - X(0)} height={Y(1) - Y(0.55)}
                fill="var(--color-low)" opacity="0.055" rx="1.5" />
          <text x={X(0.02)} y={Y(0.97)} fontSize="2.5" fill="var(--color-low)" opacity="0.8"
                style={{ fontWeight: 600 }}>cheap and close</text>

          {/* axis captions, so nobody has to infer what the axes mean */}
          <text x={X(0.5)} y={Y(1) + 9} fontSize="2.4" fill="currentColor" opacity="0.4" textAnchor="middle"
                style={{ fontWeight: 600 }}>how far you would drive →</text>

          {/* price gridlines */}
          {ticks.map((t) => (
            <g key={t.v}>
              <line x1={X(0)} x2={X(1)} y1={t.y} y2={t.y} stroke="var(--color-rule)" strokeWidth="0.16" />
              <text x={X(1) + 1.2} y={t.y + 0.7} fontSize="2.4" fill="currentColor" opacity="0.45">
                {fmtUSD(t.v, { round: true })}
              </text>
            </g>
          ))}

          {/* distance axis */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={X(f)} y={Y(1) + 4.5} fontSize="2.4" fill="currentColor" opacity="0.45" textAnchor="middle">
              {Math.round(pts.mHi * f)} mi
            </text>
          ))}

          {pts.items.map((it, i) => {
            const on = selected === it.ccn || hover === it.ccn;
            return (
              <circle
                key={it.ccn || i}
                cx={X(it.fx)} cy={Y(it.fy)}
                r={on ? 3.6 : 2.5}
                fill={SCALE[it.band]}
                stroke="var(--color-card)" strokeWidth={on ? 0.9 : 0.6}
                opacity={hover && !on ? 0.35 : 1}
                style={{
                  cursor: 'pointer',
                  transition: 'r .18s cubic-bezier(.16,1,.3,1)',
                  animation: 'dotIn .5s cubic-bezier(.16,1,.3,1) both',
                  animationDelay: `${Math.min(i * 35, 600)}ms`,
                }}
                onMouseEnter={() => setHover(it.ccn)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(it.ccn)}
              />
            );
          })}
          <style>{`@keyframes dotIn { from { opacity:0; transform: scale(.2); transform-box: fill-box; transform-origin: center; } to { opacity:1; transform: scale(1); } }`}</style>
        </svg>
      </div>

      <div className="px-5 sm:px-6 pb-5 pt-1 min-h-[4.25rem] border-t rule mt-1">
        {shown ? (
          <div className="pt-3.5 flex items-baseline justify-between gap-5 flex-wrap">
            <div className="min-w-0">
              <div className="font-semibold tracking-[-0.016em] truncate">{titleCase(shown.name)}</div>
              <div className="t-small opacity-55 mt-0.5">
                {titleCase(shown.city)} · <span className="tabular-nums">{shown.miles.toFixed(0)} mi</span>
                <span className="opacity-70"> ({approxRoadMiles(shown.miles).toFixed(0)} driving)</span>
              </div>
            </div>
            <div className="t-num text-[1.5rem]" style={{ color: SCALE[shown.band] }}>
              {fmtUSD(shown.price, { round: true })}
            </div>
          </div>
        ) : (
          <p className="t-small opacity-45 pt-4">
            Hover any hospital to see it. Click to open it in the list.
            {estimateFn && ' Showing what you would pay with your insurance.'}
          </p>
        )}
      </div>
    </div>
  );
}
