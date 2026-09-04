#!/usr/bin/env node
/**
 * Precomputes the statistics the landing and data pages show, so those pages
 * stay fast and every figure on them traces back to a published price.
 * Reads only the shards this pipeline already wrote.
 *
 * The per-unit rule is applied FIRST, not counted afterwards.
 * -----------------------------------------------------------
 * The old script defined isProcedureLike and then used it for exactly one
 * thing: a footnote counting how many of the spreads it would have excluded.
 * Every headline number — comparable procedures, the median ratio, the 2x/5x/10x
 * counts, the biggest-spread table, the cash comparison — was computed over the
 * unfiltered set. That is how "J1414, 189,210,000x" became the top spread in a
 * table meant to persuade a legislator: a hospital priced the unit and another
 * priced the vial. Drug and supply codes stay searchable; they are never used
 * to make a claim, and now the code enforces that.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  args, dirs, log, median, pct, perUnitReason, isProcedureLike, writeJSON, readJSON,
} from './lib/util.mjs';
import { openData, chargeSummary } from './lib/shards.mjs';

const A = args();
const { data: DATA } = dirs(A);
const J = (f) => readJSON(path.join(DATA, f));

const hospitals = J('hospitals.json');
const search = J('search.json');
const payers = J('payers.json');
const settings = J('settings.json');
const billingClasses = fs.existsSync(path.join(DATA, 'billing_classes.json')) ? J('billing_classes.json') : [];
const data = openData(DATA);

const rows = search.r.map(([type, code, desc, nHosp, nEntries, p10, p50, p90]) =>
  ({ type, code, desc, nHosp, nEntries, p10, p50, p90 }));

/* ---- what may be used to make an argument -------------------------------- */
const audit = {
  codesTotal: rows.length,
  codesPerUnitExcluded: 0,
  perUnitReasons: {},
  codesBelowCoverage: 0,
  coverageThreshold: 8,
  codesComparable: 0,
  codesWithoutShard: 0,
  codesTooFewHospitalMedians: 0,
  cashComparisonsSkippedNoMatchedSetting: 0,
  cashComparisonsSkippedTooFewRates: 0,
  minRatesForCashComparison: 3,
};

const procedureLike = [];
for (const r of rows) {
  const reason = perUnitReason(r.type, r.code, r.desc);
  if (reason) {
    audit.codesPerUnitExcluded++;
    audit.perUnitReasons[reason] = (audit.perUnitReasons[reason] || 0) + 1;
    continue;
  }
  procedureLike.push(r);
}

// Only procedures published by enough hospitals for a comparison to mean
// something, and with a real 10th and 90th percentile.
const comparable = procedureLike.filter((r) => {
  if (r.nHosp >= audit.coverageThreshold && r.p10 > 0 && r.p90 > 0) return true;
  audit.codesBelowCoverage++;
  return false;
});
audit.codesComparable = comparable.length;
log(`${rows.length} codes -> ${procedureLike.length} procedure-like -> ${comparable.length} comparable`);

/* ---- spread: how much the same procedure varies across hospitals ---------- */
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

/* ---- cash vs negotiated, matched on (code, setting, billing class) -------- */
// The old comparison took the first 4,000 comparable codes and compared a
// hospital's single merged cash price against the median of every negotiated
// rate it published for that code, whatever the setting. An outpatient cash
// price against an inpatient negotiated median is not a comparison. This one
// matches on setting and billing class, runs over every comparable code, and
// reports its own denominator.
let cashCheaper = 0, cashComparisons = 0;
const cashExamples = [];

for (const r of comparable) {
  const loaded = data.loadCode(r.type, r.code);
  if (!loaded) { audit.codesWithoutShard++; continue; }

  const perHospital = [];
  for (const h of loaded.hospitals) {
    if (h.prices.length) {
      perHospital.push({ hIdx: h.hIdx, med: median(h.prices), charges: h.charges });
    }

    // cash vs negotiated, within one (setting, billing class)
    for (const c of h.charges) {
      if (c.c == null) continue;
      const matched = h.rates.filter((x) => x.setting === c.se && x.billingClass === c.bc).map((x) => x.cents);
      if (!matched.length) { audit.cashComparisonsSkippedNoMatchedSetting++; continue; }
      if (matched.length < audit.minRatesForCashComparison) { audit.cashComparisonsSkippedTooFewRates++; continue; }
      const med = median(matched);
      cashComparisons++;
      if (c.c < med) {
        cashCheaper++;
        if (med / c.c > 1.5) {
          cashExamples.push({
            type: r.type, code: r.code, desc: r.desc,
            hospital: hospitals[h.hIdx]?.name, city: hospitals[h.hIdx]?.city,
            setting: settings[c.se] ?? null, billingClass: billingClasses[c.bc] ?? null,
            cash: c.c, insured: med, saving: med - c.c, ratesMatched: matched.length,
          });
        }
      }
    }
  }

  if (perHospital.length < audit.coverageThreshold) { audit.codesTooFewHospitalMedians++; continue; }
  perHospital.sort((a, b) => a.med - b.med);

  // Compare the 10th and the 90th percentile hospital, not the two extremes. A
  // single mistyped row in one file must never become the headline number.
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
  if (BASKET_CODES.has(r.type + '|' + r.code)) medsByCode.set(r.type + '|' + r.code, meds);
}

