/**
 * Shared helpers for the pipeline stages.
 *
 * Every stage is a standalone script so it can be re-run on its own, but they
 * all need the same four things: parse `--flags`, read a CSV without pulling in
 * a dependency, hash a file for the manifest, and log with a timestamp.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
export const REPO = path.resolve(HERE, '..');

/** `--data x --raw y --flag` -> { data: 'x', raw: 'y', flag: true }. */
export function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Where this stage reads and writes. Defaults keep the old manual workflow working. */
export function dirs(a = args()) {
  const data = path.resolve(a.data || path.join(REPO, 'public', 'data'));
  const raw = path.resolve(a.raw || path.join(REPO, 'pipeline', 'raw'));
  return { data, raw };
}

export const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

/* ---------------------------------------------------------------- CSV ----- */

export function splitCSV(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Stream a CSV, handing each row to `onRow` as an object keyed by header name.
 * Header-keyed rather than positional: the export gained columns and a silent
 * off-by-one between the SQL and the packer is exactly the class of bug this
 * rewrite exists to kill.
 */
export async function readCSV(file, onRow) {
  if (!fs.existsSync(file)) throw new Error(`missing export file: ${file}`);
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { highWaterMark: 1 << 20 }), crlfDelay: Infinity,
  });
  let head = null, n = 0, pending = null;
  for await (const line of rl) {
    // A quoted field may contain a newline; rejoin those before parsing.
    let text = pending == null ? line : pending + '\n' + line;
    const quotes = (text.match(/"/g) || []).length;
    if (quotes % 2 === 1) { pending = text; continue; }
    pending = null;
    if (!text) continue;
    const cells = splitCSV(text);
    if (!head) { head = cells; continue; }
    const row = {};
    for (let i = 0; i < head.length; i++) row[head[i]] = cells[i] ?? '';
    onRow(row, n);
    n++;
  }
  return n;
}

/**
 * Read `<name>.csv`, or every CSV in a `<name>/` directory, as one stream.
 *
 * The export writes one file per hospital so each SQL statement prunes to that
 * hospital's partitions; downstream that is still just "the charges" or "the
 * rates". Files are read in a stable order, and the callback is told which file
 * a row came from so per-hospital accounting stays exact.
 */
export async function readCSVSet(rawDir, name, onRow) {
  const single = path.join(rawDir, `${name}.csv`);
  const dir = path.join(rawDir, name);
  let files = [];
  if (fs.existsSync(single)) files = [single];
  else if (fs.existsSync(dir)) {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()
      .map((f) => path.join(dir, f));
  } else throw new Error(`missing export data: ${single} or ${dir}/`);
  let total = 0;
  for (const f of files) {
    const base = path.basename(f, '.csv');
    total += await readCSV(f, (row, i) => onRow(row, i, base));
  }
  return total;
}

/* --------------------------------------------------------------- values --- */

/**
 * Dollars -> integer cents, keeping the fact that a value was sub-cent.
 * Returns { cents, sub } where `sub` marks a value that rounds to a penny or
 * less. Those are published artefacts (0.003, 0.008) rather than prices, and
 * the site's own methodology says they are withheld — but they are counted and
 * flagged here, never silently dropped.
 */
export function toCents(s) {
  if (s == null || s === '') return null;
  const f = parseFloat(s);
  if (!Number.isFinite(f)) return null;
  const cents = Math.round(f * 100);
  return { cents, sub: cents <= 1 };
}

export const num = (s) => (s === '' || s == null ? null : (Number.isFinite(+s) ? +s : null));
export const bool = (s) => (s === 't' || s === 'true' || s === 'TRUE' ? true : s === 'f' || s === 'false' ? false : null);

/** Postgres array literal `{a,b}` -> ['a','b']. */
export function pgArray(s) {
  if (!s || s === '{}') return [];
  return s.replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).filter(Boolean);
}

/* ---------------------------------------------------------------- hash ---- */

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/** Every file under a directory, relative paths, sorted. */
export function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

