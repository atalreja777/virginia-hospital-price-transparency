#!/usr/bin/env node
/**
 * Precomputes the statistics the landing and data pages show, so those pages
 * stay fast and every figure on them traces back to a published price.
 * Reads only the shards this pipeline already wrote.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const hospitals = J('hospitals.json');
const search = J('search.json');
const payers = J('payers.json');
const rows = search.r.map(([type, code, desc, nHosp, nRates, p10, p50, p90]) =>
  ({ type, code, desc, nHosp, nRates, p10, p50, p90 }));

const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);


/**
 * Drug and supply codes are billed per unit — per mg, per ml, per dose. One
 * hospital prices the milligram and another prices the vial, so the "spread"
 * between them is a unit-of-measure mismatch, not a price difference. Leading
 * with those would be dishonest, so they are excluded from anything headline.
 * They stay searchable; they are just never used to make an argument.
 */
const PER_UNIT = /\b(inj(ection)?|per\s|mg\b|ml\b|mcg\b|unit[s]?\b|dose|vial|tablet|capsule|solution|soln|iv\b|infusion)\b/i;
const isProcedureLike = (r) =>
  !PER_UNIT.test(r.desc || '')
  && !(r.type === 'HCPCS' && /^[JQ]/.test(r.code));   // J = drugs, Q = temporary supplies

/* ---- spread: how much the same procedure varies across hospitals ---------- */
// Only procedures published by enough hospitals for the comparison to mean
// something, and with a real median, so one outlier cannot drive the story.
const comparable = rows.filter((r) => r.nHosp >= 8 && r.p10 > 0 && r.p90 > 0);

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

/**
 * A basket of care people actually plan and shop for. Recognisable procedures
 * make the argument better than statistical extremes, and every one of them is
 * something a Virginian might schedule next month.
 */
const BASKET = [
  ['CPT', '45378', 'Colonoscopy'],
  ['CPT', '45380', 'Colonoscopy with biopsy'],
  ['CPT', '70450', 'CT scan of the head'],
  ['CPT', '72148', 'MRI of the lower back'],
  ['CPT', '73721', 'MRI of a knee or leg joint'],
  ['CPT', '74177', 'CT scan of the abdomen and pelvis'],
  ['CPT', '76700', 'Abdominal ultrasound'],
  ['CPT', '77067', 'Screening mammogram'],
  ['CPT', '80053', 'Comprehensive metabolic blood panel'],
  ['CPT', '85025', 'Complete blood count'],
  ['CPT', '81002', 'Urinalysis'],
  ['CPT', '93000', 'Electrocardiogram'],
  ['CPT', '93306', 'Echocardiogram of the heart'],
  ['CPT', '27447', 'Total knee replacement'],
  ['CPT', '27130', 'Total hip replacement'],
  ['CPT', '29881', 'Knee arthroscopy with meniscus repair'],
  ['CPT', '66984', 'Cataract surgery'],
  ['CPT', '47562', 'Gallbladder removal, laparoscopic'],
  ['CPT', '49505', 'Inguinal hernia repair'],
  ['CPT', '59400', 'Childbirth, vaginal delivery'],
  ['CPT', '59510', 'Childbirth, caesarean delivery'],
  ['CPT', '43239', 'Upper endoscopy with biopsy'],
  ['CPT', '19120', 'Breast lump removal'],
  ['CPT', '64483', 'Spinal injection for back pain'],
  ['MS-DRG', '470', 'Major joint replacement, inpatient stay'],
  ['MS-DRG', '291', 'Heart failure, inpatient stay'],
  ['MS-DRG', '193', 'Pneumonia, inpatient stay'],
  ['MS-DRG', '807', 'Vaginal delivery, inpatient stay'],
];
const BASKET_CODES = new Set(BASKET.map(([t, c]) => t + '|' + c));

