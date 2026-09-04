/**
 * Parsing and formatting for a dollar-amount text field.
 *
 * Kept separate from the MoneyInput component so the parsing rules — the part
 * someone can actually get wrong — are plain functions a test can call
 * directly, with no DOM required.
 */

/** Strip anything that is not a digit or a dot, and collapse to one dot. */
export function sanitizeMoneyText(raw) {
  const stripped = String(raw ?? '').replace(/[^0-9.]/g, '');
  const firstDot = stripped.indexOf('.');
  if (firstDot === -1) return stripped;
  // Only the first "." is a decimal point; drop any that follow.
  return stripped.slice(0, firstDot + 1) + stripped.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Parse a dollar string typed by a person into integer cents.
 *
 * Deliberately tolerant: a leading "." (".5"), a trailing "." ("12."), and up
 * to two fraction digits are all valid. Anything typed beyond two fraction
 * digits is ignored rather than rounded into a different number while the
 * person is still typing.
 *
 * @returns {number|null} cents, or null for an empty/incomplete field
 */
export function parseMoneyToCents(raw) {
  const clean = sanitizeMoneyText(raw);
  if (clean === '' || clean === '.') return null;
  const [whole, frac = ''] = clean.split('.');
  const fracClamped = frac.slice(0, 2);
  const dollars = whole === '' ? 0 : parseInt(whole, 10);
  const cents = fracClamped === '' ? 0 : Math.round(parseInt(fracClamped.padEnd(2, '0'), 10));
  if (!Number.isFinite(dollars)) return null;
  return dollars * 100 + cents;
}

/** Format cents back into the editable text a person would have typed. */
export function centsToEditText(cents) {
  if (cents == null || !Number.isFinite(cents)) return '';
  if (cents === 0) return '';
  const sign = cents < 0 ? '-' : '';
  const c = Math.abs(cents);
  const dollars = Math.floor(c / 100);
  const rem = c % 100;
  return rem === 0 ? `${sign}${dollars}` : `${sign}${dollars}.${String(rem).padStart(2, '0')}`;
}
