/** Search behaviour against the real index — the thing users touch first. */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { searchProcedures, looksLikeCode } from '../src/lib/data.js';

let index;
beforeAll(() => {
  const raw = JSON.parse(fs.readFileSync(path.resolve('public/data/search.json'), 'utf8'));
  const rows = raw.r.map(([type, code, desc, hospitals, rates, p10, p50, p90]) =>
    ({ type, code, desc, hospitals, rates, p10, p50, p90 }));

  // Mirror the token index the browser builds on first use.
  const STOP = new Set(['the','and','with','without','of','for','or','a','an','to','in','on','by','per','hc','w','wo']);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
  const byToken = new Map(), byCode = new Map();
  rows.forEach((row, i) => {
    byCode.set(`${row.type}|${row.code}`, row);
    const seen = new Set();
    for (const t of tokens(row.desc)) {
      if (seen.has(t)) continue;
      seen.add(t);
      (byToken.get(t) ?? byToken.set(t, []).get(t)).push(i);
      for (let n = 3; n < Math.min(t.length, 9); n++) {
        const p = t.slice(0, n);
        const b = byToken.get(p) ?? byToken.set(p, []).get(p);
        if (b[b.length - 1] !== i) b.push(i);
      }
    }
  });
  index = { rows, byToken, byCode };
});

describe('code detection', () => {
  it('recognises billing codes', () => {
    expect(looksLikeCode('45378')).toBe(true);
    expect(looksLikeCode('J1745')).toBe(true);
    expect(looksLikeCode('470')).toBe(true);
  });
  it('does not treat words as codes', () => {
    expect(looksLikeCode('colonoscopy')).toBe(false);
    expect(looksLikeCode('mri knee')).toBe(false);
  });
});

describe('searching by code', () => {
  it('puts an exact code first', () => {
    const r = searchProcedures(index, '45378');
    expect(r[0].code).toBe('45378');
    expect(r[0].type).toBe('CPT');
  });
  it('handles a DRG number', () => {
    const r = searchProcedures(index, '470');
    expect(r.some((x) => x.code === '470')).toBe(true);
  });
});

describe('searching by name', () => {
  const finds = (q, code) => searchProcedures(index, q, 40).some((r) => r.code === code);

  it('finds common procedures by plain name', () => {
    expect(finds('colonoscopy', '45378')).toBe(true);
    expect(finds('mri', '72148')).toBe(true);
    expect(finds('knee replacement', '27447') || finds('arthroplasty knee', '27447')).toBe(true);
  });
  it('matches on a prefix, so results appear while typing', () => {
    expect(searchProcedures(index, 'colon').length).toBeGreaterThan(0);
    expect(searchProcedures(index, 'mamm').length).toBeGreaterThan(0);
  });
  it('ranks widely available procedures higher', () => {
    const r = searchProcedures(index, 'colonoscopy', 10);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].hospitals).toBeGreaterThan(5);
  });
  it('returns nothing for gibberish', () => {
    expect(searchProcedures(index, 'zzzzqqqqxxxx')).toHaveLength(0);
  });
  it('ignores queries that are too short', () => {
    expect(searchProcedures(index, 'a')).toHaveLength(0);
    expect(searchProcedures(index, '')).toHaveLength(0);
  });
  it('never returns duplicates', () => {
    for (const q of ['knee', 'ct scan', 'blood', 'mri', 'x-ray', 'delivery']) {
      const r = searchProcedures(index, q, 40);
      const keys = r.map((x) => `${x.type}|${x.code}`);
      expect(new Set(keys).size, `duplicates for "${q}"`).toBe(keys.length);
    }
  });
  it('respects the result limit', () => {
    expect(searchProcedures(index, 'blood', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('robustness', () => {
  it('survives punctuation, casing and stray whitespace', () => {
    for (const q of ['  MRI  ', 'M.R.I.', 'mri!!!', 'KNEE, replacement', "colon's"]) {
      expect(() => searchProcedures(index, q)).not.toThrow();
    }
  });
  it('survives very long and odd input', () => {
    expect(() => searchProcedures(index, 'x'.repeat(5000))).not.toThrow();
    expect(() => searchProcedures(index, '👩‍⚕️🏥')).not.toThrow();
    expect(() => searchProcedures(index, '<script>alert(1)</script>')).not.toThrow();
    expect(() => searchProcedures(index, '../../etc/passwd')).not.toThrow();
  });
  it('handles a missing index without throwing', () => {
    expect(searchProcedures(null, 'mri')).toEqual([]);
  });
  it('returns results quickly enough to type against', () => {
    const t0 = performance.now();
    for (const q of ['mri', 'colonoscopy', 'knee', 'blood test', 'ct scan', 'delivery', 'cataract']) {
      searchProcedures(index, q, 40);
    }
    expect(performance.now() - t0).toBeLessThan(600);
  });
});
