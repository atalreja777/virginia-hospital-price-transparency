#!/usr/bin/env node
/**
 * Packs the read-only CSV export into static JSON shards the website fetches.
 * One streaming pass over rates.csv (9.6M rows). Never touches Postgres.
 *
 * Output layout (public/data):
 *   meta.json                     build stamp + scope + counts
 *   hospitals.json                VA hospitals w/ provenance (geo added by 03_geocode)
 *   payers.json plans.json        VA-local dictionaries
 *   settings.json methodologies.json
 *   search.json                   code -> description index for autocomplete
 *   codes/<TYPE>/<prefix>.json    price shards, bucketed by first 3 chars of code
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const OUT = path.join(HERE, '..', 'public', 'data');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- tiny CSV reader (quote-aware) ---------- */
function splitCSV(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
async function readCSV(file, onRow) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { highWaterMark: 1 << 20 }), crlfDelay: Infinity,
  });
  let head = null, n = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (!head) { head = splitCSV(line); continue; }
    onRow(splitCSV(line), head); n++;
  }
  return n;
}
const cents = (s) => {
  if (!s) return null;
  const v = Math.round(parseFloat(s) * 100);
  return Number.isFinite(v) ? v : null;
};


/* ---------- scope: what a patient can actually shop for ---------- */
// Chargemaster junk wording that means "a supply line, not a service".
const JUNK_DESC = /noncdm|non-cdm|charge record|^misc|^supply|do not use|deleted|inactive|placeholder/i;
/**
 * Keep only codes a patient could plan and shop for.
 *  - CPT     : 5 digits. ER visits and critical care already dropped in SQL.
 *  - MS-DRG  : planned inpatient stays.
 *  - HCPCS   : valid Level II format only. C-codes are device pass-throughs
 *              (screws, guide wires, catheters) billed incidentally during a
 *              procedure — nobody shops for them, and they were 80% of the data.
 */
function inScope(ct, code, desc) {
  if (JUNK_DESC.test(desc || '')) return false;
  if (ct === 'CPT') return /^[0-9]{5}$/.test(code);
  if (ct === 'MS-DRG') return /^[0-9]{1,3}$/.test(code);
  if (ct === 'HCPCS') return /^[ABDEGHJKLMPQRSTVU][0-9]{4}$/.test(code);
  return false;
}

/* ---------- 1. hospitals ---------- */
log('hospitals');
const hospitals = [];
const hIdx = new Map();                       // hospital_id -> dense index
await readCSV(path.join(RAW, 'hospitals.csv'), (r) => {
  const [hospital_id, ccn, name, address, city, state, zip, ownership, hgi_type,
         status, pos_subtype_cd, exempt_basis, status_reason] = r;
  hIdx.set(hospital_id, hospitals.length);
  hospitals.push({
    id: +hospital_id, ccn, name, address, city, state, zip,
    ownership: ownership || null, type: hgi_type || null, status,
    posSubtype: pos_subtype_cd || null,
    exemptBasis: exempt_basis || null, statusReason: status_reason || null,
    lat: null, lon: null, sources: [],
  });
});
log('  ', hospitals.length, 'VA hospitals');

/* ---------- 2. provenance ---------- */
await readCSV(path.join(RAW, 'sources.csv'), (r) => {
  const [hospital_id, url, source_page_url, declared_last_updated, declared_version,
         layout, sha256, size_bytes, first_seen_at, declared_hospital_name,
         attestation_confirmed] = r;
  const i = hIdx.get(hospital_id); if (i == null) return;
  hospitals[i].sources.push({
    url, pageUrl: source_page_url || null,
    updated: declared_last_updated || null, version: declared_version || null,
    layout: layout || null, sha256: (sha256 || '').slice(0, 16),
    bytes: +size_bytes || null, fetched: (first_seen_at || '').slice(0, 10),
    declaredName: declared_hospital_name || null,
    attested: attestation_confirmed === 't' ? true
            : attestation_confirmed === 'f' ? false : null,
  });
});
log('   provenance attached');

