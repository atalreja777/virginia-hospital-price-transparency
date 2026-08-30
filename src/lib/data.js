/**
 * Data access. Everything is a static JSON file fetched from the same origin —
 * there is no API, no key, and nothing to rate-limit. The price shards are
 * bucketed by code prefix so a search downloads tens of kilobytes, not the
 * whole hundred-megabyte dataset.
 */

const BASE = import.meta.env.BASE_URL || '/';
const url = (p) => `${BASE}data/${p}`.replace(/([^:])\/{2,}/g, '$1/');

const memo = new Map();
/** Fetch a JSON file once and keep it. Concurrent callers share one request. */
function once(key, loader) {
  if (!memo.has(key)) {
    memo.set(key, loader().catch((e) => { memo.delete(key); throw e; }));
  }
  return memo.get(key);
}
async function getJSON(p) {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`Could not load ${p} (${r.status})`);
  return r.json();
}

export const loadMeta       = () => once('meta',    () => getJSON('meta.json'));
export const loadHospitals  = () => once('hosp',    () => getJSON('hospitals.json'));
export const loadPayers     = () => once('payers',  () => getJSON('payers.json'));
export const loadPlans      = () => once('plans',   () => getJSON('plans.json'));
export const loadSettings   = () => once('sett',    () => getJSON('settings.json'));
export const loadMethods    = () => once('meth',    () => getJSON('methodologies.json'));
export const loadZips       = () => once('zips',    () => getJSON('zips.json'));
export const loadPayerGroups= () => once('pgroups', () => getJSON('payer_groups.json'));

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
  const rows = raw.r.map(([type, code, desc, hospitals, rates, p10, p50, p90]) => ({
    type, code, desc, hospitals, rates, p10, p50, p90,
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
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?(head|brain)\b|^ct\s*head/, [['CPT','70450'],['CPT','70460']]],
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?(abdomen|belly|stomach)/,     [['CPT','74177'],['CPT','74176']]],
  [/\b(ct|cat)\s*(scan)?\s*(of\s*)?(the\s*)?chest/,                        [['CPT','71260'],['CPT','71250']]],
  [/^(ct|cat)(\s*scan)?$/,                                                    [['CPT','70450'],['CPT','74177'],['CPT','71250']]],
  [/\bmri\b.*(back|spine|lumbar)|^(back|lumbar)\s*mri/,                     [['CPT','72148'],['CPT','72158']]],
  [/\bmri\b.*(knee|leg)/,                                                    [['CPT','73721'],['CPT','73718']]],
  [/\bmri\b.*(brain|head)/,                                                  [['CPT','70551'],['CPT','70553']]],
  [/^mri$/,                                                                    [['CPT','72148'],['CPT','73721'],['CPT','70551']]],
  [/\b(knee\s*replacement|total\s*knee)\b/,                                [['CPT','27447'],['MS-DRG','470']]],
  [/\b(hip\s*replacement|total\s*hip)\b/,                                  [['CPT','27130'],['MS-DRG','470']]],
  [/\bshoulder\s*replacement\b/,                                            [['CPT','23472']]],
  [/\b(knee\s*(arthroscopy|scope)|meniscus)\b/,                             [['CPT','29881'],['CPT','29880']]],
  [/\bcataract\b/,                                                           [['CPT','66984'],['CPT','66982']]],
  [/\bcolonoscopy\b/,                                                        [['CPT','45378'],['CPT','45380'],['CPT','45385']]],
  [/\b(upper\s*endoscopy|egd)\b/,                                           [['CPT','43239'],['CPT','43235']]],
  [/\bgall\s*bladder\b|\bcholecystectomy\b/,                              [['CPT','47562'],['CPT','47563']]],
  [/\bhernia\b/,                                                             [['CPT','49505'],['CPT','49585']]],
  [/\bappendix\b|\bappendectomy\b/,                                        [['CPT','44970']]],
  [/\bhysterectomy\b/,                                                       [['CPT','58150'],['CPT','58571']]],
  [/\btonsil/,                                                                [['CPT','42820'],['CPT','42826']]],
  [/\b(childbirth|give\s*birth|vaginal\s*(delivery|birth)|have\s*a\s*baby)\b/, [['CPT','59400'],['MS-DRG','807']]],
  [/\b(c\s*section|cesarean|caesarean)\b/,                                  [['CPT','59510'],['MS-DRG','788']]],
  [/\bmammogram\b|\bmammograph/,                                            [['CPT','77067'],['CPT','77065']]],
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
  [/\b(cataract|lasik|eye\s*surgery)\b/,                                    [['CPT','66984']]],
];

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
export function searchProcedures(index, query, limit = 40) {
  if (!index) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  const out = [];
  const push = (row, boost) => out.push({ row, score: boost });

  // Curated answers first, in the order the alias lists them.
  aliasHits(index, q).forEach((row, i) => push(row, 5e8 - i));

  // direct code hit
  if (looksLikeCode(q)) {
    const up = q.toUpperCase();
    for (const t of ['CPT', 'HCPCS', 'MS-DRG']) {
      const hit = index.byCode.get(`${t}|${up}`);
      if (hit) push(hit, 1e9 + hit.hospitals);
    }
    // partial code prefix
    if (out.length < 8) {
      for (const row of index.rows) {
        if (row.code.startsWith(up) && row.code !== up) {
          push(row, 1e6 + row.hospitals);
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
      push(row, s);
    }
  }

  const seen = new Set();
  return out
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
export async function loadCode(type, code) {
  const file = shardName(type, code);
  const bucket = await once(file, () => getJSON(file));
  const entry = bucket[code];
  if (!entry) return null;

  const hospitals = Object.entries(entry.h).map(([hIdx, v]) => {
    const rates = [];
    for (let i = 0; i < v.r.length; i += 5) {
      rates.push({ payer: v.r[i], plan: v.r[i + 1], setting: v.r[i + 2], method: v.r[i + 3], price: v.r[i + 4] });
    }
    rates.sort((a, b) => a.price - b.price);
    const prices = rates.map((r) => r.price);
    return {
      hIdx: +hIdx,
      gross: v.g, cash: v.c, minNegotiated: v.mn, maxNegotiated: v.mx,
      rates, prices,
      low: prices[0] ?? null,
      median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
      high: prices[prices.length - 1] ?? null,
    };
  });

  return { type, code, desc: entry.d, hospitals };
}
