/**
 * The judgements that turn decoded entries into something a page may show.
 *
 * Each of these pins a specific way the old site was wrong: one cash price
 * where two were published, one median over rates that are not the same kind
 * of thing, and one source file credited for a price that came from another.
 */
import { describe, it, expect } from 'vitest';
import {
  chargeSummary, chargesFor, chargeSummaryFor, methodGroup, methodGroupsByIndex,
  defaultContext, defaultSettings, resolveBillingClass, rateMatches, contextMedian,
  formulaLabel, alsoPublished, isFormulaOnly, sourceOf, freshness, groupStageCounts,
  METHOD_GROUPS, isPerUnitGroup,
} from '../src/lib/prices.js';
import { decodeBucket } from '../src/lib/shards.js';
import {
  META_V2, BUCKET_V2, META_LEGACY, BUCKET_LEGACY,
  SETTINGS, BILLING_CLASSES, METHODS, SOURCES,
} from './fixtures/shards.js';

const v2 = decodeBucket(META_V2, BUCKET_V2, '45378');
const h0 = v2.hospitals.find((h) => h.hIdx === 0);
const groupByIndex = methodGroupsByIndex(METHODS);

/* ---------------------------------------------------------------- charges -- */

describe('chargeSummary', () => {
  it('reports a range rather than picking the larger cash price', () => {
    const s = chargeSummary(h0.charges);
    expect(s.combinations).toBe(2);
    expect(s.cashLow).toBe(120000);
    expect(s.cashHigh).toBe(300000);
    // The defect this replaces: max() reported $3000 for the outpatient case too.
    expect(s.varies).toBe(true);
    expect(s.distinctCash).toBe(2);
  });

  it('reports gross the same way', () => {
    const s = chargeSummary(h0.charges);
    expect(s.grossLow).toBe(400000);
    expect(s.grossHigh).toBe(900000);
  });

  it('does not claim variation when every combination agrees', () => {
    const s = chargeSummary([
      { se: 0, bc: 0, c: 5000, g: 9000 },
      { se: 2, bc: 0, c: 5000, g: 9000 },
    ]);
    expect(s.varies).toBe(false);
    expect(s.cashLow).toBe(5000);
    expect(s.cashHigh).toBe(5000);
  });

  it('notices a withheld charge field', () => {
    expect(chargeSummary(h0.charges).hasWithheld).toBe(true);
    expect(chargeSummary([{ se: 0, bc: 0, c: 100 }]).hasWithheld).toBe(false);
  });

  it('survives an empty or absent charge list', () => {
    for (const input of [[], null, undefined]) {
      const s = chargeSummary(input);
      expect(s.combinations).toBe(0);
      expect(s.cashLow).toBeNull();
      expect(s.varies).toBe(false);
    }
  });

  it('ignores nulls rather than treating them as zero', () => {
    const s = chargeSummary([
      { se: 0, bc: 0, c: null, g: 400000, mn: null, mx: null },
      { se: 2, bc: 0, c: 300000, g: null, mn: null, mx: null },
    ]);
    expect(s.cashLow).toBe(300000);
    expect(s.grossLow).toBe(400000);
  });

  it('flags a legacy merge as merged, so the page can say so', () => {
    const legacy = decodeBucket(META_LEGACY, BUCKET_LEGACY, '45378').hospitals[0];
    const s = chargeSummary(legacy.charges);
    expect(s.merged).toBe(true);
    expect(s.combinations).toBe(1);
    expect(s.varies).toBe(false);
  });
});

describe('chargesFor and chargeSummaryFor', () => {
  it('restricts to one setting and billing class', () => {
    expect(chargesFor(h0.charges, 0, 0)).toHaveLength(1);
    expect(chargesFor(h0.charges, 2, 0)[0].c).toBe(300000);
    expect(chargesFor(h0.charges, 1, 0)).toHaveLength(0);
  });

  it('scopes the summary to the chosen setting', () => {
    const s = chargeSummaryFor(h0.charges, { settings: [0, 1], billingClass: null });
    expect(s.scoped).toBe(true);
    expect(s.cashLow).toBe(120000);
    expect(s.cashHigh).toBe(120000);   // the $3000 inpatient price is a different thing
    expect(s.varies).toBe(false);
  });

  it('falls back to every combination, and says so, when the context matches none', () => {
    const s = chargeSummaryFor(h0.charges, { settings: [99], billingClass: null });
    expect(s.scoped).toBe(false);
    expect(s.combinations).toBe(2);
  });
});

