import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, VA_CENTER } from '../lib/geo.js';
import { fmtUSD } from '../lib/estimate.js';

/**
 * Hospitals as price tags on a map.
 *
 * The whole argument of this site is that price and geography are linked, so
 * the map has to show price, not just location. Design decisions that follow
 * from that:
 *
 *   - The basemap is deliberately quiet and desaturated. Every bit of colour on
 *     screen belongs to the data.
 *   - Tags are square and set in mono, matching the rest of the interface, and
 *     coloured on the same cheap-to-dear scale used everywhere else.
 *   - Overlapping tags collapse to dots as you zoom out, so a cluster of
 *     hospitals never becomes an unreadable pile.
 *   - Tiles come from a free, key-less source. No API key means the map cannot
 *     break because of a billing failure, which matters for a public tool.
 */

const STYLE = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap · © CARTO',
    },
    labels: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.95 } },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.6 } },
  ],
};

const SCALE = ['#0F7B72', '#4F9A4A', '#C69214', '#E2692A', '#B62419'];
const bandFor = (price, lo, hi) => {
  if (price == null || lo == null || hi == null || hi === lo) return 2;
  const t = (price - lo) / (hi - lo);
  return Math.min(4, Math.max(0, Math.floor(t * 5)));
};

export default function HospitalMap({ items, origin, radiusMiles, selected, onSelect, priceKey = 'median' }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [zoom, setZoom] = useState(6.1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (map.current || !el.current) return;

    // MapLibre draws tiles through WebGL. Where it is unavailable — disabled by
    // the user, blocked by policy, or missing in an embedded view — the canvas
    // stays blank while markers still position, which looks broken. Check first
    // and fall back to the list, which carries every price anyway.
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
        style: STYLE,
        center: [VA_CENTER.lon, VA_CENTER.lat],
        zoom: 6.1,
        minZoom: 5,
        maxZoom: 14,
        attributionControl: { compact: true },
        cooperativeGestures: true,   // never steal the page scroll on touch
      });
    } catch {
      setFailed(true);
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('moveend', () => setZoom(m.getZoom() + Math.random() * 1e-9));
    m.on('error', (e) => { if (e?.error?.status === 0) setFailed(true); });
    return () => { m.remove(); map.current = null; };
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
      m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#0B0B0C', 'fill-opacity': 0.04 } });
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#0B0B0C', 'line-opacity': 0.28, 'line-dasharray': [3, 3], 'line-width': 1 } });
    };
    if (m.isStyleLoaded()) draw(); else m.once('load', draw);
  }, [origin, radiusMiles]);

  /* price tags */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    const placed = items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
    const prices = placed.map((i) => i[priceKey]).filter((p) => p != null);
    const lo = prices.length ? Math.min(...prices) : null;
    const hi = prices.length ? Math.max(...prices) : null;

    // At low zoom a dense cluster of tags is unreadable, so a tag that would
    // land on top of one already placed becomes a dot until you zoom in far
    // enough to separate them. Screen-space, via the map's own projection.
    const seen = [];
    const collides = (it) => {
      let x, y;
      try { ({ x, y } = m.project([it.lon, it.lat])); } catch { return false; }
      for (const p of seen) if (Math.abs(p.x - x) < 64 && Math.abs(p.y - y) < 22) return true;
      seen.push({ x, y });
      return false;
    };

    const ordered = [...placed].sort((a, b) => (a[priceKey] ?? Infinity) - (b[priceKey] ?? Infinity));

    for (const it of ordered) {
      const isSel = selected === it.ccn;
      const price = it[priceKey];
      const band = bandFor(price, lo, hi);
      const colour = SCALE[band];
      const asDot = !isSel && collides(it);

      const node = document.createElement('button');
      node.type = 'button';
      node.setAttribute('aria-label', `${it.name}${price != null ? `, ${fmtUSD(price, { round: true })}` : ''}`);

      if (asDot) {
        node.style.cssText = `
          width:11px;height:11px;border-radius:50%;cursor:pointer;padding:0;
          background:${colour};border:1.5px solid #FFFDF9;
          box-shadow:0 1px 4px rgba(0,0,0,.28);transition:transform .16s cubic-bezier(.16,1,.3,1);`;
      } else {
        node.textContent = price != null ? fmtUSD(price, { round: true }) : '—';
        node.style.cssText = `
          font:500 11px/1 "Geist Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;
          letter-spacing:-0.02em;padding:5px 7px;border-radius:2px;cursor:pointer;white-space:nowrap;
          color:#fff;background:${colour};
          border:${isSel ? '2px solid #0B0B0C' : '1px solid rgba(255,255,255,.9)'};
          box-shadow:${isSel ? '0 4px 14px rgba(0,0,0,.34)' : '0 1px 5px rgba(0,0,0,.24)'};
          transition:transform .16s cubic-bezier(.16,1,.3,1);
          z-index:${isSel ? 10 : 1};`;
      }
      node.onmouseenter = () => { node.style.transform = 'scale(1.16)'; node.style.zIndex = '20'; };
      node.onmouseleave = () => { node.style.transform = ''; node.style.zIndex = isSel ? '10' : '1'; };
      node.onclick = (e) => { e.stopPropagation(); onSelect?.(it.ccn); };

      markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([it.lon, it.lat]).addTo(m));
    }
  }, [items, selected, onSelect, priceKey, zoom]);   // zoom ticks on moveend

  /* fit to the current result set */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const placed = items.filter((i) => Number.isFinite(i.lat));
    const b = boundsOf(origin ? [...placed, origin] : placed);
    if (b) m.fitBounds(b, { padding: 54, maxZoom: 11, duration: 640 });
  }, [items, origin]);

  /* pan to the row picked in the list */
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const it = items.find((i) => i.ccn === selected);
    if (it && Number.isFinite(it.lat)) m.easeTo({ center: [it.lon, it.lat], zoom: Math.max(m.getZoom(), 9.5), duration: 540 });
  }, [selected, items]);

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
    <div className="relative w-full h-full">
      <div ref={el} className="w-full h-full bg-paper-2" role="application" aria-label="Map of hospitals with published prices" />
      <div className="absolute left-3 bottom-3 bg-card/95 backdrop-blur border rule rounded-[2px] px-3 py-2 pointer-events-none">
        <div className="t-label opacity-45 mb-1.5">Price</div>
        <div className="flex items-center gap-1">
          <span className="t-small opacity-55 mr-1">low</span>
          {SCALE.map((c) => <span key={c} className="w-5 h-2" style={{ background: c }} />)}
          <span className="t-small opacity-55 ml-1">high</span>
        </div>
      </div>
    </div>
  );
}
