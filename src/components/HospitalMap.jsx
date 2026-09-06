import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, VA_CENTER, approxRoadMiles } from '../lib/geo.js';
import { fmtUSD } from '../lib/estimate.js';
import { chargeSummaryFor } from '../lib/prices.js';

/**
 * Hospitals as price pins on a map that looks like part of this site.
 *
 *   - The basemap is OpenFreeMap's Positron (free, no key), recoloured at load
 *     into the page's own palette: ivory land, pale blue-green water, sage
 *     parks, warm grey roads, ink labels. Same tiles, our colours.
 *   - Every pin is a price: an ivory pill in mono, on a short stem, with a dot
 *     at the exact location. The dot carries the cheap-to-dear colour the rest
 *     of the site uses; the pill stays readable without it. The lowest price
 *     in the search is filled teal; the selected pin is filled ink.
 *   - Pins that would overlap collapse into one two-line pin: how many
 *     hospitals, and the range of their medians. Click to zoom in; when they
 *     share one address the card lets you switch between them.
 *   - Clicking a pin opens a card: name, median, cash, the range of plan rates,
 *     the source date, and one action to the hospital page. On phones it is a
 *     bottom sheet.
 *   - Hovering a list row lifts its pin, and hovering a pin marks its row.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/* Our palette, applied to the vendor style's layers by id. Anything not
   listed keeps Positron's own colour, which is already quiet. */
const PAINT = {
  background: { 'background-color': '#F3EEE3' },
  park: { 'fill-color': '#E2E9D7' },
  landcover_wood: { 'fill-color': '#DFE6D3' },
  landuse_residential: { 'fill-color': '#EDE8DD' },
  water: { 'fill-color': '#CFE0DE' },
  waterway: { 'line-color': '#C1D6D3' },
  building: { 'fill-color': '#E8E2D6', 'fill-outline-color': '#DDD6C8' },
  highway_path: { 'line-color': '#E3DCCF' },
  highway_minor: { 'line-color': '#E1DACD' },
  highway_major_casing: { 'line-color': '#D3CBBC' },
  highway_major_inner: { 'line-color': '#FBF8F1' },
  highway_major_subtle: { 'line-color': 'rgba(205,197,183,0.7)' },
  highway_motorway_casing: { 'line-color': '#CFC6B6' },
  highway_motorway_inner: { 'line-color': '#F6F1E6' },
  highway_motorway_subtle: { 'line-color': 'rgba(205,197,183,0.55)' },
  highway_motorway_bridge_casing: { 'line-color': '#CFC6B6' },
  highway_motorway_bridge_inner: { 'line-color': '#F6F1E6' },
  railway: { 'line-color': '#D9D2C5' },
  boundary_2: { 'line-color': '#A99F8C', 'line-width': 1.6 },
  boundary_3: { 'line-color': '#C4BBAA' },
  label_state: { 'text-color': '#7A7364', 'text-halo-color': '#F3EEE3' },
  label_city: { 'text-color': '#2A2620', 'text-halo-color': '#F8F5EE' },
  label_city_capital: { 'text-color': '#2A2620', 'text-halo-color': '#F8F5EE' },
  label_town: { 'text-color': '#4A453C', 'text-halo-color': '#F8F5EE' },
  label_village: { 'text-color': '#5E584D', 'text-halo-color': '#F8F5EE' },
  label_other: { 'text-color': '#5E584D', 'text-halo-color': '#F8F5EE' },
  water_name_point_label: { 'text-color': '#4E7B78', 'text-halo-color': '#E4EEEC' },
  water_name_line_label: { 'text-color': '#4E7B78', 'text-halo-color': '#E4EEEC' },
  'highway-name-major': { 'text-color': '#6F675A' },
  'highway-name-minor': { 'text-color': '#8A8274' },
};

function applyPalette(m) {
  for (const [id, props] of Object.entries(PAINT)) {
    if (!m.getLayer(id)) continue;
    for (const [k, v] of Object.entries(props)) {
      try { m.setPaintProperty(id, k, v); } catch { /* vendor style drift: skip */ }
    }
  }
}

