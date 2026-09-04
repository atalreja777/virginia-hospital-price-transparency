# The data contract

What the pipeline writes into `public/data`, and exactly what `src/lib/data.js`
and the components that use it have to change.

Nothing in `src/` has been touched by the pipeline rewrite. Until the changes
below are made, the site reads the old shape; the new shards will not render
correctly under the old reader, because the stride of the rate array changed and
charges moved.

---

## 1. Why the shape changed

The old shards threw away distinctions the published files actually make, and
the site then showed a number that did not exist in any file:

| Old behaviour | What it hid |
|---|---|
| Charges merged across settings and billing classes with `max()` | A hospital publishing $150 outpatient and $900 inpatient showed **$900** for both |
| Rates keyed `payer\|plan\|setting`, keeping only the lowest and highest of each group | Every price between them vanished; the methodology of the first row was stamped on both |
| No methodology or billing class in the key | "Case rate $12,000" and "fee schedule $840" collapsed into one group |
| Code index built from rate rows only | A code with only a cash price did not exist on the site |
| Percentage- and algorithm-based rates dropped | A payer that published "62% of charges" looked like a payer that published nothing |
| No link from a price to the file it came from | A disputed number could not be traced to a URL and a digest |
| Values rounded to cents *before* the quality rules ran | Eight rows of $0.003–$0.009 became **$0.01** prices on a site whose methodology says they are withheld |

Every one of those is now representable, and `meta.json` declares the shape so a
reader never hard-codes a stride again.

---

## 2. `meta.json` — read this first

```jsonc
{
  "builtAt": "2026-09-04T21:03:00.000Z",
  "buildId": "2026-09-04T21:03:00.000Z+9cc21dd8f0a1",
  "releaseId": "2026-09-04T21-02-11Z",
  "gitCommit": "9cc21dd…",
  "shard": {
    "version": 2,
    "encoding": "full",                  // or "compact"
    "rateFields":  ["pa","pl","se","bc","me","cents","src"],
    "withheldFields": ["pa","pl","se","bc","me","cents","src"],
    "xFields":     ["pa","pl","se","bc","me","src","pk","v"],
    "chargeFields":["se","bc","g","c","mn","mx","src","w"],
    "comboFields": null,                 // ["pa","pl","se","bc","me"] when compact
    "comboKey":    null,                 // "_cx" when compact
    "priceKinds":  ["percentage","algorithm","allowed_amount"],
    "percentageScale": 100
  },
  "counts": { "hospitalsWithPrices": 4, "codes": 13839, "priceEntries": 239901,
              "withheldEntries": 9, "formulaEntries": 8909, "chargeEntries": 56695, … },
  "stages": { "itemsTotal": …, "ratesTotal": …, "negotiatedDollarRates": …, … },
  "audit":  { … why rows were excluded … },
  "export": { "snapshot": "…", "capabilities": {…}, "files": {…} }
}
```

**`meta.counts.hospitalsWithPrices` is now a real number.** It used to be
`new Set(searchRows.flatMap(() => [])).size || null` — always `null` — so the
site could never state it.

**Take the stride from `meta.shard.rateFields.length`.** Do not hard-code 5 or 7.

---

## 3. Shard files: `codes/<TYPE>/<PREFIX>.json`

### Before

```jsonc
{ "45378": { "d": "Colonoscopy…",
             "h": { "12": { "r": [3,0,1,4,120000, …],   // stride 5: pa,pl,se,me,cents
                            "g": 400000, "c": 120000, "mn": 90000, "mx": 300000 } } } }
```

### After

```jsonc
{
  "45378": {
    "d": "Colonoscopy, flexible, diagnostic",
    "h": {
      "12": {
        "ch": [                                   // one per (setting, billing class), all of them
          { "se": 0, "bc": 0, "g": 400000, "c": 120000, "mn": 90000, "mx": 300000, "src": 0 },
          { "se": 1, "bc": 0, "g": 900000, "c": 300000, "mn": null,  "mx": null,   "src": 0,
            "w": ["mn"] }                         // "mn" was published but rounds to <= 1c: withheld
        ],
        "r": [3,0,1,0,4,120000,0,  3,0,1,0,2,98000,0],   // stride 7
        "w": [1,0,0,0,4,1,0],                             // same stride: withheld, never a price
        "x": [2,0,0,0,3,0,0,4250]                         // stride 8: formula-based
      }
    }
  }
}
```

