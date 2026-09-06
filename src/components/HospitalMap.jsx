import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, VA_CENTER, approxRoadMiles } from '../lib/geo.js';
import { fmtUSD } from '../lib/estimate.js';
import { chargeSummaryFor } from '../lib/prices.js';

/**
 * Hospitals as price pins on a map.
 *
 * The whole argument of this site is that price and geography are linked, so
 * the map has to show price, not just location. What that means here:
 *
 *   - Every pin IS a price: a white pill with the median in mono and a dot on
 *     the same cheap-to-dear scale as the list. The basemap stays quiet; the
 *     numbers stay legible. (The old pins were saturated blocks with white
 *     text, which fought the map and were hard to read.)
 *   - Pins that would overlap at the current zoom collapse into one count pill
 *     showing how many hospitals and the cheapest of them. Click it to zoom in.
 *   - Clicking a pin opens a receipt-style card inside the map: median, range,
 *     cash, distance, source date, and a way to the full hospital page.
 *   - "Use my location" asks the browser once, draws you as a steady dot with a
 *     slow pulse, and re-centers. Nothing about the position leaves the browser
 *     unless you press "Share this search", which puts a rounded position in
 *     the link on purpose.
 *   - Tiles come from a free, key-less source (OpenFreeMap Positron), so the
 *     map cannot break because of a billing failure.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const bandFor = (price, lo, hi) => {
  if (price == null || lo == null || hi == null || hi === lo) return 2;
  const t = (price - lo) / (hi - lo);
  return Math.min(4, Math.max(0, Math.floor(t * 5)));
};
const SCALE = ['var(--color-p1)', 'var(--color-p2)', 'var(--color-p3)', 'var(--color-p4)', 'var(--color-p5)'];

export default function HospitalMap({
  items, origin, originKind, radiusMiles, selected, onSelect, priceKey = 'median',
  onUseLocation, locating = false, locateError = null,
  onShare, shareState = 'idle', ctx = null, dicts = null,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const youMarker = useRef(null);
  const [zoom, setZoom] = useState(6.1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (map.current || !el.current) return;
    const glOK = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
      } catch { return false; }
    })();
    if (!glOK) { setFailed(true); return; }

    let m;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: STYLE_URL,
        center: [VA_CENTER.lon, VA_CENTER.lat],
        zoom: 6.1, minZoom: 5, maxZoom: 15,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
    } catch { setFailed(true); return; }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('moveend', () => setZoom(m.getZoom() + Math.random() * 1e-9));
    m.on('error', (e) => { if (e?.error?.status === 0) setFailed(true); });
    m.on('click', () => onSelect?.(null));

    // MapLibre sizes its drawing buffer once, from whatever the container
    // measured at construction; inside a lazy route or a grid that is often a
    // sliver. Resize whenever the box actually changes, plus two early kicks.
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      let w = 0, h = 0;
      ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width < 2 || height < 2) return;
        if (Math.abs(width - w) < 1 && Math.abs(height - h) < 1) return;
        w = width; h = height; m.resize();
      });
      ro.observe(el.current);
    }
    const kicks = [120, 700].map((t) => setTimeout(() => m.resize(), t));
    return () => { kicks.forEach(clearTimeout); ro?.disconnect(); m.remove(); map.current = null; };
  }, []);

  /* radius ring */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      for (const id of ['radius-fill', 'radius-line']) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource('radius')) m.removeSource('radius');
      if (!origin || !radiusMiles) return;
      const km = radiusMiles * 1.609344;
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * 2 * Math.PI;
        pts.push([
          origin.lon + (km / (111.32 * Math.cos((origin.lat * Math.PI) / 180))) * Math.sin(a),
          origin.lat + (km / 110.574) * Math.cos(a),
        ]);
      }
      m.addSource('radius', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } } });
      m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#0B7A6A', 'fill-opacity': 0.05 } });
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#0B7A6A', 'line-opacity': 0.45, 'line-dasharray': [2, 3], 'line-width': 1.2 } });
    };
    if (m.isStyleLoaded()) draw(); else m.once('load', draw);
  }, [origin, radiusMiles]);

  /* you / your ZIP */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    youMarker.current?.remove(); youMarker.current = null;
    if (!origin) return;
    const node = document.createElement('div');
    if (originKind === 'you') {
      node.className = 'map-you';
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', 'Your location');
    } else {
      node.className = 'map-zip';
      node.textContent = origin.label || 'Your ZIP';
    }
    youMarker.current = new maplibregl.Marker({ element: node, anchor: originKind === 'you' ? 'center' : 'bottom' })
      .setLngLat([origin.lon, origin.lat]).addTo(m);
  }, [origin, originKind]);

  /* price pins, with clustering in screen space */
  const placed = useMemo(() => items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)), [items]);
  const [lo, hi] = useMemo(() => {
    const prices = placed.map((i) => i[priceKey]).filter((p) => p != null);
    return prices.length ? [Math.min(...prices), Math.max(...prices)] : [null, null];
  }, [placed, priceKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    const ordered = [...placed].sort((a, b) => (a[priceKey] ?? Infinity) - (b[priceKey] ?? Infinity));
    const anchors = [];                       // { x, y, items: [] }
    const project = (it) => { try { return m.project([it.lon, it.lat]); } catch { return null; } };

    for (const it of ordered) {
      const p = project(it);
      if (!p) continue;
      if (selected === it.ccn) { anchors.push({ x: p.x, y: p.y, items: [it], pinned: true }); continue; }
      const hit = anchors.find((a) => !a.pinned && Math.abs(a.x - p.x) < 78 && Math.abs(a.y - p.y) < 30);
      if (hit) hit.items.push(it); else anchors.push({ x: p.x, y: p.y, items: [it] });
    }

    for (const a of anchors) {
      const lead = a.items[0];
      const price = lead[priceKey];
      const band = bandFor(price, lo, hi);
      const approx = lead.locationSrc === 'zip-centroid';
      const node = document.createElement('button');
      node.type = 'button';
      if (a.items.length > 1) {
        node.className = 'map-cluster';
        node.innerHTML = `<span class="n">${a.items.length}</span><span><span class="from">from </span>${price != null ? fmtUSD(price, { round: true }) : '—'}</span>`;
        node.setAttribute('aria-label', `${a.items.length} hospitals here, from ${price != null ? fmtUSD(price, { round: true }) : 'no price'}. Zoom in to separate them.`);
        node.onclick = (e) => {
          e.stopPropagation();
          const b = boundsOf(a.items, 0.02);
          const z = m.getZoom();
          if (b && z < 13) m.fitBounds(b, { padding: 80, maxZoom: Math.min(15, z + 2.5), duration: 520 });
          else onSelect?.(lead.ccn);
        };
      } else {
        node.className = 'map-pill';
        node.dataset.band = String(band);
        if (approx) node.dataset.approx = '1';
        if (selected === lead.ccn) node.dataset.sel = '1';
        node.textContent = price != null ? fmtUSD(price, { round: true }) : '—';
        node.setAttribute('aria-label', `${lead.name}${price != null ? `, ${fmtUSD(price, { round: true })}` : ''}${approx ? ' (approximate location)' : ''}`);
        if (approx) node.title = 'Approximate location: pinned at the ZIP-code center, not the exact address';
        node.onclick = (e) => { e.stopPropagation(); onSelect?.(selected === lead.ccn ? null : lead.ccn); };
      }
      const mk = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat([lead.lon, lead.lat]).addTo(m);
      // Above sibling pins only. Anything higher would escape the panel's stacking
      // context and paint over the page's sticky controls when the map scrolls under them.
      if (selected === lead.ccn) mk.getElement().style.zIndex = '3';
      markers.current.push(mk);
    }
  }, [placed, selected, onSelect, priceKey, zoom, lo, hi]);

  /* fit to the current result set */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = boundsOf(origin ? [...placed, origin] : placed);
    if (b) m.fitBounds(b, { padding: { top: 64, right: 54, bottom: 54, left: 54 }, maxZoom: 11, duration: 640 });
  }, [placed, origin]);

  /* ease to the selected hospital, leaving room for the card */
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const it = placed.find((i) => i.ccn === selected);
    if (it) m.easeTo({ center: [it.lon, it.lat], zoom: Math.max(m.getZoom(), 9), offset: [0, -70], duration: 520 });
  }, [selected, placed]);

  const sel = selected ? placed.find((i) => i.ccn === selected) : null;

  if (failed) {
    return (
      <div className="w-full h-full grid place-items-center bg-paper-2 p-8 text-center">
        <div>
          <p className="t-label opacity-45">Map unavailable</p>
          <p className="t-small mt-2 opacity-70 max-w-[30ch]">
            The map tiles would not load. Every price and distance is still listed beside it.
          </p>
        </div>
      </div>
    );
  }

  const hasApprox = placed.some((i) => i.locationSrc === 'zip-centroid');

  return (
    <div className="relative w-full h-full">
      <div ref={el} className="w-full h-full bg-paper-2 [&_canvas]:saturate-[.6]" role="application" aria-label="Map of hospitals with published prices" />

      {/* top-left: location + share */}
      <div className="absolute left-3 top-3 flex flex-col items-start gap-2 max-w-[calc(100%-5rem)]">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="map-btn" onClick={onUseLocation} disabled={locating}
                  data-on={originKind === 'you' ? '1' : undefined} aria-live="polite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" />
            </svg>
            {locating ? 'Finding you…' : originKind === 'you' ? 'Using your location' : 'Use my location'}
          </button>
          <button type="button" className="map-btn" onClick={onShare} data-on={shareState === 'copied' ? '1' : undefined}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 16V4M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {shareState === 'copied' ? 'Link copied' : 'Share this search'}
          </button>
        </div>
        {locateError && (
          <p className="t-small bg-card/95 backdrop-blur border rule rounded-2xl px-3 py-2 max-w-[24rem] shadow-[0_2px_10px_rgb(20_18_15/0.10)]" role="status">
            {locateError}
          </p>
        )}
      </div>

      {/* legend, hidden while a card is open on narrow screens */}
      <div className={`absolute right-3 bottom-8 flex flex-col items-end gap-1.5 ${sel ? 'hidden sm:flex' : 'flex'}`}>
        {hasApprox && (
          <div className="bg-card/95 backdrop-blur border rule rounded-full px-3 py-1 pointer-events-none">
            <span className="t-small opacity-55 text-[0.6875rem]">hollow dot: approximate (ZIP-center) location</span>
          </div>
        )}
        <div className="bg-card/95 backdrop-blur border rule rounded-full px-3 py-1.5 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="t-small opacity-55 text-[0.6875rem]">cheaper</span>
            {SCALE.map((c) => <span key={c} className="w-3.5 h-2 rounded-[1px]" style={{ background: c }} />)}
            <span className="t-small opacity-55 text-[0.6875rem]">dearer</span>
          </div>
        </div>
      </div>

      {sel && <DetailCard row={sel} lo={lo} hi={hi} priceKey={priceKey} ctx={ctx} dicts={dicts} onClose={() => onSelect?.(null)} showDistance={!!origin} />}
    </div>
  );
}