/* ---------- 3. global dictionaries (only VA-used entries are kept later) ---------- */
const payerName = new Map(), planName = new Map(), methName = new Map();
await readCSV(path.join(RAW, 'payers.csv'), (r) => payerName.set(r[0], r[1]));
await readCSV(path.join(RAW, 'plans.csv'),  (r) => planName.set(r[0], r[1] || ''));
await readCSV(path.join(RAW, 'methodologies.csv'), (r) => methName.set(r[0], r[1]));

/* ---------- 4. code descriptions ---------- */
log('code descriptions');
const codeDesc = new Map();                   // "TYPE|CODE" -> {d, nh}
await readCSV(path.join(RAW, 'code_descriptions.csv'), (r) => {
  const [ct, code, desc, n_hosp] = r;
  codeDesc.set(ct + '|' + code, { d: (desc || '').replace(/\s+/g, ' ').trim().slice(0, 120), nh: +n_hosp });
});
log('  ', codeDesc.size, 'codes described');

/* ---------- 5. charges per hospital+code ---------- */
log('charges');
const charges = new Map();                    // "TYPE|CODE" -> Map(hIdx -> {g,c,mn,mx})
let chargeRows = 0;
await readCSV(path.join(RAW, 'charges.csv'), (r) => {
  const [hospital_id, ct, code, setting, billing_class, gross, cash, mn, mx] = r;
  const hi = hIdx.get(hospital_id); if (hi == null) return;
  const k = ct + '|' + code;
  let m = charges.get(k); if (!m) charges.set(k, m = new Map());
  const prev = m.get(hi) || { g: null, c: null, mn: null, mx: null };
  const g = cents(gross), c = cents(cash), lo = cents(mn), hi2 = cents(mx);
  if (g  != null) prev.g  = prev.g  == null ? g  : Math.max(prev.g, g);
  if (c  != null) prev.c  = prev.c  == null ? c  : Math.max(prev.c, c);
  if (lo != null) prev.mn = prev.mn == null ? lo : Math.min(prev.mn, lo);
  if (hi2!= null) prev.mx = prev.mx == null ? hi2: Math.max(prev.mx, hi2);
  m.set(hi, prev); chargeRows++;
});
log('  ', chargeRows, 'charge rows over', charges.size, 'codes');

/* ---------- 6. rates: the streaming pass ---------- */
log('rates (streaming 9.6M rows)');
const payerIdx = new Map(), planIdx = new Map(), setIdx = new Map(), methIdx = new Map();
const payers = [], plans = [], settings = [], methods = [];
const dense = (map, arr, key, val) => {
  let i = map.get(key);
  if (i == null) { i = arr.length; map.set(key, i); arr.push(val); }
  return i;
};
const byCode = new Map();                     // "TYPE|CODE" -> number[] flat [hi,pa,pl,se,me,cents]
let rateRows = 0, skipped = 0;
await readCSV(path.join(RAW, 'rates.csv'), (r) => {
  const [hospital_id, ct, code, payer_id, plan_id, setting, methodology_id, dollar] = r;
  const hi = hIdx.get(hospital_id); if (hi == null) { skipped++; return; }
  const v = cents(dollar); if (v == null || v <= 0) { skipped++; return; }
  const pa = dense(payerIdx, payers, payer_id, payerName.get(payer_id) || 'Unknown payer');
  const pl = dense(planIdx,  plans,  plan_id,  planName.get(plan_id)  || '');
  const se = dense(setIdx,   settings, setting || '', setting || '');
  const me = dense(methIdx,  methods, methodology_id || '', methName.get(methodology_id) || '');
  const k = ct + '|' + code;
  let a = byCode.get(k); if (!a) byCode.set(k, a = []);
  a.push(hi, pa, pl, se, me, v);
  rateRows++;
  if (rateRows % 2_000_000 === 0) log('   ...', rateRows.toLocaleString());
});
log('  ', rateRows.toLocaleString(), 'rates kept,', skipped, 'skipped,',
    byCode.size, 'codes,', payers.length, 'payers,', plans.length, 'plans');

/* ---------- 7. write shards, bucketed by first 3 chars of the code ---------- */
log('writing shards');
fs.rmSync(path.join(OUT, 'codes'), { recursive: true, force: true });
const buckets = new Map();                    // "TYPE/PREFIX" -> { [code]: payload }
const searchRows = [];
let statTotalRates = 0, outOfScope = 0;

