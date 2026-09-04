/**
 * Turning decoded shard entries into things a page can honestly show.
 *
 * Two rules drive everything here:
 *
 *  1. There is no single "the cash price". A hospital that publishes $150
 *     outpatient and $900 inpatient has two cash prices, and the old pipeline
 *     reported $900 for both. Callers either pick a combination deliberately
 *     or show a range and say it is a range.
 *
 *  2. A median is only meaningful over entries that are the same kind of thing.
 *     "Case rate $12,000" and "fee schedule $840" are not two samples of one
 *     price; a per-diem rate is a price per day and is not comparable to either
 *     without saying so.
 */

/* --------------------------------------------------------------- charges -- */

/**
 * One hospital's charge picture for a code, across whatever combinations of
 * (setting, billing class) it published.
 *
 * `varies` is the flag a caller needs before printing a single number: when it
 * is true there is more than one distinct cash price and no one of them is
 * "the" price.
 */
export function chargeSummary(charges) {
  const list = charges || [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const cash = list.map((c) => c.c).filter(num);
  const gross = list.map((c) => c.g).filter(num);
  const mn = list.map((c) => c.mn).filter(num);
  const mx = list.map((c) => c.mx).filter(num);
  const distinctCash = new Set(cash).size;

  return {
    combinations: list.length,
    cashLow: cash.length ? Math.min(...cash) : null,
    cashHigh: cash.length ? Math.max(...cash) : null,
    grossLow: gross.length ? Math.min(...gross) : null,
    grossHigh: gross.length ? Math.max(...gross) : null,
    minNegotiated: mn.length ? Math.min(...mn) : null,
    maxNegotiated: mx.length ? Math.max(...mx) : null,
    // More than one different cash price was published for this code.
    varies: distinctCash > 1,
    distinctCash,
    // A value was published but rounds to a penny or less, so it is withheld.
    hasWithheld: list.some((c) => Array.isArray(c.w) && c.w.length > 0),
    // Legacy data merged every combination with max(); it cannot be split.
    merged: list.some((c) => c.legacyMerged),
  };
}

/** Charges restricted to one (setting, billing class) pair. */
export function chargesFor(charges, setting, billingClass) {
  return (charges || []).filter(
    (c) => (setting == null || c.se === setting) && (billingClass == null || c.bc === billingClass),
  );
}

/**
 * The charge picture for the context the user is looking at, falling back to
 * everything published when the context matches nothing.
 *
 * `scoped` says whether the numbers are actually for the requested context, so
 * the page can label a fallback rather than implying a precision it does not
 * have.
 */
export function chargeSummaryFor(charges, ctx) {
  const all = charges || [];
  const inCtx = all.filter((c) => chargeMatches(c, ctx));
  if (inCtx.length) return { ...chargeSummary(inCtx), scoped: true };
  return { ...chargeSummary(all), scoped: false };
}

const chargeMatches = (c, ctx) => {
  if (!ctx) return true;
  if (ctx.settings && c.se != null && !ctx.settings.includes(c.se)) return false;
  if (ctx.billingClass != null && c.bc != null && c.bc !== ctx.billingClass) return false;
  return true;
};

/** "cash price varies by setting and billing class" — the honest label. */
export function cashLabel(summary, settingsDict, billingDict) {
  if (!summary || summary.cashLow == null) return null;
  if (!summary.varies) return null;
  const dims = [];
  if (settingsDict) dims.push('setting');
  if (billingDict && billingDict.length > 1) dims.push('billing class');
  return `cash price varies by ${dims.join(' and ') || 'setting'}`;
}

/* ------------------------------------------------------------ methodology -- */

/**
 * The four method groups that matter for whether prices can be averaged.
 *
 * A per-diem rate is a price per day; a case rate is a price for the whole
 * admission. Mixing them into one median produces a number that describes
 * neither, which is what the old shards did.
 */
export const METHOD_GROUPS = [
  { id: 'caseRate', label: 'Case rate', test: /case\s*rate/i, perUnit: false },
  { id: 'perDiem', label: 'Per diem', test: /per\s*diem/i, perUnit: true, badge: 'per day' },
  { id: 'feeSchedule', label: 'Fee schedule', test: /fee\s*schedule/i, perUnit: false },
  { id: 'other', label: 'Other', test: null, perUnit: false },
];

/** Which group a methodology string belongs to. */
export function methodGroup(name) {
  const s = String(name || '');
  for (const g of METHOD_GROUPS) if (g.test && g.test.test(s)) return g.id;
  return 'other';
}

/** Map a methodologies.json dictionary to a group id per index, once. */
export function methodGroupsByIndex(methods) {
  return (methods || []).map((m) => methodGroup(m));
}

export const isPerUnitGroup = (id) => METHOD_GROUPS.some((g) => g.id === id && g.perUnit);

/* ---------------------------------------------------------------- context -- */

/**
 * Defaults chosen so the first thing a visitor sees is one comparable thing.
 *
 * Setting: outpatient plus "both", because a scheduled procedure someone is
 * shopping for is an outpatient one, and files that decline to split the two
 * publish "both".
 *
 * Billing class: the facility fee where the file distinguishes one, since that
 * is the charge the hospital itself controls. Many files publish a single
 * unlabelled billing class, in which case filtering on it would hide
 * everything — `resolveBillingClass` returns null and the filter is inert.
 *
 * Methods: every dollar method is shown, per-diem included and badged "per
 * day". What per-diem is held out of is the cross-hospital *ranking*, because
 * a price per day cannot be ranked against a price per case — not the list,
 * where it is a real published rate the hospital should be credited for.
 * `methodGroups` says what is visible; `includePerDiem` says what is ranked.
 */
export function defaultContext(dicts) {
  return {
    settings: defaultSettings(dicts?.settings),
    billingClass: resolveBillingClass(dicts?.billingClasses),
    methodGroups: METHOD_GROUPS.map((g) => g.id),
    includePerDiem: false,
  };
}

/** Indices of "outpatient" and "both" in settings.json, if present. */
export function defaultSettings(settings) {
  if (!settings?.length) return null;
  const want = settings
    .map((s, i) => [String(s).toLowerCase(), i])
    .filter(([s]) => s === 'outpatient' || s === 'both')
    .map(([, i]) => i);
  return want.length ? want : null;
}

/**
 * The index of a facility billing class, or null when the file does not
 * distinguish one. Null means "do not filter", which is the only honest
 * behaviour when every entry carries the same unlabelled class.
 */
export function resolveBillingClass(billingClasses) {
  if (!billingClasses?.length || billingClasses.length < 2) return null;
  const i = billingClasses.findIndex((b) => /facilit|institution|hospital/i.test(String(b || '')));
  return i >= 0 ? i : null;
}

/**
 * Does one decoded rate belong in the current comparison?
 *
 * `forRanking` additionally drops per-diem entries unless the user opted in —
 * they stay visible in the hospital's own list either way, they just do not
 * feed a median that is compared across hospitals.
 */
export function rateMatches(rate, ctx, groupByIndex, { forRanking = false } = {}) {
  if (!ctx) return true;
  if (ctx.settings && rate.setting != null && !ctx.settings.includes(rate.setting)) return false;
  if (ctx.billingClass != null && rate.billingClass != null && rate.billingClass !== ctx.billingClass) return false;
  const g = groupByIndex?.[rate.method] ?? 'other';
  if (ctx.methodGroups && !ctx.methodGroups.includes(g)) return false;
  if (forRanking && !ctx.includePerDiem && isPerUnitGroup(g)) return false;
  return true;
}

/** The median of already-decoded rates, over the selected context only. */
export function contextMedian(rates, ctx, groupByIndex, opts) {
  const prices = (rates || [])
    .filter((r) => rateMatches(r, ctx, groupByIndex, opts))
    .map((r) => r.price)
    .sort((a, b) => a - b);
  if (!prices.length) return { median: null, low: null, high: null, prices: [], n: 0 };
  return {
    median: prices[Math.floor(prices.length / 2)],
    low: prices[0],
    high: prices[prices.length - 1],
    prices,
    n: prices.length,
  };
}

/* -------------------------------------------------------------- new states -- */

/**
 * What a formula-based entry says, in words, without inventing a dollar amount.
 * `percentageScale` comes from the contract (basis points by default).
 */
export function formulaLabel(entry, { percentageScale = 100 } = {}) {
  if (!entry) return null;
  if (entry.kind === 'percentage') {
    const pct = entry.value / percentageScale;
    const shown = Number.isInteger(pct) ? pct : pct.toFixed(1);
    return `${shown}% of gross charges; no dollar amount published`;
  }
  if (entry.kind === 'allowed_amount') {
    return `median allowed amount ${usd(entry.value)}${entry.n > 1 ? ` from ${entry.n} remittances` : ''}`;
  }
  if (entry.kind === 'algorithm') {
    return 'set by a published algorithm; no dollar amount published';
  }
  return 'published as a formula; no dollar amount published';
}

export const WITHHELD_NOTE =
  'published below one cent; withheld';

const usd = (cents) => (cents == null ? '—' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * The one-line "also published" summary for a hospital that has entries which
 * are not usable prices. Returns null when there is nothing to say.
 */
export function alsoPublished(h) {
  const parts = [];
  const w = h?.withheld?.length ?? 0;
  const f = h?.formula?.length ?? 0;
  if (w) parts.push(`${w} value${w === 1 ? '' : 's'} below one cent, withheld`);
  if (f) parts.push(`${f} formula-based rate${f === 1 ? '' : 's'} with no dollar amount`);
  return parts.length ? `Also published here: ${parts.join('; ')}.` : null;
}

/** A hospital that published only formulas is a finding, not an absence. */
export const isFormulaOnly = (h) => !!h && (h.rates?.length ?? 0) === 0 && (h.formula?.length ?? 0) > 0;

/* ------------------------------------------------------------- provenance -- */

/**
 * The source file one entry actually came from.
 *
 * Using `sources[0]` was wrong the moment a hospital published more than one
 * file: a price from the second file was labelled with the first file's URL,
 * date and hash, which is precisely the claim provenance exists to prevent.
 */
export function sourceOf(sources, src) {
  if (!Array.isArray(sources) || !sources.length) return null;
  if (src == null) return null;
  return sources[src] ?? null;
}

const TWELVE_MONTHS_MS = 365 * 24 * 3600 * 1000;

/**
 * How much to trust the date the hospital declared on the file.
 * Twelve months is the federal update cadence, so past it the file is stale by
 * the rule's own standard.
 */
export function freshness(updated, now = Date.now()) {
  if (!updated) return { state: 'unknown', label: 'date not stated' };
  const t = Date.parse(updated);
  if (Number.isNaN(t)) return { state: 'unknown', label: 'date not stated' };
  const age = now - t;
  if (age <= TWELVE_MONTHS_MS) return { state: 'current', label: 'current', months: Math.round(age / (30 * 24 * 3600 * 1000)) };
  return { state: 'stale', label: 'over a year old', months: Math.round(age / (30 * 24 * 3600 * 1000)) };
}

/* ------------------------------------------------------------ stage counts -- */

/**
 * The outcome vocabulary `02_pack.mjs` emits, grouped for the data page.
 *
 * The pipeline is the authority on these strings; anything it emits that is not
 * listed here still gets its own group rather than being dropped, so a new
 * outcome shows up as itself instead of vanishing.
 */
export const OUTCOME_GROUPS = [
  { id: 'published', match: 'published', label: 'Published usable prices',
    note: 'A file was found, parsed, and priced.' },
  { id: 'noFile', match: 'no machine-readable file found', label: 'No file located',
    note: 'No machine-readable file could be found for this hospital.' },
  { id: 'rejected', match: 'file links rejected as belonging to another hospital', label: 'Identity under review',
    note: 'The only files found were published under another hospital\'s name, so they are not attributed here.' },
  { id: 'nothingParsed', match: 'file found but nothing parsed from it', label: 'File located but nothing parsed',
    note: 'A file was located but no rows could be read from it.' },
  { id: 'noComparable', match: 'no comparable codes published (local or revenue codes only)', label: 'Parsed but no comparable codes published',
    note: 'The file uses local or revenue codes only, so nothing can be compared with another hospital.' },
  { id: 'noDollars', match: 'comparable codes published, but no negotiated dollar amounts', label: 'Comparable codes but no dollar amounts',
    note: 'Rates are published only as formulas or percentages, so no price can be shown.' },
  { id: 'investigate', match: 'published prices the pipeline did not retain — investigate', label: 'Published but not retained — under investigation',
    note: 'The file held prices that this pipeline did not retain. That is a defect here, not at the hospital.' },
];

/**
 * Refine the "no dollar amounts" bucket using what was actually retained, so
 * "formula-only" and "cash-only" are told apart rather than lumped together.
 */
function refine(row) {
  if (row.outcome !== 'comparable codes published, but no negotiated dollar amounts') return null;
  const r = row.retained || {};
  if ((r.formulaEntries ?? 0) > 0) return { id: 'formulaOnly', label: 'Formula-based rates only',
    note: 'Every rate is published as a percentage or an algorithm, so no dollar amount exists to show.' };
  if ((r.chargeEntries ?? 0) > 0) return { id: 'cashOnly', label: 'Cash and gross charges only',
    note: 'The file publishes charges but no negotiated rates.' };
  return null;
}

/**
 * Group `stage_counts.json` by outcome, for the data page.
 * Returns groups in a stable, meaningful order with their hospitals attached.
 */
export function groupStageCounts(rows, { includePublished = false } = {}) {
  const groups = new Map();
  const put = (id, label, note, row) => {
    if (!groups.has(id)) groups.set(id, { id, label, note, hospitals: [] });
    groups.get(id).hospitals.push(row);
  };

  for (const row of rows || []) {
    if (row.outcome === 'published' && !includePublished) continue;
    const refined = refine(row);
    if (refined) { put(refined.id, refined.label, refined.note, row); continue; }
    const g = OUTCOME_GROUPS.find((x) => x.match === row.outcome);
    if (g) put(g.id, g.label, g.note, row);
    else put('otherOutcome', row.outcome || 'Not categorised', 'Reported by the pipeline under this outcome.', row);
  }

  const order = ['noFile', 'rejected', 'nothingParsed', 'noComparable', 'formulaOnly', 'cashOnly', 'noDollars', 'investigate', 'otherOutcome', 'published'];
  return [...groups.values()]
    .map((g) => ({ ...g, count: g.hospitals.length }))
    .sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || b.count - a.count;
    });
}
