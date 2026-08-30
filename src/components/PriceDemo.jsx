import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtUSD } from '../lib/estimate.js';

const BASE = import.meta.env.BASE_URL || '/';
const SCALE = ['#0B7A6A', '#5A9A47', '#C98A12', '#DB6B2A', '#C7402F'];
const bandOf = (p, lo, hi) => (hi === lo ? 0 : Math.min(4, Math.floor(((p - lo) / (hi - lo)) * 5)));

/**
 * The product, running, on the landing page.
 *
 * Award-winning product sites show the thing working rather than describing it.
 * This is the real search result for a real procedure, built from the same
 * published prices the rest of the site uses — pick a procedure and watch what
 * Virginia hospitals actually charge for it.
 *
 * It advances on its own until someone touches it, then it stops and stays
 * wherever they left it. A demo that keeps moving while you are reading it is
 * a demo that fights you.
 */
export default function PriceDemo() {
  const [data, setData] = useState(null);
  const [i, setI] = useState(0);
  const [touched, setTouched] = useState(false);
  const [visible, setVisible] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    fetch(`${BASE}data/demo.json`).then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  // Only animate while on screen, and never for reduced-motion users.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setVisible(true); return; }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    const t = setTimeout(() => setVisible(true), 900);   // fail visible
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);

  useEffect(() => {
    if (!data || touched || !visible) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setI((n) => (n + 1) % data.length), 5200);
    return () => clearTimeout(t);
  }, [data, i, touched, visible]);

  if (!data?.length) {
    return <div ref={box} className="rounded-[18px] bg-paper-2 h-[30rem] shimmer" aria-hidden="true" />;
  }

  const d = data[i];
  const rows = d.rows;
  const max = d.high;

  return (
    <div ref={box} className="rounded-[18px] bg-card border rule overflow-hidden shadow-[0_1px_2px_rgb(20_18_15/0.04),0_12px_40px_-12px_rgb(20_18_15/0.10)]">
      {/* procedure switcher */}
      <div className="flex gap-1.5 p-3 overflow-x-auto scroll-thin border-b rule bg-paper-2/60">
        {data.map((x, n) => (
          <button
            key={x.code}
            onClick={() => { setI(n); setTouched(true); }}
            aria-pressed={n === i}
            className={`shrink-0 px-3.5 py-2 rounded-full text-[0.8125rem] font-semibold tracking-[-0.008em] transition-all duration-300
              ${n === i ? 'bg-ink text-paper' : 'text-ink/55 hover:text-ink hover:bg-paper-3/70'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <h3 className="t-title !text-[1.5rem]">{d.label}</h3>
            <p className="t-small opacity-55 mt-1.5">{d.blurb}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="t-num text-[1.75rem]" style={{ color: SCALE[4] }}>
              {d.ratio >= 10 ? Math.round(d.ratio) : d.ratio.toFixed(1)}×
            </div>
            <div className="t-small opacity-45">price difference</div>
          </div>
        </div>

        {/* the bars: one Virginia hospital each, cheapest first */}
        <ul className="space-y-[7px]">
          {rows.map((r, n) => {
            const band = bandOf(r.price, d.low, d.high);
            const pct = Math.max(3.5, (r.price / max) * 100);
            return (
              <li key={r.ccn || n} className="grid grid-cols-[minmax(0,10.5rem)_1fr_auto] items-center gap-3 sm:gap-4">
                <span className="t-small truncate opacity-70">{r.name}</span>
                <span className="relative h-[22px] rounded-r-[4px] overflow-hidden bg-paper-2">
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-[4px] origin-left"
                    style={{
                      width: `${pct}%`,
                      background: SCALE[band],
                      // Re-keyed per procedure so bars redraw on every switch.
                      animation: `demoGrow .85s cubic-bezier(.16,1,.3,1) both`,
                      animationDelay: `${n * 42}ms`,
                    }}
                  />
                </span>
                <span className="t-figure text-[0.8125rem] w-[4.75rem] text-right tabular-nums">
                  {fmtUSD(r.price, { round: true })}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-4 flex-wrap mt-6 pt-5 border-t rule">
          <p className="t-small opacity-60 max-w-[42ch]">
            {d.hospitals} Virginia hospitals publish a price for this.
            The cheapest is <strong className="tabular-nums">{fmtUSD(d.low, { round: true })}</strong>,
            the dearest <strong className="tabular-nums">{fmtUSD(d.high, { round: true })}</strong>.
          </p>
          <Link to={`/procedure/${d.type}/${d.code}`} className="btn btn-ink !py-2 !px-4 !text-[0.8125rem]">
            Open this comparison
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      <style>{`@keyframes demoGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
    </div>
  );
}