const bandFor = (price, lo, hi) => {
  if (price == null || lo == null || hi == null || hi === lo) return 2;
  const t = (price - lo) / (hi - lo);
  return Math.min(4, Math.max(0, Math.floor(t * 5)));
};
const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default function HospitalMap({
  items, origin, originKind, radiusMiles, selected, onSelect, hovered, onHover,
  priceKey = 'median', ctx = null,
}) {
  const el = useRef(null);
  const wrap = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const youMarker = useRef(null);
  const [zoom, setZoom] = useState(6.1);
  const [failed, setFailed] = useState(false);
  const [siblings, setSiblings] = useState(null);     // hospitals at the selected pin's address

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
    m.on('style.load', () => applyPalette(m));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.FullscreenControl({ container: wrap.current || undefined }), 'top-right');
    m.on('moveend', () => setZoom(m.getZoom() + Math.random() * 1e-9));
    m.on('error', (e) => { if (e?.error?.status === 0) setFailed(true); });
    m.on('click', () => { onSelect?.(null); setSiblings(null); });

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
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#0B7A6A', 'line-opacity': 0.5, 'line-dasharray': [2, 3], 'line-width': 1.2 } });
    };
    if (m.isStyleLoaded()) draw(); else m.once('load', draw);
  }, [origin, radiusMiles]);

  /* you, or your ZIP */
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

  const placed = useMemo(() => items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)), [items]);
  const [lo, hi] = useMemo(() => {
    const prices = placed.map((i) => i[priceKey]).filter((p) => p != null);
    return prices.length ? [Math.min(...prices), Math.max(...prices)] : [null, null];
  }, [placed, priceKey]);

  /* pins */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    const ordered = [...placed].sort((a, b) => (a[priceKey] ?? Infinity) - (b[priceKey] ?? Infinity));
    const anchors = [];
    const project = (it) => { try { return m.project([it.lon, it.lat]); } catch { return null; } };
    for (const it of ordered) {
      const p = project(it);
      if (!p) continue;
      if (selected === it.ccn) { anchors.push({ x: p.x, y: p.y, items: [it], pinned: true }); continue; }
      const hit = anchors.find((a) => !a.pinned && Math.abs(a.x - p.x) < 84 && Math.abs(a.y - p.y) < 44);
      if (hit) hit.items.push(it); else anchors.push({ x: p.x, y: p.y, items: [it] });
    }

    const pin = (a) => {
      const lead = a.items[0];
      const price = lead[priceKey];
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'map-pin';
      node.dataset.band = String(bandFor(price, lo, hi));
      if (lead.locationSrc === 'zip-centroid') node.dataset.approx = '1';
      const label = document.createElement('span');
      label.className = 'label';
      if (a.items.length > 1) {
        const prices = a.items.map((i) => i[priceKey]).filter((p) => p != null);
        const cl = Math.min(...prices), ch = Math.max(...prices);
        node.dataset.cluster = '1';
        label.innerHTML = `<span class="n">${a.items.length} hospitals</span><span class="range">${fmtUSD(cl, { round: true })}${ch !== cl ? `–${fmtUSD(ch, { round: true })}` : ''}</span>`;
        node.setAttribute('aria-label', `${a.items.length} hospitals here; median prices from ${fmtUSD(cl, { round: true })} to ${fmtUSD(ch, { round: true })}. Activate to zoom in.`);
        node.onclick = (e) => {
          e.stopPropagation();
          const b = boundsOf(a.items, 0.02);
          const samePlace = a.items.every((i) => Math.abs(i.lat - lead.lat) < 1e-4 && Math.abs(i.lon - lead.lon) < 1e-4);
          if (b && m.getZoom() < 13 && !samePlace) {
            m.fitBounds(b, { padding: 90, maxZoom: Math.min(15, m.getZoom() + 2.5), duration: 520 });
          } else {
            setSiblings(a.items.map((i) => i.ccn));
            onSelect?.(lead.ccn);
          }
        };
      } else {
        label.textContent = price != null ? fmtUSD(price, { round: true }) : '—';
        if (lo != null && price === lo) node.dataset.low = '1';
        if (selected === lead.ccn) node.dataset.sel = '1';
        if (hovered === lead.ccn) node.dataset.hover = '1';
        node.setAttribute('aria-label', `${lead.name}${price != null ? `, ${fmtUSD(price, { round: true })}` : ''}${lead.locationSrc === 'zip-centroid' ? ' (approximate location)' : ''}`);
        node.onclick = (e) => { e.stopPropagation(); setSiblings(null); onSelect?.(selected === lead.ccn ? null : lead.ccn); };
        node.onmouseenter = () => onHover?.(lead.ccn);
        node.onmouseleave = () => onHover?.(null);
      }
      const stem = document.createElement('span'); stem.className = 'stem';
      const dot = document.createElement('span'); dot.className = 'dot';
      node.append(label, stem, dot);
      const mk = new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat([lead.lon, lead.lat]).addTo(m);
      if (selected === lead.ccn || hovered === lead.ccn) mk.getElement().style.zIndex = '3';
      markers.current.push(mk);
    };
    anchors.forEach(pin);
  }, [placed, selected, hovered, onSelect, onHover, priceKey, zoom, lo, hi]);

  /* fit to the result set when it changes */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = boundsOf(origin ? [...placed, origin] : placed);
    if (b) m.fitBounds(b, { padding: { top: 70, right: 60, bottom: 60, left: 60 }, maxZoom: 11, duration: 640 });
  }, [placed, origin]);

  /* only move when the selected pin is hidden: off screen or under the card */
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const it = placed.find((i) => i.ccn === selected);
    if (!it) return;
    let p; try { p = m.project([it.lon, it.lat]); } catch { return; }
    const { clientWidth: W, clientHeight: H } = m.getContainer();
    const desktop = window.innerWidth >= 640;
    const underCard = desktop ? (p.x < 400 && p.y > H - 280) : p.y > H * 0.45;
    const offScreen = p.x < 40 || p.x > W - 40 || p.y < 70 || p.y > H - 20;
    if (underCard || offScreen) m.easeTo({ center: [it.lon, it.lat], offset: desktop ? [140, -60] : [0, -H * 0.2], duration: 480 });
  }, [selected, placed]);

  const resetView = () => {
    const m = map.current;
    const b = boundsOf(origin ? [...placed, origin] : placed);
    if (m && b) m.fitBounds(b, { padding: { top: 70, right: 60, bottom: 60, left: 60 }, maxZoom: 11, duration: 520 });
  };

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

  return (
    <div ref={wrap} className="relative w-full h-full bg-[#F3EEE3]">
      <div ref={el} className="w-full h-full" role="application" aria-label="Map of hospitals with published prices" />

      {/* map-only controls, grouped with zoom and fullscreen at top-right */}
      <button type="button" onClick={resetView} className="map-btn absolute right-[10px] top-[108px] z-[5] !px-2 !py-2" aria-label="Reset the view to every hospital in this search" title="Reset view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" strokeLinecap="round" />
        </svg>
      </button>

      {sel && (
        <DetailCard
          row={sel} lo={lo} hi={hi} priceKey={priceKey} ctx={ctx} showDistance={!!origin}
          siblings={siblings ? placed.filter((i) => siblings.includes(i.ccn) && i.ccn !== sel.ccn) : []}
          onPick={(ccn) => onSelect?.(ccn)}
          onClose={() => { onSelect?.(null); setSiblings(null); }}
        />
      )}
    </div>
  );
}

