import { describe, it, expect } from 'vitest';
import { estimate, estimateRange, emptyBenefits, fmtUSD } from '../src/lib/estimate.js';

const $ = (d) => Math.round(d * 100);
const base = (o = {}) => ({ ...emptyBenefits(), ...o });

describe('deductible', () => {
  it('patient pays the whole rate while the deductible is unmet', () => {
    const r = estimate($(900), base({ deductible: $(2000), coinsurance: 0.2, copay: null }));
    expect(r.patient).toBe($(900));
    expect(r.toDeductible).toBe($(900));
    expect(r.toCoinsurance).toBe(0);
    expect(r.plan).toBe(0);
  });

  it('splits across the deductible boundary', () => {
    // $500 of deductible left, $1,500 rate, 20% coinsurance on the remaining $1,000
    const r = estimate($(1500), base({ deductible: $(2000), deductibleMet: $(1500), coinsurance: 0.2, copay: null }));
    expect(r.toDeductible).toBe($(500));
    expect(r.toCoinsurance).toBe($(200));
    expect(r.patient).toBe($(700));
    expect(r.plan).toBe($(800));
  });

  it('is coinsurance only once the deductible is met', () => {
    const r = estimate($(1000), base({ deductible: $(2000), deductibleMet: $(2000), coinsurance: 0.3, copay: null }));
    expect(r.toDeductible).toBe(0);
    expect(r.patient).toBe($(300));
  });

  it('treats a deductible already over-met as met', () => {
    const r = estimate($(1000), base({ deductible: $(1000), deductibleMet: $(5000), coinsurance: 0.1, copay: null }));
    expect(r.toDeductible).toBe(0);
    expect(r.patient).toBe($(100));
  });
});

describe('copay', () => {
  it('replaces the deductible on a PPO-style plan', () => {
    const r = estimate($(900), base({ deductible: $(2000), copay: $(40), copayWaivesDeductible: true }));
    expect(r.patient).toBe($(40));
    expect(r.toCopay).toBe($(40));
    expect(r.toDeductible).toBe(0);
  });

  it('never exceeds the negotiated rate', () => {
    const r = estimate($(25), base({ copay: $(40), copayWaivesDeductible: true }));
    expect(r.patient).toBe($(25));
    expect(r.notes.join(' ')).toMatch(/lower negotiated rate/);
  });

  it('applies after the deductible on an HDHP', () => {
    const r = estimate($(900), base({
      deductible: $(2000), copay: $(40), copayWaivesDeductible: false, coinsurance: 0,
    }));
    expect(r.toDeductible).toBe($(900));
    expect(r.patient).toBe($(900));
  });
});

describe('out-of-pocket maximum', () => {
  it('caps the bill', () => {
    const r = estimate($(50000), base({
      deductible: $(3000), coinsurance: 0.2, copay: null,
      outOfPocketMax: $(8000), outOfPocketMet: $(1000),
    }));
    expect(r.patient).toBe($(7000));
    expect(r.cappedByOopMax).toBe(true);
  });

  it('charges nothing once the maximum is reached', () => {
    const r = estimate($(4000), base({ outOfPocketMax: $(8000), outOfPocketMet: $(8000) }));
    expect(r.patient).toBe(0);
    expect(r.plan).toBe($(4000));
    expect(r.notes.join(' ')).toMatch(/already reached/);
  });

  it('ignores a maximum of zero, meaning not entered', () => {
    const r = estimate($(1000), base({ deductible: 0, coinsurance: 0.2, copay: null, outOfPocketMax: 0 }));
    expect(r.patient).toBe($(200));
    expect(r.cappedByOopMax).toBe(false);
  });
});

describe('edge cases', () => {
  it('handles a zero rate without inventing a price', () => {
    const r = estimate(0, base({ deductible: $(1000) }));
    expect(r.patient).toBe(0);
    expect(r.notes.join(' ')).toMatch(/No negotiated rate/);
  });

  it('clamps coinsurance outside 0..1', () => {
    expect(estimate($(100), base({ coinsurance: 5, copay: null, deductible: 0 })).patient).toBe($(100));
    expect(estimate($(100), base({ coinsurance: -2, copay: null, deductible: 0 })).patient).toBe(0);
  });

  it('never charges the patient more than the allowed amount', () => {
    const r = estimate($(100), base({ deductible: $(999999), coinsurance: 1, copay: null }));
    expect(r.patient).toBeLessThanOrEqual($(100));
  });

  it('always splits the allowed amount exactly between patient and plan', () => {
    for (const allowed of [1, 99, $(37.55), $(1200), $(98765.43)]) {
      for (const ded of [0, $(500), $(6000)]) {
        for (const co of [0, 0.1, 0.2, 0.5, 1]) {
          const r = estimate(allowed, base({ deductible: ded, coinsurance: co, copay: null }));
          expect(r.patient + r.plan).toBe(allowed);
          expect(r.patient).toBeGreaterThanOrEqual(0);
          expect(r.plan).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('flags out-of-network balance billing', () => {
    const r = estimate($(1000), base({ inNetwork: false, deductible: 0, coinsurance: 0.2, copay: null }));
    expect(r.notes.join(' ')).toMatch(/out of network/i);
  });

  it('survives rubbish input instead of returning NaN', () => {
    const r = estimate(NaN, base({ deductible: NaN, coinsurance: NaN, outOfPocketMax: NaN }));
    expect(Number.isFinite(r.patient)).toBe(true);
    expect(r.patient).toBe(0);
  });
});

describe('range', () => {
  it('reports low, middle and high patient cost', () => {
    const rates = [$(500), $(900), $(1400), $(5000)];
    const r = estimateRange(rates, base({ deductible: 0, coinsurance: 0.2, copay: null }));
    expect(r.low.patient).toBe($(100));
    expect(r.high.patient).toBe($(1000));
    expect(r.mid.patient).toBeGreaterThan(r.low.patient);
  });
  it('returns null with no rates', () => {
    expect(estimateRange([], base())).toBe(null);
  });
});

describe('formatting', () => {
  it('formats cents as dollars', () => {
    expect(fmtUSD($(1234.5))).toBe('$1,234.50');
    expect(fmtUSD($(1234.5), { round: true })).toBe('$1,235');
    expect(fmtUSD(null)).toBe('—');
  });
});
