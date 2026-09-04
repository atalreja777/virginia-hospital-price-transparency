#!/usr/bin/env node
/**
 * The whole pipeline, once, as one auditable thing.
 *
 * Before this existed, `npm run data` ran stages 1 to 3 and the operator was
 * expected to remember the other five by hand. Nothing recorded which database
 * snapshot, which git commit or which stage counts produced the files sitting
 * in public/data, so "where does this number come from" had no answer, and a
 * half-finished build overwrote the live dataset in place.
 *
 * Now every stage writes into pipeline/out/<releaseId>/, logs to that
 * directory, and the build is validated before it is promoted. Promotion is a
 * rename: the previous dataset becomes public/data.prev-<id> and the new one
 * takes its place, so the site is never serving a half-written directory.
 *
 *   npm run release                          # statewide
 *   npm run release -- --hospital 5913,5888  # a sample
 *   npm run release -- --limit 5 --no-promote
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { args, log, REPO, sha256File, walk, dirSize, mb, readJSON, writeJSON } from './lib/util.mjs';

const A = args();
// Where a validated build is promoted to. Redirectable so the swap itself can
// be exercised against a scratch directory without touching the live dataset.
const PUBLIC = path.resolve(A.publicDir || path.join(REPO, 'public', 'data'));
const releaseId = A.releaseId || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const ROOT = path.join(REPO, 'pipeline', 'out', releaseId);
const DATA = path.join(ROOT, 'data');
const RAW = path.join(ROOT, 'raw');
const LOGS = path.join(ROOT, 'logs');
const PROMOTE = A.promote !== false && !A['no-promote'] && !A.dry;

for (const d of [DATA, RAW, LOGS]) fs.mkdirSync(d, { recursive: true });

const git = (cmd, fallback = null) => {
  try { return execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
};

const stages = [];
function run(name, cmd, argv, { optional = false } = {}) {
  const started = Date.now();
  log(`--- ${name}`);
  const res = spawnSync(cmd, argv, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = (res.stdout || '') + (res.stderr || '');
  fs.writeFileSync(path.join(LOGS, `${name}.log`), `$ ${cmd} ${argv.join(' ')}\n\n${output}`);
  const ok = res.status === 0;
  stages.push({ name, command: `${cmd} ${argv.join(' ')}`, ok, exitCode: res.status, seconds: +((Date.now() - started) / 1000).toFixed(1), optional });
  process.stdout.write(output.split('\n').slice(-14).join('\n') + '\n');
  if (!ok && !optional) {
    log(`stage ${name} failed (exit ${res.status}); logs in ${LOGS}`);
    writeRelease(false);
    process.exit(1);
  }
  if (!ok) log(`stage ${name} failed but is optional; continuing`);
  return ok;
}

/* ---- 01 export ----------------------------------------------------------- */
const exportArgs = ['--out', RAW];
if (A.hospital) exportArgs.push('--hospital', String(A.hospital));
if (A.limit) exportArgs.push('--limit', String(A.limit));
if (A.state) exportArgs.push('--state', String(A.state));
if (A['allow-missing-rejected']) exportArgs.push('--allow-missing-rejected');
run('01_export', path.join(REPO, 'pipeline', '01_export.sh'), exportArgs);

/* ---- 02 pack ------------------------------------------------------------- */
const packArgs = ['--max-old-space-size=8192', path.join(REPO, 'pipeline', '02_pack.mjs'),
  '--raw', RAW, '--data', DATA, '--releaseId', releaseId];
if (A.scale) packArgs.push('--scale', String(A.scale));
if (A.budget) packArgs.push('--budget', String(A.budget));
if (A.grain) packArgs.push('--grain', String(A.grain));
if (A.counts) packArgs.push('--counts');
run('02_pack', 'node', packArgs);

/* ---- 03-08 --------------------------------------------------------------- */
const node = (script, extra = []) => ['node', [path.join(REPO, 'pipeline', script), '--data', DATA, ...extra]];
run('03_geocode', ...node('03_geocode.mjs', A.online ? [] : ['--offline']));
run('04_zips', ...node('04_zips.mjs', ['--fallback', PUBLIC]));
run('05_stats', ...node('05_stats.mjs'));
run('06_payers', ...node('06_payers.mjs'));
run('07_hospital_pages', ...node('07_hospital_pages.mjs'));
run('08_demo', ...node('08_demo.mjs'));

/* ---- 09 validate --------------------------------------------------------- */
const validated = run('09_validate', 'node',
  [path.join(REPO, 'pipeline', '09_validate.mjs'), '--data', DATA, '--raw', RAW],
  { optional: true });