/** One hospital, as a card on desktop and a bottom sheet on phones. */
function DetailCard({ row, lo, hi, priceKey, ctx, onClose, showDistance, siblings, onPick }) {
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
    <div className="map-card fixed sm:absolute inset-x-0 sm:inset-x-auto bottom-0 sm:bottom-4 sm:left-4 sm:w-[22rem] z-[6] bg-card sm:rounded-[20px] rounded-t-[22px] border rule shadow-[0_-8px_40px_-12px_rgb(20_18_15/0.35)] sm:shadow-[0_18px_48px_-14px_rgb(20_18_15/0.35)] overflow-hidden"
         role="dialog" aria-label={`${titleCase(row.name)} details`}>
      <span aria-hidden="true" className="sm:hidden block w-10 h-1 rounded-full bg-paper-3 mx-auto mt-2.5" />
      <span aria-hidden="true" className="hidden sm:block h-[3px]" style={{ background: `var(--color-p${band + 1})` }} />
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[1.0625rem] sm:text-[0.9375rem] leading-snug">{titleCase(row.name)}</p>
            <p className="t-small opacity-60 mt-0.5">
              {titleCase(row.city)}
              {showDistance && row.miles != null && <> · {row.miles.toFixed(0)} mi, about {approxRoadMiles(row.miles).toFixed(0)} by road</>}
              {row.locationSrc === 'zip-centroid' && <> · approximate location</>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details"
                  className="w-8 h-8 -mt-1 -mr-1.5 rounded-full grid place-items-center opacity-50 hover:opacity-100 hover:bg-paper-2 transition shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
          </button>
        </div>

        {siblings.length > 0 && (
          <p className="t-small opacity-70 mt-2 flex flex-wrap gap-x-2 gap-y-1 items-center">
            <span>Also at this address:</span>
            {siblings.map((s) => (
              <button key={s.ccn} type="button" onClick={() => onPick(s.ccn)} className="underline underline-offset-2 hover:opacity-100">
                {titleCase(s.name)}
              </button>
            ))}
          </p>
        )}

        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="t-num text-[2rem] leading-none tabular-nums" style={{ color: 'var(--color-accent)' }}>{price != null ? fmtUSD(price, { round: true }) : '—'}</p>
            <p className="t-small opacity-55 mt-1">Median negotiated</p>
          </div>
          {charges?.cashLow != null && (
            <div className="text-right border-l rule pl-4">
              <p className="t-num text-[1.25rem] leading-none tabular-nums">
                {charges.cashHigh != null && charges.cashHigh !== charges.cashLow
                  ? `${fmtUSD(charges.cashLow, { round: true })}–${fmtUSD(charges.cashHigh, { round: true })}`
                  : fmtUSD(charges.cashLow, { round: true })}
              </p>
              <p className="t-small opacity-55 mt-1">Cash price</p>
            </div>
          )}
        </div>

        {spread && (
          <div className="mt-3.5">
            <div className="relative h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-p1), var(--color-p3), var(--color-p5))', opacity: .9 }}>
              <span className="absolute top-1/2 w-3 h-3 -mt-1.5 -ml-1.5 rounded-full bg-ink border-2 border-white shadow" style={{ left: `${pos * 100}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 t-small opacity-55 tabular-nums">
              <span>{fmtUSD(row.low, { round: true })}</span>
              <span>{n} plan {n === 1 ? 'rate' : 'rates'}</span>
              <span>{fmtUSD(row.high, { round: true })}</span>
            </div>
          </div>
        )}

        <p className="t-small opacity-50 mt-3">
          {updated ? <>Source file dated {updated}{stale ? ', over a year old' : ''}</> : 'Source date not declared'}
        </p>

        <div className="mt-3.5 flex items-center gap-3">
          {row.ccn && <Link to={`/hospital/${row.ccn}`} className="btn btn-ink !py-2.5 !px-4 !text-[0.875rem] flex-1 justify-center">View hospital details →</Link>}
          <button type="button" onClick={scrollToRow} className="t-small underline underline-offset-2 opacity-60 hover:opacity-100 shrink-0">Show in list</button>
        </div>
      </div>
    </div>
  );
}