cashExamples.sort((a, b) => b.saving - a.saving);
spreads.sort((a, b) => b.ratio - a.ratio);
const ratios = spreads.map((s) => s.ratio);
const byCode = new Map(spreads.map((s) => [s.type + '|' + s.code, s]));

// Belt and braces: nothing per-unit can reach a headline table even if the
// filter above is ever loosened by accident.
const headlineSafe = spreads.filter((s) => isProcedureLike(s.type, s.code, s.desc));
if (headlineSafe.length !== spreads.length) {
  throw new Error(`per-unit code survived the filter: ${spreads.find((s) => !isProcedureLike(s.type, s.code, s.desc)).code}`);
}

const basket = BASKET
  .map(([type, code, label]) => {
    const s = byCode.get(type + '|' + code);
    return s ? { ...s, label, prices: medsByCode.get(type + '|' + code) ?? [] } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.ratio - a.ratio);

/* ---- coverage ------------------------------------------------------------ */
const withPrices = new Set();
const coverage = hospitals.map((h, i) => ({
  idx: i, name: h.name, city: h.city, status: h.status,
  codes: 0, priceEntries: 0, withheldEntries: 0, formulaEntries: 0, chargeEntries: 0,
}));
data.eachCode(({ hospitals: hs }) => {
  for (const h of hs) {
    const c = coverage[h.hIdx];
    if (!c) continue;
    withPrices.add(h.hIdx);
    c.codes++;
    c.priceEntries += h.rates.length;
    c.withheldEntries += h.withheld.length;
    c.formulaEntries += h.formula.length;
    c.chargeEntries += h.charges.length;
  }
});

const meta = data.meta;
const byStatus = hospitals.reduce((m, h) => (m[h.status] = (m[h.status] || 0) + 1, m), {});

const out = {
  builtAt: new Date().toISOString(),
  releaseId: meta.releaseId ?? null,
  totals: {
    hospitalsSeeded: hospitals.length,
    hospitalsPublishing: withPrices.size,
    hospitalsGeolocated: hospitals.filter((h) => h.lat != null).length,
    procedures: rows.length,
    priceEntries: coverage.reduce((s, c) => s + c.priceEntries, 0),
    withheldEntries: coverage.reduce((s, c) => s + c.withheldEntries, 0),
    formulaEntries: coverage.reduce((s, c) => s + c.formulaEntries, 0),
    chargeEntries: coverage.reduce((s, c) => s + c.chargeEntries, 0),
    payers: payers.length,
    byStatus,
  },
  stages: meta.stages ?? null,
  spread: {
    method: 'Per hospital, the median of its negotiated dollar entries for the code. Codes compared '
          + 'only when at least 8 hospitals publish one. The range is the 10th to the 90th percentile '
          + 'hospital, never the two extremes. Per-unit drug and supply codes are excluded before any '
          + 'of this is computed.',
    comparableProcedures: spreads.length,
    medianRatio: median(ratios),
    p90Ratio: ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length * 0.9)] ?? null,
    over2x: spreads.filter((s) => s.ratio >= 2).length,
    over5x: spreads.filter((s) => s.ratio >= 5).length,
    over10x: spreads.filter((s) => s.ratio >= 10).length,
  },
  biggestSpreads: spreads.slice(0, 40),
  basket,
  headline: basket.slice(0, 12),
  excludedFromHeadline: {
    reason: 'Drug and supply codes are billed per unit, so differences between hospitals often reflect '
          + 'a unit of measure rather than a price. They remain searchable but are never used to make '
          + 'a claim, and they are removed before any statistic on this page is computed.',
    codes: audit.codesPerUnitExcluded,
    reasons: audit.perUnitReasons,
  },
  cash: {
    method: 'A hospital\'s published discounted cash price compared with the median of its own '
          + 'negotiated dollar entries for the SAME code, setting and billing class, requiring at '
          + 'least 3 such entries. Every comparable code is included, not a first slice of them.',
    denominator: cashComparisons,
    comparisons: cashComparisons,
    cashCheaper,
    share: cashComparisons ? cashCheaper / cashComparisons : null,
    examples: cashExamples.slice(0, 24),
  },
  coverage: coverage.filter((h) => h.codes > 0).sort((a, b) => b.codes - a.codes),
  noPrices: coverage.filter((h) => h.codes === 0).map(({ name, city, status }) => ({ name, city, status })),
  audit,
};

writeJSON(path.join(DATA, 'stats.json'), out);
log('stats.json written');
log('  publishing hospitals :', out.totals.hospitalsPublishing, 'of', out.totals.hospitalsSeeded);
log('  comparable procedures:', out.spread.comparableProcedures,
    `(of ${rows.length} codes; ${audit.codesPerUnitExcluded} excluded as per-unit)`);
log('  median spread ratio  :', out.spread.medianRatio?.toFixed(2) + 'x');
log('  >=2x / >=5x / >=10x  :', out.spread.over2x, '/', out.spread.over5x, '/', out.spread.over10x);
log('  cash cheaper         :', cashComparisons
  ? `${(out.cash.share * 100).toFixed(1)}% of ${cashComparisons.toLocaleString()} matched comparisons`
  : 'no matched comparisons');
if (out.biggestSpreads[0]) {
  log('  top spread           :', out.biggestSpreads[0].desc?.slice(0, 50), out.biggestSpreads[0].ratio.toFixed(0) + 'x');
}
