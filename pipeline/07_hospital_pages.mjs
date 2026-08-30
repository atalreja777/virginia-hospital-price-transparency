#!/usr/bin/env node
/**
 * Per-hospital summaries.
 *
 * The price shards are keyed by procedure, which is right for the main search
 * but useless for "show me this hospital". This walks every shard once and
 * writes one small file per hospital, so a hospital page is a single fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const hospitals = J('hospitals.json');
const stats = J('stats.json');
const groups = J('payer_groups.json');
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

const basketKeys = new Set(stats.basket.map((b) => `${b.type}|${b.code}`));
const basketLabel = new Map(stats.basket.map((b) => [`${b.type}|${b.code}`, b.label]));
const basketMedian = new Map(stats.basket.map((b) => [`${b.type}|${b.code}`, b.median]));

const acc = hospitals.map(() => ({
  codes: 0, rates: 0, payers: new Set(), brands: new Set(),
  withGross: 0, withCash: 0, cashBeatsInsured: 0, cashComparisons: 0,
  basket: [],
}));

for (const typeDir of fs.readdirSync(path.join(DATA, 'codes'))) {
  for (const f of fs.readdirSync(path.join(DATA, 'codes', typeDir))) {
    const bucket = JSON.parse(fs.readFileSync(path.join(DATA, 'codes', typeDir, f), 'utf8'));
    for (const [code, entry] of Object.entries(bucket)) {
      const key = `${typeDir === 'MS-DRG' ? 'MS-DRG' : typeDir}|${code}`;
      for (const [hIdx, v] of Object.entries(entry.h)) {
        const a = acc[+hIdx];
        if (!a) continue;
        a.codes++;
        const prices = [];
        for (let i = 0; i < v.r.length; i += 5) {
          a.rates++;
          a.payers.add(v.r[i]);
          const b = groups.brandOf[v.r[i]];
          if (b) a.brands.add(b);
          prices.push(v.r[i + 4]);
        }
        if (v.g != null) a.withGross++;
        if (v.c != null) {
          a.withCash++;
          const m = median(prices);
          if (m != null) { a.cashComparisons++; if (v.c < m) a.cashBeatsInsured++; }
        }
        if (basketKeys.has(key)) {
          a.basket.push({
            type: key.split('|')[0], code,
            label: basketLabel.get(key), desc: entry.d,
            median: median(prices), low: Math.min(...prices), high: Math.max(...prices),
            gross: v.g, cash: v.c,
            stateMedian: basketMedian.get(key),
          });
        }
      }
    }
  }
}

const dir = path.join(DATA, 'hospital');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

let written = 0;
hospitals.forEach((h, i) => {
  if (!h.ccn) return;
  const a = acc[i];
  if (!a.codes) return;
  a.basket.sort((x, y) => (y.median ?? 0) - (x.median ?? 0));
  fs.writeFileSync(path.join(dir, `${h.ccn}.json`), JSON.stringify({
    ...h,
    idx: i,
    stats: {
      codes: a.codes, rates: a.rates,
      payers: a.payers.size, brands: [...a.brands].sort(),
      withGross: a.withGross, withCash: a.withCash,
      cashBeatsInsured: a.cashBeatsInsured, cashComparisons: a.cashComparisons,
    },
    basket: a.basket,
  }));
  written++;
});

// A light directory for the hospital index, cheap enough to load anywhere.
fs.writeFileSync(path.join(DATA, 'hospital_index.json'), JSON.stringify(
  hospitals.map((h, i) => ({
    ccn: h.ccn, name: h.name, city: h.city, lat: h.lat, lon: h.lon,
    status: h.status, codes: acc[i].codes, rates: acc[i].rates,
  })).filter((h) => h.ccn)
));

console.log(`${written} hospital pages written`);