const medsByCode = new Map();
const spreads = [];
for (const r of comparable) {
  const shard = path.join(DATA, 'codes', r.type.replace(/[^A-Za-z0-9-]/g, ''), r.code.slice(0, 3) + '.json');
  if (!fs.existsSync(shard)) continue;
  const entry = JSON.parse(fs.readFileSync(shard, 'utf8'))[r.code];
  if (!entry) continue;

  // One representative price per hospital: its median negotiated rate.
  const perHospital = [];
  for (const [hIdx, v] of Object.entries(entry.h)) {
    const ps = [];
    for (let i = 4; i < v.r.length; i += 5) ps.push(v.r[i]);
    if (!ps.length) continue;
    perHospital.push({ hIdx: +hIdx, med: median(ps), cash: v.c, gross: v.g });
  }
  if (perHospital.length < 8) continue;
  perHospital.sort((a, b) => a.med - b.med);

  // Compare the 10th and 90th percentile hospital, not the two extremes. A
  // single mistyped row in one file should never become the headline number.
  const meds = perHospital.map((x) => x.med);
  const lo = pct(meds, 0.10), hi = pct(meds, 0.90);
  if (!lo || !hi) continue;
  const loH = perHospital[Math.min(perHospital.length - 1, Math.floor(0.10 * perHospital.length))];
  const hiH = perHospital[Math.min(perHospital.length - 1, Math.floor(0.90 * perHospital.length))];

  spreads.push({
    type: r.type, code: r.code, desc: r.desc, hospitals: perHospital.length,
    low: lo, high: hi, ratio: hi / lo,
    absoluteLow: meds[0], absoluteHigh: meds[meds.length - 1],
    lowHospital: hospitals[loH.hIdx]?.name ?? null,
    lowCity: hospitals[loH.hIdx]?.city ?? null,
    highHospital: hospitals[hiH.hIdx]?.name ?? null,
    highCity: hospitals[hiH.hIdx]?.city ?? null,
    median: median(meds),
  });
  // Every hospital's own median, kept only for the codes the basket draws on.
  // The landing page plots one dot per hospital, and a range with nothing
  // inside it cannot show that most hospitals cluster low while a few do not.
  if (BASKET_CODES.has(r.type + '|' + r.code)) medsByCode.set(r.type + '|' + r.code, meds);
}

spreads.sort((a, b) => b.ratio - a.ratio);
const ratios = spreads.map((s) => s.ratio);
const byCode = new Map(spreads.map((s) => [s.type + '|' + s.code, s]));

/**
 * A basket of care people actually plan and shop for. Recognisable procedures
 * make the argument better than statistical extremes, and every one of them is
 * something a Virginian might schedule next month.
 */

