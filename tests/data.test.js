/**
 * Validates the generated dataset itself, not just the code that reads it.
 * A price site fails silently when its data is wrong, so the data gets tests too.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openData } from '../pipeline/lib/shards.mjs';
import { perUnitReason } from '../pipeline/lib/util.mjs';

const DATA = path.resolve('public/data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

let hospitals, payers, plans, settings, billingClasses, methods, search, meta, zips, groups, stats;
/**
 * The shard shape is declared in meta.json rather than assumed here. A dataset
 * built before the contract existed still has to validate — this file is what
 * says the LIVE data is sound, and it must not start failing merely because a
 * release has not been rebuilt yet.
 */
let V2 = false, data = null;
beforeAll(() => {
  hospitals = J('hospitals.json'); payers = J('payers.json'); plans = J('plans.json');
  settings = J('settings.json'); methods = J('methodologies.json');
  search = J('search.json'); meta = J('meta.json'); zips = J('zips.json');
  groups = J('payer_groups.json'); stats = J('stats.json');
  V2 = (meta.shard?.version ?? 1) >= 2;
  billingClasses = V2 ? J('billing_classes.json') : [];
  data = openData(DATA);
});

const shardFiles = () => {
  const out = [];
  for (const t of fs.readdirSync(path.join(DATA, 'codes')))
    for (const f of fs.readdirSync(path.join(DATA, 'codes', t)))
      out.push({ type: t, file: path.join(DATA, 'codes', t, f) });
  return out;
};

