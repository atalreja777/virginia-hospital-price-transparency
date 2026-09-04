/**
 * Data access. Everything is a static JSON file fetched from the same origin —
 * there is no API, no key, and nothing to rate-limit. The price shards are
 * bucketed by code prefix so a search downloads tens of kilobytes, not the
 * whole hundred-megabyte dataset.
 */

import { decodeBucket } from './shards.js';

const BASE = import.meta.env.BASE_URL || '/';

// The build id from meta.json, once known, rides along on later requests as a
// query string. It changes nothing about what a URL means — the server still
// answers the same file either way — so caching is unaffected; it only gives
// a shard fetched moments after a new deploy a distinct URL from the one a
// stale tab already cached, and gives a genuine version mismatch (this tab's
// index.html references data a later deploy has since removed) a signal to
// detect rather than a silent wrong answer.
let buildId = null;
const url = (p) => {
  const base = `${BASE}data/${p}`.replace(/([^:])\/{2,}/g, '$1/');
  return buildId ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(buildId)}` : base;
};

const memo = new Map();
/** Fetch a JSON file once and keep it. Concurrent callers share one request. */
function once(key, loader) {
  if (!memo.has(key)) {
    memo.set(key, loader().catch((e) => { memo.delete(key); throw e; }));
  }
  return memo.get(key);
}
async function getJSON(p, signal) {
  let r;
  try {
    r = await fetch(url(p), signal ? { signal } : undefined);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    const err = new Error(`Could not reach the server for ${p}: ${e.message}`);
    err.cause = e;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Could not load ${p} (${r.status})`);
    err.status = r.status;
    throw err;
  }
  try {
    return await r.json();
  } catch (e) {
    const err = new Error(`${p} did not parse as JSON`);
    err.cause = e;
    throw err;
  }
}

export const loadMeta = () => once('meta', () => getJSON('meta.json').then((m) => {
  buildId = m?.buildId ?? m?.builtAt ?? buildId;
  return m;
}));
export const loadHospitals  = () => once('hosp',    () => getJSON('hospitals.json'));
export const loadPayers     = () => once('payers',  () => getJSON('payers.json'));
export const loadPlans      = () => once('plans',   () => getJSON('plans.json'));
export const loadSettings   = () => once('sett',    () => getJSON('settings.json'));
export const loadMethods    = () => once('meth',    () => getJSON('methodologies.json'));
export const loadZips       = () => once('zips',    () => getJSON('zips.json'));
export const loadPayerGroups= () => once('pgroups', () => getJSON('payer_groups.json'));

/**
 * Files the rewritten pipeline added. Every one of them is optional: a dataset
 * built before the contract existed simply does not have them, and the site
 * has to deploy in either order. A missing file is `null` — a real answer —
 * while a network failure still throws, because those are not the same fact.
 *
 * "Missing" is not always a 404. This site is served as static files with a
 * single-page fallback: GitHub Pages, and `vite preview`, answer a request for
 * a file that is not there with **200 and index.html**. A loader that only
 * recognised 404 therefore got a body of HTML, threw a parse error, and took
 * the whole page down with it — precisely when the new UI is deployed ahead of
 * the new data, which is the case this fallback exists to survive.
 *
 * So an optional file is absent if the server says 404 *or* answers with
 * something that is not JSON. A body that claims to be JSON and does not parse
 * is still an error: that is corruption, not absence.
 */
async function getOptionalJSON(p, signal) {
  let r;
  try {
    r = await fetch(url(p), signal ? { signal } : undefined);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    const err = new Error(`Could not reach the server for ${p}: ${e.message}`);
    err.cause = e;
    throw err;
  }
  if (r.status === 404) return null;
  if (!r.ok) {
    const err = new Error(`Could not load ${p} (${r.status})`);
    err.status = r.status;
    throw err;
  }
  const type = r.headers?.get?.('content-type') || '';
  const body = await r.text();
  // The single-page fallback, served in place of a file that is not there.
  if (/\bhtml\b/i.test(type) || /^\s*<(!doctype|html)/i.test(body)) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    const err = new Error(`${p} did not parse as JSON`);
    err.cause = e;
    throw err;
  }
}

const optional = (key, file) => once(key, () => getOptionalJSON(file));
export const loadBillingClasses = () => optional('bc',    'billing_classes.json');
export const loadPayerSegments  = () => optional('pseg',  'payer_segments.json');
export const loadStageCounts    = () => optional('stage', 'stage_counts.json');
export const loadRelease        = () => optional('rel',   'release.json');

