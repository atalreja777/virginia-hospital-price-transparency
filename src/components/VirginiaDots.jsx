import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const BASE = import.meta.env.BASE_URL || '/';
const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

/**
 * Every hospital in Virginia, plotted by its real coordinates.
 *
 * No basemap and no tiles — with 124 points the state draws its own outline,
 * which is both lighter than a map and a better picture of the argument:
 * filled dots publish usable prices, hollow ones do not. The compliance gap
 * becomes something you can see rather than a number you have to trust.
 */
export default function VirginiaDots() {
  const [rows, setRows] = useState(null);
  const [hover, setHover] = useState(null);
  const [shown, setShown] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    fetch(`${BASE}data/hospital_index.json`).then((r) => r.json()).then(setRows).catch(() => {});
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    const t = setTimeout(() => setShown(true), 900);   // fail visible
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);

  const { pts, publishing, total } = useMemo(() => {
    if (!rows) return { pts: [], publishing: 0, total: 0 };
    const located = rows.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
    const W = 1000, H = 420, PAD = 26;
    const lats = located.map((h) => h.lat), lons = located.map((h) => h.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const sx = (W - PAD * 2) / (maxLon - minLon);
    const sy = (H - PAD * 2) / (maxLat - minLat);
    const k = Math.min(sx, sy);
    const offX = PAD + ((W - PAD * 2) - (maxLon - minLon) * k) / 2;
    const offY = PAD + ((H - PAD * 2) - (maxLat - minLat) * k) / 2;
    return {
      pts: located.map((h) => ({
        ...h,
        x: offX + (h.lon - minLon) * k,
        y: offY + (maxLat - h.lat) * k,          // screen y grows downward
        on: h.codes > 0,
      })),
      publishing: located.filter((h) => h.codes > 0).length,
      total: rows.length,
    };
  }, [rows]);

  return (
    <div ref={box}>
      <div className="relative rounded-[18px] bg-ink overflow-hidden">
        <svg viewBox="0 0 1000 420" className="w-full h-auto block" role="img"
             aria-label={`Map of ${total} Virginia hospitals; ${publishing} publish usable prices`}>
          {pts.map((h, i) => (
            <g key={h.ccn || i}>
              <circle
                cx={h.x} cy={h.y}
                r={hover === h.ccn ? 9 : h.on ? 5.5 : 4}
                fill={h.on ? '#2ED3B7' : 'transparent'}
                stroke={h.on ? 'none' : 'rgba(255,255,255,.34)'}
                strokeWidth="1.4"
                style={{
                  opacity: shown ? (h.on ? 0.95 : 0.6) : 0,
                  transition: `opacity .5s ease ${Math.min(i * 9, 700)}ms, r .18s cubic-bezier(.16,1,.3,1)`,
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHover(h.ccn)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
        </svg>

        {/* hovered hospital */}
        <div className="absolute left-5 bottom-5 right-5 pointer-events-none">
          {hover ? (
            (() => {
              const h = pts.find((p) => p.ccn === hover);
              if (!h) return null;
              return (
                <div className="text-paper">
                  <div className="font-semibold tracking-[-0.018em] text-[1.0625rem]">{titleCase(h.name)}</div>
                  <div className="t-small opacity-60 mt-0.5">
                    {titleCase(h.city)} · {h.on
                      ? `${h.codes.toLocaleString()} procedures priced`
                      : 'no usable prices published'}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-paper/70">
              <span className="flex items-center gap-2 t-small">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#2ED3B7' }} />
                {publishing} publish usable prices
              </span>
              <span className="flex items-center gap-2 t-small">
                <span className="w-2.5 h-2.5 rounded-full border border-white/40" />
                {total - publishing} do not
              </span>
              <span className="t-small opacity-45 hidden sm:inline">Hover any hospital</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
