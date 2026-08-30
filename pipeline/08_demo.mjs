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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const hospitals = J('hospitals.json');
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
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
  for (let i = 0; i < n; i++) {
    out.push(sorted[Math.round((i / (n - 1)) * (sorted.length - 1))]);
  }
  // Identical neighbours add nothing; drop them but never the endpoints.
  return out.filter((r, i) => i === 0 || i === out.length - 1 || r.price !== out[i - 1].price);
}

const out = [];
for (const [type, code, label, blurb] of SHOW) {
  const shard = path.join(DATA, 'codes', type, code.slice(0, 3) + '.json');
  if (!fs.existsSync(shard)) { console.warn('missing shard for', code); continue; }
  const entry = JSON.parse(fs.readFileSync(shard, 'utf8'))[code];
  if (!entry) { console.warn('missing code', code); continue; }

  const rows = [];
  for (const [hIdx, v] of Object.entries(entry.h)) {
    const prices = [];
    for (let i = 4; i < v.r.length; i += 5) prices.push(v.r[i]);
    const m = median(prices);
    const h = hospitals[+hIdx];
    if (m == null || !h) continue;
    rows.push({ name: titleCase(h.name), city: titleCase(h.city), ccn: h.ccn, price: m, cash: v.c ?? null });
  }
  rows.sort((a, b) => a.price - b.price);
  if (rows.length < 6) continue;

  out.push({
    type, code, label, blurb,
    hospitals: rows.length,
    low: rows[0].price,
    high: rows[rows.length - 1].price,
    ratio: rows[rows.length - 1].price / rows[0].price,
    // Sample evenly across the sorted range rather than taking the cheapest few.
    // Whole health systems price identically, so the head of the list is often
    // eight copies of one number — true, but it makes the chart look broken.
    // Always keep the cheapest and the dearest; they are the point.
    rows: pickSpread(rows, 11),
  });
}

fs.writeFileSync(path.join(DATA, 'demo.json'), JSON.stringify(out));
console.log(`demo.json: ${out.length} procedures, ${(fs.statSync(path.join(DATA, 'demo.json')).size / 1024).toFixed(1)} KB`);
for (const d of out) {
  console.log(`   ${d.label.padEnd(26)} ${d.hospitals} hospitals  $${(d.low/100).toFixed(0)} – $${(d.high/100).toFixed(0)}  ${d.ratio.toFixed(1)}x`);
}