/**
 * Re-check meta.json (bypassing the in-memory cache) and report whether the
 * build id has moved on since this tab loaded — the signal that a deploy
 * happened underneath an open tab and it is time to suggest a reload.
 */
export async function hasNewBuild() {
  const seenAt = buildId;
  try {
    const m = await getJSON(`meta.json?t=${Date.now()}`);
    const latest = m?.buildId ?? m?.builtAt ?? null;
    return !!(seenAt && latest && latest !== seenAt);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- search -- */

const STOP = new Set(['the','and','with','without','of','for','or','a','an','to','in','on','by','per','hc','w','wo']);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

/**
 * The search index: 17k codes with their description, hospital coverage and
 * price percentiles. Built into a token map on first use so typing is instant.
 */
export const loadSearch = () => once('search', async () => {
  const raw = await getJSON('search.json');
  // Field 5 is `entries` under the new contract and `rates` under the old one.
  // It is positional either way; only the label changed, and what it counts —
  // retained distinct price entries rather than post-collapse rows.
  const rows = raw.r.map(([type, code, desc, hospitals, entries, p10, p50, p90]) => ({
    type, code, desc, hospitals, entries, rates: entries, p10, p50, p90,
  }));

  const byToken = new Map();
  const byCode = new Map();
  rows.forEach((row, i) => {
    byCode.set(`${row.type}|${row.code}`, row);
    const seen = new Set();
    for (const t of tokens(row.desc)) {
      if (seen.has(t)) continue;
      seen.add(t);
      let a = byToken.get(t);
      if (!a) byToken.set(t, a = []);
      a.push(i);
      // prefixes, so "colon" finds "colonoscopy" without a fuzzy pass
      for (let n = 3; n < Math.min(t.length, 9); n++) {
        const p = t.slice(0, n);
        let b = byToken.get(p);
        if (!b) byToken.set(p, b = []);
        if (b[b.length - 1] !== i) b.push(i);
      }
    }
  });
  return { rows, byToken, byCode };
});

/** Is this string a billing code the user typed directly? */
export const looksLikeCode = (q) => /^[A-Za-z]?\d{2,5}$/.test(q.trim());

const CODE_TYPES = { CPT: 'CPT', HCPCS: 'HCPCS', 'MS-DRG': 'MS-DRG', DRG: 'MS-DRG' };

/**
 * "CPT 70551", "CPT:70551", "HCPCS J1885", "MS-DRG 470", "DRG 470" — a code
 * typed with its type prefix, so the search can go straight to that exact
 * code instead of falling through to a fuzzy word match on "cpt" and "470".
 */
export function parseCodeQuery(q) {
  const m = String(q || '').trim().match(/^(CPT|HCPCS|MS-DRG|DRG)\s*[:\-]?\s*([A-Za-z0-9]{1,8})$/i);
  if (!m) return null;
  const type = CODE_TYPES[m[1].toUpperCase()];
  if (!type) return null;
  return { type, code: m[2].toUpperCase() };
}



/**
 * What people type, mapped straight to the code they mean.
 *
 * General relevance ranking cannot reliably tell "total knee replacement" from
 * "revision of knee replacement" — both contain every word typed, and the
 * revision code is published by more hospitals. For the queries people actually
 * make, a curated answer beats a clever score. Everything not listed here still
 * goes through the normal index.
 */
const ALIASES = [
  [/\brevision\b.*\bknee\b|\bknee\b.*\brevision\b/,                          [['MS-DRG','466'],['MS-DRG','467'],['MS-DRG','468'],['CPT','27486'],['CPT','27487']]],
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?(head|brain)\b|^ct\s*head/, [['CPT','70450'],['CPT','70460']]],
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?(abdomen|belly|stomach)/,     [['CPT','74177'],['CPT','74176']]],
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?chest/,                        [['CPT','71260'],['CPT','71250']]],
  [/^(ct|cat)(\s*scan)?$/,                                                    [['CPT','70450'],['CPT','74177'],['CPT','71250']]],
  [/\bmri\b.*(back|spine|lumbar)|^(back|lumbar)\s*mri/,                     [['CPT','72148'],['CPT','72158']]],
  [/\bmri\b.*(knee|leg)/,                                                    [['CPT','73721'],['CPT','73718']]],
  [/\bmri\b.*(brain|head)/,                                                  [['CPT','70551'],['CPT','70552'],['CPT','70553']]],
  [/^mri$/,                                                                    [['CPT','72148'],['CPT','73721'],['CPT','70551']]],
  [/\b(knee\s*replacement|total\s*knee)\b/,                                [['CPT','27447'],['MS-DRG','470']]],
  [/\b(hip\s*replacement|total\s*hip)\b/,                                  [['CPT','27130'],['MS-DRG','470']]],
  [/\bshoulder\s*replacement\b/,                                            [['CPT','23472']]],
  [/\b(knee\s*(arthroscopy|scope)|meniscus)\b/,                             [['CPT','29880'],['CPT','29881'],['CPT','29882'],['CPT','29883']]],
  [/\bcataract\b/,                                                           [['CPT','66984'],['CPT','66982']]],
  [/\bcolonoscopy\b/,                                                        [['CPT','45378'],['CPT','45380'],['CPT','45385']]],
  [/\b(upper\s*endoscopy|egd)\b/,                                           [['CPT','43239'],['CPT','43235']]],
  [/\bgall\s*bladder\b|\bcholecystectomy\b/,                              [['CPT','47562'],['CPT','47563']]],
  [/\bhernia\b/,                                                             [['CPT','49505']]],
  [/\bappendix\b|\bappendectomy\b/,                                        [['CPT','44970']]],
  [/\bhysterectomy\b/,                                                       [['CPT','58150'],['CPT','58571']]],
  [/\btonsil/,                                                                [['CPT','42820'],['CPT','42826']]],
  [/\b(childbirth|give\s*birth|vaginal\s*(delivery|birth)|have\s*a\s*baby)\b/, [['CPT','59400'],['MS-DRG','807']]],
  [/\b(c\s*section|cesarean|caesarean)\b/,                                  [['CPT','59510'],['MS-DRG','788']]],
  [/\bmammogram\b|\bmammograph/,                                            [['CPT','77067'],['CPT','77065'],['CPT','77066']]],
  [/\b(x\s*-?\s*ray)\b.*chest|^chest\s*x/,                                [['CPT','71046'],['CPT','71045']]],
  [/\b(ekg|ecg|electrocardiogram)\b/,                                        [['CPT','93000'],['CPT','93005']]],
  [/\b(echo|echocardiogram)\b/,                                              [['CPT','93306'],['CPT','93307']]],
  [/\b(ultrasound|sonogram)\b.*(abdomen|belly)|^abdominal\s*ultrasound/,    [['CPT','76700'],['CPT','76705']]],
  [/\b(blood\s*(test|work|panel)|metabolic\s*panel|cmp)\b/,                [['CPT','80053'],['CPT','80048']]],
  [/\b(cbc|complete\s*blood\s*count)\b/,                                   [['CPT','85025'],['CPT','85027']]],
  [/\b(cholesterol|lipid\s*panel)\b/,                                       [['CPT','80061']]],
  [/\b(a1c|hemoglobin\s*a1c|diabetes\s*test)\b/,                           [['CPT','83036']]],
  [/\b(urinalysis|urine\s*test)\b/,                                         [['CPT','81002'],['CPT','81003']]],
  [/\bthyroid\b/,                                                            [['CPT','84443']]],
  [/\b(sleep\s*study|polysomnograph)/,                                       [['CPT','95810'],['CPT','95811']]],
  [/\b(stress\s*test|treadmill)\b/,                                         [['CPT','93015'],['CPT','93017']]],
  [/\b(back\s*injection|epidural\s*(injection|steroid)|spinal\s*injection)\b/, [['CPT','64483'],['CPT','64493']]],
  [/\b(prostate\s*biopsy)\b/,                                               [['CPT','55700']]],
  [/\b(breast\s*(lump|biopsy))\b/,                                          [['CPT','19120'],['CPT','19083']]],
  [/\b(pneumonia)\b/,                                                        [['MS-DRG','193'],['MS-DRG','194']]],
  [/\b(heart\s*failure)\b/,                                                 [['MS-DRG','291'],['MS-DRG','292']]],
  [/\b(bone\s*density|dexa)\b/,                                             [['CPT','77080']]],
  [/\b(vasectomy)\b/,                                                        [['CPT','55250']]],
  [/\b(carpal\s*tunnel)\b/,                                                 [['CPT','64721']]],
  // LASIK is deliberately not mapped to anything. It is not billed through
  // hospital machine-readable files, and pointing it at cataract surgery — a
  // different procedure that happens to also be eye surgery — would be a
  // confident-looking wrong answer, which is worse than no answer.
];

