/**
 * Two shard buckets carrying the same hospital and the same code, in the two
 * shapes the site has to read: the legacy 5-int groups with merged charge
 * scalars, and the v2 contract with a declared stride.
 *
 * Hand-built rather than copied out of a build, so a test can say exactly which
 * distinction it is checking. The field orders match what
 * `pipeline/02_pack.mjs` emits and what `pipeline/CONTRACT.md` documents.
 */

/* ------------------------------------------------------------------ v2 --- */

export const META_V2 = {
  builtAt: '2026-09-04T21:03:00.000Z',
  buildId: '2026-09-04T21:03:00.000Z+abc123',
  releaseId: '2026-09-04T21-02-11Z',
  shard: {
    version: 2,
    encoding: 'full',
    rateFields: ['pa', 'pl', 'se', 'bc', 'me', 'cents', 'src'],
    withheldFields: ['pa', 'pl', 'se', 'bc', 'me', 'cents', 'src'],
    xFields: ['pa', 'pl', 'se', 'bc', 'me', 'src', 'pk', 'v'],
    chargeFields: ['se', 'bc', 'g', 'c', 'mn', 'mx', 'src', 'w'],
    comboFields: null,
    comboKey: null,
    priceKinds: ['percentage', 'algorithm', 'allowed_amount'],
    percentageScale: 100,
  },
  counts: { hospitals: 3, hospitalsWithPrices: 2, codes: 1, priceEntries: 6 },
};

// settings: 0 outpatient, 1 both, 2 inpatient
export const SETTINGS = ['outpatient', 'both', 'inpatient'];
// billing classes: 0 facility, 1 professional
export const BILLING_CLASSES = ['facility', 'professional'];
// methodologies: 0 other, 1 case rate, 2 per diem, 3 fee schedule
export const METHODS = ['other', 'case rate', 'per diem', 'fee schedule'];
export const PAYERS = ['AETNA', 'ANTHEM', 'UHC MEDICARE'];
export const PLANS = ['AETNA PPO', 'ANTHEM HMO', 'UHC MA'];

/**
 * Hospital 0 publishes:
 *   two outpatient facility fee-schedule rates ($1200, $980)   <- the default view
 *   one inpatient facility case rate           ($9000)
 *   one outpatient facility per-diem rate      ($400)          <- shown, not ranked
 *   one professional outpatient fee schedule   ($150)
 * plus a withheld value, a percentage formula, and two charge combinations
 * whose cash prices differ — the case the old max() merge got wrong.
 *
 * Hospital 1 publishes only a formula: it must still appear in the list.
 * Hospital 2 publishes one rate from its SECOND source file, so a reader that
 * reaches for sources[0] labels it with the wrong URL and hash.
 */
export const BUCKET_V2 = {
  45378: {
    d: 'Colonoscopy, flexible, diagnostic',
    h: {
      0: {
        ch: [
          { se: 0, bc: 0, g: 400000, c: 120000, mn: 98000, mx: 300000, src: 0 },
          { se: 2, bc: 0, g: 900000, c: 300000, mn: null, mx: null, src: 0, w: ['mn'] },
        ],
        r: [
          //pa pl se bc me  cents  src
          0, 0, 0, 0, 3, 120000, 0,
          1, 1, 0, 0, 3, 98000, 0,
          0, 0, 2, 0, 1, 900000, 0,
          1, 1, 0, 0, 2, 40000, 0,
          0, 0, 0, 1, 3, 15000, 0,
        ],
        w: [2, 2, 0, 0, 3, 1, 0],
        x: [1, 1, 0, 0, 0, 0, 0, 6200],
      },
      1: {
        ch: [],
        r: [],
        x: [0, 0, 0, 0, 0, 0, 0, 4160],
      },
      2: {
        ch: [{ se: 0, bc: 0, g: 500000, c: 250000, mn: null, mx: null, src: 1 }],
        r: [0, 0, 0, 0, 3, 210000, 1],
      },
    },
  },
};

/* -------------------------------------------------------------- compact --- */

export const META_COMPACT = {
  ...META_V2,
  shard: {
    ...META_V2.shard,
    encoding: 'compact',
    rateFields: ['cx', 'cents', 'src'],
    xFields: ['cx', 'src', 'pk', 'v'],
    comboFields: ['pa', 'pl', 'se', 'bc', 'me'],
    comboKey: '_cx',
  },
};

/** The same hospital-0 entries as BUCKET_V2, through the combination table. */
export const BUCKET_COMPACT = {
  _cx: [
    0, 0, 0, 0, 3,   // 0: AETNA / PPO / outpatient / facility / fee schedule
    1, 1, 0, 0, 3,   // 1: ANTHEM / HMO / outpatient / facility / fee schedule
    0, 0, 2, 0, 1,   // 2: AETNA / PPO / inpatient / facility / case rate
    1, 1, 0, 0, 2,   // 3: ANTHEM / HMO / outpatient / facility / per diem
    0, 0, 0, 1, 3,   // 4: AETNA / PPO / outpatient / professional / fee schedule
    2, 2, 0, 0, 3,   // 5: UHC MEDICARE — the withheld one
  ],
  45378: {
    d: 'Colonoscopy, flexible, diagnostic',
    h: {
      0: {
        ch: [
          { se: 0, bc: 0, g: 400000, c: 120000, mn: 98000, mx: 300000, src: 0 },
          { se: 2, bc: 0, g: 900000, c: 300000, mn: null, mx: null, src: 0, w: ['mn'] },
        ],
        r: [0, 120000, 0, 1, 98000, 0, 2, 900000, 0, 3, 40000, 0, 4, 15000, 0],
        w: [5, 1, 0],
        x: [1, 0, 0, 6200],
      },
    },
  },
};

/* -------------------------------------------------------------- legacy --- */

/** No `shard` key at all — the shape currently in public/data. */
export const META_LEGACY = {
  builtAt: '2026-09-04T21:03:00.000Z',
  state: 'VA',
  counts: { hospitals: 125, hospitalsWithPrices: null, codes: 17810, rates: 7337400 },
};

/** Stride 5: pa, pl, se, me, cents. Charges are four merged scalars. */
export const BUCKET_LEGACY = {
  45378: {
    d: 'Colonoscopy, flexible, diagnostic',
    h: {
      0: {
        r: [
          0, 0, 0, 3, 120000,
          1, 1, 0, 3, 98000,
          0, 0, 2, 1, 900000,
        ],
        g: 900000, c: 300000, mn: 98000, mx: 900000,
      },
    },
  },
};

/** Two source files, so "which file did this price come from" has a real answer. */
export const SOURCES = [
  {
    fileVersionId: 424,
    url: 'https://example.org/hospital-a/standardcharges.csv',
    pageUrl: 'https://example.org/hospital-a/pricing',
    updated: '2026-04-01',
    sha256: '0a366d87363ed195f11e4eeb2d661cd1b2aac36f96b19628f41a426fb9b31a06',
    fetched: '2026-08-30 03:02:43',
  },
  {
    fileVersionId: 425,
    url: 'https://example.org/hospital-a/standardcharges-part2.csv',
    pageUrl: null,
    updated: '2019-01-15',
    sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    fetched: '2026-08-30 03:05:11',
  },
];
