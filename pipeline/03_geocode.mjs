#!/usr/bin/env node
/**
 * Adds lat/lon to public/data/hospitals.json so radius search works.
 * The price database has no coordinates, so we resolve them here and cache the
 * result in pipeline/geocache.json. Postgres is never written to.
 *
 * Primary : US Census geocoder (public, no key, built for US street addresses)
 * Fallback: OpenStreetMap Nominatim (1 req/s, city+state)
 * Last     : ZIP centroid via Zippopotam
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, dirs } from './lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = args();
const DATA = path.join(dirs(A).data, 'hospitals.json');
const CACHE = path.join(HERE, 'geocache.json');
// A release build must not stall for ten minutes behind a geocoder that is down;
// --offline resolves from the cache only and reports what it could not place.
const OFFLINE = !!A.offline;
const UA = 'VA-Hospital-Price-Transparency/1.0 (civic price transparency project)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

async function jget(url, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function census(h) {
  const a = `${h.address}, ${h.city}, ${h.state} ${h.zip}`;
  const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + `?address=${encodeURIComponent(a)}&benchmark=Public_AR_Current&format=json`;
  const j = await jget(u);
  const m = j?.result?.addressMatches?.[0]?.coordinates;
  return m ? { lat: m.y, lon: m.x, src: 'census' } : null;
}
async function nominatim(h) {
  const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'
    + `&street=${encodeURIComponent(h.address || '')}`
    + `&city=${encodeURIComponent(h.city || '')}&state=VA&postalcode=${encodeURIComponent(h.zip || '')}`;
  const j = await jget(u);
  const m = Array.isArray(j) && j[0];
  return m ? { lat: +m.lat, lon: +m.lon, src: 'nominatim' } : null;
}
async function zipCentroid(h) {
  const j = await jget(`https://api.zippopotam.us/us/${(h.zip || '').slice(0, 5)}`);
  const p = j?.places?.[0];
  return p ? { lat: +p.latitude, lon: +p.longitude, src: 'zip-centroid' } : null;
}

const hospitals = JSON.parse(fs.readFileSync(DATA, 'utf8'));
let hit = 0, done = 0;
for (const h of hospitals) {
  const key = h.ccn || String(h.id);
  if (cache[key]) { Object.assign(h, cache[key]); hit++; continue; }
  if (OFFLINE) { log('  UNCACHED (offline)', h.name, h.city); continue; }

  let g = await census(h);
  if (!g) { await sleep(1100); g = await nominatim(h); }
  if (!g) { await sleep(400);  g = await zipCentroid(h); }

  if (g) { cache[key] = g; Object.assign(h, g); }
  else   { log('  UNRESOLVED', h.name, h.city); }
  done++;
  if (done % 10 === 0) { log('  geocoded', done); fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); }
  await sleep(350);
}
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
fs.writeFileSync(DATA, JSON.stringify(hospitals));

const ok = hospitals.filter((h) => h.lat != null);
const bySrc = ok.reduce((m, h) => (m[h.src] = (m[h.src] || 0) + 1, m), {});
log(`done: ${ok.length}/${hospitals.length} located (cache hits ${hit})`, bySrc);
const bad = ok.filter((h) => h.lat < 36.4 || h.lat > 39.6 || h.lon < -83.9 || h.lon > -75.1);
if (bad.length) log('WARNING outside Virginia bounding box:', bad.map((h) => `${h.name} ${h.lat},${h.lon}`));
