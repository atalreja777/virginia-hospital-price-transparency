/**
 * loadCode must tell a real "no Virginia hospital published this" apart from
 * "the network failed" — the two look identical to a naive implementation,
 * but they call for very different messages on the page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { META_V2, BUCKET_V2, META_LEGACY, BUCKET_LEGACY } from './fixtures/shards.js';

const importFresh = () => import('../src/lib/data.js');

const mockFetchOnce = (impl) => {
  global.fetch = vi.fn(impl);
};

const SPA_FALLBACK = '<!doctype html>\n<html lang="en"><head><title>What Virginia Hospitals Charge</title></head><body><div id="root"></div></body></html>';

const jsonRes = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const htmlRes = () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'text/html; charset=utf-8' },
  json: async () => { throw new SyntaxError('Unexpected token <'); },
  text: async () => SPA_FALLBACK,
});

/**
 * Serve files from one fake origin.
 *
 * `missing` chooses how the host reports a file that is not there: '404', or
 * 'spa' for the single-page fallback that answers 200 with index.html — which
 * is what GitHub Pages and `vite preview` actually do, and therefore what the
 * site really meets in production.
 */
const serve = (files, missing = '404') => mockFetchOnce(async (u) => {
  const name = String(u).split('/data/')[1]?.split('?')[0];
  if (!(name in files)) return missing === 'spa' ? htmlRes() : { ok: false, status: 404 };
  return jsonRes(files[name]);
});

describe('loadCode', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns status "absent" on a genuine 404 — a code nobody published', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 404 }));
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '00000');
    expect(r).toEqual({ status: 'absent' });
  });

  it('throws on a network failure rather than reporting "absent"', async () => {
    mockFetchOnce(async () => { throw new TypeError('Failed to fetch'); });
    const { loadCode } = await importFresh();
    await expect(loadCode('CPT', '70551')).rejects.toThrow();
  });

  it('throws on a 500 rather than reporting "absent"', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 500 }));
    const { loadCode } = await importFresh();
    await expect(loadCode('CPT', '70551')).rejects.toThrow();
  });

  it('throws on a shard that fails to parse as JSON', async () => {
    // A body that claims to be JSON and is not: corruption, not absence.
    mockFetchOnce(async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{ "truncated": ',
    }));
    const { loadCode } = await importFresh();
    await expect(loadCode('CPT', '70551')).rejects.toThrow(/did not parse/);
  });

  it('resolves with the priced hospitals on success', async () => {
    const bucket = { 70551: { d: 'MRI brain', h: { 3: { r: ['AETNA', 1, 'out', 'neg', 15000], g: 20000, c: 12000, mn: 10000, mx: 18000 } } } };
    mockFetchOnce(async () => jsonRes(bucket));
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '70551');
    expect(r.status).toBe('ok');
    expect(r.desc).toBe('MRI brain');
    expect(r.hospitals[0].median).toBe(15000);
  });
});

/**
 * The site has to deploy before or after the data. These drive the real loader
 * against both shapes, so the wiring between meta.json and the decoder is
 * tested and not just the decoder on its own.
 */
