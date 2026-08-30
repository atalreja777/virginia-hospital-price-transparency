import { describe, it, expect } from 'vitest';
import { distanceMiles, zipToPoint, isValidZip, withDistance, boundsOf, withinVirginia } from '../src/lib/geo.js';

describe('distance', () => {
  it('measures a known Virginia leg', () => {
    // Richmond -> Charlottesville is about 65 miles as the crow flies
    const d = distanceMiles(37.5407, -77.4360, 38.0293, -78.4767);
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(72);
  });
  it('is zero at the same point', () => {
    expect(distanceMiles(37.5, -77.4, 37.5, -77.4)).toBeCloseTo(0, 6);
  });
  it('is symmetric', () => {
    const a = distanceMiles(36.85, -76.28, 38.88, -77.17);
    const b = distanceMiles(38.88, -77.17, 36.85, -76.28);
    expect(a).toBeCloseTo(b, 9);
  });
  it('returns null on missing coordinates', () => {
    expect(distanceMiles(null, -77, 38, -77)).toBe(null);
    expect(distanceMiles(37, -77, undefined, -77)).toBe(null);
  });
});

describe('zips', () => {
  const zips = { '23219': [37.5406, -77.4347], '22030': [38.8372, -77.3405] };
  it('resolves a known ZIP', () => expect(zipToPoint(zips, '23219').lat).toBeCloseTo(37.5406));
  it('trims ZIP+4', () => expect(zipToPoint(zips, '22030-1234')?.zip).toBe('22030'));
  it('rejects rubbish', () => {
    expect(zipToPoint(zips, 'abcde')).toBe(null);
    expect(zipToPoint(zips, '1234')).toBe(null);
    expect(zipToPoint(zips, '99999')).toBe(null);
    expect(zipToPoint(zips, null)).toBe(null);
  });
  it('validates format', () => {
    expect(isValidZip('23219')).toBe(true);
    expect(isValidZip('2321')).toBe(false);
  });
});

describe('radius', () => {
  const items = [
    { id: 1, lat: 37.5407, lon: -77.4360 },   // Richmond
    { id: 2, lat: 38.0293, lon: -78.4767 },   // Charlottesville ~65mi
    { id: 3, lat: 36.8508, lon: -76.2859 },   // Norfolk ~78mi
  ];
  const origin = { lat: 37.5407, lon: -77.4360 };
  it('sorts nearest first', () => {
    expect(withDistance(items, origin).map((i) => i.id)).toEqual([1, 2, 3]);
  });
  it('filters by radius', () => {
    expect(withDistance(items, origin, 70).map((i) => i.id)).toEqual([1, 2]);
    expect(withDistance(items, origin, 10).map((i) => i.id)).toEqual([1]);
  });
  it('keeps everything with no origin', () => {
    expect(withDistance(items, null, 10)).toHaveLength(3);
  });
  it('drops points with no coordinates when filtering', () => {
    const withNull = [...items, { id: 4, lat: null, lon: null }];
    expect(withDistance(withNull, origin, 100).find((i) => i.id === 4)).toBeUndefined();
  });
});

describe('bounds', () => {
  it('brackets the points', () => {
    const b = boundsOf([{ lat: 37, lon: -77 }, { lat: 38, lon: -78 }]);
    expect(b[0][0]).toBeLessThan(-78);
    expect(b[1][1]).toBeGreaterThan(38);
  });
  it('returns null with nothing to fit', () => {
    expect(boundsOf([])).toBe(null);
    expect(boundsOf([{ lat: null, lon: null }])).toBe(null);
  });
});

describe('virginia bounds', () => {
  it('accepts Richmond and rejects Chicago', () => {
    expect(withinVirginia(37.54, -77.43)).toBe(true);
    expect(withinVirginia(41.88, -87.63)).toBe(false);
  });
});
