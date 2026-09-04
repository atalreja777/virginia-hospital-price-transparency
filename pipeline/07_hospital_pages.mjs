#!/usr/bin/env node
/**
 * Per-hospital summaries.
 *
 * The price shards are keyed by procedure, which is right for the main search
 * but useless for "show me this hospital". This walks every shard once and
 * writes one small file per hospital, so a hospital page is a single fetch.
 *
 * Reads through pipeline/lib/shards.mjs, so it follows whatever encoding
 * meta.json declares rather than assuming a stride.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, dirs, log, median, writeJSON, readJSON } from './lib/util.mjs';
import { openData, chargeSummary } from './lib/shards.mjs';

const A = args();
const { data: DATA } = dirs(A);
const J = (f) => readJSON(path.join(DATA, f));

const hospitals = J('hospitals.json');
const stats = J('stats.json');
const groups = J('payer_groups.json');
const settings = J('settings.json');
const billingClasses = fs.existsSync(path.join(DATA, 'billing_classes.json')) ? J('billing_classes.json') : [];
const data = openData(DATA);

const basketLabel = new Map(stats.basket.map((b) => [`${b.type}|${b.code}`, b.label]));
const basketMedian = new Map(stats.basket.map((b) => [`${b.type}|${b.code}`, b.median]));

const acc = hospitals.map(() => ({
  codes: 0, priceEntries: 0, withheldEntries: 0, formulaEntries: 0, chargeEntries: 0,
  payers: new Set(), brands: new Set(), segments: new Set(),
  settings: new Set(), billingClasses: new Set(), sources: new Set(),
  withGross: 0, withCash: 0, cashBeatsInsured: 0, cashComparisons: 0,
  basket: [],
}));

data.eachCode(({ type, code, desc, hospitals: hs }) => {
  const key = `${type}|${code}`;
  for (const h of hs) {
    const a = acc[h.hIdx];
    if (!a) continue;
    a.codes++;
    a.priceEntries += h.rates.length;
    a.withheldEntries += h.withheld.length;
    a.formulaEntries += h.formula.length;
    a.chargeEntries += h.charges.length;
    for (const r of h.rates) {
      a.payers.add(r.payer);
      a.settings.add(r.setting);
      a.billingClasses.add(r.billingClass);
      a.sources.add(r.src);
      const b = groups.brandOf[r.payer];
      if (b) a.brands.add(b);
    }
    for (const c of h.charges) {
      if (c.g != null) a.withGross++;
      if (c.c != null) a.withCash++;
      a.sources.add(c.src);
      // Cash beats insured only within the same setting and billing class.
      if (c.c == null) continue;
      const matched = h.rates.filter((r) => r.setting === c.se && r.billingClass === c.bc).map((r) => r.cents);
      if (matched.length < 3) continue;
      a.cashComparisons++;
      if (c.c < median(matched)) a.cashBeatsInsured++;
    }
    if (basketLabel.has(key)) {
      const ch = chargeSummary(h.charges);
      a.basket.push({
        type, code, label: basketLabel.get(key), desc,
        median: median(h.prices), low: h.prices[0] ?? null, high: h.prices[h.prices.length - 1] ?? null,
        entries: h.rates.length,
        grossLow: ch.grossLow, grossHigh: ch.grossHigh,
        cashLow: ch.cashLow, cashHigh: ch.cashHigh,
        chargeCombinations: ch.combinations,
        stateMedian: basketMedian.get(key),
      });
    }
  }
});

const dir = path.join(DATA, 'hospital');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

let written = 0;
hospitals.forEach((h, i) => {
  if (!h.ccn) return;
  const a = acc[i];
  if (!a.codes) return;
  a.basket.sort((x, y) => (y.median ?? 0) - (x.median ?? 0));
  writeJSON(path.join(dir, `${h.ccn}.json`), {
    ...h,
    idx: i,
    stats: {
      codes: a.codes,
      priceEntries: a.priceEntries,
      withheldEntries: a.withheldEntries,
      formulaEntries: a.formulaEntries,
      chargeEntries: a.chargeEntries,
      payers: a.payers.size,
      brands: [...a.brands].sort(),
      settings: [...a.settings].map((s) => settings[s]).filter(Boolean).sort(),
      billingClasses: [...a.billingClasses].map((b) => billingClasses[b]).filter(Boolean).sort(),
      sourceFiles: [...a.sources].sort((x, y) => x - y),
      withGross: a.withGross, withCash: a.withCash,
      cashBeatsInsured: a.cashBeatsInsured, cashComparisons: a.cashComparisons,
    },
    basket: a.basket,
  });
  written++;
});

writeJSON(path.join(DATA, 'hospital_index.json'),
  hospitals.map((h, i) => ({
    ccn: h.ccn, name: h.name, city: h.city, lat: h.lat, lon: h.lon,
    status: h.status, codes: acc[i].codes, priceEntries: acc[i].priceEntries,
  })).filter((h) => h.ccn));

log(`${written} hospital pages written`);