describe('loadCode across both data shapes', () => {
  beforeEach(() => { vi.resetModules(); });

  it('decodes the new shape using the stride meta declares', async () => {
    serve({ 'meta.json': META_V2, 'codes/CPT/453.json': BUCKET_V2 });
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '45378');

    expect(r.status).toBe('ok');
    expect(r.desc).toBe('Colonoscopy, flexible, diagnostic');
    const h0 = r.hospitals.find((h) => h.hIdx === 0);
    expect(h0.rates).toHaveLength(5);
    expect(h0.rates[0].billingClass).not.toBeUndefined();
    expect(h0.charges).toHaveLength(2);
    expect(h0.withheld).toHaveLength(1);
    expect(h0.formula).toHaveLength(1);
    // A stride-5 reader would have taken a plan index for a price here.
    expect(h0.prices).toEqual([15000, 40000, 98000, 120000, 900000]);
  });

  it('decodes the legacy shape when meta declares no shard', async () => {
    serve({ 'meta.json': META_LEGACY, 'codes/CPT/453.json': BUCKET_LEGACY });
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '45378');

    expect(r.status).toBe('ok');
    const h0 = r.hospitals[0];
    expect(h0.prices).toEqual([98000, 120000, 900000]);
    expect(h0.median).toBe(120000);
    // The legacy merge becomes one combination rather than four bare scalars.
    expect(h0.charges).toEqual([
      { se: null, bc: null, g: 900000, c: 300000, mn: 98000, mx: 900000, src: 0, legacyMerged: true },
    ]);
  });

  it('reports a code the shard does not carry as absent, not as an error', async () => {
    serve({ 'meta.json': META_V2, 'codes/CPT/453.json': BUCKET_V2 });
    const { loadCode } = await importFresh();
    expect(await loadCode('CPT', '45399')).toEqual({ status: 'absent' });
  });

  it('reports a missing shard as absent even when the host serves the SPA fallback', async () => {
    // Not a 404: a static host answers a missing file with 200 and index.html.
    serve({ 'meta.json': META_V2 }, 'spa');
    const { loadCode } = await importFresh();
    expect(await loadCode('CPT', '99999')).toEqual({ status: 'absent' });
  });

  it('still loads a shard when meta.json is missing entirely', async () => {
    // A dataset with no meta.json at all must read as legacy, not as an outage.
    serve({ 'codes/CPT/453.json': BUCKET_LEGACY });
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '45378');
    expect(r.status).toBe('ok');
    expect(r.hospitals[0].median).toBe(120000);
  });

  it('does not turn a broken meta.json into "nobody published this"', async () => {
    mockFetchOnce(async (u) => (String(u).includes('meta.json')
      ? { ok: false, status: 500 }
      : { ok: true, status: 200, json: async () => BUCKET_V2 }));
    const { loadCode } = await importFresh();
    await expect(loadCode('CPT', '45378')).rejects.toThrow();
  });
});

describe('the loaders for files only the new pipeline writes', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns null for each when the dataset predates them', async () => {
    serve({ 'meta.json': META_LEGACY });
    const d = await importFresh();
    expect(await d.loadBillingClasses()).toBeNull();
    expect(await d.loadPayerSegments()).toBeNull();
    expect(await d.loadStageCounts()).toBeNull();
    expect(await d.loadRelease()).toBeNull();
  });

  it('returns the file when it is there', async () => {
    serve({
      'billing_classes.json': ['facility', 'professional'],
      'stage_counts.json': [{ name: 'A', outcome: 'published' }],
      'release.json': { releaseId: '2026-09-04T21-02-11Z', builtAt: '2026-09-04T21:22:53.451Z' },
    });
    const d = await importFresh();
    expect(await d.loadBillingClasses()).toEqual(['facility', 'professional']);
    expect((await d.loadStageCounts())[0].outcome).toBe('published');
    expect((await d.loadRelease()).releaseId).toBe('2026-09-04T21-02-11Z');
  });

  it('still throws on a real failure rather than reporting the file absent', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 500 }));
    const d = await importFresh();
    await expect(d.loadStageCounts()).rejects.toThrow();
  });

  /**
   * The case that actually breaks in production. This site is static, with a
   * single-page fallback: a request for a file that is not there comes back as
   * 200 with index.html, not as a 404. Treating that as a parse error took the
   * whole procedure page down when the new UI met the old data.
   */
  it('reads the single-page fallback as "file absent", not as broken JSON', async () => {
    serve({ 'meta.json': META_LEGACY }, 'spa');
    const d = await importFresh();
    expect(await d.loadBillingClasses()).toBeNull();
    expect(await d.loadPayerSegments()).toBeNull();
    expect(await d.loadStageCounts()).toBeNull();
    expect(await d.loadRelease()).toBeNull();
  });

  it('still reports corruption when a file really is malformed JSON', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{ "half": ',
    }));
    const d = await importFresh();
    await expect(d.loadRelease()).rejects.toThrow(/did not parse/);
  });
});

describe('the search index field that was renamed', () => {
  beforeEach(() => { vi.resetModules(); });

  it('reads field 5 as entries, and keeps the old name working', async () => {
    serve({
      'search.json': {
        f: ['type', 'code', 'desc', 'hospitals', 'entries', 'p10', 'p50', 'p90'],
        r: [['CPT', '45378', 'Colonoscopy', 12, 340, 1000, 2000, 3000]],
      },
    });
    const { loadSearch } = await importFresh();
    const idx = await loadSearch();
    const row = idx.byCode.get('CPT|45378');
    expect(row.entries).toBe(340);
    expect(row.rates).toBe(340);   // positional, so the legacy name still resolves
    expect(row.hospitals).toBe(12);
  });
});
