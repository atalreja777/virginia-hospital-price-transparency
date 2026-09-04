#!/usr/bin/env node
/**
 * Generates the synthetic export the pipeline tests run against.
 *
 * Ten invented hospitals, a handful of codes, and one instance of every trap
 * the real data sets: a drug code with an absurd spread, a sub-cent price, a
 * code published only as a cash price, a code hidden in a local `CDM` column,
 * a hospital whose file link was rejected, and one code priced differently in
 * two settings. Small enough to read; complete enough that a regression in any
 * of the six defects this rewrite fixes fails a test.
 *
 *   node tests/fixtures/pipeline/build.mjs      # regenerate in place
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || HERE;

const HOSPITALS = Array.from({ length: 10 }, (_, i) => ({
  id: 901 + i,
  ccn: `49T${String(i + 1).padStart(3, '0')}`,
  name: `Test Hospital ${i + 1}`,
  city: 'Testville',
  fv: 8001 + i,
  mrf: 7001 + i,
}));
// Hospital 10's file was rejected as belonging to somebody else.
const REJECTED = [{ hospital_id: 910, mrf_id: 7010, reason: 'file declares a different hospital' }];

const csv = (rows) => rows.map((r) => r.map((v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

const write = (rel, rows) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, csv(rows));
};

/* ---- dictionaries -------------------------------------------------------- */
const PAYERS = [
  [1, 'AETNA', 'aetna'],
  [2, 'ANTHEM HEALTHKEEPERS', 'anthem'],
  [3, 'UNITED HEALTHCARE MEDICARE ADVANTAGE', 'uhc_ma'],
  [4, 'ANTHEM COMMUNITY PLAN MEDICAID', 'anthem_medicaid'],
  [5, 'MEDICARE', 'medicare'],
  [6, 'SELF PAY', 'selfpay'],
];
const PLANS = [[1, 'PPO', 'ppo'], [2, 'HMO', 'hmo'], [3, 'MEDICARE ADVANTAGE HMO', 'ma_hmo']];
const METHODS = [[1, 'Case Rate'], [2, 'case rate'], [3, 'fee schedule'], [4, 'percent of charges']];

write('payers.csv', [['payer_id', 'payer_name_raw', 'payer_key'], ...PAYERS]);
write('plans.csv', [['plan_id', 'plan_name_raw', 'plan_key'], ...PLANS]);
write('methodologies.csv', [['methodology_id', 'methodology'], ...METHODS]);

write('hospitals.csv', [
  ['hospital_id', 'ccn', 'name', 'address', 'city', 'state', 'zip', 'ownership', 'hgi_type', 'status', 'pos_subtype_cd', 'exempt_basis', 'status_reason'],
  ...HOSPITALS.map((h) => [h.id, h.ccn, h.name, '1 Test Way', h.city, 'VA', '23000', 'Nonprofit', 'Short Term', 'success', '', '', '']),
]);

write('sources.csv', [
  ['hospital_id', 'file_version_id', 'mrf_id', 'url', 'source_page_url', 'declared_last_updated', 'declared_version', 'layout', 'sha256', 'size_bytes', 'first_seen_at', 'declared_hospital_name', 'attestation_confirmed'],
  ...HOSPITALS.filter((h) => !REJECTED.some((r) => r.hospital_id === h.id)).map((h) => [
    h.id, h.fv, h.mrf, `https://example.org/${h.ccn}/standardcharges.csv`, `https://example.org/${h.ccn}/`,
    '2026-01-15', '2.0.0', 'csv_wide', String(h.id).repeat(21).slice(0, 64).padEnd(64, 'a'),
    123456, '2026-02-01 10:00:00+00', h.name, 't',
  ]),
]);

write('rejected.csv', [
  ['hospital_id', 'mrf_id', 'rejected_at', 'rejected_reason'],
  ...REJECTED.map((r) => [r.hospital_id, r.mrf_id, '2026-03-01 00:00:00+00', r.reason]),
]);

write('snapshot.csv', [['snapshot', 'xmin', 'taken_at', 'server_version'], ['1000:1000:', '1000', '2026-03-01 00:00:00+00', '16.13']]);

/* ---- the published rows -------------------------------------------------- */
const CHARGE_HEAD = ['hospital_id', 'file_version_id', 'item_id', 'source_row_ref', 'code_type', 'code',
  'description', 'setting', 'billing_class', 'modifiers', 'drug_unit', 'drug_type',
  'gross', 'cash', 'min_negotiated', 'max_negotiated', 'generic_notes', 'dup_count'];
const RATE_HEAD = ['hospital_id', 'file_version_id', 'item_id', 'code_type', 'code', 'setting', 'billing_class',
  'modifiers', 'drug_unit', 'payer_id', 'plan_id', 'methodology_id', 'negotiated_dollar',
  'negotiated_percentage', 'negotiated_algorithm', 'estimated_amount', 'median_amount',
  'p10_amount', 'p90_amount', 'count_raw', 'additional_notes', 'derived_basis', 'quality_labels'];

