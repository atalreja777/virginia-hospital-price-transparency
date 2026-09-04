#!/usr/bin/env node
/**
 * Builds the small dataset behind the landing page's live demo.
 *
 * The demo shows the product actually working — real hospitals, real published
 * prices — rather than a screenshot of it. That only needs a handful of
 * recognisable procedures, so this stays a few kilobytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, dirs, log, median, writeJSON, readJSON } from './lib/util.mjs';
import { openData, chargeSummary } from './lib/shards.mjs';

const A = args();
const { data: DATA } = dirs(A);
const hospitals = readJSON(path.join(DATA, 'hospitals.json'));
const data = openData(DATA);
const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

// Care people recognise instantly and might genuinely schedule.
const SHOW = [
  ['CPT', '70450', 'CT scan of the head',      'A scan after a fall or a bad headache'],
  ['CPT', '72148', 'MRI of the lower back',    'The scan ordered for persistent back pain'],
  ['CPT', '45378', 'Colonoscopy',              'Routine screening from age 45'],
  ['CPT', '27447', 'Knee replacement',         'Planned joint surgery'],
  ['CPT', '59400', 'Childbirth, vaginal',      'Routine delivery and prenatal care'],
  ['CPT', '80053', 'Metabolic blood panel',    'A standard blood test at a check-up'],
];

/** Evenly spaced sample of a sorted list, endpoints always included. */
function pickSpread(sorted, n) {
  if (sorted.length <= n) return sorted;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.round((i / (n - 1)) * (sorted.length - 1))]);
  return out.filter((r, i) => i === 0 || i === out.length - 1 || r.price !== out[i - 1].price);
}

const out = [];
for (const [type, code, label, blurb] of SHOW) {
  const loaded = data.loadCode(type, code);
  if (!loaded) { log('missing shard for', code); continue; }

  const rows = [];
  for (const h of loaded.hospitals) {
    const hosp = hospitals[h.hIdx];
    if (!hosp || !h.prices.length) continue;
    const ch = chargeSummary(h.charges);
    rows.push({
      name: titleCase(hosp.name), city: titleCase(hosp.city), ccn: hosp.ccn,
      price: median(h.prices),
      // A hospital can publish more than one cash price for a code — one per
      // setting and billing class. Show the range, never a single merged number.
      cashLow: ch.cashLow, cashHigh: ch.cashHigh,
    });
  }
  rows.sort((a, b) => a.price - b.price);
  if (rows.length < 6) continue;

  out.push({
    type, code, label, blurb,
    hospitals: rows.length,
    low: rows[0].price,
    high: rows[rows.length - 1].price,
    ratio: rows[rows.length - 1].price / rows[0].price,
    // Sample evenly across the sorted range rather than taking the cheapest few:
    // whole health systems price identically, so the head of the list is often
    // eight copies of one number. Always keep the cheapest and the dearest.
    rows: pickSpread(rows, 11),
  });
}

const bytes = writeJSON(path.join(DATA, 'demo.json'), out);
log(`demo.json: ${out.length} procedures, ${(bytes / 1024).toFixed(1)} KB`);
for (const d of out) {
  log(`   ${d.label.padEnd(26)} ${d.hospitals} hospitals  $${(d.low / 100).toFixed(0)} - $${(d.high / 100).toFixed(0)}  ${d.ratio.toFixed(1)}x`);
}