const basket = BASKET
  .map(([type, code, label]) => {
    const s = byCode.get(type + '|' + code);
    return s ? { ...s, label, prices: medsByCode.get(type + '|' + code) ?? [] } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.ratio - a.ratio);

/* ---- cash vs negotiated: when paying cash beats using insurance ----------- */
let cashCheaperCount = 0, cashComparisons = 0;
const cashExamples = [];
for (const r of comparable.slice(0, 4000)) {
  const shard = path.join(DATA, 'codes', r.type.replace(/[^A-Za-z0-9-]/g, ''), r.code.slice(0, 3) + '.json');
  if (!fs.existsSync(shard)) continue;
  const entry = JSON.parse(fs.readFileSync(shard, 'utf8'))[r.code];
  if (!entry) continue;
  for (const [hIdx, v] of Object.entries(entry.h)) {
    if (v.c == null) continue;
    const ps = [];
    for (let i = 4; i < v.r.length; i += 5) ps.push(v.r[i]);
    if (ps.length < 3) continue;
    const med = median(ps);
    cashComparisons++;
    if (v.c < med) {
      cashCheaperCount++;
      if (cashExamples.length < 200 && med / v.c > 1.5) {
        cashExamples.push({
          type: r.type, code: r.code, desc: r.desc,
          hospital: hospitals[+hIdx]?.name, city: hospitals[+hIdx]?.city,
          cash: v.c, insured: med, saving: med - v.c,
        });
      }
    }
  }
}
cashExamples.sort((a, b) => b.saving - a.saving);

/* ---- coverage and compliance --------------------------------------------- */
const withPrices = new Set();
for (const r of rows) { /* counted below from shards for accuracy */ }
const hospitalCoverage = hospitals.map((h, i) => ({ idx: i, name: h.name, city: h.city, status: h.status, codes: 0 }));
for (const r of rows) {
  const shard = path.join(DATA, 'codes', r.type.replace(/[^A-Za-z0-9-]/g, ''), r.code.slice(0, 3) + '.json');
  if (!fs.existsSync(shard)) continue;
}
// cheaper: walk each shard once
for (const typeDir of fs.readdirSync(path.join(DATA, 'codes'))) {
  for (const f of fs.readdirSync(path.join(DATA, 'codes', typeDir))) {
    const bucket = JSON.parse(fs.readFileSync(path.join(DATA, 'codes', typeDir, f), 'utf8'));
    for (const entry of Object.values(bucket)) {
      for (const hIdx of Object.keys(entry.h)) {
        withPrices.add(+hIdx);
        hospitalCoverage[+hIdx].codes++;
      }
    }
  }
}

const byStatus = hospitals.reduce((m, h) => (m[h.status] = (m[h.status] || 0) + 1, m), {});
const geo = hospitals.filter((h) => h.lat != null).length;

const out = {
  builtAt: new Date().toISOString(),
  totals: {
    hospitalsSeeded: hospitals.length,
    hospitalsPublishing: withPrices.size,
    hospitalsGeolocated: geo,
    procedures: rows.length,
    prices: rows.reduce((s, r) => s + r.nRates, 0),
    payers: payers.length,
    byStatus,
  },
  spread: {
    comparableProcedures: spreads.length,
    medianRatio: median(ratios),
    p90Ratio: ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length * 0.9)] ?? null,
    over2x: spreads.filter((s) => s.ratio >= 2).length,
    over5x: spreads.filter((s) => s.ratio >= 5).length,
    over10x: spreads.filter((s) => s.ratio >= 10).length,
  },
  biggestSpreads: spreads.slice(0, 40),
  // A basket of recognisable, schedulable care. This is what the site leads with.
  basket,
  headline: basket.slice(0, 12),
  excludedFromHeadline: {
    reason: 'Drug and supply codes are billed per unit, so differences between hospitals '
          + 'often reflect a unit of measure rather than a price. They remain searchable '
          + 'but are never used to make a claim.',
    count: spreads.filter((s) => !isProcedureLike(s)).length,
  },
  cash: {
    comparisons: cashComparisons,
    cashCheaper: cashCheaperCount,
    share: cashComparisons ? cashCheaperCount / cashComparisons : null,
    examples: cashExamples.slice(0, 24),
  },
  coverage: hospitalCoverage.filter((h) => h.codes > 0).sort((a, b) => b.codes - a.codes),
  noPrices: hospitalCoverage.filter((h) => h.codes === 0).map(({ name, city, status }) => ({ name, city, status })),
};

fs.writeFileSync(path.join(DATA, 'stats.json'), JSON.stringify(out));
console.log('stats.json written');
console.log('  publishing hospitals :', out.totals.hospitalsPublishing, 'of', out.totals.hospitalsSeeded);
console.log('  comparable procedures:', out.spread.comparableProcedures);
console.log('  median spread ratio  :', out.spread.medianRatio?.toFixed(2) + 'x');
console.log('  >=2x / >=5x / >=10x  :', out.spread.over2x, '/', out.spread.over5x, '/', out.spread.over10x);
console.log('  cash cheaper than insured median:', (out.cash.share * 100).toFixed(1) + '%');
console.log('  top spread:', out.biggestSpreads[0]?.desc?.slice(0, 50), out.biggestSpreads[0]?.ratio.toFixed(0) + 'x');
