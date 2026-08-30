/** Distance and location helpers for "how far will you travel". */

const R_MILES = 3958.7613;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMiles(aLat, aLon, bLat, bLon) {
  if (![aLat, aLon, bLat, bLon].every(Number.isFinite)) return null;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Straight-line miles understate real travel. A ~1.25 detour factor is the
 * usual rule of thumb for road networks, so we say so rather than implying
 * the number is a driving distance.
 */
export const ROAD_FACTOR = 1.25;
export const approxRoadMiles = (straight) => (straight == null ? null : straight * ROAD_FACTOR);

/** Resolve a typed ZIP to a centroid. Returns null if we do not know it. */
export function zipToPoint(zips, zip) {
  const z = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const p = zips?.[z];
  return p ? { lat: p[0], lon: p[1], zip: z } : null;
}

export const isValidZip = (z) => /^\d{5}$/.test(String(z || '').trim());

/** Virginia's bounding box, used to sanity-check geocoding output. */
export const VA_BOUNDS = { minLat: 36.4, maxLat: 39.6, minLon: -83.9, maxLon: -75.1 };
export const VA_CENTER = { lat: 37.75, lon: -78.9 };

export function withinVirginia(lat, lon) {
  return lat >= VA_BOUNDS.minLat && lat <= VA_BOUNDS.maxLat
      && lon >= VA_BOUNDS.minLon && lon <= VA_BOUNDS.maxLon;
}

/** Attach distance from an origin and optionally filter by radius. */
export function withDistance(items, origin, radiusMiles) {
  if (!origin) return items.map((it) => ({ ...it, miles: null }));
  const out = items.map((it) => ({
    ...it,
    miles: distanceMiles(origin.lat, origin.lon, it.lat, it.lon),
  }));
  const within = radiusMiles ? out.filter((it) => it.miles != null && it.miles <= radiusMiles) : out;
  return within.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
}

/** Fit a map to a set of points with a little padding. */
export function boundsOf(points, pad = 0.35) {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pts.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  const dLat = Math.max(0.05, (maxLat - minLat) * pad);
  const dLon = Math.max(0.05, (maxLon - minLon) * pad);
  return [[minLon - dLon, minLat - dLat], [maxLon + dLon, maxLat + dLat]];
}
