import { describe, it, expect } from 'vitest';
import { parseMoneyToCents, sanitizeMoneyText, centsToEditText } from '../src/lib/money.js';

describe('parseMoneyToCents', () => {
  it('parses a plain dollar-and-cents string', () => {
    expect(parseMoneyToCents('123.45')).toBe(12345);
  });
  it('parses a string with a thousands comma', () => {
    expect(parseMoneyToCents('1,000.5')).toBe(100050);
  });
  it('parses a leading decimal point', () => {
    expect(parseMoneyToCents('.5')).toBe(50);
  });
  it('returns null for an empty field', () => {
    expect(parseMoneyToCents('')).toBe(null);
  });
  it('returns null for a bare decimal point', () => {
    expect(parseMoneyToCents('.')).toBe(null);
  });
  it('parses whole dollars with no fraction', () => {
    expect(parseMoneyToCents('2000')).toBe(200000);
  });
  it('ignores a trailing decimal point', () => {
    expect(parseMoneyToCents('12.')).toBe(1200);
  });
  it('truncates more than two fraction digits rather than rounding a different number', () => {
    expect(parseMoneyToCents('1.239')).toBe(123);
  });
  it('ignores stray non-numeric characters', () => {
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
  });
});

describe('sanitizeMoneyText', () => {
  it('keeps only digits and the first dot', () => {
    expect(sanitizeMoneyText('1,234.5.6')).toBe('1234.56');
  });
  it('preserves a trailing dot so typing "123." is not rewritten mid-keystroke', () => {
    expect(sanitizeMoneyText('123.')).toBe('123.');
  });
});

describe('centsToEditText', () => {
  it('round-trips through parseMoneyToCents', () => {
    for (const s of ['123.45', '1000.5', '0.5', '2000']) {
      const cents = parseMoneyToCents(s);
      expect(parseMoneyToCents(centsToEditText(cents))).toBe(cents);
    }
  });
  it('renders zero and null as an empty field', () => {
    expect(centsToEditText(0)).toBe('');
    expect(centsToEditText(null)).toBe('');
  });
});
