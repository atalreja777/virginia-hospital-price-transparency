# What Virginia Hospitals Charge

A price comparison tool built from the machine-readable files Virginia hospitals
are required to publish under federal rule 45 CFR Part 180.

Search a procedure, set how far you are willing to travel, add your insurance,
and see what you would actually pay at each hospital.

**Live site:** https://atalreja777.github.io/virginia-hospital-price-transparency/

---

## What it shows

| | |
|---|---|
| Virginia hospitals with usable prices | 73 of 125 in the federal registry |
| Individual published prices | 7,414,620 |
| Schedulable procedures | 17,517 |
| Distinct insurance plan names | 320 |
| Median price spread for the same code | 3.0× |

A CT scan of the head costs **$110** at one Virginia hospital and **$2,145** at
another. A comprehensive metabolic panel ranges from **$11** to **$307**. A knee
replacement runs **$12,527** to **$31,497**. Every one of those numbers is
published by the hospitals themselves.

Across the 15,333 procedures published by at least eight hospitals, **10,623 vary
by 2× or more** and **1,816 vary by 10× or more**.

In **41%** of cases where a hospital published both, its discounted cash price
was *lower* than its median negotiated insured rate.

## How it works

1. **Name the procedure** — by name or CPT code. Emergency and ambulance codes
   are excluded, because nobody shops for an ambulance.
2. **Set a radius** — enter a ZIP and choose how far you will travel.
3. **Add your insurance** — pick your carrier from the names hospitals actually
   published. Hospitals spell insurers many ways; the site groups all spellings
   of each carrier so you see all of its rates.
4. **Enter your benefits** — deductible, coinsurance, copay, out-of-pocket
   maximum. Every field explains what the term means and where to find it.

Nothing you type leaves your browser. There is no account, no server and no
analytics — every price is a static file the browser downloads and filters
locally.

## Honesty about the data

- Ranges shown on the landing and statistics pages run from the **10th to the
  90th percentile hospital**, not from the single cheapest to the single dearest,
  so one mistyped row cannot become a headline.
- **Drug and supply codes are excluded from every comparison.** They are billed
  per unit, so a gap between two hospitals usually reflects a unit of measure
  rather than a price. They remain searchable, never used to make a claim.
- Prices of $0.01, exact zeros, strings of nines and values far outside a file's
  own stated range are flagged during loading and withheld rather than shown as
  real.
- The 52 hospitals with no usable prices are **listed by name**, not quietly
  dropped.
- Distances are straight-line. Real driving is roughly a quarter further, and
  the site says so.

This is an estimate for planning, not a bill or a guarantee of coverage. One
procedure often generates several bills — facility, surgeon, anaesthetist.

## Running it

```bash
npm install
npm run dev
```

Rebuilding the dataset needs read access to the `hpt` Postgres database that
holds the ingested hospital files. **The pipeline only ever reads from it.**

```bash
npm run data:export   # read-only SQL export to pipeline/raw/*.csv
npm run data:pack     # CSV -> sharded JSON in public/data/
npm run data:geo      # add hospital coordinates
node pipeline/04_zips.mjs
node pipeline/05_stats.mjs
node pipeline/06_payers.mjs
node pipeline/07_hospital_pages.mjs
node pipeline/08_demo.mjs
```

```bash
npm test
```

72 tests cover the insurance arithmetic, distance and radius logic, search
behaviour, and the generated dataset itself — every shard file, every index
bound, every coordinate.

## Built with

React, Vite, Tailwind CSS, MapLibre GL with key-less CARTO tiles, and Vitest.
No API keys, so nothing can break because of a billing failure.

## Sources

- Hospital machine-readable files published under [45 CFR Part 180](https://www.cms.gov/hospital-price-transparency)
- [US Census ZCTA gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) for ZIP centroids
- [US Census geocoder](https://geocoding.geo.census.gov/) and OpenStreetMap Nominatim for hospital coordinates
- Quality ratings link out to [Medicare Care Compare](https://www.medicare.gov/care-compare/)