/**
 * Query attributes that split one clinical concept into two different codes.
 * A plain token match cannot tell "MRI brain with contrast" from "without" —
 * both queries contain "mri" and "brain" — so each pair here rewards a
 * description that agrees with what was typed and penalises one that
 * contradicts it.
 */
const ATTRIBUTE_PAIRS = [
  { yes: (t) => t.has('with'), no: (t) => t.has('without') || t.has('wo') || t.has('w/o'),
    descYes: /\bwith contrast\b/i, descNo: /\bwithout contrast\b/i },
  { yes: (t) => t.has('screening'), no: (t) => t.has('diagnostic'),
    descYes: /\bscreening\b/i, descNo: /\bdiagnostic\b/i },
  { yes: (t) => t.has('revision'), no: (t) => t.has('primary') || t.has('initial'),
    descYes: /\brevision\b/i, descNo: /\brevision\b/i, negateNo: true },
  { yes: (t) => t.has('repair'), no: (t) => t.has('removal') || t.has('excision'),
    descYes: /\brepair\b/i, descNo: /\bremoval\b|ectomy\b|\bexcision\b/i },
  { yes: (t) => t.has('bilateral'), no: (t) => t.has('unilateral'),
    descYes: /\bbilateral\b/i, descNo: /\bunilateral\b/i },
];

