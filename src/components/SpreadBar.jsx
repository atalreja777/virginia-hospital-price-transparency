import { fmtUSD } from '../lib/estimate.js';

/**
 * A shared logarithmic price scale for the whole column.
 *
 * These procedures span four orders of magnitude — a blood count starts at $8,
 * a joint replacement runs past $45,000 — and on a linear axis every cheap
 * procedure collapses into an invisible sliver against the most expensive one.
 *
 * The domain is padded outward so no dot reaches the edge of the track. The
 * padding is lopsided on purpose: the low end only ever has to clear something
 * like "$8", while the high end has to clear "$45,901", so an even margin would
 * either crowd the right or waste the left.
 */
const PAD_LO = 0.30;
const PAD_HI = 0.62;

export function logScale(domain) {
  if (!domain) return null;
  const lo = Math.max(1, domain[0]) / 10 ** PAD_LO;
  const hi = Math.max(lo * 1.0001, domain[1]) * 10 ** PAD_HI;
  const span = Math.log10(hi) - Math.log10(lo);
  return {
    lo, hi,
    pos: (v) => ((Math.log10(Math.max(1, v)) - Math.log10(lo)) / span) * 100,
  };
}

/**
 * Ticks at every power of ten inside the domain, which on this scale means
 * every decade of dollars: $10, $100, $1K, $10K. They are what turns the
 * column from floating marks into one readable chart — without them a reader
 * cannot tell that a dot further right means a dearer hospital.
 */
export function decadeTicks(domain) {
  const s = logScale(domain);
  if (!s) return [];
  const out = [];
  // Bounded by the real data, not the padded track. A tick out in the margin
  // would advertise a decade no procedure on this chart actually reaches.
  for (let e = Math.ceil(Math.log10(domain[0])); 10 ** e <= domain[1]; e++) {
    const dollars = 10 ** e / 100;
    if (dollars < 1) continue;
    out.push({
      cents: 10 ** e,
      pct: s.pos(10 ** e),
      label: dollars >= 1000 ? `$${dollars / 1000}K` : `$${dollars}`,
    });
  }
  return out;
}

// The site's five-step price scale, reused so a dot means the same thing here
// as a pin on the map or a band on a hospital page.
const STEPS = ['var(--color-p1)', 'var(--color-p2)', 'var(--color-p3)', 'var(--color-p4)', 'var(--color-p5)'];

/**
 * One procedure, one dot per hospital.
 *
 * A range on its own answers "how far apart are the extremes". It cannot answer
 * the question people actually have — where do most hospitals sit, and is the
 * one near me among them — and it hides the shape that makes the argument: for
 * almost every procedure here the cheaper hospitals cluster tightly and a short
 * tail charges many times more.
 */
export default function SpreadBar({
  label, low, high, prices = [], ratio, hospitals, domain, delay = 0,
}) {
  const s = logScale(domain) ?? logScale([low, high]);
  const pts = prices.length ? prices : [low, high];
  const min = pts[0];
  const max = pts[pts.length - 1];

  // Colour each dot by where it falls in this procedure's own range, so every
  // row reads on its own terms rather than against the state's dearest care.
  const lg = Math.log10(Math.max(1, min));
  const rg = Math.max(0.0001, Math.log10(Math.max(min * 1.0001, max)) - lg);
  const stepOf = (v) => STEPS[Math.max(0, Math.min(4, Math.floor(((Math.log10(Math.max(1, v)) - lg) / rg) * 5)))];

  const bandL = s.pos(low);
  const bandW = Math.max(1, s.pos(high) - bandL);

  return (
    <div className="spread-row grid items-center py-7 sm:py-9">
      <div className="min-w-0">
        <h3 className="spread-name text-[1.0625rem] sm:text-[1.1875rem] font-semibold tracking-[-0.021em] leading-[1.2]">
          {label}
        </h3>
        <div className="t-small opacity-55 mt-1 tabular-nums">{hospitals} hospitals</div>

        {/* On a narrow track there is no room outside the dearest dot for its
            own label, and spreading the pair to the ends of the track instead
            would put "$403" where the axis reads $10K. */}
        <div className="xl:hidden mt-2 t-figure text-[0.9375rem] opacity-50">
          {fmtUSD(min, { round: true })}
          <span className="opacity-50 mx-2">–</span>
          {fmtUSD(max, { round: true })}
        </div>

        <div className="relative h-10 mt-4">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-paper-3" />

          {/* Where the middle 80% of hospitals sit. Everything outside it is the
              tail the multiple is measuring. */}
          <div
            className="absolute top-1/2 h-[22px] -translate-y-1/2 rounded-full bg-paper-3"
            style={{ left: `${bandL}%`, width: `${bandW}%` }}
          />

          <div className="absolute inset-0 dots-in" style={{ animationDelay: `${delay}ms` }}>
            {pts.map((p, i) => (
              <span
                key={i}
                className="spread-dot absolute top-1/2 block rounded-full"
                style={{
                  left: `${s.pos(p)}%`,
                  transform: 'translate(-50%,-50%)',
                  background: stepOf(p),
                  boxShadow: '0 0 0 1.5px var(--color-paper)',
                }}
              />
            ))}
          </div>

          <span
            className="hidden xl:block absolute top-1/2 t-figure text-[0.9375rem] opacity-45 whitespace-nowrap"
            style={{ left: `${s.pos(min)}%`, transform: 'translate(-100%,-50%)', paddingRight: '0.85rem' }}
          >
            {fmtUSD(min, { round: true })}
          </span>
          <span
            className="hidden xl:block absolute top-1/2 t-figure text-[0.9375rem] opacity-45 whitespace-nowrap"
            style={{ left: `${s.pos(max)}%`, transform: 'translateY(-50%)', paddingLeft: '0.85rem' }}
          >
            {fmtUSD(max, { round: true })}
          </span>
        </div>
      </div>

      <div className="t-num text-accent text-right tabular-nums leading-[0.9] text-[2rem] sm:text-[2.875rem]">
        {ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}
        <span className="align-super text-[0.36em] ml-[0.05em] opacity-70">×</span>
      </div>
    </div>
  );
}
