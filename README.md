# What Virginia Hospitals Charge

A price comparison tool built from the machine-readable files Virginia hospitals
are required to publish under federal rule 45 CFR Part 180.

Search a procedure, set how far you are willing to travel, add your insurance,
and see what you would actually pay at each hospital.

**Live site:** https://atalreja777.github.io/virginia-hospital-price-transparency/

---

## What it shows

Every figure below is emitted by the build that produced the dataset and is
recorded in `public/data/meta.json` and `release.json`. The exact numbers change
with each release; what does not change is that each one has a definition, given
under [Building a release](#building-a-release).

| | |
|---|---|
| Virginia hospitals whose published file we could use | `counts.hospitalsWithPrices` |
| Hospitals with a file but no comparable code in it | from `stage_counts.json`, by reason |
| Retained price entries | `counts.priceEntries` |
| Values withheld as below a cent | `counts.withheldEntries` |
| Rates published as a formula, not a dollar | `counts.formulaEntries` |
| Schedulable procedures | `counts.codes` |
| Distinct insurers named | `counts.payers` |

A CT scan of the head costs **$108** at one Virginia hospital and **$2,145** at
another. A comprehensive metabolic panel ranges from **$11** to **$307**. A knee
replacement runs **$12,527** to **$31,497**. Every one of those numbers is
published by the hospitals themselves.

The counts of how far prices vary — how many procedures differ by 2×, 5× or 10×
across hospitals — come from `stats.json` and are recomputed every release. They
are taken over procedures published by at least eight hospitals, **after** drug
and supply codes billed per unit have been removed, and they compare the 10th
with the 90th percentile hospital.

Applying that exclusion where it belongs, rather than counting it in a footnote
afterwards, moves the comparable set from 16,064 procedures to 13,552 and the
"10× or more" count from 1,953 to 1,238. It also removes the single largest
"spread" the site had ever found, a J-code at 189,210,000×, which was two
hospitals pricing different units of the same drug.

The cash-versus-insured share is computed within a matched code, setting and
billing class, over every comparable procedure, and `stats.json` states the
denominator it used.

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
  real. Values are rounded to cents **before** that judgement is made, so a
  published $0.008 is withheld rather than becoming a $0.01 price.
- Hospitals with no usable prices are **listed by name and by reason** — no file
  found, the file we found belongs to a different hospital, nothing parsed, no
  comparable codes published, or codes but no dollar amounts. They are not
  lumped together as non-compliant.
- Distances are straight-line. Real driving is roughly a quarter further, and
  the site says so.

This is an estimate for planning, not a bill or a guarantee of coverage. One
procedure often generates several bills — facility, surgeon, anaesthetist.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
```

110 tests cover the insurance arithmetic, distance and radius logic, search
behaviour, the pipeline itself (against synthetic fixtures in
`tests/fixtures/pipeline/`), and the generated dataset — every shard file, every
index bound, every coordinate.

---

## Building a release

Rebuilding the dataset needs read access to the `hpt` Postgres database that
holds the ingested hospital files. **The pipeline only ever reads from it**, in
a single read-only, repeatable-read transaction.

```bash
npm run release                                # the whole state, validated, then promoted
npm run release -- --hospital 5913,5888        # a named sample
npm run release -- --limit 5 --no-promote      # build and validate, change nothing
```

Everything lands in `pipeline/out/<releaseId>/`:

```
raw/     the CSV export, one file per hospital, plus export_manifest.json
data/    the candidate dataset
logs/    one log per stage
release.json   what this release is: git commit, DB snapshot, per-file digests,
               stage counts, validation result, test result
```

`public/data` is only touched at the very end, and only by two renames: the old
dataset becomes `public/data.prev-<releaseId>`, the validated candidate takes its
place. There is no moment when the site is serving half a build. `npm run data`
still works and now runs this, after saying so.

### The stages

| | |
|---|---|
| `01_export.sh` | Read-only SQL. One repeatable-read snapshot for every file, so prices and provenance describe the same instant. Keeps only the current, parsed version of an active file whose link to the hospital has not been rejected and which is not quarantined. Every statement carries a literal `hospital_id = ANY(ARRAY[…])` so Postgres prunes to those partitions, and one hospital is exported per statement. Fails loudly if the database has no `hospital_mrfs.rejected_at`. |
| `02_pack.mjs` | CSVs → sharded JSON, keeping the grain. Declares the shard shape in `meta.json`. |
| `03_geocode.mjs` | Hospital coordinates, cached in `pipeline/geocache.json`. |
| `04_zips.mjs` | ZIP centroids from the Census gazetteer, or carried forward. |
| `05_stats.mjs` | The statistics the landing and data pages show. |
| `06_payers.mjs` | Payer brands, and what kind of coverage each is. |
| `07_hospital_pages.mjs` | One file per hospital. |
| `08_demo.mjs` | The landing page's live demo. |
| `09_validate.mjs` | Refuses to promote a build that does not add up. |

### The manifest

`pipeline/out/<releaseId>/raw/export_manifest.json` records, for the export: the
Postgres snapshot id, the exact `FROM` clauses used, which optional columns the
database had, and the line count, byte count and SHA-256 of every CSV.

`release.json` records the rest: the git commit and whether the tree was dirty,
the backend migration head, the stage counts, the SHA-256 of every published
file, the test results and every validation check. It is copied into
`public/data/release.json`, so the live site can say which build it is serving.

### What the numbers mean

The old README said "7,596,663 individual published prices" and "76 of 125
hospitals". Neither was defined anywhere, and the first was an artefact: the
packer had already merged prices across settings and billing classes and kept
only the lowest and highest of each group, so the number counted neither the
rows the hospitals published nor the prices the site could show. These are the
counts the pipeline now emits, each with a definition.

**Staged coverage.** Every row of the table below is a real filter, applied in
order, and `stage_counts.json` carries it per hospital as well as in total.

| Stage | Meaning |
|---|---|
| `itemsTotal` | Line items parsed from the hospitals' current files |
| `itemsClean` | …carrying no quality flag |
| `itemsWithShoppableCode` | …carrying a CPT, HCPCS or MS-DRG code a patient can shop for |
| `ratesTotal` | Payer-specific rate rows on those files |
| `ratesClean` | …carrying no quality flag, on a clean item |
| `negotiatedDollarRates` | …stating a dollar amount |
| `percentageOnlyRates` | …stating a percentage of charges and no dollar |
| `allowedAmountRates` | …stating an allowed or estimated amount and no dollar |
| `algorithmOnlyRates` | …stating a formula in words and no dollar |
| `cashOnlyItems` | Items with a cash price and no negotiated dollar anywhere |

**Published counts.**

| Count | Definition |
|---|---|
| **Retained price entries** | Distinct `(payer, plan, setting, billing class, methodology, price, source file)` combinations kept per hospital and code. Exact duplicates of the same seven values collapse; nothing else does. This is what the site can show, and it is smaller than `negotiatedDollarRates` because one price is often published many times over. |
| **Charge entries** | Distinct `(setting, billing class, gross, cash, min, max, source file)` combinations per hospital and code. A hospital with an outpatient and an inpatient cash price has two, not one. |
| **Withheld entries** | Published values that round to a penny or less. Counted, flagged, never shown, never compared. |
| **Formula entries** | Rates published as a percentage, an allowed amount or an algorithm rather than a dollar. Shown as "formula-based", never as $0. |
| **Hospitals with prices** | Hospitals with at least one retained entry — a real count, previously hard-coded to `null`. |
| **Comparable procedures** | Codes published by at least eight hospitals, with per-unit drug and supply codes removed *before* any statistic is computed. |

### A note on scale

A five-hospital Virginia sample (Bon Secours St Marys, Southside, LewisGale
Montgomery, Buchanan General, Encompass Petersburg) produces 11.7 MB of shards
from 1.03 million exported rate rows, which projects to roughly 245 MB statewide
— inside the 400 MB budget the packer enforces. If a build would exceed it, the
packer switches to a compact encoding that keeps every entry but stores the five
identity indexes in a per-file lookup table, and records that choice in
`meta.json`. Readers follow `meta.shard`; they never assume a stride.

## Built with

React, Vite, Tailwind CSS, MapLibre GL with key-less CARTO tiles, and Vitest.
No API keys, so nothing can break because of a billing failure.

## Sources

- Hospital machine-readable files published under [45 CFR Part 180](https://www.cms.gov/hospital-price-transparency)
- [US Census ZCTA gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) for ZIP centroids
- [US Census geocoder](https://geocoding.geo.census.gov/) and OpenStreetMap Nominatim for hospital coordinates
- Quality ratings link out to [Medicare Care Compare](https://www.medicare.gov/care-compare/)