/**
 * Score how well one procedure's description agrees with the with/without,
 * screening/diagnostic-style attributes present in the raw (unfiltered)
 * query tokens. Large relative to the +1-per-rank spacing used for curated
 * alias order, so it can actually reorder a curated list; small relative to
 * the score gap between an alias hit and a generic search hit, so it never
 * promotes an unrelated procedure.
 */
function attributeScore(rawTokenSet, desc) {
  let s = 0;
  for (const a of ATTRIBUTE_PAIRS) {
    const wantYes = a.yes(rawTokenSet);
    const wantNo = a.no(rawTokenSet);
    if (wantYes === wantNo) continue; // no signal, or a contradictory query
    if (a.negateNo) {
      // "no" side means the description must NOT carry the marker (e.g. a
      // "primary" query wants a description with no mention of "revision").
      if (wantYes) s += a.descYes.test(desc) ? 900 : -900;
      else s += a.descYes.test(desc) ? -900 : 300;
      continue;
    }
    if (wantYes) { if (a.descYes.test(desc)) s += 900; if (a.descNo.test(desc)) s -= 900; }
    else { if (a.descNo.test(desc)) s += 900; if (a.descYes.test(desc)) s -= 900; }
  }
  return s;
}

/** Codes a curated alias points at, in order, for this query. */
function aliasHits(index, q) {
  const nq = q.toLowerCase().trim();
  const out = [];
  for (const [re, codes] of ALIASES) {
    if (!re.test(nq)) continue;
    for (const [type, code] of codes) {
      const row = index.byCode.get(`${type}|${code}`);
      if (row) out.push(row);
    }
  }
  return out;
}

/**
 * Patients type "MRI"; hospitals write "Magnetic resonance (eg, proton) imaging".
 * Patients type "knee replacement"; hospitals write "Arthroplasty, knee, condyle
 * and plateau". Without this bridge the search looks broken to the people it is for.
 *
 * Each entry maps a word people use to the words the billing description uses.
 * Both are searched, so nothing is lost.
 */
