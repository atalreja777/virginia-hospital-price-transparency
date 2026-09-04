/**
 * The pipeline's own tests: run the real stages over a small synthetic export
 * and assert on what comes out.
 *
 * Every case here is a defect that reached the live site. A green run means the
 * grain of the data survived packing, a sub-cent value was withheld rather than
 * shown as a penny, per-unit drug codes stayed out of the headline statistics,
 * a rejected hospital/file link published nothing, and a real code buried in a
 * hospital's local column was rescued without inventing one that wasn't there.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openData, chargeSummary } from '../pipeline/lib/shards.mjs';
import { perUnitReason, isProcedureLike, admitCode, effectiveType, toCents } from '../pipeline/lib/util.mjs';
import { classifySegment, SEGMENTS } from '../pipeline/lib/payers.mjs';

const REPO = path.resolve('.');
const RAW = path.join(REPO, 'tests', 'fixtures', 'pipeline');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'hpt-pipeline-'));
const DATA = path.join(OUT, 'data');

const node = (script, extra = []) =>
  execFileSync('node', [path.join(REPO, 'pipeline', script), '--data', DATA, ...extra],
    { encoding: 'utf8', maxBuffer: 1 << 26 });

let data, meta, settings, billingClasses, payers;

beforeAll(() => {
  node('02_pack.mjs', ['--raw', RAW, '--releaseId', 'test-fixture']);
  fs.copyFileSync(path.join(RAW, 'zips.json'), path.join(DATA, 'zips.json'));
  node('05_stats.mjs');
  node('06_payers.mjs');
  node('07_hospital_pages.mjs');
  node('08_demo.mjs');
  data = openData(DATA);
  meta = data.meta;
  settings = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
  billingClasses = JSON.parse(fs.readFileSync(path.join(DATA, 'billing_classes.json'), 'utf8'));
  payers = JSON.parse(fs.readFileSync(path.join(DATA, 'payers.json'), 'utf8'));
}, 120_000);

const hospitalNamed = (loaded, name) => {
  const hospitals = JSON.parse(fs.readFileSync(path.join(DATA, 'hospitals.json'), 'utf8'));
  const idx = hospitals.findIndex((h) => h.name === name);
  return loaded.hospitals.find((h) => h.hIdx === idx);
};

describe('shard contract', () => {
  it('declares its own encoding rather than making readers assume one', () => {
    expect(meta.shard.version).toBeGreaterThanOrEqual(2);
    expect(meta.shard.rateFields).toContain('cents');
    expect(meta.shard.rateFields).toContain('src');
    expect(meta.shard.chargeFields).toContain('bc');
    expect(meta.counts.hospitalsWithPrices).toBeGreaterThan(0);
    expect(meta.buildId).toBeTruthy();
    expect(meta.releaseId).toBe('test-fixture');
  });
});

describe('grain preservation', () => {
  it('keeps two cash prices for the same code, setting and billing class', () => {
    const cmp = data.loadCode('CPT', '80053');
    const h = hospitalNamed(cmp, 'Test Hospital 1');
    const cash = h.charges.map((c) => c.c).sort((a, b) => a - b);
    expect(cash).toEqual([4500, 6000]);
  });

  it('does not merge settings: outpatient and inpatient stay separate charges', () => {
    const ct = data.loadCode('CPT', '70450');
    const h = hospitalNamed(ct, 'Test Hospital 1');
    const cashBySetting = {};
    for (const c of h.charges) (cashBySetting[settings[c.se]] ??= []).push(c.c);
    expect(cashBySetting.outpatient.sort((a, b) => a - b)).toEqual([15000, 150000]);
    expect(cashBySetting.inpatient).toEqual([90000]);
    // The old packer took max() across settings and reported that one number
    // as the hospital's cash price for the code, whichever setting you asked about.
    const summary = chargeSummary(h.charges);
    expect(summary.combinations).toBe(3);
    expect(summary.cashLow).toBe(15000);
    expect(summary.cashHigh).toBe(150000);
  });

  it('keeps every distinct negotiated dollar, not just the lowest and highest', () => {
    const colo = data.loadCode('CPT', '45378');
    const h = hospitalNamed(colo, 'Test Hospital 1');
    const selfPay = payers.findIndex((p) => p === 'SELF PAY');
    const prices = h.rates.filter((r) => r.payer === selfPay).map((r) => r.cents).sort((a, b) => a - b);
    expect(prices).toEqual([111100, 122200, 133300]);
  });

  it('carries a billing class and a methodology on every entry', () => {
    const colo = data.loadCode('CPT', '45378');
    for (const h of colo.hospitals) {
      for (const r of h.rates) {
        expect(billingClasses[r.billingClass]).toBeTypeOf('string');
        expect(r.methodology).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('points every entry at the source file it came from', () => {
    const hospitals = JSON.parse(fs.readFileSync(path.join(DATA, 'hospitals.json'), 'utf8'));
    const colo = data.loadCode('CPT', '45378');
    for (const h of colo.hospitals) {
      const sources = hospitals[h.hIdx].sources;
      expect(sources.length).toBeGreaterThan(0);
      for (const r of h.rates) expect(sources[r.src]).toBeTruthy();
      // and provenance carries the whole digest, not a 16-character prefix
      for (const s of sources) expect(s.sha256).toHaveLength(64);
    }
  });

  it('includes a code that has only a cash price and no negotiated rate', () => {
    // Built from rates alone, this code vanished from the site entirely.
    const cmp = data.loadCode('CPT', '80053');
    expect(cmp).toBeTruthy();
    const h = hospitalNamed(cmp, 'Test Hospital 1');
    expect(h.rates).toHaveLength(0);
    expect(h.charges.length).toBeGreaterThan(0);
  });
});

describe('penny policy', () => {
  it('withholds a sub-cent value instead of showing it as $0.01', () => {
    const colo = data.loadCode('CPT', '45378');
    const h = hospitalNamed(colo, 'Test Hospital 2');
    expect(h.rates.every((r) => r.cents > 1)).toBe(true);
    expect(h.withheld.length).toBe(1);
    expect(h.withheld[0].cents).toBeLessThanOrEqual(1);
  });

  it('rounds before judging, not after', () => {
    expect(toCents('0.008')).toEqual({ cents: 1, sub: true });
    expect(toCents('0.02')).toEqual({ cents: 2, sub: false });
    expect(toCents('0')).toEqual({ cents: 0, sub: true });
  });

  it('counts what it withheld', () => {
    expect(meta.counts.withheldEntries).toBeGreaterThan(0);
    expect(meta.audit.dollarRowsWithheldSubCent).toBeGreaterThan(0);
  });

  it('never lets a withheld value into a price list', () => {
    data.eachCode(({ hospitals }) => {
      for (const h of hospitals) for (const p of h.prices) expect(p).toBeGreaterThan(1);
    });
  });
});

describe('formula-based rates', () => {
  it('keeps a percentage-of-charges rate rather than dropping it', () => {
    const colo = data.loadCode('CPT', '45378');
    const h = hospitalNamed(colo, 'Test Hospital 2');
    const pctEntry = h.formula.find((f) => f.kind === 'percentage');
    expect(pctEntry).toBeTruthy();
    expect(pctEntry.value / meta.shard.percentageScale).toBeCloseTo(42.5);
  });
});

describe('codes hidden in a local column', () => {
  it('rescues a code corroborated by a hospital that typed it properly', () => {
    const knee = data.loadCode('CPT', '29881');
    expect(knee).toBeTruthy();
    expect(hospitalNamed(knee, 'Test Hospital 9')).toBeTruthy();
  });

  it('refuses a local code nobody else published as a real code', () => {
    expect(data.loadCode('CPT', '88888')).toBeNull();
    expect(meta.audit.localCodesUncorroborated).toBeGreaterThan(0);
  });

  it('never treats a short revenue code as a national code', () => {
    expect(effectiveType('HCPCS', '270')).toBe('HCPCS');       // typed HCPCS, but...
    expect(admitCode('HCPCS', '270', 'MEDICAL SUPPLIES', false).ok).toBe(false);
    expect(effectiveType('CDM', '270')).toBeNull();
    expect(effectiveType('CDM', '45378')).toBe('CPT');
    expect(effectiveType('CDM', 'J1234')).toBe('HCPCS');
  });
});

describe('rejected hospital/file links', () => {
  it('publishes nothing at all for a rejected link', () => {
    const hospitals = JSON.parse(fs.readFileSync(path.join(DATA, 'hospitals.json'), 'utf8'));
    const ghost = hospitals.findIndex((h) => h.name === 'Test Hospital 10');
    expect(hospitals[ghost].sources).toHaveLength(0);
    let seen = false;
    data.eachCode(({ hospitals: hs }) => { if (hs.some((h) => h.hIdx === ghost)) seen = true; });
    expect(seen).toBe(false);
  });

  it('says why, rather than filing it with hospitals that published nothing', () => {
    const stage = JSON.parse(fs.readFileSync(path.join(DATA, 'stage_counts.json'), 'utf8'));
    const row = stage.find((r) => r.name === 'Test Hospital 10');
    expect(row.outcome).toMatch(/rejected/);
  });
});

describe('statistics filter', () => {
  let stats;
  beforeAll(() => { stats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8')); });

  it('excludes per-unit drug codes before computing anything, not after', () => {
    // J1234 has a 1000x spread across the fixture's hospitals; it is exactly
    // the kind of row that became the site's headline number.
    for (const s of [...stats.biggestSpreads, ...stats.basket]) {
      expect(perUnitReason(s.type, s.code, s.desc), `${s.type} ${s.code}`).toBeNull();
    }
    expect(stats.biggestSpreads.some((s) => s.code === 'J1234')).toBe(false);
  });

  it('recognises the per-unit cases the old rule missed', () => {
    expect(perUnitReason('HCPCS', 'J1414', 'Injection, drug')).toBe('hcpcs_j_code');
    expect(perUnitReason('HCPCS', 'Q2043', 'Sipuleucel-t')).toBe('hcpcs_q_code');
    expect(perUnitReason('HCPCS', 'A4216', 'Sterile water, 10 ml')).toBe('hcpcs_a_code');
    expect(isProcedureLike('CPT', '45378', 'Colonoscopy, flexible, diagnostic')).toBe(true);
    expect(isProcedureLike('CPT', '64483', 'Injection, anesthetic agent')).toBe(false);
  });

  it('reports the denominator and the method of the cash comparison', () => {
    expect(stats.cash.method).toMatch(/setting and billing class/i);
    expect(stats.cash.denominator).toBe(stats.cash.comparisons);
    expect(stats.cash.comparisons).toBeGreaterThan(0);
    expect(stats.cash.share).toBeGreaterThanOrEqual(0);
    expect(stats.cash.share).toBeLessThanOrEqual(1);
  });

  it('audits what it excluded and why', () => {
    expect(stats.audit.codesPerUnitExcluded).toBeGreaterThan(0);
    expect(Object.keys(stats.audit.perUnitReasons).length).toBeGreaterThan(0);
    expect(stats.audit.codesTotal).toBeGreaterThan(stats.audit.codesComparable);
  });

  it('keeps the 10th-to-90th percentile rule', () => {
    expect(stats.spread.method).toMatch(/10th to the 90th percentile/);
    for (const s of stats.biggestSpreads) {
      expect(s.high).toBeGreaterThanOrEqual(s.low);
      expect(s.absoluteHigh).toBeGreaterThanOrEqual(s.high);
      expect(s.absoluteLow).toBeLessThanOrEqual(s.low);
    }
  });
});

describe('methodology labels', () => {
  it('folds case variants into one methodology', () => {
    const methods = JSON.parse(fs.readFileSync(path.join(DATA, 'methodologies.json'), 'utf8'));
    const seen = methods.map((m) => m.toLowerCase());
    expect(new Set(seen).size).toBe(seen.length);
    expect(methods).toContain('case rate');
    expect(methods).not.toContain('Case Rate');
  });
});

describe('payer segments', () => {
  it('separates Medicare Advantage from the commercial brand that sells it', () => {
    expect(classifySegment('UNITED HEALTHCARE MEDICARE ADVANTAGE', 'HMO').segment).toBe('medicare_advantage');
    expect(classifySegment('AETNA', 'PPO').segment).toBe('commercial');
    expect(classifySegment('MEDICARE', '').segment).toBe('medicare');
  });

  it('treats a managed Medicaid product as Medicaid, not as its carrier', () => {
    expect(classifySegment('ANTHEM COMMUNITY PLAN MEDICAID', '').segment).toBe('medicaid');
    expect(classifySegment('Cardinal Care', '').segment).toBe('medicaid');
  });

  it('keeps things that are not insurance out of the insurance segments', () => {
    expect(classifySegment('SELF PAY', '').segment).toBe('other');
    expect(classifySegment('WORKERS COMP', '').segment).toBe('other');
    expect(classifySegment('TRICARE', '').segment).toBe('other');
  });

  it('says how confident it is, and defaults conservatively', () => {
    const unknown = classifySegment('ACME HEALTH ALLIANCE', '');
    expect(unknown.segment).toBe('commercial');
    expect(unknown.confidence).toBe('low');
    expect(SEGMENTS).toContain(unknown.segment);
  });

  it('annotates every payer in the release', () => {
    const seg = JSON.parse(fs.readFileSync(path.join(DATA, 'payer_segments.json'), 'utf8'));
    expect(seg.payers).toHaveLength(payers.length);
    for (const p of seg.payers) expect(SEGMENTS).toContain(p.segment);
  });
});

describe('the validator', () => {
  const validate = (dir) => {
    try {
      execFileSync('node', [path.join(REPO, 'pipeline', '09_validate.mjs'), '--data', dir, '--raw', RAW],
        { encoding: 'utf8', maxBuffer: 1 << 26 });
      return { ok: true };
    } catch (e) {
      return { ok: false, output: (e.stdout || '') + (e.stderr || '') };
    }
  };

  it('passes a clean build', () => {
    const r = validate(DATA);
    expect(r.ok, r.output).toBe(true);
    const report = JSON.parse(fs.readFileSync(path.join(DATA, 'validation.json'), 'utf8'));
    expect(report.passed).toBe(true);
    expect(report.checks.length).toBeGreaterThan(15);
  }, 60_000);

  it('fails a build whose counts do not match its files', () => {
    const dir = path.join(OUT, 'tampered-counts');
    fs.cpSync(DATA, dir, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    m.counts.priceEntries += 1;
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m));
    const r = validate(dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/priceEntries/);
  }, 60_000);

  it('fails a build with a hospital index that points nowhere', () => {
    const dir = path.join(OUT, 'tampered-index');
    fs.cpSync(DATA, dir, { recursive: true });
    const f = path.join(dir, 'codes', 'CPT', '453.json');
    const bucket = JSON.parse(fs.readFileSync(f, 'utf8'));
    const entry = bucket['45378'];
    entry.h['9999'] = entry.h[Object.keys(entry.h)[0]];
    fs.writeFileSync(f, JSON.stringify(bucket));
    const r = validate(dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/hospital index/);
  }, 60_000);

  it('fails a build that shows a price of a penny', () => {
    const dir = path.join(OUT, 'tampered-penny');
    fs.cpSync(DATA, dir, { recursive: true });
    const f = path.join(dir, 'codes', 'CPT', '453.json');
    const bucket = JSON.parse(fs.readFileSync(f, 'utf8'));
    const entry = bucket['45378'];
    const first = entry.h[Object.keys(entry.h)[0]];
    first.r[meta.shard.rateFields.indexOf('cents')] = 1;
    fs.writeFileSync(f, JSON.stringify(bucket));
    const r = validate(dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/penny/);
  }, 60_000);

  it('fails a build whose statistics do not survive a recompute', () => {
    const dir = path.join(OUT, 'tampered-stats');
    fs.cpSync(DATA, dir, { recursive: true });
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
    s.spread.over2x += 7;
    fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(s));
    const r = validate(dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/over2x/);
  }, 60_000);
});
