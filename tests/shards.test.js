/**
 * The site deploys independently of the data, so both shard shapes have to
 * decode correctly from the same build: the legacy 5-int groups currently in
 * public/data, and the v2 contract the rewritten pipeline emits.
 *
 * The failure this guards against is silent. A reader that assumes stride 5
 * against stride-7 data does not crash — it reads a plan index as a price and
 * renders a plausible, entirely wrong number.
 */
import { describe, it, expect } from 'vitest';
import { shardContract, decodeBucket, decodeHospital } from '../src/lib/shards.js';
import {
  META_V2, BUCKET_V2, META_LEGACY, BUCKET_LEGACY,
  META_COMPACT, BUCKET_COMPACT,
} from './fixtures/shards.js';

describe('shardContract', () => {
  it('takes the stride from meta.shard rather than a literal', () => {
    const C = shardContract(META_V2);
    expect(C.rateStride).toBe(7);
    expect(C.xStride).toBe(8);
    expect(C.legacy).toBe(false);
    expect(C.version).toBe(2);
  });

  it('falls back to the legacy 5-int shape when meta declares none', () => {
    const C = shardContract(META_LEGACY);
    expect(C.rateStride).toBe(5);
    expect(C.xStride).toBe(0);
    expect(C.legacy).toBe(true);
  });

  it('treats a missing meta entirely as legacy rather than throwing', () => {
    expect(shardContract(null).rateStride).toBe(5);
    expect(shardContract(undefined).legacy).toBe(true);
  });
});

describe('decoding the v2 shape', () => {
  const decoded = decodeBucket(META_V2, BUCKET_V2, '45378');
  const h0 = decoded.hospitals.find((h) => h.hIdx === 0);

  it('reads the description and every hospital', () => {
    expect(decoded.desc).toBe('Colonoscopy, flexible, diagnostic');
    expect(decoded.hospitals.map((h) => h.hIdx).sort()).toEqual([0, 1, 2]);
  });

  it('reads five rates with their billing class and source', () => {
    expect(h0.rates).toHaveLength(5);
    const top = h0.rates.find((r) => r.price === 900000);
    expect(top).toMatchObject({ payer: 0, plan: 0, setting: 2, billingClass: 0, method: 1, src: 0 });
  });

  it('sorts rates by price and reports low, median and high', () => {
    expect(h0.prices).toEqual([15000, 40000, 98000, 120000, 900000]);
    expect(h0.low).toBe(15000);
    expect(h0.median).toBe(98000);
    expect(h0.high).toBe(900000);
  });

  it('keeps charges as a list of combinations, not four merged scalars', () => {
    expect(h0.charges).toHaveLength(2);
    expect(h0.charges[0]).toMatchObject({ se: 0, bc: 0, c: 120000 });
    expect(h0.charges[1]).toMatchObject({ se: 2, bc: 0, c: 300000, w: ['mn'] });
    expect(h0.gross).toBeUndefined();
  });

  it('reads a withheld value as withheld, never as a price', () => {
    expect(h0.withheld).toHaveLength(1);
    expect(h0.withheld[0]).toMatchObject({ payer: 2, plan: 2, price: 1 });
    // The whole point: a penny value must not reach the price list.
    expect(h0.prices).not.toContain(1);
  });

  it('reads a formula-based rate with its kind and value', () => {
    expect(h0.formula).toHaveLength(1);
    expect(h0.formula[0]).toMatchObject({ kind: 'percentage', value: 6200, src: 0 });
  });

  it('keeps a hospital that published only a formula', () => {
    const h1 = decoded.hospitals.find((h) => h.hIdx === 1);
    expect(h1.rates).toHaveLength(0);
    expect(h1.formula).toHaveLength(1);
    expect(h1.median).toBeNull();
  });

  it('carries the source index each entry actually came from', () => {
    const h2 = decoded.hospitals.find((h) => h.hIdx === 2);
    expect(h2.rates[0].src).toBe(1);
    expect(h2.charges[0].src).toBe(1);
  });
});

describe('decoding the legacy shape', () => {
  const decoded = decodeBucket(META_LEGACY, BUCKET_LEGACY, '45378');
  const h0 = decoded.hospitals[0];

  it('reads stride-5 groups without a billing class or source', () => {
    expect(h0.rates).toHaveLength(3);
    expect(h0.rates[0]).toMatchObject({ payer: 1, plan: 1, setting: 0, method: 3, price: 98000 });
    // Claiming billing class 0 would be inventing a distinction the file never made.
    expect(h0.rates[0].billingClass).toBeNull();
    expect(h0.rates[0].src).toBeNull();
  });

  it('produces the same prices the old reader produced', () => {
    expect(h0.prices).toEqual([98000, 120000, 900000]);
    expect(h0.median).toBe(120000);
  });

  it('presents the four merged scalars as one charge combination', () => {
    expect(h0.charges).toHaveLength(1);
    expect(h0.charges[0]).toMatchObject({
      se: null, bc: null, g: 900000, c: 300000, mn: 98000, mx: 900000, legacyMerged: true,
    });
  });

  it('has no withheld or formula entries, because the shape cannot carry them', () => {
    expect(h0.withheld).toEqual([]);
    expect(h0.formula).toEqual([]);
  });

  it('reads no charges at all when the legacy bucket published none', () => {
    const bare = { 1: { d: 'x', h: { 0: { r: [0, 0, 0, 0, 500] } } } };
    const d = decodeBucket(META_LEGACY, bare, '1');
    expect(d.hospitals[0].charges).toEqual([]);
    expect(d.hospitals[0].median).toBe(500);
  });
});

describe('decoding the compact encoding', () => {
  const decoded = decodeBucket(META_COMPACT, BUCKET_COMPACT, '45378');
  const h0 = decoded.hospitals[0];

  it('resolves identity through the _cx combination table', () => {
    expect(h0.rates).toHaveLength(5);
    const perDiem = h0.rates.find((r) => r.price === 40000);
    expect(perDiem).toMatchObject({ payer: 1, plan: 1, setting: 0, billingClass: 0, method: 2 });
  });

  it('agrees with the full encoding on every price', () => {
    const full = decodeBucket(META_V2, BUCKET_V2, '45378').hospitals.find((h) => h.hIdx === 0);
    expect(h0.prices).toEqual(full.prices);
    expect(h0.median).toBe(full.median);
  });

  it('resolves withheld and formula entries through the table too', () => {
    expect(h0.withheld[0]).toMatchObject({ payer: 2, plan: 2, price: 1 });
    expect(h0.formula[0]).toMatchObject({ kind: 'percentage', value: 6200 });
  });

  it('does not mistake the _cx table for a code', () => {
    expect(decodeBucket(META_COMPACT, BUCKET_COMPACT, '_cx')).toBeNull();
  });
});

describe('decodeBucket edges', () => {
  it('returns null for a code the bucket does not carry', () => {
    expect(decodeBucket(META_V2, BUCKET_V2, '99999')).toBeNull();
    expect(decodeBucket(META_V2, null, '45378')).toBeNull();
  });

  it('returns null for a hospital entry that is not there', () => {
    expect(decodeHospital(shardContract(META_V2), null, 0, [])).toBeNull();
  });
});
