/** Search behaviour against the real index — the thing users touch first. */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { searchProcedures, looksLikeCode, parseCodeQuery } from '../src/lib/data.js';

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

describe('code-type prefixes', () => {
  it('parses a type-prefixed code in its various punctuations', () => {
    expect(parseCodeQuery('CPT 70551')).toEqual({ type: 'CPT', code: '70551' });
    expect(parseCodeQuery('CPT:70551')).toEqual({ type: 'CPT', code: '70551' });
    expect(parseCodeQuery('CPT-70551')).toEqual({ type: 'CPT', code: '70551' });
    expect(parseCodeQuery('HCPCS J1885')).toEqual({ type: 'HCPCS', code: 'J1885' });
    expect(parseCodeQuery('MS-DRG 470')).toEqual({ type: 'MS-DRG', code: '470' });
    expect(parseCodeQuery('DRG 470')).toEqual({ type: 'MS-DRG', code: '470' });
  });
  it('is null for anything else', () => {
    expect(parseCodeQuery('colonoscopy')).toBe(null);
    expect(parseCodeQuery('70551')).toBe(null);
  });

  it('a type-prefixed code resolves to that exact code, not a fuzzy match', () => {
    const top = (q) => searchProcedures(index, q, 40)[0];
    expect(top('CPT 70551')).toMatchObject({ type: 'CPT', code: '70551' });
    expect(top('CPT:70551')).toMatchObject({ type: 'CPT', code: '70551' });
    expect(top('MS-DRG 470')).toMatchObject({ type: 'MS-DRG', code: '470' });
    expect(top('DRG 470')).toMatchObject({ type: 'MS-DRG', code: '470' });
  });
});

describe('golden queries', () => {
  const top = (q) => searchProcedures(index, q, 40)[0];

  it('distinguishes with-contrast from without-contrast', () => {
    expect(top('MRI brain with contrast')).toMatchObject({ type: 'CPT', code: '70552' });
    expect(top('MRI brain without contrast')).toMatchObject({ type: 'CPT', code: '70551' });
    expect(top('CT abdomen without contrast').code).toMatch(/^(74176|74150)$/);
  });

  it('distinguishes screening from diagnostic', () => {
    expect(top('diagnostic mammogram').code).toMatch(/^(77065|77066)$/);
    expect(top('screening mammogram')).toMatchObject({ type: 'CPT', code: '77067' });
  });

  it('finds a revision, not a primary, knee replacement', () => {
    expect(['466', '467', '468', '27486', '27487']).toContain(top('revision knee replacement').code);
  });

  it('finds a meniscus repair, not a meniscectomy', () => {
    expect(['29882', '29883']).toContain(top('meniscus repair').code);
  });

  it('finds polyp removal during colonoscopy', () => {
    expect(top('colonoscopy with polyp removal')).toMatchObject({ type: 'CPT', code: '45385' });
  });

  it('does not confidently match LASIK to anything, least of all cataract surgery', () => {
    const r = searchProcedures(index, 'LASIK', 40);
    expect(r.every((x) => x.code !== '66984')).toBe(true);
  });

  it('a bare code goes straight to that code', () => {
    expect(top('70551')).toMatchObject({ type: 'CPT', code: '70551' });
  });
});

describe('minimum relevance', () => {
  it('gives no confident match for a nonsense query rather than a weak guess', () => {
    expect(searchProcedures(index, 'zzzzqqqqxxxx')).toHaveLength(0);
    expect(searchProcedures(index, 'LASIK')).toHaveLength(0);
  });
  it('still finds legitimate short and prefix queries', () => {
    expect(searchProcedures(index, 'colon').length).toBeGreaterThan(0);
    expect(searchProcedures(index, 'mri').length).toBeGreaterThan(0);
    expect(searchProcedures(index, 'mamm').length).toBeGreaterThan(0);
  });
});

describe('alias table integrity', () => {
  const dataSrc = fs.readFileSync(path.resolve('src/lib/data.js'), 'utf8');

  it('every alias code exists in the search index', () => {
    // Re-read the module source to enumerate the curated codes without
    // duplicating the list here, so this test fails the moment a code is
    // added to the table that the current dataset does not contain.
    const aliasSrc = dataSrc.slice(dataSrc.indexOf('const ALIASES = ['), dataSrc.indexOf('\n];', dataSrc.indexOf('const ALIASES = [')) + 3);
    const codeRe = /\[['"](CPT|HCPCS|MS-DRG)['"]\s*,\s*['"]([A-Za-z0-9]+)['"]\]/g;
    const missing = [];
    let m;
    while ((m = codeRe.exec(aliasSrc))) {
      const [, type, code] = m;
      if (!index.byCode.has(`${type}|${code}`)) missing.push(`${type}|${code}`);
    }
    expect(missing, `alias codes missing from search.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('no longer maps the deleted hernia code 49585', () => {
    const herniaLine = dataSrc.split('\n').find((l) => l.includes('\\bhernia\\b'));
    expect(herniaLine).toBeTruthy();
    expect(herniaLine).not.toMatch(/49585/);
  });
});
