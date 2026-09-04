/**
 * Reading the price shards back.
 *
 * Every downstream stage — statistics, hospital pages, the demo, the validator —
 * used to hard-code "stride 5, price at offset 4". When the shard shape changed,
 * each of them would have gone on producing plausible nonsense. They all read
 * through here instead, and here reads the shape out of meta.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJSON } from './util.mjs';

export function openData(dataDir) {
  const meta = readJSON(path.join(dataDir, 'meta.json'));
  const shard = meta.shard || {
    // A dataset from before the contract was declared: the legacy 5-int rates.
    version: 1, encoding: 'legacy',
    rateFields: ['pa', 'pl', 'se', 'me', 'cents'], xFields: null, chargeFields: null,
  };
  const rateStride = shard.rateFields.length;
  const xStride = shard.xFields ? shard.xFields.length : 0;
  const compact = shard.encoding === 'compact';

  const idx = (fields) => Object.fromEntries(fields.map((f, i) => [f, i]));
  const R = idx(shard.rateFields);
  const X = shard.xFields ? idx(shard.xFields) : {};

  /** One rate group -> a named object, whichever encoding it is in. */
  const readGroup = (a, i, cx) => {
    const g = {};
    if (compact) {
      const c = a[i + R.cx] * 5;
      g.payer = cx[c]; g.plan = cx[c + 1]; g.setting = cx[c + 2];
      g.billingClass = cx[c + 3]; g.methodology = cx[c + 4];
    } else {
      g.payer = a[i + R.pa]; g.plan = a[i + R.pl]; g.setting = a[i + R.se];
      g.billingClass = shard.version >= 2 ? a[i + R.bc] : null;
      g.methodology = a[i + R.me];
    }
    g.cents = a[i + R.cents];
    g.src = R.src == null ? null : a[i + R.src];
    g.n = R.n == null ? 1 : a[i + R.n];
    return g;
  };

  const readX = (a, i, cx) => {
    const g = {};
    if (compact) {
      const c = a[i + X.cx] * 5;
      g.payer = cx[c]; g.plan = cx[c + 1]; g.setting = cx[c + 2];
      g.billingClass = cx[c + 3]; g.methodology = cx[c + 4];
    } else {
      g.payer = a[i + X.pa]; g.plan = a[i + X.pl]; g.setting = a[i + X.se];
      g.billingClass = a[i + X.bc]; g.methodology = a[i + X.me];
    }
    g.src = a[i + X.src];
    g.kind = (shard.priceKinds || [])[a[i + X.pk]] ?? null;
    g.value = a[i + X.v];
    return g;
  };

  /** All of one hospital's published entries for one code. */
  function decode(entry, hIdx, cx) {
    const v = entry.h[hIdx];
    if (!v) return null;
    const rates = [], withheld = [], formula = [];
    for (let i = 0; v.r && i < v.r.length; i += rateStride) rates.push(readGroup(v.r, i, cx));
    for (let i = 0; v.w && i < v.w.length; i += rateStride) withheld.push(readGroup(v.w, i, cx));
    for (let i = 0; v.x && i < v.x.length && xStride; i += xStride) formula.push(readX(v.x, i, cx));
    return {
      hIdx: +hIdx,
      charges: v.ch || [],
      rates, withheld, formula,
      prices: rates.map((r) => r.cents).sort((a, b) => a - b),
    };
  }

  const shardPath = (type, code) =>
    path.join(dataDir, 'codes', type.replace(/[^A-Za-z0-9-]/g, ''),
      (code.slice(0, 3).replace(/[^A-Za-z0-9]/g, '_') || '_') + '.json');

  const bucketCache = new Map();
  function bucket(type, code) {
    const f = shardPath(type, code);
    if (!bucketCache.has(f)) bucketCache.set(f, fs.existsSync(f) ? readJSON(f) : null);
    return bucketCache.get(f);
  }

  /** Everything one code's shard says, decoded. */
  function loadCode(type, code) {
    const b = bucket(type, code);
    const e = b?.[code];
    if (!e) return null;
    const cx = b._cx || [];
    const hospitals = Object.keys(e.h).map((hi) => decode(e, hi, cx)).filter(Boolean);
    return { type, code, desc: e.d, hospitals };
  }

  /** Walk every shard file once — the cheap way to do anything per hospital. */
  function eachCode(cb) {
    const root = path.join(dataDir, 'codes');
    if (!fs.existsSync(root)) return;
    for (const typeDir of fs.readdirSync(root)) {
      for (const f of fs.readdirSync(path.join(root, typeDir))) {
        const b = readJSON(path.join(root, typeDir, f));
        const cx = b._cx || [];
        for (const [code, e] of Object.entries(b)) {
          if (code === '_cx') continue;
          const hospitals = Object.keys(e.h).map((hi) => decode(e, hi, cx)).filter(Boolean);
          cb({ type: typeDir, code, desc: e.d, hospitals, raw: e, cx, file: f });
        }
      }
    }
  }

  return { meta, shard, compact, rateStride, xStride, loadCode, eachCode, decode, bucket, shardPath };
}

/**
 * One hospital's charge picture for a code, per (setting, billing class).
 *
 * There is deliberately no single "the cash price" any more: a hospital that
 * publishes $150 outpatient and $900 inpatient has two cash prices, and the old
 * max() merge reported $900 for both. Callers that need one number take the
 * range and say it is a range.
 */
export function chargeSummary(charges) {
  const cash = charges.map((c) => c.c).filter((v) => v != null);
  const gross = charges.map((c) => c.g).filter((v) => v != null);
  const withheld = charges.some((c) => c.w?.length);
  return {
    combinations: charges.length,
    cashLow: cash.length ? Math.min(...cash) : null,
    cashHigh: cash.length ? Math.max(...cash) : null,
    grossLow: gross.length ? Math.min(...gross) : null,
    grossHigh: gross.length ? Math.max(...gross) : null,
    hasWithheld: withheld,
  };
}

/** Charges restricted to one (setting, billing class) pair, the honest comparison unit. */
export function chargesFor(charges, setting, billingClass) {
  return charges.filter((c) => c.se === setting && c.bc === billingClass);
}