/* ------------------------------------------------------------ methodology -- */

describe('method grouping', () => {
  it('tells the four groups apart', () => {
    expect(methodGroup('case rate')).toBe('caseRate');
    expect(methodGroup('per diem')).toBe('perDiem');
    expect(methodGroup('Per Diem')).toBe('perDiem');
    expect(methodGroup('fee schedule')).toBe('feeSchedule');
    expect(methodGroup('percent of total billed charges')).toBe('other');
    expect(methodGroup(null)).toBe('other');
  });

  it('marks per diem, and only per diem, as a per-unit rate', () => {
    expect(isPerUnitGroup('perDiem')).toBe(true);
    for (const g of METHOD_GROUPS.filter((x) => x.id !== 'perDiem')) {
      expect(isPerUnitGroup(g.id), g.id).toBe(false);
    }
  });

  it('maps a methodologies dictionary to groups by index', () => {
    expect(groupByIndex).toEqual(['other', 'caseRate', 'perDiem', 'feeSchedule']);
  });
});

/* ---------------------------------------------------------------- context -- */

describe('context defaults', () => {
  it('defaults to outpatient plus both', () => {
    expect(defaultSettings(SETTINGS)).toEqual([0, 1]);
  });

  it('picks the facility billing class when the file distinguishes one', () => {
    expect(resolveBillingClass(BILLING_CLASSES)).toBe(0);
  });

  it('does not filter on billing class when every entry carries the same one', () => {
    // The real Virginia build publishes billing_classes.json as [""] — filtering
    // on it would hide every price rather than narrowing anything.
    expect(resolveBillingClass([''])).toBeNull();
    expect(resolveBillingClass([])).toBeNull();
    expect(resolveBillingClass(null)).toBeNull();
  });

  it('shows every dollar method but leaves per diem out of the ranking', () => {
    const ctx = defaultContext({ settings: SETTINGS, billingClasses: BILLING_CLASSES });
    expect(ctx.methodGroups).toContain('caseRate');
    expect(ctx.methodGroups).toContain('feeSchedule');
    expect(ctx.includePerDiem).toBe(false);
  });
});

describe('rateMatches', () => {
  const ctx = defaultContext({ settings: SETTINGS, billingClasses: BILLING_CLASSES });
  const rate = (o) => ({ payer: 0, plan: 0, setting: 0, billingClass: 0, method: 3, price: 100, ...o });

  it('accepts an outpatient facility fee-schedule rate', () => {
    expect(rateMatches(rate(), ctx, groupByIndex)).toBe(true);
  });

  it('rejects an inpatient rate under the outpatient default', () => {
    expect(rateMatches(rate({ setting: 2 }), ctx, groupByIndex)).toBe(false);
  });

  it('rejects a professional rate under the facility default', () => {
    expect(rateMatches(rate({ billingClass: 1 }), ctx, groupByIndex)).toBe(false);
  });

  it('shows a per-diem rate but keeps it out of the ranking', () => {
    const pd = rate({ method: 2 });
    expect(rateMatches(pd, ctx, groupByIndex)).toBe(true);
    expect(rateMatches(pd, ctx, groupByIndex, { forRanking: true })).toBe(false);
  });

  it('includes per-diem in the ranking once the user opts in', () => {
    const opted = { ...ctx, includePerDiem: true };
    expect(rateMatches(rate({ method: 2 }), opted, groupByIndex, { forRanking: true })).toBe(true);
  });

  it('never filters on a billing class the data does not carry', () => {
    // Legacy rates have billingClass null; a facility default must not hide them.
    expect(rateMatches(rate({ billingClass: null }), ctx, groupByIndex)).toBe(true);
  });

  it('passes everything through when there is no context yet', () => {
    expect(rateMatches(rate({ setting: 2, method: 2 }), null, groupByIndex)).toBe(true);
  });
});