export const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Percentile of an already sorted array, same rule everywhere in the pipeline. */
export const pct = (sorted, p) =>
  (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

/* ------------------------------------------------------- code identity ---- */

/**
 * HCPCS Level I *is* CPT, and about a third of Virginia's hospitals label their
 * whole code column "HCPCS", 5-digit CPT numbers included. A 5-digit numeric
 * code is never a valid Level II code, so folding it into CPT is unambiguous.
 */
export const normType = (ct, code) => (ct === 'HCPCS' && /^[0-9]{5}$/.test(code) ? 'CPT' : ct);

/** The three code systems a patient can compare across hospitals. */
export const NATIVE_TYPES = new Set(['CPT', 'HCPCS', 'MS-DRG']);

const SHAPE_CPT = /^[0-9]{5}$/;
const SHAPE_HCPCS2 = /^[ABDEGHJKLMPQRSTVU][0-9]{4}$/;

/**
 * What code system a published row really belongs to.
 *
 * A row typed CPT/HCPCS/MS-DRG is taken at its word (with the HCPCS-5-digit
 * fold above). A row under any other label — `CDM`, `RC`, a hospital's own
 * column name — is claimed only on shape: five digits is a CPT, a letter and
 * four digits is HCPCS Level II. Short numerics are NOT claimed: revenue code
 * 270 and MS-DRG 270 are the same string, and guessing between them would put
 * a box of gloves next to a hip replacement.
 *
 * Shape alone is a candidacy, not an admission — see `admitCode`.
 */
export function effectiveType(ct, code) {
  if (NATIVE_TYPES.has(ct)) return normType(ct, code);
  if (SHAPE_CPT.test(code)) return 'CPT';
  if (SHAPE_HCPCS2.test(code)) return 'HCPCS';
  return null;
}

/**
 * Should this published row be used as a price for `type|code`?
 *
 * Rows under a real code column are admitted on their own. Rows rescued from a
 * local column are admitted only when the same code appears under a properly
 * typed column at some hospital in this release — evidence that the string is
 * the national code it looks like, rather than an internal chargemaster number.
 *
 * Returns { ok, type, native, reason }.
 */
export function admitCode(ct, code, desc, corroborated) {
  const type = effectiveType(ct, code);
  if (!type) return { ok: false, type: null, native: false, reason: 'unrecognised code system' };
  if (!inScope(type, code, desc)) return { ok: false, type, native: NATIVE_TYPES.has(ct), reason: 'not patient-shoppable' };
  const native = NATIVE_TYPES.has(ct);
  if (native) return { ok: true, type, native: true, reason: 'published under its own code column' };
  if (corroborated) return { ok: true, type, native: false, reason: `rescued from a "${ct}" column; corroborated elsewhere` };
  return { ok: false, type, native: false, reason: `only seen under a "${ct}" column; no corroboration` };
}

const JUNK_DESC = /noncdm|non-cdm|charge record|^misc|^supply|do not use|deleted|inactive|placeholder/i;

/** Keep only codes a patient could plan and shop for. */
export function inScope(ct, code, desc) {
  if (JUNK_DESC.test(desc || '')) return false;
  if (ct === 'CPT') return /^[0-9]{5}$/.test(code) && !(code >= '99281' && code <= '99292');
  if (ct === 'MS-DRG') return /^[0-9]{1,3}$/.test(code);
  if (ct === 'HCPCS') return /^[ABDEGHJKLMPQRSTVU][0-9]{4}$/.test(code);
  return false;
}

/**
 * Per-unit test, in one place because three stages need the same answer.
 *
 * Drug and supply codes are billed per unit — per mg, per ml, per dose. One
 * hospital prices the milligram and another the vial, so a "spread" between
 * them is a unit-of-measure mismatch rather than a price difference. HCPCS
 * J (drugs), Q (temporary drugs and supplies) and A (supplies and transport)
 * are per-unit by construction, whatever their wording says.
 */
export const PER_UNIT_DESC = /\b(inj(ection)?|per\s|mg\b|ml\b|mcg\b|unit[s]?\b|dose|vial|tablet|capsule|solution|soln|iv\b|infusion)\b/i;

export function perUnitReason(type, code, desc) {
  if (type === 'HCPCS' && /^[JQA]/.test(code || '')) return `hcpcs_${code[0].toLowerCase()}_code`;
  // Anesthesia (CPT 00100-01999) is priced in base + time units, so a published
  // figure may be one unit or a whole case; a 113,000x "spread" on CPT 00908 was
  // that, not a price difference. Searchable, never used to argue.
  if (type === 'CPT' && /^0[01]\d{3}$/.test(code || '')) return 'cpt_anesthesia_time_units';
  if (PER_UNIT_DESC.test(desc || '')) return 'per_unit_wording';
  return null;
}

export const isProcedureLike = (type, code, desc) => perUnitReason(type, code, desc) === null;

/* ---------------------------------------------------------------- misc ---- */

export function writeJSON(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
  return fs.statSync(file).size;
}

export const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function dirSize(dir) {
  let n = 0;
  for (const f of walk(dir)) n += fs.statSync(path.join(dir, f)).size;
  return n;
}

export const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

/* ------------------------------------------------------- wording ---- */
/**
 * Choose the displayed wording for one code from its candidates
 * [{d, nh, native, shared}]. Rules, in order: a wording used by several codes
 * of the same type (`shared`) is never chosen while an unshared one used by
 * at least MIN_UNIQUE hospitals exists; native (published under a real CPT/
 * HCPCS/MS-DRG column) beats local-column wording; then the wording the most
 * hospitals use; then the longer one.
 */
export function pickWording(cands, MIN_UNIQUE = 2) {
  // Among code-unique candidates: native first, then most hospitals, then
  // longer. When no unique wording is used by MIN_UNIQUE hospitals the shared
  // wording is the honest choice, ranked the same way without the uniqueness.
  const rank = (c) => [c.native ? 1 : 0, c.nh, c.d.length];
  const better = (a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i]; return false; };
  const unique = cands.filter((c) => !c.shared && c.nh >= MIN_UNIQUE);
  const pool = unique.length ? unique : cands;
  let best = pool[0];
  for (const c of pool.slice(1)) if (better(c, best)) best = c;
  return best;
}
