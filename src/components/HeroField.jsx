import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL || '/';

/**
 * The hero backdrop, drawn from the prices themselves.
 *
 * A stock photograph of a hospital corridor would say nothing. This is the real
 * published data — every rate for the demo procedures, one thin bar each,
 * sorted cheapest to dearest — drifting slowly behind the headline. It reads as
 * texture at a glance and as evidence if you look, and it is the same shape the
 * rest of the site keeps showing: a long flat run of ordinary prices, then a
 * steep climb at the end.
 *
 * Purely decorative, so it is hidden from assistive technology, and it holds
 * still for anyone who asked for reduced motion.
 */
export default function HeroField() {
  const [bars, setBars] = useState(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    setStill(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    fetch(`${BASE}data/demo.json`)
      .then((r) => r.json())
      .then((d) => {
        const all = d.flatMap((p) => p.rows.map((r) => r.price / p.high));
        if (!all.length) return;
        // Repeat the run so the field spans the width at any viewport.
        const sorted = all.sort((a, b) => a - b);
        const out = [];
        while (out.length < 220) out.push(...sorted);
        setBars(out.slice(0, 220));
      })
      .catch(() => {});
  }, []);

  if (!bars) return null;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div
        className="absolute bottom-0 left-0 flex items-end gap-[3px] h-[62%] w-[200%]"
        style={still ? undefined : { animation: 'fieldDrift 90s linear infinite' }}
      >
        {bars.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[1px]"
            style={{
              height: `${8 + v * 92}%`,
              background: 'var(--color-accent-dk)',
              opacity: 0.06 + v * 0.1,
            }}
          />
        ))}
      </div>

      {/* fade the field out behind the type so nothing competes with reading */}
      <div className="absolute inset-0"
           style={{ background: 'linear-gradient(180deg,var(--color-ink) 8%,transparent 55%,rgb(20 18 15 / .55) 100%)' }} />

      <style>{`@keyframes fieldDrift { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  );
}