let itemId = 100000;
const charges = new Map(HOSPITALS.map((h) => [h.id, []]));
const rates = new Map(HOSPITALS.map((h) => [h.id, []]));

function charge(h, { type, code, desc, setting = 'outpatient', bc = 'facility', gross, cash, mn, mx }) {
  itemId++;
  charges.get(h.id).push([h.id, h.fv, itemId, `row:${itemId}`, type, code, desc, setting, bc, '', '', '',
    gross ?? '', cash ?? '', mn ?? '', mx ?? '', '', '']);
  return itemId;
}
function rate(h, item, { type, code, setting = 'outpatient', bc = 'facility', payer, plan, meth, dollar, pctv, alg, est }) {
  rates.get(h.id).push([h.id, h.fv, item, type, code, setting, bc, '', '', payer, plan, meth,
    dollar ?? '', pctv ?? '', alg ?? '', est ?? '', '', '', '', '', '', '', '']);
}

for (const [i, h] of HOSPITALS.entries()) {
  /* Colonoscopy: every hospital, a believable 3x spread across hospitals. */
  const colo = charge(h, { type: 'CPT', code: '45378', desc: 'Colonoscopy, flexible, diagnostic', gross: 4000 + i * 300, cash: 1200 + i * 90 });
  for (const [p, pl, m] of [[1, 1, 3], [2, 1, 1], [3, 3, 2], [5, 1, 3]]) {
    rate(h, colo, { type: 'CPT', code: '45378', payer: p, plan: pl, meth: m, dollar: 900 + i * 120 + p * 7 });
  }

  /* A drug code billed per unit, with the absurd spread those produce. It must
     never reach a headline table however large its ratio is. */
  const drug = charge(h, { type: 'HCPCS', code: 'J1234', desc: 'Injection, testolimab, 1 mg', gross: 10 + i, cash: 5 + i });
  rate(h, drug, { type: 'HCPCS', code: 'J1234', payer: 1, plan: 1, meth: 3, dollar: i === 0 ? 0.02 : 20 * (i + 1) * (i + 1) });

  /* CT head: eight hospitals, and a cash price below the insured median at
     half of them, matched on setting and billing class. */
  if (i < 8) {
    const ct = charge(h, { type: 'CPT', code: '70450', desc: 'Ct head or brain without contrast', gross: 2000 + i * 400, cash: i % 2 ? 300 : 1500 });
    for (const [p, pl, m] of [[1, 1, 3], [2, 2, 3], [5, 1, 3]]) {
      rate(h, ct, { type: 'CPT', code: '70450', payer: p, plan: pl, meth: m, dollar: 800 + i * 150 + p * 11 });
    }
  }
}

/* ---- the specific traps -------------------------------------------------- */
const h1 = HOSPITALS[0], h2 = HOSPITALS[1], h9 = HOSPITALS[8], h10 = HOSPITALS[9];

// (a) Same code, two settings, two very different cash prices. Neither may be
//     merged away, and the inpatient one must not overwrite the outpatient one.
const ctOut = charge(h1, { type: 'CPT', code: '70450', desc: 'Ct head or brain without contrast', setting: 'outpatient', bc: 'facility', gross: 2000, cash: 150 });
const ctIn = charge(h1, { type: 'CPT', code: '70450', desc: 'Ct head or brain without contrast', setting: 'inpatient', bc: 'facility', gross: 9000, cash: 900 });
rate(h1, ctIn, { type: 'CPT', code: '70450', setting: 'inpatient', payer: 1, plan: 1, meth: 1, dollar: 4200 });

// (b) Same (setting, billing class) key, two different cash prices from two
//     rows of the same file. Both are facts; both survive.
charge(h1, { type: 'CPT', code: '80053', desc: 'Comprehensive metabolic panel', gross: 300, cash: 45 });
charge(h1, { type: 'CPT', code: '80053', desc: 'Comprehensive metabolic panel', gross: 300, cash: 60 });
// ...and 80053 has no negotiated rate anywhere at this hospital: a code that
// exists only as a cash price still has to appear on the site.

// (c) Three distinct negotiated dollars under one payer/plan/setting/method.
//     The old packer kept the lowest and the highest and threw the middle away.
const colo1 = charges.get(h1.id).find((r) => r[5] === '45378')[2];
for (const d of [1111, 1222, 1333]) rate(h1, colo1, { type: 'CPT', code: '45378', payer: 6, plan: 2, meth: 3, dollar: d });

// (d) A sub-cent value. It rounds to a penny, which the site's methodology says
//     is withheld — so it must be carried flagged, not shown, not dropped.
rate(h2, charges.get(h2.id)[0][2], { type: 'CPT', code: '45378', payer: 1, plan: 1, meth: 3, dollar: 0.008 });