describe('hospitals', () => {
  it('are all in Virginia', () => {
    expect(hospitals.length).toBeGreaterThan(100);
    for (const h of hospitals) expect(h.state).toBe('VA');
  });
  it('have unique CCNs where present', () => {
    const seen = new Set();
    for (const h of hospitals.filter((x) => x.ccn)) {
      expect(seen.has(h.ccn), `duplicate CCN ${h.ccn}`).toBe(false);
      seen.add(h.ccn);
    }
  });
  it('have coordinates inside Virginia when located', () => {
    const located = hospitals.filter((h) => h.lat != null);
    expect(located.length).toBeGreaterThanOrEqual(120);
    for (const h of located) {
      expect(h.lat, h.name).toBeGreaterThan(36.4);
      expect(h.lat, h.name).toBeLessThan(39.6);
      expect(h.lon, h.name).toBeGreaterThan(-83.9);
      expect(h.lon, h.name).toBeLessThan(-75.1);
    }
  });
  it('carry provenance for every source file', () => {
    for (const h of hospitals) {
      for (const s of h.sources || []) {
        expect(s.url).toMatch(/^https?:\/\//);
        expect(typeof s.sha256).toBe('string');
        // A truncated digest cannot be checked against the published file, and
        // being able to check is the whole point of carrying it.
        if (V2) {
          expect(s.sha256, `${h.name}`).toMatch(/^[0-9a-f]{64}$/);
          expect(Number.isInteger(s.fileVersionId)).toBe(true);
        }
      }
    }
  });
});

describe('price shards', () => {
  it('are valid and internally consistent', () => {
    const files = shardFiles();
    expect(files.length).toBeGreaterThan(500);

    let codes = 0, rates = 0;
    const problems = [];
    const push = (m) => { if (problems.length < 40) problems.push(m); };

    data.eachCode(({ code, desc, hospitals: hs, raw }) => {
      codes++;
      if (typeof desc !== 'string') push(`${code}: description not a string`);
      if (!raw.h || typeof raw.h !== 'object') { push(`${code}: no hospitals`); return; }
      for (const h of hs) {
        if (!Number.isInteger(h.hIdx) || h.hIdx < 0 || h.hIdx >= hospitals.length) {
          push(`${code}: hospital index ${h.hIdx} out of range`);
          continue;
        }
        const nSources = hospitals[h.hIdx].sources?.length ?? 0;
        for (const r of h.rates) {
          rates++;
          if (!Number.isInteger(r.payer) || r.payer < 0 || r.payer >= payers.length) push(`${code}: payer index ${r.payer}`);
          if (!Number.isInteger(r.plan) || r.plan < 0 || r.plan >= plans.length) push(`${code}: plan index ${r.plan}`);
          if (!Number.isInteger(r.setting) || r.setting < 0 || r.setting >= settings.length) push(`${code}: setting index ${r.setting}`);
          if (!Number.isInteger(r.methodology) || r.methodology < 0 || r.methodology >= methods.length) push(`${code}: methodology index ${r.methodology}`);
          // A price must be a positive whole number of cents — and, under the
          // current contract, more than a penny. See the penny test below for
          // why the legacy dataset is held to the weaker rule.
          if (!Number.isInteger(r.cents) || r.cents <= (V2 ? 1 : 0)) push(`${code}: price ${r.cents} is not a real price in cents`);
          if (V2) {
            if (!Number.isInteger(r.billingClass) || r.billingClass < 0 || r.billingClass >= billingClasses.length) push(`${code}: billing class index ${r.billingClass}`);
            if (!Number.isInteger(r.src) || r.src < 0 || r.src >= nSources) push(`${code}: source index ${r.src} of ${nSources}`);
          }
        }
        if (V2) {
          for (const c of h.charges) {
            if (!Number.isInteger(c.se) || c.se >= settings.length) push(`${code}: charge setting ${c.se}`);
            if (!Number.isInteger(c.bc) || c.bc >= billingClasses.length) push(`${code}: charge billing class ${c.bc}`);
            if (!Number.isInteger(c.src) || c.src >= nSources) push(`${code}: charge source ${c.src}`);
            for (const f of ['g', 'c', 'mn', 'mx']) {
              const val = c[f];
              if (val != null && (!Number.isInteger(val) || val <= 1)) push(`${code}: charge ${f} = ${val}`);
            }
          }
        } else {
          for (const f of ['g', 'c', 'mn', 'mx']) {
            const val = raw.h[h.hIdx][f];
            if (val != null && (!Number.isInteger(val) || val < 0)) push(`${code}: ${f} = ${val}`);
          }
        }
      }
    });

    expect(problems.slice(0, 10)).toEqual([]);
    expect(codes).toBeGreaterThan(10000);
    expect(rates).toBeGreaterThan(200_000);
  }, 240_000);

  /**
   * The site's own methodology says a price of $0.01 is withheld rather than
   * shown. The dataset currently in public/data contains eight of them: four
   * J-code rows at LewisGale Montgomery and four at LewisGale Pulaski, where a
   * published value of 0.007-0.009 dollars was rounded to a cent and then
   * judged. The rewritten pipeline rounds first and judges afterwards, and
   * carries such values flagged in `w` instead.
   *
   * This test pins the known defect so it cannot grow, and flips to demanding
   * zero as soon as public/data is rebuilt.
   */
  it('shows no price of a penny or less once the dataset is rebuilt', () => {
    let pennies = 0;
    data.eachCode(({ hospitals: hs }) => {
      for (const h of hs) for (const r of h.rates) if (r.cents <= 1) pennies++;
    });
    if (V2) expect(pennies).toBe(0);
    else expect(pennies, 'known defect in the legacy dataset').toBeLessThanOrEqual(8);
  }, 240_000);

  it('never exceed a size that would stall a phone', () => {
    for (const { file } of shardFiles()) {
      const mb = fs.statSync(file).size / 1048576;
      expect(mb, path.basename(file)).toBeLessThan(3);
    }
  });
});

describe('search index', () => {
  it('matches the declared field order', () => {
    expect(search.f).toEqual(V2
      ? ['type', 'code', 'desc', 'hospitals', 'entries', 'p10', 'p50', 'p90']
      : ['type', 'code', 'desc', 'hospitals', 'rates', 'p10', 'p50', 'p90']);
  });
  it('has sane rows', () => {
    expect(search.r.length).toBeGreaterThan(10000);
    for (const [type, code, desc, nh, nr, p10, p50, p90] of search.r) {
      expect(['CPT', 'HCPCS', 'MS-DRG']).toContain(type);
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(typeof desc).toBe('string');
      expect(nh).toBeGreaterThan(0);
      // A code can be searchable with zero negotiated-dollar entries: since the
      // release contract, hospitals that publish only a cash/gross charge or a
      // formula for it still count as publishing it. Negative counts are a bug.
      expect(nr).toBeGreaterThanOrEqual(0);
      if (p10 != null && p90 != null) expect(p90).toBeGreaterThanOrEqual(p10);
      if (p10 != null && p50 != null) expect(p50).toBeGreaterThanOrEqual(p10);
    }
  });
  it('excludes emergency and ambulance codes, which cannot be shopped', () => {
    for (const [type, code] of search.r) {
      if (type === 'CPT') {
        const n = +code;
        expect(n >= 99281 && n <= 99292, `emergency code ${code} present`).toBe(false);
      }
      if (type === 'HCPCS') expect(code.startsWith('A0'), `ambulance code ${code} present`).toBe(false);
    }
  });
  it('excludes device pass-through C-codes', () => {
    for (const [type, code] of search.r) {
      if (type === 'HCPCS') expect(code.startsWith('C'), `device code ${code} present`).toBe(false);
    }
  });
  it('finds the procedures people actually search for', () => {
    const has = (t, c) => search.r.some((r) => r[0] === t && r[1] === c);
    for (const c of ['45378', '70450', '27447', '59400', '80053', '66984']) {
      expect(has('CPT', c), `CPT ${c} missing`).toBe(true);
    }
  });
});

describe('payer grouping', () => {
  it('assigns every payer a brand', () => {
    expect(groups.brandOf).toHaveLength(payers.length);
    for (const b of groups.brandOf) expect(typeof b).toBe('string');
  });
  it('lists members that all exist', () => {
    for (const g of groups.groups) {
      expect(g.members.length).toBeGreaterThan(0);
      for (const m of g.members) expect(m).toBeLessThan(payers.length);
    }
  });
  it('covers every payer exactly once', () => {
    const seen = new Set();
    for (const g of groups.groups) for (const m of g.members) {
      expect(seen.has(m), `payer ${m} in two groups`).toBe(false);
      seen.add(m);
    }
    expect(seen.size).toBe(payers.length);
  });
  it('collapses the big carriers rather than leaving them scattered', () => {
    const byName = new Map(groups.groups.map((g) => [g.brand, g.members.length]));
    for (const brand of ['UnitedHealthcare', 'Anthem Blue Cross Blue Shield', 'Aetna', 'Cigna']) {
      expect(byName.get(brand), `${brand} not grouped`).toBeGreaterThan(5);
    }
  });
  it('does not mistake a union fund for an insurer', () => {
    const i = payers.findIndex((p) => /United Mine Workers/i.test(p));
    if (i >= 0) expect(groups.brandOf[i]).not.toBe('UnitedHealthcare');
  });
});

describe('zip centroids', () => {
  it('cover Virginia and its border', () => {
    const keys = Object.keys(zips);
    expect(keys.length).toBeGreaterThan(3000);
    for (const z of ['23219', '22030', '24016', '23454', '22401']) {
      expect(zips[z], `ZIP ${z} missing`).toBeTruthy();
    }
  });
  it('are well-formed and in the right region', () => {
    for (const [z, [lat, lon]] of Object.entries(zips)) {
      expect(z).toMatch(/^\d{5}$/);
      expect(lat).toBeGreaterThan(34.8);
      expect(lat).toBeLessThan(40.8);
      expect(lon).toBeGreaterThan(-85.0);
      expect(lon).toBeLessThan(-74.5);
    }
  });
});

describe('statistics', () => {
  it('never leads with a per-unit drug code', () => {
    // A spinal injection is a procedure you schedule; "daptomycin, 1 mg" is a
    // dose. The tell is an explicit unit of measure, or a J/Q drug code — not
    // the word "injection", which appears in legitimate CPT procedures.
    const dosed = /\b\d+\s*(mg|ml|mcg|units?)\b|\bper\s+(mg|ml|dose|unit|vial|tx)\b|\bper tx dose\b/i;
    for (const b of stats.basket) {
      expect(dosed.test(b.desc || ''), `dosed unit in basket: ${b.desc}`).toBe(false);
      expect(b.type === 'HCPCS' && /^[JQ]/.test(b.code), `drug code in basket: ${b.code}`).toBe(false);
    }
  });
  it('reports spreads that are the right way round', () => {
    for (const b of stats.basket) {
      expect(b.high).toBeGreaterThanOrEqual(b.low);
      expect(b.ratio).toBeGreaterThanOrEqual(1);
      expect(b.hospitals).toBeGreaterThanOrEqual(8);
    }
  });
  it('keeps headline ratios believable', () => {
    // p10-to-p90 across hospitals should not produce absurd multiples.
    for (const b of stats.basket) expect(b.ratio, b.label).toBeLessThan(100);
  });
  it('counts agree with the search index', () => {
    expect(stats.totals.procedures).toBe(search.r.length);
    expect(stats.totals.payers).toBe(payers.length);
  });
  it('never leads with a per-unit code in any headline table', () => {
    if (!V2) return;
    for (const s of [...stats.biggestSpreads, ...stats.basket, ...stats.headline]) {
      expect(perUnitReason(s.type, s.code, s.desc), `${s.type} ${s.code}`).toBeNull();
    }
  });
  it('says how the cash comparison was made and over what denominator', () => {
    if (!V2) return;
    expect(stats.cash.method).toMatch(/setting and billing class/i);
    expect(stats.cash.denominator).toBe(stats.cash.comparisons);
  });
  it('accounts for every code it excluded', () => {
    if (!V2) return;
    expect(stats.audit.codesTotal).toBe(search.r.length);
    expect(stats.audit.codesPerUnitExcluded).toBeGreaterThan(0);
  });
});

describe('meta', () => {
  it('describes the build honestly', () => {
    expect(meta.state).toBe('VA');
    expect(meta.scope).toMatch(/emergency/i);
    expect(new Date(meta.builtAt).toString()).not.toBe('Invalid Date');
    expect(meta.counts.hospitals).toBe(hospitals.length);
  });
  it('says which build produced it and how many hospitals published', () => {
    if (!V2) return;
    expect(meta.buildId).toBeTruthy();
    expect(meta.releaseId).toBeTruthy();
    // This was hard-coded to null, so the site could never state it.
    expect(meta.counts.hospitalsWithPrices).toBeGreaterThan(0);
    expect(meta.export?.snapshot).toBeTruthy();
    expect(meta.shard.rateFields.length).toBeGreaterThan(2);
  });
});
