#!/usr/bin/env node
/**
 * Refuses to let a bad release reach public/data.
 *
 * A price site fails silently: a shard whose hospital index is off by one still
 * renders, it just attributes UVA's price to Danville. Every check here exists
 * because the failure it catches would otherwise have been invisible.
 *
 *   node pipeline/09_validate.mjs --data pipeline/out/<id>/data --raw pipeline/out/<id>/raw
 *
 * Exits non-zero, and prints every failure, when the build must not be promoted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  args, dirs, log, readCSV, readJSON, median, pct, perUnitReason, dirSize, mb,
} from './lib/util.mjs';
import { openData } from './lib/shards.mjs';

const A = args();
const { data: DATA, raw: RAW } = dirs(A);
const J = (f) => readJSON(path.join(DATA, f));

const failures = [];
const warnings = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail ?? null });
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  return !!ok;
};
const warn = (name, detail) => { warnings.push(`${name}: ${detail}`); checks.push({ name, ok: true, warning: detail }); };

/* ---- files present ------------------------------------------------------- */
const REQUIRED = ['meta.json', 'hospitals.json', 'search.json', 'payers.json', 'plans.json',
  'settings.json', 'billing_classes.json', 'methodologies.json', 'stats.json',
  'payer_groups.json', 'zips.json', 'demo.json', 'hospital_index.json'];
for (const f of REQUIRED) check(`file ${f} exists`, fs.existsSync(path.join(DATA, f)));
if (failures.length) { report(); process.exit(1); }

const meta = J('meta.json');
const hospitals = J('hospitals.json');
const payers = J('payers.json');
const plans = J('plans.json');
const settings = J('settings.json');
const billingClasses = J('billing_classes.json');
const methods = J('methodologies.json');
const search = J('search.json');
const stats = J('stats.json');
const groups = J('payer_groups.json');
const data = openData(DATA);

/* ---- the export's own guarantees ----------------------------------------- */
const exportManifest = meta.export;
check('meta carries the export manifest', !!exportManifest);
if (exportManifest) {
  check('export ran against a database that knows about rejected file links',
    exportManifest.capabilities?.rejectedAtAvailable === true,
    'hospital_mrfs.rejected_at was missing; run the Phase 0 backend migration before publishing');
  check('export recorded a transaction snapshot', !!exportManifest.snapshot);
}

// Nothing may be published under a hospital<->file link the backend rejected.
const rejectedPairs = new Set();
const rejectedFile = path.join(RAW, 'rejected.csv');
if (fs.existsSync(rejectedFile)) {
  await readCSV(rejectedFile, (r) => rejectedPairs.add(`${r.hospital_id}|${r.mrf_id}`));
}
const rejectedSources = [];
hospitals.forEach((h, i) => {
  (h.sources || []).forEach((s, si) => {
    if (rejectedPairs.has(`${h.id}|${s.mrfId}`)) rejectedSources.push(`${h.name} src[${si}] mrf ${s.mrfId}`);
  });
});
check('no source belongs to a rejected hospital/file pair', rejectedSources.length === 0, rejectedSources.slice(0, 5).join('; '));

