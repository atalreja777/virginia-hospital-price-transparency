#!/usr/bin/env node
/**
 * Builds the ZIP -> centroid lookup that powers "how far am I willing to travel".
 * Source: US Census ZCTA gazetteer (official, public domain). Filtered to
 * Virginia and the ring of states around it, so someone in Bristol or
 * Winchester can still search across a state line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, dirs } from './lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = args();
const DATA = dirs(A).data;
const SRC = fs.readdirSync(HERE).find((f) => /Gaz_zcta_national\.txt$/.test(f));

/**
 * ZIP centroids come from a static Census file that changes once a year. When
 * it is not on disk, carrying the previous release's copy forward is honest and
 * correct — inventing coordinates or shipping a release with no radius search
 * would not be. The release manifest records which happened.
 */
if (!SRC) {
  const prev = A.fallback && path.join(A.fallback, 'zips.json');
  if (prev && fs.existsSync(prev)) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.copyFileSync(prev, path.join(DATA, 'zips.json'));
    const n = Object.keys(JSON.parse(fs.readFileSync(prev, 'utf8'))).length;
    console.log(`gazetteer not present; carried ${n} ZIP centroids forward from ${prev}`);
    process.exit(0);
  }
  console.error('gazetteer not found — download the Census ZCTA gazetteer into pipeline/, or pass --fallback <dir with zips.json>');
  process.exit(1);
}

// Virginia plus a travel ring (MD, DC, WV, NC, TN, KY, DE borders).
const BOX = { minLat: 34.8, maxLat: 40.8, minLon: -85.0, maxLon: -74.5 };

const out = {};
let seen = 0;
for (const line of fs.readFileSync(path.join(HERE, SRC), 'utf8').split('\n')) {
  const p = line.split('\t');
  if (p.length < 7 || p[0] === 'GEOID') continue;
  const zip = p[0].trim();
  const lat = parseFloat(p[5]), lon = parseFloat(p[6]);
  seen++;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (lat < BOX.minLat || lat > BOX.maxLat || lon < BOX.minLon || lon > BOX.maxLon) continue;
  out[zip] = [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4];
}
const dest = path.join(DATA, 'zips.json');
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${Object.keys(out).length} ZIP centroids kept of ${seen} national (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
