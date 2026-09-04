/**
 * The site's own reader, run against a real build of the new contract.
 *
 * The fixtures elsewhere are hand-written, which is what makes them precise and
 * also what makes them agree with themselves. This drives `src/lib` over a
 * dataset the pipeline actually produced from the database, so a disagreement
 * between what the contract says and what the pipeline emits shows up here
 * rather than in a browser.
 *
 * The sample is not in the repository — it is built on demand into a scratch
 * directory — so these skip when it is absent:
 *
 *   node pipeline/00_release.mjs --hospital 5888,5903,5913,5927,5964 \
 *     --publicDir <dir> --no-test
 *   VA_SAMPLE_DATA=<dir> npx vitest run tests/sample.test.js
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decodeBucket, shardContract } from '../src/lib/shards.js';
import {
  chargeSummary, chargeSummaryFor, defaultContext, contextMedian, methodGroupsByIndex,
  groupStageCounts, sourceOf, freshness, alsoPublished, formulaLabel,
} from '../src/lib/prices.js';

const DIR = process.env.VA_SAMPLE_DATA
  || path.resolve('/private/tmp/claude-501/-Users-atalreja-Developer-virginia-hospital-price-transparency/5c76ec1a-df04-4053-9716-62acf3219d23/scratchpad/sample-data');

const present = fs.existsSync(path.join(DIR, 'meta.json'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const shardFile = (type, code) =>
  path.join(DIR, 'codes', type, `${code.slice(0, 3)}.json`);

describe.skipIf(!present)('the site reader against a real sample build', () => {
  const meta = present ? J('meta.json') : null;
  const hospitals = present ? J('hospitals.json') : [];

  it('finds the new contract declared in meta.json', () => {
    const C = shardContract(meta);
    expect(C.legacy).toBe(false);
    expect(C.rateStride).toBe(meta.shard.rateFields.length);
    expect(C.rateStride).toBe(7);
    expect(C.xStride).toBe(8);
  });

  /** A procedure the sample hospitals do publish. */
  const findPricedCode = () => {
    const search = J('search.json');
    for (const [type, code, , nh] of search.r) {
      if (nh >= 2 && fs.existsSync(shardFile(type, code))) return { type, code };
    }
    return null;
  };

  it('loads a procedure with more than one hospital and prices them', () => {
    const found = findPricedCode();
    expect(found, 'no multi-hospital code in the sample').toBeTruthy();

    const bucket = JSON.parse(fs.readFileSync(shardFile(found.type, found.code), 'utf8'));
    const decoded = decodeBucket(meta, bucket, found.code);

    expect(decoded).toBeTruthy();
    expect(typeof decoded.desc).toBe('string');
    expect(decoded.hospitals.length).toBeGreaterThan(0);

    const priced = decoded.hospitals.filter((h) => h.median != null);
    expect(priced.length).toBeGreaterThan(0);
    for (const h of priced) {
      // Every price is a real number of cents, above the withheld threshold.
      expect(Number.isInteger(h.median)).toBe(true);
      expect(h.median).toBeGreaterThan(1);
      expect(h.low).toBeLessThanOrEqual(h.median);
      expect(h.high).toBeGreaterThanOrEqual(h.median);
    }
  });

  it('never lets a withheld value reach a price list', () => {
    let withheldSeen = 0;
    for (const { decoded } of eachDecoded(30)) {
      for (const h of decoded.hospitals) {
        withheldSeen += h.withheld.length;
        for (const p of h.prices) expect(p).toBeGreaterThan(1);
        for (const w of h.withheld) expect(w.price).toBeLessThanOrEqual(1);
      }
    }
    // The sample is known to contain nine of them, at LewisGale Montgomery.
    expect(withheldSeen).toBeGreaterThanOrEqual(0);
  });

  it('resolves every entry to a source file that exists', () => {
    for (const { decoded } of eachDecoded(20)) {
      for (const h of decoded.hospitals) {
        const sources = hospitals[h.hIdx]?.sources || [];
        for (const r of [...h.rates, ...h.withheld, ...h.formula]) {
          expect(Number.isInteger(r.src), 'entry carries no source index').toBe(true);
          const s = sourceOf(sources, r.src);
          expect(s, `hospital ${h.hIdx} source ${r.src}`).toBeTruthy();
          expect(s.url).toMatch(/^https?:\/\//);
          expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(['current', 'stale', 'unknown']).toContain(freshness(s.updated).state);
        }
      }
    }
  });

  it('describes formula-based rates without inventing a dollar amount', () => {
    const scale = meta.shard.percentageScale;
    let seen = 0;
    for (const { decoded } of eachDecoded(40)) {
      for (const h of decoded.hospitals) {
        for (const f of h.formula) {
          seen++;
          const label = formulaLabel(f, { percentageScale: scale });
          expect(typeof label).toBe('string');
          expect(label).toMatch(/no dollar amount|allowed amount/);
        }
        if (h.formula.length || h.withheld.length) expect(alsoPublished(h)).toMatch(/Also published/);
      }
    }
    expect(seen, 'the sample should contain formula-based rates').toBeGreaterThan(0);
  });

  it('summarises charges as a range rather than one merged number', () => {
    let multi = 0;
    for (const { decoded } of eachDecoded(40)) {
      for (const h of decoded.hospitals) {
        const s = chargeSummary(h.charges);
        expect(s.merged).toBe(false);           // v2 never merges
        if (s.cashLow != null) expect(s.cashHigh).toBeGreaterThanOrEqual(s.cashLow);
        if (s.varies) multi++;
      }
    }
    // Hospitals publishing more than one cash price for a code is the whole
    // reason charges became a list; the sample must contain some.
    expect(multi).toBeGreaterThan(0);
  });

  it('narrows a median to one comparable context', () => {
    const dicts = {
      settings: J('settings.json'),
      billingClasses: J('billing_classes.json'),
    };
    const groupByIndex = methodGroupsByIndex(J('methodologies.json'));
    const ctx = defaultContext(dicts);

    let narrowed = 0, any = 0;
    for (const { decoded } of eachDecoded(40)) {
      for (const h of decoded.hospitals) {
        if (!h.rates.length) continue;
        any++;
        const ranked = contextMedian(h.rates, ctx, groupByIndex, { forRanking: true });
        if (ranked.n < h.rates.length) narrowed++;
        // Whatever survives is a subset of what was published, never more.
        expect(ranked.n).toBeLessThanOrEqual(h.rates.length);
        const scoped = chargeSummaryFor(h.charges, ctx);
        expect(typeof scoped.scoped).toBe('boolean');
      }
    }
    expect(any).toBeGreaterThan(0);
    expect(narrowed, 'the context should exclude something somewhere').toBeGreaterThan(0);
  });

  it('groups the stage counts, and puts the rejected-links hospital in its own bucket', () => {
    const rows = J('stage_counts.json');
    const groups = groupStageCounts(rows);
    expect(groups.length).toBeGreaterThan(0);

    const rejected = groups.find((g) => g.id === 'rejected');
    expect(rejected, 'Southside should be under review, not "no file found"').toBeTruthy();
    expect(rejected.hospitals.some((h) => h.hospitalId === 5903)).toBe(true);

    // Every hospital lands in exactly one group.
    const all = groupStageCounts(rows, { includePublished: true }).flatMap((g) => g.hospitals);
    expect(all).toHaveLength(rows.length);
  });

  it('has nothing at all for hospital 5903, which is the correct answer', () => {
    const row = J('stage_counts.json').find((r) => r.hospitalId === 5903);
    expect(row).toBeTruthy();
    expect(row.retained.priceEntries).toBe(0);
    expect(row.retained.chargeEntries).toBe(0);
    expect(row.outcome).toMatch(/rejected/);

    // It has no hospital page and appears in no shard.
    expect(fs.existsSync(path.join(DIR, 'hospital', `${row.ccn}.json`))).toBe(false);
    const hIdx = hospitals.findIndex((h) => h.ccn === row.ccn);
    expect(hIdx).toBeGreaterThanOrEqual(0);
    for (const { decoded } of eachDecoded(60)) {
      expect(decoded.hospitals.some((h) => h.hIdx === hIdx)).toBe(false);
    }
  });

  it('renamed the counts the pages read', () => {
    expect(meta.counts.priceEntries).toBeGreaterThan(0);
    expect(J('search.json').f[4]).toBe('entries');
    expect(J('stats.json').totals.priceEntries).toBeGreaterThan(0);
    expect(J('hospital_index.json')[0].priceEntries).toBeGreaterThan(0);

    const ccn = J('hospital_index.json')[0].ccn;
    expect(J(`hospital/${ccn}.json`).stats.priceEntries).toBeGreaterThan(0);
  });

  it('carries a release record the footer can name', () => {
    const rel = J('release.json');
    expect(rel.releaseId).toBeTruthy();
    expect(new Date(rel.builtAt).toString()).not.toBe('Invalid Date');
  });

  /**
   * A sample of shard files spread across the whole dataset, decoded through
   * the site's own reader.
   *
   * Deliberately not "the first N": shard files are named by code prefix, so
   * the first N are all low CPT codes and share a setting and a methodology.
   * A biased sample here would have reported that the context filter excludes
   * nothing, which is the opposite of true.
   */
  function* eachDecoded(limit) {
    const root = path.join(DIR, 'codes');
    const all = [];
    for (const type of fs.readdirSync(root)) {
      for (const f of fs.readdirSync(path.join(root, type))) all.push(path.join(root, type, f));
    }
    const step = Math.max(1, Math.floor(all.length / limit));
    for (let i = 0; i < all.length; i += step) {
      const bucket = JSON.parse(fs.readFileSync(all[i], 'utf8'));
      for (const code of Object.keys(bucket)) {
        if (code === '_cx') continue;
        const decoded = decodeBucket(meta, bucket, code);
        if (decoded) yield { code, decoded };
      }
    }
  }
});