describe('contextMedian', () => {
  const ctx = defaultContext({ settings: SETTINGS, billingClasses: BILLING_CLASSES });

  it('medians only the outpatient facility dollar rates, per diem excluded', () => {
    const r = contextMedian(h0.rates, ctx, groupByIndex, { forRanking: true });
    // $1200 and $980 survive; $9000 is inpatient, $150 professional, $400 per diem.
    expect(r.prices).toEqual([98000, 120000]);
    expect(r.n).toBe(2);
    expect(r.low).toBe(98000);
    expect(r.high).toBe(120000);
  });

  it('never mixes a case rate and a per-diem rate into one median silently', () => {
    const ranked = contextMedian(h0.rates, ctx, groupByIndex, { forRanking: true });
    expect(ranked.prices).not.toContain(40000);   // the per-diem rate
    expect(ranked.prices).not.toContain(900000);  // the inpatient case rate
  });

  it('widens when the user asks for any setting and every method', () => {
    const wide = { settings: null, billingClass: null, methodGroups: ['caseRate', 'perDiem', 'feeSchedule', 'other'], includePerDiem: true };
    const r = contextMedian(h0.rates, wide, groupByIndex, { forRanking: true });
    expect(r.n).toBe(5);
    expect(r.prices).toEqual([15000, 40000, 98000, 120000, 900000]);
  });

  it('reports nothing rather than zero when the context matches no rate', () => {
    const r = contextMedian(h0.rates, { settings: [99] }, groupByIndex, { forRanking: true });
    expect(r.median).toBeNull();
    expect(r.n).toBe(0);
  });
});

/* ------------------------------------------------------------- new states -- */