Field meanings, all integers unless noted:

| Key | Meaning |
|---|---|
| `pa` | index into `payers.json` (the exact published payer string) |
| `pl` | index into `plans.json` |
| `se` | index into `settings.json` |
| `bc` | index into `billing_classes.json` — **new file** |
| `me` | index into `methodologies.json` (now case-folded: one "case rate", not two) |
| `cents` | the negotiated dollar amount, in whole cents, always > 1 |
| `src` | index into `hospitals.json[hIdx].sources[]` — which file this price came from |
| `pk` | index into `meta.shard.priceKinds` for `x` entries |
| `v` | percentage × `percentageScale` (basis points), or an allowed amount in cents, or 0 for an algorithm |

`ch` entries are objects, not packed ints, because there are few of them and
they carry an optional `w` array naming any field that was withheld.

**Compact encoding.** If a build would exceed the size budget, `meta.shard.encoding`
is `"compact"`: the bucket gains a top-level `_cx` array of `[pa,pl,se,bc,me]`
fives, and rate entries become `[cx, cents, src]` (stride 3), `x` becomes
`[cx, src, pk, v]`. Read `_cx` out of the bucket, skip that key when iterating
codes. The Virginia build measured 245 MB projected in `full`, so `full` is what
ships today — but a reader that follows `meta.shard` handles both for free.

---

## 4. Exactly what to change in `src/lib/data.js`

### 4.1 `loadCode` — the only structural change

**Before**

```js
const hospitals = Object.entries(entry.h).map(([hIdx, v]) => {
  const rates = [];
  for (let i = 0; i < v.r.length; i += 5) {
    rates.push({ payer: v.r[i], plan: v.r[i+1], setting: v.r[i+2], method: v.r[i+3], price: v.r[i+4] });
  }
  rates.sort((a, b) => a.price - b.price);
  const prices = rates.map((r) => r.price);
  return { hIdx: +hIdx, gross: v.g, cash: v.c, minNegotiated: v.mn, maxNegotiated: v.mx,
           rates, prices, low: …, median: …, high: … };
});
```

**After** — `meta.json` must be loaded before any shard, and the stride comes
from it:

```js
export async function loadCode(type, code) {
  const meta = await loadMeta();
  const S = meta.shard;
  const stride = S.rateFields.length;
  const xStride = S.xFields.length;
  const F = Object.fromEntries(S.rateFields.map((f, i) => [f, i]));
  const X = Object.fromEntries(S.xFields.map((f, i) => [f, i]));

  const bucket = await once(file, () => getJSON(file));
  const cx = bucket?._cx || null;                       // compact encoding only
  const entry = bucket?.[code];
  if (!entry) return null;

  const ident = (a, i) => (cx
    ? { payer: cx[a[i + F.cx] * 5],     plan: cx[a[i + F.cx] * 5 + 1],
        setting: cx[a[i + F.cx] * 5 + 2], billingClass: cx[a[i + F.cx] * 5 + 3],
        method: cx[a[i + F.cx] * 5 + 4] }
    : { payer: a[i + F.pa], plan: a[i + F.pl], setting: a[i + F.se],
        billingClass: a[i + F.bc], method: a[i + F.me] });

  const hospitals = Object.entries(entry.h).map(([hIdx, v]) => {
    const rates = [];
    for (let i = 0; v.r && i < v.r.length; i += stride) {
      rates.push({ ...ident(v.r, i), price: v.r[i + F.cents], src: v.r[i + F.src] });
    }
    rates.sort((a, b) => a.price - b.price);
    const prices = rates.map((r) => r.price);

    const withheld = [];                                 // shown as "withheld", never as a price
    for (let i = 0; v.w && i < v.w.length; i += stride) {
      withheld.push({ ...ident(v.w, i), src: v.w[i + F.src] });
    }
    const formula = [];                                  // "formula-based; dollar unavailable"
    for (let i = 0; v.x && i < v.x.length; i += xStride) {
      formula.push({ ...ident(v.x, i), src: v.x[i + X.src],
                     kind: meta.shard.priceKinds[v.x[i + X.pk]], value: v.x[i + X.v] });
    }

    return {
      hIdx: +hIdx,
      charges: v.ch || [],        // REPLACES gross / cash / minNegotiated / maxNegotiated
      rates, prices, withheld, formula,
      low: prices[0] ?? null,
      median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
      high: prices[prices.length - 1] ?? null,
    };
  });
  return { type, code, desc: entry.d, hospitals };
}
```