const SYNONYMS = {
  mri: ['magnetic', 'resonance'],
  mra: ['magnetic', 'resonance', 'angiography'],
  ct: ['computed'],
  cat: ['computed'],
  catscan: ['computed'],
  pet: ['positron'],
  xray: ['radiologic', 'radiography', 'ray'],
  ekg: ['electrocardiogram'],
  ecg: ['electrocardiogram'],
  eeg: ['electroencephalogram'],
  echo: ['echocardiography', 'echocardiogram'],
  ultrasound: ['ultrasound', 'echography', 'sonography'],
  sonogram: ['ultrasound', 'echography'],
  mammogram: ['mammography'],
  dexa: ['absorptiometry', 'bone', 'density'],
  scope: ['endoscopy', 'scopy'],

  replacement: ['arthroplasty', 'prosthesis', 'replacement'],
  scan: ['imaging', 'scan'],
  removal: ['excision', 'removal', 'resection'],
  repair: ['repair', 'reconstruction'],
  biopsy: ['biopsy'],

  childbirth: ['obstetric', 'delivery'],
  birth: ['obstetric', 'delivery'],
  csection: ['cesarean'],
  cesarean: ['cesarean'],
  pregnancy: ['obstetric', 'antepartum'],

  bloodtest: ['blood', 'panel', 'assay'],
  bloodwork: ['blood', 'panel', 'assay'],
  labs: ['panel', 'assay', 'blood'],
  cholesterol: ['lipid', 'cholesterol'],
  a1c: ['hemoglobin', 'glycosylated'],
  thyroid: ['thyroid', 'tsh'],

  colonoscopy: ['colonoscopy'],
  endoscopy: ['endoscopy', 'esophagogastroduodenoscopy'],
  gallbladder: ['cholecystectomy', 'gallbladder'],
  appendix: ['appendectomy'],
  hernia: ['hernia', 'herniorrhaphy'],
  hysterectomy: ['hysterectomy'],
  tonsils: ['tonsillectomy'],
  cataract: ['cataract'],
  stent: ['stent'],
  bypass: ['bypass'],
  pacemaker: ['pacemaker', 'pacing'],
  dialysis: ['dialysis', 'hemodialysis'],
  chemo: ['chemotherapy'],
  chemotherapy: ['chemotherapy'],
  radiation: ['radiation', 'radiotherapy'],
  physicaltherapy: ['therapeutic', 'therapy'],
  sleepstudy: ['polysomnography', 'sleep'],
  stresstest: ['stress', 'exercise'],

  knee: ['knee'],
  hip: ['hip'],
  shoulder: ['shoulder'],
  back: ['spinal', 'spine', 'lumbar'],
  spine: ['spinal', 'spine', 'lumbar', 'cervical'],
  heart: ['cardiac', 'cardiovascular', 'heart'],
  brain: ['brain', 'cranial', 'head'],
  lung: ['pulmonary', 'lung', 'chest'],
  kidney: ['renal', 'kidney'],
  liver: ['hepatic', 'liver'],
  stomach: ['gastric', 'stomach', 'abdomen'],
  belly: ['abdominal', 'abdomen'],
  breast: ['breast', 'mammary'],
  prostate: ['prostate'],
  eye: ['ocular', 'eye', 'ophthalm'],
  ear: ['otic', 'ear', 'tympan'],
  teeth: ['dental', 'tooth'],
  tooth: ['dental', 'tooth'],
  skin: ['skin', 'cutaneous', 'lesion'],
};

/** Expand a typed query into the clinical words the files actually use. */
function expand(qs) {
  const out = new Set(qs);
  const joined = qs.join('');
  for (const t of [...qs, joined]) {
    for (const s of SYNONYMS[t] || []) out.add(s);
  }
  return [...out];
}

/**
 * Rank procedures for a typed query.
 * Codes typed directly win outright; otherwise rank by how many query terms
 * match, then by how many hospitals publish a price (coverage = usefulness).
 */
// Below this, a token-matched (non-alias, non-code) result is noise rather
// than a confident answer — the UI shows "no confident match" instead of
// rows that merely share one common word with the query.
const MIN_RELEVANCE = 70;