describe('the states that used to be invisible', () => {
  it('describes a percentage formula without inventing a dollar amount', () => {
    expect(formulaLabel({ kind: 'percentage', value: 6200 }, { percentageScale: 100 }))
      .toBe('62% of gross charges; no dollar amount published');
  });

  it('keeps a fractional percentage readable', () => {
    expect(formulaLabel({ kind: 'percentage', value: 4160 }, { percentageScale: 100 }))
      .toBe('41.6% of gross charges; no dollar amount published');
  });

  it('describes an allowed amount as the median it is', () => {
    expect(formulaLabel({ kind: 'allowed_amount', value: 125000, n: 7 }))
      .toBe('median allowed amount $1,250.00 from 7 remittances');
  });

  it('says an algorithm is an algorithm', () => {
    expect(formulaLabel({ kind: 'algorithm', value: 0 })).toMatch(/algorithm/);
  });

  it('counts withheld and formula entries in one line', () => {
    expect(alsoPublished(h0)).toBe(
      'Also published here: 1 value below one cent, withheld; 1 formula-based rate with no dollar amount.',
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(alsoPublished({ withheld: [], formula: [] })).toBeNull();
  });

  it('recognises a formula-only hospital as a finding, not an absence', () => {
    const h1 = v2.hospitals.find((h) => h.hIdx === 1);
    expect(isFormulaOnly(h1)).toBe(true);
    expect(isFormulaOnly(h0)).toBe(false);
  });
});

/* ------------------------------------------------------------- provenance -- */

describe('provenance', () => {
  it('resolves an entry to the file it actually came from', () => {
    const h2 = v2.hospitals.find((h) => h.hIdx === 2);
    const s = sourceOf(SOURCES, h2.rates[0].src);
    expect(s.fileVersionId).toBe(425);
    // The bug this replaces: sources[0] credits the wrong file, date and hash.
    expect(s).not.toBe(SOURCES[0]);
  });

  it('resolves the first file for an entry that came from it', () => {
    expect(sourceOf(SOURCES, h0.rates[0].src).fileVersionId).toBe(424);
  });

  it('returns null rather than guessing when there is no source index', () => {
    expect(sourceOf(SOURCES, null)).toBeNull();
    expect(sourceOf(SOURCES, 9)).toBeNull();
    expect(sourceOf([], 0)).toBeNull();
    expect(sourceOf(null, 0)).toBeNull();
  });

  it('carries the full digest, not a checkable-looking prefix', () => {
    expect(sourceOf(SOURCES, 0).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('calls a file inside twelve months current', () => {
    const now = Date.parse('2026-09-04T00:00:00Z');
    expect(freshness('2026-04-01', now).state).toBe('current');
  });

  it('calls a file older than twelve months stale', () => {
    const now = Date.parse('2026-09-04T00:00:00Z');
    expect(freshness('2019-01-15', now).state).toBe('stale');
    expect(freshness('2025-01-15', now).state).toBe('stale');
  });

  it('says unknown rather than guessing when no date was declared', () => {
    expect(freshness(null).state).toBe('unknown');
    expect(freshness('not a date').state).toBe('unknown');
  });
});

/* ------------------------------------------------------------ stage counts -- */

const STAGE_ROWS = [
  { name: 'A', ccn: '1', outcome: 'published', retained: { priceEntries: 10 } },
  { name: 'B', ccn: '2', outcome: 'no machine-readable file found', retained: {} },
  { name: 'C', ccn: '3', outcome: 'file links rejected as belonging to another hospital', retained: {} },
  { name: 'D', ccn: '4', outcome: 'no comparable codes published (local or revenue codes only)', retained: {} },
  { name: 'E', ccn: '5', outcome: 'file found but nothing parsed from it', retained: {} },
  { name: 'F', ccn: '6', outcome: 'comparable codes published, but no negotiated dollar amounts', retained: { formulaEntries: 40, chargeEntries: 0 } },
  { name: 'G', ccn: '7', outcome: 'comparable codes published, but no negotiated dollar amounts', retained: { formulaEntries: 0, chargeEntries: 12 } },
  { name: 'H', ccn: '8', outcome: 'no comparable codes published (local or revenue codes only)', retained: {} },
];

describe('groupStageCounts', () => {
  const groups = groupStageCounts(STAGE_ROWS);
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

  it('leaves the hospitals that did publish out of the "what is missing" list', () => {
    expect(byId.published).toBeUndefined();
    expect(groupStageCounts(STAGE_ROWS, { includePublished: true }).find((g) => g.id === 'published').count).toBe(1);
  });

  it('groups by reason with counts and names', () => {
    expect(byId.noFile.count).toBe(1);
    expect(byId.rejected.count).toBe(1);
    expect(byId.nothingParsed.count).toBe(1);
    expect(byId.noComparable.count).toBe(2);
    expect(byId.noComparable.hospitals.map((h) => h.name)).toEqual(['D', 'H']);
  });

  it('tells formula-only apart from cash-only rather than lumping them together', () => {
    expect(byId.formulaOnly.count).toBe(1);
    expect(byId.formulaOnly.hospitals[0].name).toBe('F');
    expect(byId.cashOnly.count).toBe(1);
    expect(byId.cashOnly.hospitals[0].name).toBe('G');
  });

  it('gives every group a label and an explanation', () => {
    for (const g of groups) {
      expect(typeof g.label, g.id).toBe('string');
      expect(g.label.length, g.id).toBeGreaterThan(0);
      expect(typeof g.note, g.id).toBe('string');
    }
  });

  it('surfaces an outcome it does not recognise instead of dropping the hospital', () => {
    const g = groupStageCounts([{ name: 'Z', outcome: 'something new', retained: {} }]);
    expect(g).toHaveLength(1);
    expect(g[0].hospitals[0].name).toBe('Z');
  });

  it('accounts for every hospital exactly once', () => {
    const all = groupStageCounts(STAGE_ROWS, { includePublished: true })
      .flatMap((g) => g.hospitals.map((h) => h.ccn));
    expect(all.sort()).toEqual(STAGE_ROWS.map((r) => r.ccn).sort());
  });

  it('survives an absent stage_counts file', () => {
    expect(groupStageCounts(null)).toEqual([]);
    expect(groupStageCounts([])).toEqual([]);
  });
});