A reference implementation of exactly this decoding already exists and is under
test: **`pipeline/lib/shards.mjs`** (`openData().loadCode`, plus `chargeSummary`
and `chargesFor`). Port it rather than re-deriving it.

### 4.2 New loaders

```js
export const loadBillingClasses = () => once('bc',   () => getJSON('billing_classes.json'));
export const loadPayerSegments  = () => once('pseg', () => getJSON('payer_segments.json'));
export const loadStageCounts    = () => once('stage',() => getJSON('stage_counts.json'));
export const loadRelease        = () => once('rel',  () => getJSON('release.json'));
```

### 4.3 `search.json`

The fifth field is renamed `rates` → `entries`, and it now counts **retained
distinct price entries** rather than post-collapse rows. Positional readers keep
working; anything printing the word "rates" as a label should say "published
price entries".

---

## 5. What components must change

| Component need | Old | New |
|---|---|---|
| "the hospital's cash price" | `h.cash` | `h.charges` is a list. Pick the entry matching the setting and billing class being shown, or show the range (`chargeSummary`). There is no single cash price, and there never was. |
| gross charge | `h.gross` | same as above (`charges[].g`) |
| min/max negotiated from the file | `h.mn` / `h.mx` | `charges[].mn` / `charges[].mx` |
| rate row | `{payer, plan, setting, method, price}` | adds `billingClass` and `src` |
| price provenance | none | `hospitals[hIdx].sources[rate.src]` → `{url, pageUrl, sha256 (full 64 hex), updated, fetched, fileVersionId}` |
| payer filtering | brand only | `payer_segments.json` gives `segment` (`medicare`, `medicare_advantage`, `medicaid`, `exchange`, `commercial`, `other`) and a `confidence`. Offer "commercial only" so Medicare Advantage rates stop being mixed into a commercial comparison. |
| "no prices" list | a bare list of names | `stage_counts.json[].outcome` says which of: no file found, file links rejected as another hospital's, nothing parsed, **no comparable codes published (local or revenue codes only)**, comparable codes but no dollar amounts. Seven psychiatric facilities are in the fourth category, not the first. |
| withheld values | invisible (or shown as $0.01) | `h.withheld` — render as "published as $0.00–0.01; withheld", never as a price |
| formula-based rates | invisible | `h.formula` — "62% of charges — dollar amount not published" |

### Suggested wording for the new states

- Withheld: *"This hospital published a value below one cent for this code. It is not a usable price, so it is not shown."*
- Formula-based: *"This payer's rate is set as a formula (62% of charges), not a dollar amount, so no price can be shown."*
- Multiple charges: *"$150 outpatient · $900 inpatient"* rather than one number.

---

## 6. Files in `public/data` after a release

| File | Status |
|---|---|
| `meta.json` | changed — now carries `shard`, real counts, stages, audit, export manifest |
| `hospitals.json` | changed — `sources[]` carries the full sha256, `fileVersionId`, `mrfId` |
| `search.json` | field 5 renamed `rates` → `entries` |
| `codes/**` | changed — see above |
| `billing_classes.json` | **new** |
| `payer_segments.json` | **new** |
| `stage_counts.json` | **new** |
| `release.json` | **new** — git commit, DB snapshot, per-file digests, test results |
| `validation.json` | **new** — every check the build had to pass |
| `payers.json`, `plans.json`, `settings.json`, `methodologies.json` | unchanged in shape (methodologies now case-folded) |
| `payer_groups.json` | adds `segment` / `segments` per group |
| `stats.json` | adds `audit`, `spread.method`, `cash.method`, `cash.denominator`; `totals.prices` → `totals.priceEntries` |
| `hospital/<CCN>.json` | `stats.rates` → `stats.priceEntries`, adds `withheldEntries`, `formulaEntries`, `chargeEntries`, `settings`, `billingClasses`, `sourceFiles`; basket entries carry `cashLow`/`cashHigh` instead of `cash` |
| `hospital_index.json` | `rates` → `priceEntries` |
| `demo.json` | rows carry `cashLow`/`cashHigh` instead of `cash` |
| `zips.json` | unchanged |
