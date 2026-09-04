/**
 * What a patient actually pays.
 *
 * Every dollar figure in this file is an integer number of cents. Floating point
 * dollars drift; a price tool that is off by a penny loses trust it cannot regain.
 *
 * The model follows how commercial plans in the United States actually adjudicate
 * a claim, in this order:
 *   1. The plan's allowed amount is the negotiated rate, not the gross charge.
 *   2. A copay, where the plan uses one, is a flat fee for that visit.
 *   3. Otherwise the patient pays the rest of the deductible first.
 *   4. Coinsurance is a percentage of what is left after the deductible.
 *   5. The out-of-pocket maximum caps everything the patient can be charged.
 *
 * "Unknown" is a first-class value, not a hidden default. A deductible or a
 * coinsurance rate the caller has not supplied is `null`, not zero and not
 * some invented average — a plan really is unknowable until someone reads
 * their card. When a number the arithmetic needs is unknown, `estimate`
 * returns `missing` instead of guessing, and `patient`/`plan` are `null`.
 */

export const DOLLAR = 100;

/** Clamp to a non-negative integer count of cents. */
const c = (n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

const OON_NOTE = 'This estimate assumes the hospital is in your network. Out of network, your '
  + 'plan may pay less and the hospital may bill you for the difference.';

/**
 * @typedef {object} Benefits
 * @property {number|null} deductible     annual deductible, cents; null = unknown
 * @property {number}  deductibleMet      already paid toward it this year, cents
 * @property {number|null} coinsurance    patient share after deductible, 0..1; null = unknown
 * @property {number|null} copay          flat fee for this service, cents; null = none/unknown
 * @property {number|null} outOfPocketMax annual out-of-pocket maximum, cents; null = unknown
 * @property {number}  outOfPocketMet     already paid toward it this year, cents
 * @property {number|null} oonOutOfPocketMax  out-of-network out-of-pocket maximum, cents;
 *                                             an in-network maximum is never assumed to apply
 *                                             out of network
 * @property {number}  oonOutOfPocketMet
 * @property {boolean} copayWaivesDeductible  true when the copay is charged instead
 *                                            of the deductible (typical PPO office
 *                                            visit); false on most HDHPs, where the
 *                                            deductible applies first
 * @property {boolean} inNetwork
 */

/** A plan with nothing filled in. Used as the starting point in the UI. */
export const emptyBenefits = () => ({
  deductible: null,
  deductibleMet: 0,
  coinsurance: null,
  copay: null,
  outOfPocketMax: null,
  outOfPocketMet: 0,
  oonOutOfPocketMax: null,
  oonOutOfPocketMet: 0,
  copayWaivesDeductible: true,
  inNetwork: true,
});

/**
 * Estimate the patient's share of one procedure.
 *
 * @param {number} allowed  the negotiated rate for this hospital and plan, in cents
 * @param {Benefits} b
 * @returns {{
 *   patient: number|null, plan: number|null, allowed: number,
 *   toDeductible: number, toCoinsurance: number, toCopay: number,
 *   cappedByOopMax: boolean, deductibleAfter: number, oopAfter: number,
 *   missing: string[], notes: string[]
 * }}
 */
export function estimate(allowed, b) {
  const notes = [];
  const A = c(allowed);

  const deductible = b.deductible == null ? null : c(b.deductible);
  const deductibleMet = c(b.deductibleMet);
  const coins = b.coinsurance == null ? null : Math.min(1, Math.max(0, Number(b.coinsurance) || 0));
  const copay = b.copay == null ? null : c(b.copay);
  const inNetwork = b.inNetwork !== false;

  // Out of network never silently inherits the in-network maximum: without an
  // explicit out-of-network figure, that cap is simply unknown.
  const oopMaxRaw = inNetwork ? b.outOfPocketMax : b.oonOutOfPocketMax;
  const oopMetRaw = inNetwork ? b.outOfPocketMet : b.oonOutOfPocketMet;
  const oopMax = oopMaxRaw == null ? null : c(oopMaxRaw);
  const oopMet = oopMax ? Math.min(c(oopMetRaw), oopMax) : c(oopMetRaw || 0);
  const oopRoom = oopMax ? Math.max(0, oopMax - oopMet) : Infinity;

  if (A === 0) {
    return {
      patient: 0, plan: 0, allowed: 0,
      toDeductible: 0, toCoinsurance: 0, toCopay: 0,
      cappedByOopMax: false, deductibleAfter: Math.min(deductible ?? 0, deductibleMet), oopAfter: oopMet,
      missing: [], notes: ['No negotiated rate was published for this combination.'],
    };
  }

  if (oopMax != null && oopRoom === 0) {
    notes.push('You have already reached your out-of-pocket maximum, so the plan pays the full amount.');
    if (!inNetwork) notes.push(OON_NOTE);
    return {
      patient: 0, plan: A, allowed: A,
      toDeductible: 0, toCoinsurance: 0, toCopay: 0,
      cappedByOopMax: true, deductibleAfter: Math.min(deductible ?? 0, deductibleMet), oopAfter: oopMet,
      missing: [], notes,
    };
  }

  // A copay that stands in for the whole patient share needs nothing else;
  // any other path needs to know the deductible and the coinsurance rate.
  const copayCovers = copay != null && b.copayWaivesDeductible;

  const missing = [];
  if (!copayCovers) {
    if (deductible == null) missing.push('deductible');
    if (coins == null) missing.push('coinsurance');
  }

  if (missing.length) {
    if (!inNetwork) notes.push(OON_NOTE);
    return {
      patient: null, plan: null, allowed: A,
      toDeductible: 0, toCoinsurance: 0, toCopay: 0,
      cappedByOopMax: false, deductibleAfter: deductibleMet, oopAfter: oopMet,
      missing,
      notes: [`Enter your ${missing.join(' and ')} to see a number.`, ...notes],
    };
  }

  let toDeductible = 0, toCoinsurance = 0, toCopay = 0;

  if (copayCovers) {
    // PPO-style: the copay is the whole patient share for this service.
    toCopay = Math.min(copay, A);
    if (copay > A) notes.push('Your copay is higher than the negotiated rate, so you pay the lower negotiated rate.');
  } else {
    const dedMet = Math.min(deductibleMet, deductible);
    const deductibleLeft = Math.max(0, deductible - dedMet);
    toDeductible = Math.min(A, deductibleLeft);
    const afterDeductible = A - toDeductible;
    toCoinsurance = Math.round(afterDeductible * coins);
    if (copay != null && !b.copayWaivesDeductible) {
      // HDHP-style: deductible first, then the copay applies to what remains.
      toCopay = Math.min(copay, Math.max(0, afterDeductible - toCoinsurance));
      notes.push('On this plan the deductible applies before the copay.');
    }
  }

  let patient = toDeductible + toCoinsurance + toCopay;
  let cappedByOopMax = false;
  if (oopRoom !== Infinity && patient > oopRoom) {
    cappedByOopMax = true;
    // Reallocate what is actually paid, in the order it was charged, so the
    // three components still sum to the (now capped) patient share and the
    // deductible progress reflects only what really went toward it.
    let room = oopRoom;
    const nd = Math.min(toDeductible, room); room -= nd;
    const nc = Math.min(toCoinsurance, room); room -= nc;
    const ncp = Math.min(toCopay, room); room -= ncp;
    toDeductible = nd; toCoinsurance = nc; toCopay = ncp;
    patient = toDeductible + toCoinsurance + toCopay;
    notes.push('Your out-of-pocket maximum caps this bill.');
  }
  patient = Math.min(patient, A);

  if (!inNetwork) notes.push(OON_NOTE);

  return {
    patient,
    plan: A - patient,
    allowed: A,
    toDeductible, toCoinsurance, toCopay,
    cappedByOopMax,
    deductibleAfter: deductible == null ? deductibleMet : Math.min(deductible, deductibleMet + toDeductible),
    oopAfter: oopMet + patient,
    missing: [],
    notes,
  };
}

/**
 * Estimate against a spread of negotiated rates (a hospital usually publishes
 * many for one code). Returns the patient cost at the low, middle and high rate.
 */
export function estimateRange(sortedAllowed, b) {
  if (!sortedAllowed?.length) return null;
  const at = (p) => sortedAllowed[Math.min(sortedAllowed.length - 1, Math.floor(p * sortedAllowed.length))];
  return {
    low: estimate(sortedAllowed[0], b),
    mid: estimate(at(0.5), b),
    high: estimate(sortedAllowed[sortedAllowed.length - 1], b),
  };
}

export const fmtUSD = (cents, { round = false } = {}) => {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const d = cents / 100;
  return d.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: round ? 0 : 2,
    maximumFractionDigits: round ? 0 : 2,
  });
};
