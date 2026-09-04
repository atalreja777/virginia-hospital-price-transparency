#!/usr/bin/env node
/**
 * Groups the payer names hospitals wrote in their files into the carriers
 * patients recognise, and — new — says what KIND of coverage each one is.
 *
 * Hospitals spell the same insurer a dozen ways: "AETNA", "Aetna - BoB",
 * "AETNA MEDICARE [1003]". Asking a patient to pick the right string is asking
 * them to do the hospital's data entry, so every variant maps onto one brand.
 *
 * Grouping by carrier name alone put "UnitedHealthcare Medicare Advantage" and
 * "UnitedHealthcare Community Plan" (Medicaid) in the commercial
 * UnitedHealthcare bucket, so a working-age patient comparing commercial rates
 * was shown Medicare and Medicaid prices mixed in. Segment is derived from the
 * payer AND the plan string, and every payer keeps its exact published wording
 * as its identity — the segment is an annotation, never a replacement.
 *
 * The rules themselves live in pipeline/lib/payers.mjs so they can be tested
 * without a dataset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, dirs, log, writeJSON, readJSON } from './lib/util.mjs';
import { CARRIERS, SEGMENTS, classifySegment, classifyBrand } from './lib/payers.mjs';

const A = args();
const { data: DATA } = dirs(A);
const payers = readJSON(path.join(DATA, 'payers.json'));
const plans = fs.existsSync(path.join(DATA, 'plans.json')) ? readJSON(path.join(DATA, 'plans.json')) : [];

const groups = new Map();
const brandOf = payers.map((name, i) => {
  const brand = classifyBrand(name);
  let s = groups.get(brand);
  if (!s) groups.set(brand, s = new Set());
  s.add(i);
  return brand;
});

// Segment per payer, from the payer name alone: what the UI uses when only a
// carrier is selected.
const segmentOf = payers.map((name) => classifySegment(name, ''));
// Segment per plan name, so a plan string carrying the product ("Medicare
// Advantage HMO") is classified even under a bare brand.
const planSegmentOf = plans.map((name) => classifySegment('', name));

const KNOWN = new Set([
  ...CARRIERS.map(([b]) => b),
  'Medicare (traditional)', 'Medicaid (Virginia Cardinal Care)',
  'TRICARE / military', 'Workers compensation', 'Self-pay / uninsured',
]);
const isKnown = (b) => KNOWN.has(b) || /^Medicare Advantage|^Medicaid managed care/.test(b);

const list = [...groups.entries()]
  .map(([brand, set]) => {
    const members = [...set].sort((a, b) => a - b);
    const segs = new Set(members.map((m) => segmentOf[m].segment));
    return {
      brand, members, known: isKnown(brand),
      segment: segs.size === 1 ? [...segs][0] : 'mixed',
      segments: [...segs].sort(),
    };
  })
  .sort((a, b) => (b.known - a.known) || (b.members.length - a.members.length) || a.brand.localeCompare(b.brand));

writeJSON(path.join(DATA, 'payer_groups.json'), { brandOf, groups: list, segments: SEGMENTS });

/**
 * payers.json keeps its shape — it is indexed by every price entry — and the
 * annotations live beside it.
 */
writeJSON(path.join(DATA, 'payer_segments.json'), {
  segments: SEGMENTS,
  rule: 'Derived from the payer and plan strings the hospital published. The exact published '
      + 'wording remains the payer\'s identity; segment and confidence are annotations.',
  payers: segmentOf.map((s, i) => ({ i, name: payers[i], segment: s.segment, confidence: s.confidence, signal: s.signal })),
  plans: planSegmentOf.map((s, i) => ({ i, name: plans[i], segment: s.segment, confidence: s.confidence, signal: s.signal })),
});

const bySeg = segmentOf.reduce((m, s) => (m[s.segment] = (m[s.segment] || 0) + 1, m), {});
const byConf = segmentOf.reduce((m, s) => (m[s.confidence] = (m[s.confidence] || 0) + 1, m), {});
log(`${payers.length} raw payer names -> ${list.length} groups`);
log('  segments  :', JSON.stringify(bySeg));
log('  confidence:', JSON.stringify(byConf));
for (const g of list.filter((g) => g.known).slice(0, 12)) {
  log(`   ${String(g.members.length).padStart(4)}  ${g.brand}  [${g.segment}]`);
}
log(`   (${list.filter((g) => !g.known).length} names kept as published because they match no known carrier)`);
