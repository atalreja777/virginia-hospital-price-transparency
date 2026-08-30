/**
 * Validates the generated dataset itself, not just the code that reads it.
 * A price site fails silently when its data is wrong, so the data gets tests too.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve('public/data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

let hospitals, payers, plans, settings, methods, search, meta, zips, groups, stats;
beforeAll(() => {
  hospitals = J('hospitals.json'); payers = J('payers.json'); plans = J('plans.json');
  settings = J('settings.json'); methods = J('methodologies.json');
  search = J('search.json'); meta = J('meta.json'); zips = J('zips.json');
  groups = J('payer_groups.json'); stats = J('stats.json');
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
    for (const { file } of files) {
      const bucket = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [code, entry] of Object.entries(bucket)) {
        codes++;
        if (typeof entry.d !== 'string') problems.push(`${code}: description not a string`);
        if (!entry.h || typeof entry.h !== 'object') { problems.push(`${code}: no hospitals`); continue; }
        for (const [hIdx, v] of Object.entries(entry.h)) {
          const i = +hIdx;
          if (!Number.isInteger(i) || i < 0 || i >= hospitals.length) problems.push(`${code}: hospital index ${hIdx} out of range`);
          if (!Array.isArray(v.r)) { problems.push(`${code}: rates not an array`); continue; }
          if (v.r.length % 5 !== 0) problems.push(`${code}: rate array length ${v.r.length} is not a multiple of 5`);
          for (let k = 0; k < v.r.length; k += 5) {
            rates++;
            const [pa, pl, se, me, price] = v.r.slice(k, k + 5);
            if (!Number.isInteger(pa) || pa < 0 || pa >= payers.length) problems.push(`${code}: payer index ${pa}`);
            if (!Number.isInteger(pl) || pl < 0 || pl >= plans.length) problems.push(`${code}: plan index ${pl}`);
            if (!Number.isInteger(se) || se < 0 || se >= settings.length) problems.push(`${code}: setting index ${se}`);
            if (!Number.isInteger(me) || me < 0 || me >= methods.length) problems.push(`${code}: methodology index ${me}`);
            if (!Number.isInteger(price) || price <= 0) problems.push(`${code}: price ${price} is not a positive integer of cents`);
          }
          for (const f of ['g', 'c', 'mn', 'mx']) {
            const val = v[f];
            if (val != null && (!Number.isInteger(val) || val < 0)) problems.push(`${code}: ${f} = ${val}`);
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(codes).toBeGreaterThan(10000);
    expect(rates).toBeGreaterThan(1_000_000);
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
    expect(search.f).toEqual(['type', 'code', 'desc', 'hospitals', 'rates', 'p10', 'p50', 'p90']);
  });
  it('has sane rows', () => {
    expect(search.r.length).toBeGreaterThan(10000);
    for (const [type, code, desc, nh, nr, p10, p50, p90] of search.r) {
      expect(['CPT', 'HCPCS', 'MS-DRG']).toContain(type);
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(typeof desc).toBe('string');
      expect(nh).toBeGreaterThan(0);
      expect(nr).toBeGreaterThan(0);
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
});

describe('meta', () => {
  it('describes the build honestly', () => {
    expect(meta.state).toBe('VA');
    expect(meta.scope).toMatch(/emergency/i);
    expect(new Date(meta.builtAt).toString()).not.toBe('Invalid Date');
    expect(meta.counts.hospitals).toBe(hospitals.length);
  });
});