// (e) A percentage-only rate: no dollar, but the payer did agree something.
rate(h2, charges.get(h2.id)[0][2], { type: 'CPT', code: '45378', payer: 2, plan: 1, meth: 4, pctv: 42.5 });

// (f) Real codes hidden in a hospital's local column. 29881 is corroborated by
//     hospital 1 publishing it properly; 88888 is not corroborated by anyone
//     and must stay out rather than being invented into a CPT.
const knee = charge(h1, { type: 'CPT', code: '29881', desc: 'Arthroscopy, knee, surgical, with meniscectomy', gross: 15000, cash: 9000 });
rate(h1, knee, { type: 'CPT', code: '29881', payer: 1, plan: 1, meth: 1, dollar: 8000 });
const kneeLocal = charge(h9, { type: 'CDM', code: '29881', desc: 'KNEE SCOPE MENISC', gross: 14000, cash: 8000 });
rate(h9, kneeLocal, { type: 'CDM', code: '29881', payer: 1, plan: 1, meth: 1, dollar: 7000 });
const madeUp = charge(h9, { type: 'CDM', code: '88888', desc: 'HOUSE CHARGE CODE', gross: 100, cash: 90 });
rate(h9, madeUp, { type: 'CDM', code: '88888', payer: 1, plan: 1, meth: 1, dollar: 95 });
// A revenue code mislabelled as HCPCS, which is what hides real hospitals.
charge(h9, { type: 'HCPCS', code: '270', desc: 'MEDICAL SUPPLIES', gross: 12 });

// (g) The rejected hospital published plenty; none of it may appear.
const ghost = charge(h10, { type: 'CPT', code: '45378', desc: 'Colonoscopy, flexible, diagnostic', gross: 99999, cash: 88888 });
rate(h10, ghost, { type: 'CPT', code: '45378', payer: 1, plan: 1, meth: 3, dollar: 77777 });

/* ---- write per-hospital files and stage counts --------------------------- */
const STAGE_HEAD = ['hospital_id', 'ccn', 'name', 'status', 'mrf_links', 'mrf_links_rejected',
  'items_total', 'items_clean', 'items_with_shoppable_code', 'items_clean_shoppable',
  'items_with_cash', 'cash_only_items', 'rates_total', 'rates_clean', 'negotiated_dollar_rates',
  'percentage_only_rates', 'allowed_amount_rates', 'algorithm_only_rates'];

for (const h of HOSPITALS) {
  const isRejected = REJECTED.some((r) => r.hospital_id === h.id);
  // The export writes nothing for a rejected link; the stage counts still do,
  // because "we found a file and refused it" is a fact readers are owed.
  write(`charges/${h.id}.csv`, [CHARGE_HEAD, ...(isRejected ? [] : charges.get(h.id))]);
  write(`rates/${h.id}.csv`, [RATE_HEAD, ...(isRejected ? [] : rates.get(h.id))]);
  const ch = charges.get(h.id), ra = rates.get(h.id);
  write(`stage_counts/${h.id}.csv`, [STAGE_HEAD, [
    h.id, h.ccn, h.name, 'success', 1, isRejected ? 1 : 0,
    isRejected ? 0 : ch.length, isRejected ? 0 : ch.length,
    isRejected ? 0 : ch.length, isRejected ? 0 : ch.length,
    isRejected ? 0 : ch.filter((r) => r[13] !== '').length,
    isRejected ? 0 : 1,
    isRejected ? 0 : ra.length, isRejected ? 0 : ra.length,
    isRejected ? 0 : ra.filter((r) => r[12] !== '').length,
    isRejected ? 0 : ra.filter((r) => r[12] === '' && r[13] !== '').length, 0, 0,
  ]]);
}

fs.writeFileSync(path.join(OUT, 'export_manifest.json'), JSON.stringify({
  stage: '01_export',
  exportedAt: '2026-03-01T00:00:00Z',
  database: 'fixture',
  state: 'VA',
  scope: 'synthetic fixture',
  hospitalIds: HOSPITALS.map((h) => h.id),
  hospitalCount: HOSPITALS.length,
  statementTimeout: '120s',
  snapshot: '1000:1000:',
  capabilities: { rejectedAtAvailable: true, sourceRowRefAvailable: true, genericNotesAvailable: false, dupCountAvailable: false },
  ratesSource: 'fixture',
  itemsSource: 'fixture',
  files: {},
}, null, 2) + '\n');

// A couple of ZIP centroids, so the validator has the file it insists on.
fs.writeFileSync(path.join(OUT, 'zips.json'), JSON.stringify({ 23219: [37.5407, -77.4360], 22030: [38.8462, -77.3064] }));

console.log(`fixture written to ${OUT}`);