for (const [k, flat] of byCode) {
  const [ct, code] = k.split('|');
  const meta = codeDesc.get(k) || { d: '', nh: 0 };
  if (!inScope(ct, code, meta.d)) { outOfScope++; continue; }
  const ch = charges.get(k);

  // Regroup by hospital, collapsing repeats. A file often lists the same
  // negotiated rate many times over settings and modifiers; the patient-facing
  // unit is one price per payer + plan + setting, so keep the low and the high
  // and drop the noise between them.
  const perHosp = new Map();
  for (let i = 0; i < flat.length; i += 6) {
    const hi = flat[i];
    let e = perHosp.get(hi);
    if (!e) perHosp.set(hi, e = { m: new Map() });
    const kk = flat[i + 1] + '|' + flat[i + 2] + '|' + flat[i + 3];
    const v = flat[i + 5];
    const cur = e.m.get(kk);
    if (!cur) e.m.set(kk, { pa: flat[i + 1], pl: flat[i + 2], se: flat[i + 3], me: flat[i + 4], lo: v, hi: v });
    else { if (v < cur.lo) cur.lo = v; if (v > cur.hi) cur.hi = v; }
  }
  for (const e of perHosp.values()) {
    e.r = [];
    for (const x of e.m.values()) {
      e.r.push(x.pa, x.pl, x.se, x.me, x.lo);
      if (x.hi !== x.lo) e.r.push(x.pa, x.pl, x.se, x.me, x.hi);
    }
    e.m = null;
  }
  const H = {};
  const allPrices = [];
  for (const [hi, e] of perHosp) {
    const c = ch?.get(hi);
    H[hi] = { r: e.r, g: c?.g ?? null, c: c?.c ?? null, mn: c?.mn ?? null, mx: c?.mx ?? null };
    for (let i = 4; i < e.r.length; i += 5) allPrices.push(e.r[i]);
  }
  statTotalRates += allPrices.length;
  allPrices.sort((a, b) => a - b);
  const q = (p) => allPrices.length ? allPrices[Math.min(allPrices.length - 1, Math.floor(p * allPrices.length))] : null;

  const prefix = code.slice(0, 3).replace(/[^A-Za-z0-9]/g, '_') || '_';
  const bk = ct.replace(/[^A-Za-z0-9-]/g, '') + '/' + prefix;
  let b = buckets.get(bk); if (!b) buckets.set(bk, b = {});
  b[code] = { d: meta.d, h: H };

  searchRows.push([
    ct, code, meta.d, perHosp.size, allPrices.length,
    q(0.10), q(0.50), q(0.90),
  ]);
}

for (const [bk, payload] of buckets) {
  const file = path.join(OUT, 'codes', bk + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}
log('  ', buckets.size, 'shard files;', outOfScope, 'codes dropped as not patient-shoppable');

/* ---------- 8. search index + dictionaries + meta ---------- */
searchRows.sort((a, b) => b[3] - a[3] || a[1].localeCompare(b[1]));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify({
  f: ['type', 'code', 'desc', 'hospitals', 'rates', 'p10', 'p50', 'p90'], r: searchRows,
}));
fs.writeFileSync(path.join(OUT, 'payers.json'), JSON.stringify(payers));
fs.writeFileSync(path.join(OUT, 'plans.json'), JSON.stringify(plans));
fs.writeFileSync(path.join(OUT, 'settings.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(OUT, 'methodologies.json'), JSON.stringify(methods));
fs.writeFileSync(path.join(OUT, 'hospitals.json'), JSON.stringify(hospitals));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  state: 'VA',
  scope: 'Planned, schedulable care. Emergency visit codes (CPT 99281-99292) and ambulance (HCPCS A0xxx) excluded.',
  source: 'Hospital machine-readable files published under 45 CFR Part 180',
  counts: {
    hospitals: hospitals.length,
    hospitalsWithPrices: new Set(searchRows.flatMap(() => [])).size || null,
    codes: searchRows.length,
    rates: statTotalRates,
    payers: payers.length,
    plans: plans.length,
    shards: buckets.size,
  },
}, null, 2));
log('done. codes =', searchRows.length, 'rates =', statTotalRates.toLocaleString());