/* ---- tests --------------------------------------------------------------- */
// The dataset tests run against the candidate, not against whatever happens to
// be live, so a release is tested before it is promoted rather than after.
let testResult = null;
if (!A['no-test']) {
  const ok = run('tests', 'npx', ['vitest', 'run', '--reporter', 'json',
    '--outputFile', path.join(ROOT, 'test-results.json')],
    { optional: true });
  try {
    const t = readJSON(path.join(ROOT, 'test-results.json'));
    testResult = { ok, total: t.numTotalTests, passed: t.numPassedTests, failed: t.numFailedTests };
  } catch { testResult = { ok, total: null, passed: null, failed: null }; }
}

/* ---- release record ------------------------------------------------------ */
function writeRelease(promoted, dir = DATA) {
  const files = {};
  for (const rel of walk(dir)) {
    const f = path.join(dir, rel);
    files[rel] = { bytes: fs.statSync(f).size, sha256: sha256File(f) };
  }
  const meta = fs.existsSync(path.join(dir, 'meta.json')) ? readJSON(path.join(dir, 'meta.json')) : null;
  const validation = fs.existsSync(path.join(dir, 'validation.json')) ? readJSON(path.join(dir, 'validation.json')) : null;
  const rec = {
    releaseId,
    builtAt: new Date().toISOString(),
    git: {
      commit: git('git rev-parse HEAD'),
      branch: git('git rev-parse --abbrev-ref HEAD'),
      dirty: (git('git status --porcelain') || '') !== '',
    },
    database: {
      name: process.env.HPT_DB || 'hpt',
      snapshot: meta?.export?.snapshot ?? null,
      migrationHead: migrationHead(),
      capabilities: meta?.export?.capabilities ?? null,
      ratesSource: meta?.export?.ratesSource ?? null,
      itemsSource: meta?.export?.itemsSource ?? null,
    },
    scope: meta?.export?.scope ?? null,
    counts: meta?.counts ?? null,
    stageCounts: meta?.stages ?? null,
    audit: meta?.audit ?? null,
    shardContract: meta?.shard ?? null,
    stages,
    tests: testResult,
    validation: validation ? { passed: validation.passed, failures: validation.failures, warnings: validation.warnings } : null,
    export: meta?.export?.files ?? null,
    size: { dataBytes: dirSize(dir), rawBytes: dirSize(RAW) },
    files,
    promoted,
  };
  writeJSON(path.join(ROOT, 'release.json'), rec, true);
  // The promoted dataset carries its own provenance, so the live site can say
  // which build it is serving without anyone consulting a build directory.
  if (promoted) writeJSON(path.join(dir, 'release.json'), { ...rec, files: undefined }, true);
  return rec;
}

/**
 * The backend's migration head, so a release says which schema it was built
 * against. Read-only, and column-agnostic: different projects name the column
 * `filename` or `version`, and a release should not fail over that.
 */
function migrationHead() {
  const db = process.env.HPT_DB || 'hpt';
  for (const col of ['filename', 'version']) {
    try {
      const out = execSync(
        `psql -qtAX -d ${db} -c "SET statement_timeout='30s'" ` +
        `-c "SELECT ${col} FROM schema_migrations ORDER BY 1 DESC LIMIT 1"`,
        { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop();
      if (out) return out;
    } catch { /* try the next column name */ }
  }
  return null;
}

if (!validated) {
  writeRelease(false);
  log(`\nvalidation failed — nothing was promoted. Candidate left in ${DATA}`);
  log(`see ${path.join(DATA, 'validation.json')} and ${LOGS}`);
  process.exit(1);
}

if (!PROMOTE) {
  const rec = writeRelease(false);
  log(`\nbuilt ${releaseId} (${mb(rec.size.dataBytes)}) but did not promote (--no-promote)`);
  log(`candidate: ${DATA}`);
  process.exit(0);
}

/* ---- atomic swap --------------------------------------------------------- */
// Two renames, no copying, no window in which public/data is half a dataset.
const stash = path.join(path.dirname(PUBLIC), `${path.basename(PUBLIC)}.prev-${releaseId}`);
if (fs.existsSync(PUBLIC)) fs.renameSync(PUBLIC, stash);
try {
  fs.renameSync(DATA, PUBLIC);
} catch (e) {
  if (fs.existsSync(stash)) fs.renameSync(stash, PUBLIC);
  throw e;
}
// The candidate directory keeps its identity: point it at what was promoted.
fs.writeFileSync(path.join(ROOT, 'PROMOTED'), `${new Date().toISOString()} -> ${PUBLIC}\nprevious dataset: ${stash}\n`);
const rec = writeRelease(true, PUBLIC);
log(`\npromoted ${releaseId}: ${mb(rec.size.dataBytes)} now in ${PUBLIC}`);
log(`previous dataset kept at ${stash} — delete it once the site is verified`);
