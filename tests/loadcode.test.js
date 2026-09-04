/**
 * loadCode must tell a real "no Virginia hospital published this" apart from
 * "the network failed" — the two look identical to a naive implementation,
 * but they call for very different messages on the page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const importFresh = () => import('../src/lib/data.js');

const mockFetchOnce = (impl) => {
  global.fetch = vi.fn(impl);
};

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
    mockFetchOnce(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
    const { loadCode } = await importFresh();
    await expect(loadCode('CPT', '70551')).rejects.toThrow();
  });

  it('resolves with the priced hospitals on success', async () => {
    const bucket = { 70551: { d: 'MRI brain', h: { 3: { r: ['AETNA', 1, 'out', 'neg', 15000], g: 20000, c: 12000, mn: 10000, mx: 18000 } } } };
    mockFetchOnce(async () => ({ ok: true, status: 200, json: async () => bucket }));
    const { loadCode } = await importFresh();
    const r = await loadCode('CPT', '70551');
    expect(r.status).toBe('ok');
    expect(r.desc).toBe('MRI brain');
    expect(r.hospitals[0].median).toBe(15000);
  });
});