/** A receipt for one hospital, anchored inside the map. */
function DetailCard({ row, lo, hi, priceKey, ctx, dicts, onClose, showDistance }) {
  const price = row[priceKey];
  const band = bandFor(price, lo, hi);
  const charges = chargeSummaryFor(row.charges, ctx);
  const src = row.sources?.[0];
  const updated = src?.updated || null;
  const stale = updated ? (Date.now() - new Date(updated).getTime()) > 365 * 864e5 : null;
  const n = row.prices?.length || 0;
  const spread = row.low != null && row.high != null && row.high !== row.low;
  const pos = spread && price != null ? Math.max(0, Math.min(1, (price - row.low) / (row.high - row.low))) : 0.5;
  const scrollToRow = () => document.getElementById(`h-${row.ccn}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className="map-card absolute left-3 right-3 sm:right-auto sm:w-[22.5rem] bottom-8 bg-card rounded-[20px] border rule shadow-[0_18px_48px_-14px_rgb(20_18_15/0.35)] overflow-hidden" role="dialog" aria-label={`${row.name} details`}>
      <span aria-hidden="true" className="block h-[3px]" style={{ background: SCALE[band] }} />
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[0.9375rem] leading-snug truncate">{row.name}</p>
            <p className="t-small opacity-60 mt-0.5">
              {row.city}
              {showDistance && row.miles != null && <> · {row.miles.toFixed(0)} mi straight line, about {approxRoadMiles(row.miles).toFixed(0)} by road</>}
              {row.locationSrc === 'zip-centroid' && <> · approximate location</>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details"
                  className="w-7 h-7 -mt-1 -mr-1 rounded-full grid place-items-center opacity-50 hover:opacity-100 hover:bg-paper-2 transition shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <div>
            <p className="t-label opacity-45">Median negotiated</p>
            <p className="t-num text-[1.75rem] leading-none mt-1 tabular-nums">{price != null ? fmtUSD(price, { round: true }) : '—'}</p>
          </div>
          {charges?.cashLow != null && (
            <div className="text-right">
              <p className="t-label opacity-45">Cash price</p>
              <p className="t-num text-[1.125rem] leading-none mt-1 tabular-nums">
                {charges.cashHigh != null && charges.cashHigh !== charges.cashLow
                  ? `${fmtUSD(charges.cashLow, { round: true })}–${fmtUSD(charges.cashHigh, { round: true })}`
                  : fmtUSD(charges.cashLow, { round: true })}
              </p>
            </div>
          )}
        </div>

        {spread && (
          <div className="mt-3">
            <div className="relative h-1.5 rounded-full bg-paper-3">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: '100%', background: 'linear-gradient(90deg, var(--color-p1), var(--color-p3), var(--color-p5))', opacity: .35 }} />
              <span className="absolute top-1/2 w-3 h-3 -mt-1.5 -ml-1.5 rounded-full bg-ink border-2 border-white shadow" style={{ left: `${pos * 100}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 t-small opacity-55 tabular-nums">
              <span>{fmtUSD(row.low, { round: true })}</span>
              <span>{n} plan {n === 1 ? 'rate' : 'rates'}</span>
              <span>{fmtUSD(row.high, { round: true })}</span>
            </div>
          </div>
        )}

        <p className="t-small opacity-55 mt-3">
          {updated ? <>Source file dated {updated}{stale ? ', over a year old' : ''}</> : 'Source date not declared'}
          {(row.formula?.length || 0) > 0 && <> · {row.formula.length} formula-based {row.formula.length === 1 ? 'rate' : 'rates'}</>}
        </p>

        <div className="mt-3.5 flex gap-2">
          <button type="button" onClick={scrollToRow} className="chip">Show in list</button>
          {row.ccn && <Link to={`/hospital/${row.ccn}`} className="chip" data-on>Hospital page</Link>}
        </div>
      </div>
    </div>
  );
}