export function searchProcedures(index, query, limit = 40) {
  if (!index) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  const out = [];
  // `floor` marks entries that are always trusted regardless of MIN_RELEVANCE
  // — a curated alias or an exact/prefix code match already is the confident
  // answer, not a candidate for the relevance cutoff.
  const push = (row, boost, trusted = false) => out.push({ row, score: boost, trusted });

  const rawTokens = new Set(norm(q).split(' ').filter(Boolean));
  const rawTokenSet = { has: (w) => rawTokens.has(w) };

  // A code typed with its type prefix — "CPT 70551", "HCPCS J1885",
  // "MS-DRG 470" — resolves straight to that exact code.
  const typedCode = parseCodeQuery(q);
  if (typedCode) {
    const hit = index.byCode.get(`${typedCode.type}|${typedCode.code}`);
    if (hit) push(hit, 3e9, true);
  }

  // Curated answers next, in the order the alias lists them, adjusted for
  // any with/without-style attribute the query asked for.
  aliasHits(index, q).forEach((row, i) => push(row, 5e8 - i + attributeScore(rawTokenSet, row.desc), true));

  // direct code hit
  if (looksLikeCode(q)) {
    const up = q.toUpperCase();
    for (const t of ['CPT', 'HCPCS', 'MS-DRG']) {
      const hit = index.byCode.get(`${t}|${up}`);
      if (hit) push(hit, 1e9 + hit.hospitals, true);
    }
    // partial code prefix
    if (out.length < 8) {
      for (const row of index.rows) {
        if (row.code.startsWith(up) && row.code !== up) {
          push(row, 1e6 + row.hospitals, true);
          if (out.length > 30) break;
        }
      }
    }
  }

  const typed = tokens(q);
  const expanded = expand(typed).filter((t) => !typed.includes(t));
  if (typed.length) {
    const hits = new Map();
    // What the user actually typed counts for more than what we inferred.
    const score = (list, factor) => {
      if (!list) return;
      // A term matching half the corpus tells us nothing; weight rare terms up.
      const w = (Math.log(index.rows.length / (list.length + 1)) + 1) * factor;
      for (const i of list) hits.set(i, (hits.get(i) || 0) + w);
    };
    for (const t of typed) score(index.byToken.get(t), 1);
    for (const t of expanded) score(index.byToken.get(t), 0.55);

    const nq = norm(q);
    for (const [i, w] of hits) {
      const row = index.rows[i];
      const nd = norm(row.desc);
      let s = w * 100;

      // Coverage is a strong relevance signal: a procedure thirty hospitals
      // publish is far more likely to be the one you meant than a rare variant.
      s += Math.min(row.hospitals, 60) * 3;

      if (nd.startsWith(nq)) s += 1400;               // the name begins with the query
      else if (nd.includes(nq)) s += 700;             // appears intact
      // Every typed word present, in any order, beats a partial match.
      if (typed.every((t) => nd.includes(t))) s += 450;
      if (row.type === 'CPT') s += 60;                // outpatient codes are what people shop
      s += attributeScore(rawTokenSet, row.desc);
      push(row, s);
    }
  }

  const seen = new Set();
  return out
    .filter((x) => x.trusted || x.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .filter(({ row }) => {
      const k = `${row.type}|${row.code}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.row);
}

/* ----------------------------------------------------------- price shards -- */

const shardName = (type, code) => {
  const t = type.replace(/[^A-Za-z0-9-]/g, '');
  const p = code.slice(0, 3).replace(/[^A-Za-z0-9]/g, '_') || '_';
  return `codes/${t}/${p}.json`;
};

/**
 * Load every published price for one procedure.
 * Returns null when the code exists in the index but the shard has no rows.
 */
/**
 * Load every published price for one procedure.
 *
 * `status: 'absent'` means the code was looked for and genuinely has no
 * published price — a real, calm answer. Anything else wrong (offline, a 5xx,
 * a shard that failed to parse) throws, because that is not the same fact and
 * must not be shown with the same words.
 *
 * @param {AbortSignal} [signal] aborts the fetch, e.g. on route change
 */
export async function loadCode(type, code, signal) {
  const file = shardName(type, code);

  // meta.json declares the shard shape, so it has to be in hand before a shard
  // can be decoded. It is memoised and tiny; on a dataset that predates the
  // contract it simply carries no `shard` key and the legacy decoder is used.
  // A meta that will not load must not turn into "nobody published this", so
  // only a 404 is treated as an answer.
  const metaP = loadMeta().catch((e) => {
    if (e?.status === 404) return null;
    throw e;
  });

  // A shard that is not there is "nobody published this", however the host
  // says so — a 404, or the single-page fallback answering 200 with index.html.
  let bucket, meta;
  try {
    [bucket, meta] = await Promise.all([once(file, () => getOptionalJSON(file, signal)), metaP]);
  } catch (e) {
    if (e?.status === 404) return { status: 'absent' };
    throw e;
  }
  if (bucket == null) return { status: 'absent' };

  const decoded = decodeBucket(meta, bucket, code);
  if (!decoded) return { status: 'absent' };

  return {
    status: 'ok',
    type,
    code,
    desc: decoded.desc,
    hospitals: decoded.hospitals,
    contract: decoded.contract,
  };
}