/* ---- provenance ---------------------------------------------------------- */
const sourceProblems = [];
for (const h of hospitals) {
  for (const s of h.sources || []) {
    if (!/^https?:\/\//.test(s.url || '')) sourceProblems.push(`${h.name}: source url ${s.url}`);
    if (!/^[0-9a-f]{64}$/.test(s.sha256 || '')) sourceProblems.push(`${h.name}: sha256 is not a full digest (${s.sha256})`);
    if (!Number.isInteger(s.fileVersionId)) sourceProblems.push(`${h.name}: no file_version_id on a source`);
  }
}
check('every source carries a url, a full sha256 and a file version', sourceProblems.length === 0,
  sourceProblems.slice(0, 5).join('; '));

/* ---- shards: every index resolves ---------------------------------------- */
let codes = 0, priceEntries = 0, withheldEntries = 0, formulaEntries = 0, chargeEntries = 0;
const hospitalsSeen = new Set();
const indexProblems = [];
const pennyShown = [];
const bad = (m) => { if (indexProblems.length < 20) indexProblems.push(m); };

data.eachCode(({ type, code, hospitals: hs }) => {
  codes++;
  for (const h of hs) {
    if (!Number.isInteger(h.hIdx) || h.hIdx < 0 || h.hIdx >= hospitals.length) {
      bad(`${type} ${code}: hospital index ${h.hIdx} out of range`);
      continue;
    }
    hospitalsSeen.add(h.hIdx);
    const nSources = hospitals[h.hIdx].sources.length;
    const checkGroup = (g, where) => {
      if (!(g.payer >= 0 && g.payer < payers.length)) bad(`${code}: payer index ${g.payer}`);
      if (!(g.plan >= 0 && g.plan < plans.length)) bad(`${code}: plan index ${g.plan}`);
      if (!(g.setting >= 0 && g.setting < settings.length)) bad(`${code}: setting index ${g.setting}`);
      if (!(g.billingClass >= 0 && g.billingClass < billingClasses.length)) bad(`${code}: billing class index ${g.billingClass}`);
      if (!(g.methodology >= 0 && g.methodology < methods.length)) bad(`${code}: methodology index ${g.methodology}`);
      if (!(g.src >= 0 && g.src < nSources)) bad(`${code}: source index ${g.src} but hospital has ${nSources} sources (${where})`);
    };
    for (const g of h.rates) {
      priceEntries++;
      checkGroup(g, 'r');
      if (!Number.isInteger(g.cents) || g.cents <= 1) pennyShown.push(`${type} ${code} @${hospitals[h.hIdx].name}: ${g.cents}`);
    }
    for (const g of h.withheld) { withheldEntries++; checkGroup(g, 'w'); }
    for (const g of h.formula) {
      formulaEntries++;
      checkGroup(g, 'x');
      if (g.kind == null) bad(`${code}: formula entry with unknown price kind`);
    }
    for (const c of h.charges) {
      chargeEntries++;
      if (!(c.se >= 0 && c.se < settings.length)) bad(`${code}: charge setting index ${c.se}`);
      if (!(c.bc >= 0 && c.bc < billingClasses.length)) bad(`${code}: charge billing class index ${c.bc}`);
      if (!(c.src >= 0 && c.src < nSources)) bad(`${code}: charge source index ${c.src}`);
      for (const f of ['g', 'c', 'mn', 'mx']) {
        const v = c[f];
        if (v != null && (!Number.isInteger(v) || v <= 1)) pennyShown.push(`${type} ${code} charge ${f} = ${v}`);
      }
    }
  }
});

check('every index in every shard resolves', indexProblems.length === 0, indexProblems.join('; '));
check('no price is shown at a penny or less', pennyShown.length === 0, pennyShown.slice(0, 5).join('; '));

/* ---- counts agree with meta ---------------------------------------------- */
check('meta.counts.codes matches the shards', meta.counts.codes === codes, `${meta.counts.codes} vs ${codes}`);
check('meta.counts.priceEntries matches the shards', meta.counts.priceEntries === priceEntries, `${meta.counts.priceEntries} vs ${priceEntries}`);
check('meta.counts.withheldEntries matches the shards', meta.counts.withheldEntries === withheldEntries, `${meta.counts.withheldEntries} vs ${withheldEntries}`);
check('meta.counts.formulaEntries matches the shards', meta.counts.formulaEntries === formulaEntries, `${meta.counts.formulaEntries} vs ${formulaEntries}`);
check('meta.counts.chargeEntries matches the shards', meta.counts.chargeEntries === chargeEntries, `${meta.counts.chargeEntries} vs ${chargeEntries}`);
check('hospitalsWithPrices is a real number', Number.isInteger(meta.counts.hospitalsWithPrices) && meta.counts.hospitalsWithPrices > 0,
  String(meta.counts.hospitalsWithPrices));
check('hospitalsWithPrices matches the shards', meta.counts.hospitalsWithPrices === hospitalsSeen.size,
  `${meta.counts.hospitalsWithPrices} vs ${hospitalsSeen.size}`);
check('search index covers every code in the shards', search.r.length === codes, `${search.r.length} vs ${codes}`);
check('meta declares the shard contract', !!meta.shard?.rateFields?.length && meta.shard.version >= 2);
check('meta carries a build id and a release id', !!meta.buildId && !!meta.releaseId);

/* ---- statistics ---------------------------------------------------------- */
const perUnitInHeadline = [];
for (const s of [...stats.biggestSpreads, ...stats.basket]) {
  const r = perUnitReason(s.type, s.code, s.desc);
  if (r) perUnitInHeadline.push(`${s.type} ${s.code} (${r})`);
}
check('no per-unit or HCPCS J/Q/A code in a headline table', perUnitInHeadline.length === 0,
  perUnitInHeadline.slice(0, 5).join('; '));
check('spread ratios are the right way round', stats.biggestSpreads.every((s) => s.high >= s.low && s.ratio >= 1));
check('the cash comparison reports its denominator',
  Number.isInteger(stats.cash.denominator) && typeof stats.cash.method === 'string');
check('stats totals agree with the shards', stats.totals.priceEntries === priceEntries,
  `${stats.totals.priceEntries} vs ${priceEntries}`);
check('payer groups cover every payer',
  groups.brandOf.length === payers.length && new Set(groups.groups.flatMap((g) => g.members)).size === payers.length);

/**
 * Recompute the headline statistics independently of 05_stats.mjs and insist
 * they match. Two implementations disagreeing is the cheapest possible alarm on
 * a stats bug, and the numbers in stats.json are the ones a legislator quotes.
 */
const rows = search.r.map(([type, code, desc, nHosp, nEntries, p10, p50, p90]) =>
  ({ type, code, desc, nHosp, nEntries, p10, p50, p90 }));
const recomputed = [];
for (const r of rows) {
  if (perUnitReason(r.type, r.code, r.desc)) continue;
  if (!(r.nHosp >= 8 && r.p10 > 0 && r.p90 > 0)) continue;
  const loaded = data.loadCode(r.type, r.code);
  if (!loaded) continue;
  const meds = loaded.hospitals.filter((h) => h.prices.length).map((h) => median(h.prices)).sort((a, b) => a - b);
  if (meds.length < 8) continue;
  const lo = pct(meds, 0.10), hi = pct(meds, 0.90);
  if (!lo || !hi) continue;
  recomputed.push(hi / lo);
}
recomputed.sort((a, b) => a - b);
const rec = {
  comparableProcedures: recomputed.length,
  medianRatio: median(recomputed),
  over2x: recomputed.filter((x) => x >= 2).length,
  over5x: recomputed.filter((x) => x >= 5).length,
  over10x: recomputed.filter((x) => x >= 10).length,
};
for (const k of Object.keys(rec)) {
  const a = rec[k], b = stats.spread[k];
  const same = (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
  check(`stats.spread.${k} survives an independent recompute`, same, `${b} vs recomputed ${a}`);
}

/* ---- size ---------------------------------------------------------------- */
const bytes = dirSize(DATA);
const budget = meta.size?.budgetBytes ?? 400 * 1048576;
if (bytes > budget) warn('dataset size', `${mb(bytes)} exceeds the ${mb(budget)} budget`);
const bigShards = [];
const codesRoot = path.join(DATA, 'codes');
for (const t of fs.readdirSync(codesRoot)) {
  for (const f of fs.readdirSync(path.join(codesRoot, t))) {
    const size = fs.statSync(path.join(codesRoot, t, f)).size;
    if (size > 3 * 1048576) bigShards.push(`${t}/${f} ${mb(size)}`);
  }
}
check('no single shard would stall a phone (>3 MB)', bigShards.length === 0, bigShards.slice(0, 5).join('; '));

/* ---- report -------------------------------------------------------------- */
function report() {
  const out = {
    validatedAt: new Date().toISOString(),
    dataDir: DATA,
    passed: failures.length === 0,
    failures, warnings, checks,
    observed: { codes, priceEntries, withheldEntries, formulaEntries, chargeEntries, hospitalsWithPrices: hospitalsSeen.size, bytes },
    recomputedSpread: typeof rec === 'undefined' ? null : rec,
  };
  fs.writeFileSync(path.join(DATA, 'validation.json'), JSON.stringify(out, null, 2));
  for (const c of checks) log(c.ok ? (c.warning ? 'WARN ' : 'ok   ') : 'FAIL ', c.name, c.detail ? `- ${c.detail}` : (c.warning ? `- ${c.warning}` : ''));
  log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed, ${warnings.length} warnings`);
  return out;
}

const result = report();
if (!result.passed) {
  log('VALIDATION FAILED — this build must not be promoted to public/data');
  process.exit(1);
}
log('validation passed');
