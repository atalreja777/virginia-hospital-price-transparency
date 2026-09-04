/**
 * Reading the price shards back, in the browser.
 *
 * This is a port of `pipeline/lib/shards.mjs` — the decoder the pipeline's own
 * downstream stages read through, and the one under test in
 * `tests/pipeline.test.js`. The semantics are deliberately identical; only the
 * I/O differs (the pipeline reads files, the site is handed parsed JSON).
 *
 * Two shapes have to decode correctly, because the site deploys independently
 * of the data:
 *
 *   legacy  — no `meta.shard`. Rates are 5-int groups (pa,pl,se,me,cents) and
 *             the charges are four scalars merged across every setting and
 *             billing class on the bucket itself (g, c, mn, mx).
 *   v2      — `meta.shard` declares the field order. The stride comes from
 *             `rateFields.length`; charges are a list of (setting, billing
 *             class) combinations; withheld values and formula-based rates
 *             exist as their own arrays.
 *
 * Never hard-code a stride. That is the whole reason the contract declares one.
 */

/** The shape a dataset without `meta.shard` is in: the original 5-int rates. */
const LEGACY_SHARD = {
  version: 1,
  encoding: 'legacy',
  rateFields: ['pa', 'pl', 'se', 'me', 'cents'],
  withheldFields: null,
  xFields: null,
  chargeFields: null,
  comboFields: null,
  comboKey: null,
  priceKinds: [],
  percentageScale: 100,
};

const indexOf = (fields) => Object.fromEntries(fields.map((f, i) => [f, i]));

/**
 * Normalise `meta.shard` into everything a decoder needs, filling in the legacy
 * shape when the dataset predates the contract.
 */
export function shardContract(meta) {
  const shard = meta?.shard || LEGACY_SHARD;
  const legacy = !meta?.shard;
  const compact = shard.encoding === 'compact';
  const rateFields = shard.rateFields || LEGACY_SHARD.rateFields;
  const xFields = shard.xFields || null;
  return {
    shard,
    legacy,
    compact,
    version: shard.version ?? 1,
    rateStride: rateFields.length,
    xStride: xFields ? xFields.length : 0,
    R: indexOf(rateFields),
    X: xFields ? indexOf(xFields) : {},
    priceKinds: shard.priceKinds || [],
    percentageScale: shard.percentageScale ?? 100,
  };
}

/**
 * One packed group -> a named object, in whichever encoding it is in.
 *
 * `billingClass` is null on legacy data rather than 0: index 0 is a real
 * billing class, and claiming one that was never published would be a
 * fabrication rather than a default.
 */
function readGroup(C, a, i, cx) {
  const { R, compact, version } = C;
  const g = {};
  if (compact) {
    const c = a[i + R.cx] * 5;
    g.payer = cx[c]; g.plan = cx[c + 1]; g.setting = cx[c + 2];
    g.billingClass = cx[c + 3]; g.method = cx[c + 4];
  } else {
    g.payer = a[i + R.pa]; g.plan = a[i + R.pl]; g.setting = a[i + R.se];
    g.billingClass = version >= 2 && R.bc != null ? a[i + R.bc] : null;
    g.method = a[i + R.me];
  }
  g.price = a[i + R.cents];
  g.src = R.src == null ? null : a[i + R.src];
  g.n = R.n == null ? 1 : a[i + R.n];
  return g;
}

/** A formula-based entry: no dollar amount, but a published rule. */
function readFormula(C, a, i, cx) {
  const { X, compact, priceKinds } = C;
  const g = {};
  if (compact) {
    const c = a[i + X.cx] * 5;
    g.payer = cx[c]; g.plan = cx[c + 1]; g.setting = cx[c + 2];
    g.billingClass = cx[c + 3]; g.method = cx[c + 4];
  } else {
    g.payer = a[i + X.pa]; g.plan = a[i + X.pl]; g.setting = a[i + X.se];
    g.billingClass = a[i + X.bc]; g.method = a[i + X.me];
  }
  g.src = a[i + X.src];
  g.kind = priceKinds[a[i + X.pk]] ?? null;
  g.value = a[i + X.v];
  return g;
}

/**
 * Legacy buckets carry one merged charge picture per hospital, not a list.
 *
 * Presenting it as a one-entry list lets every caller use the same code path;
 * `se` and `bc` are null because the legacy merge threw those distinctions
 * away — a hospital publishing $150 outpatient and $900 inpatient was recorded
 * as $900 for both, and pretending we know which setting that is would be
 * worse than saying we do not.
 */
function legacyCharges(v) {
  if (v.g == null && v.c == null && v.mn == null && v.mx == null) return [];
  return [{ se: null, bc: null, g: v.g ?? null, c: v.c ?? null, mn: v.mn ?? null, mx: v.mx ?? null, src: 0, legacyMerged: true }];
}

/**
 * All of one hospital's published entries for one code.
 * @param {object} C  the contract from shardContract()
 * @param {object} v  the per-hospital bucket value
 */
export function decodeHospital(C, v, hIdx, cx) {
  if (!v) return null;
  const { rateStride, xStride, legacy } = C;
  const rates = [];
  const withheld = [];
  const formula = [];
  for (let i = 0; v.r && i < v.r.length; i += rateStride) rates.push(readGroup(C, v.r, i, cx));
  for (let i = 0; v.w && i < v.w.length; i += rateStride) withheld.push(readGroup(C, v.w, i, cx));
  for (let i = 0; v.x && xStride && i < v.x.length; i += xStride) formula.push(readFormula(C, v.x, i, cx));

  rates.sort((a, b) => a.price - b.price);
  const prices = rates.map((r) => r.price);

  return {
    hIdx: +hIdx,
    charges: legacy ? legacyCharges(v) : (v.ch || []),
    rates,
    withheld,
    formula,
    prices,
    low: prices[0] ?? null,
    median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    high: prices[prices.length - 1] ?? null,
  };
}

/**
 * Decode one code out of an already-fetched shard bucket.
 * Returns null when the bucket does not carry that code.
 */
export function decodeBucket(meta, bucket, code) {
  const C = shardContract(meta);
  const entry = bucket?.[code];
  if (!entry || !entry.h) return null;
  const cx = bucket._cx || [];
  const hospitals = Object.entries(entry.h)
    .map(([hIdx, v]) => decodeHospital(C, v, hIdx, cx))
    .filter(Boolean);
  return { desc: entry.d, hospitals, contract: C };
}
