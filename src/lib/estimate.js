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
 */

export const DOLLAR = 100;

/** Clamp to a non-negative integer count of cents. */
const c = (n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * @typedef {object} Benefits
 * @property {number}  deductible        annual deductible, cents
 * @property {number}  deductibleMet     already paid toward it this year, cents
 * @property {number}  coinsurance       patient share after deductible, 0..1
 * @property {number|null} copay         flat fee for this service, cents, null if none
 * @property {number}  outOfPocketMax    annual out-of-pocket maximum, cents
 * @property {number}  outOfPocketMet    already paid toward it this year, cents
 * @property {boolean} copayWaivesDeductible  true when the copay is charged instead
 *                                            of the deductible (typical PPO office
 *                                            visit); false on most HDHPs, where the
 *                                            deductible applies first
 * @property {boolean} inNetwork
 */

/** A plan with nothing filled in. Used as the starting point in the UI. */
export const emptyBenefits = () => ({
  deductible: 0,
  deductibleMet: 0,
  coinsurance: 0.2,
  copay: null,
  outOfPocketMax: 0,
  outOfPocketMet: 0,
  copayWaivesDeductible: true,
  inNetwork: true,
});

/**
 * Estimate the patient's share of one procedure.
 *
 * @param {number} allowed  the negotiated rate for this hospital and plan, in cents
 * @param {Benefits} b
 * @returns {{
 *   patient: number, plan: number, allowed: number,
 *   toDeductible: number, toCoinsurance: number, toCopay: number,
 *   cappedByOopMax: boolean, deductibleAfter: number, oopAfter: number,
 *   notes: string[]
 * }}
 */
export function estimate(allowed, b) {
  const notes = [];
  const A = c(allowed);

  const deductible = c(b.deductible);
  const deductibleMet = Math.min(c(b.deductibleMet), deductible);
  const oopMax = c(b.outOfPocketMax);
  const oopMet = oopMax ? Math.min(c(b.outOfPocketMet), oopMax) : c(b.outOfPocketMet);
  const coins = Math.min(1, Math.max(0, Number(b.coinsurance) || 0));
  const copay = b.copay == null ? null : c(b.copay);

  // Headroom left under the out-of-pocket maximum. Zero means the plan pays all.
  const oopRoom = oopMax > 0 ? Math.max(0, oopMax - oopMet) : Infinity;

  if (A === 0) {
    return {
      patient: 0, plan: 0, allowed: 0,
      toDeductible: 0, toCoinsurance: 0, toCopay: 0,
      cappedByOopMax: false, deductibleAfter: deductibleMet, oopAfter: oopMet,
      notes: ['No negotiated rate was published for this combination.'],
    };
  }

  if (oopMax > 0 && oopRoom === 0) {
    notes.push('You have already reached your out-of-pocket maximum, so the plan pays the full amount.');
    return {
      patient: 0, plan: A, allowed: A,
      toDeductible: 0, toCoinsurance: 0, toCopay: 0,
      cappedByOopMax: true, deductibleAfter: deductibleMet, oopAfter: oopMet,
      notes,
    };
  }

  let toDeductible = 0, toCoinsurance = 0, toCopay = 0;

  if (copay != null && b.copayWaivesDeductible) {
    // PPO-style: the copay is the whole patient share for this service.
    toCopay = Math.min(copay, A);
    if (copay > A) notes.push('Your copay is higher than the negotiated rate, so you pay the lower negotiated rate.');
  } else {
    const deductibleLeft = Math.max(0, deductible - deductibleMet);
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
  if (patient > oopRoom) {
    patient = oopRoom;
    cappedByOopMax = true;
    notes.push('Your out-of-pocket maximum caps this bill.');
  }
  patient = Math.min(patient, A);

  if (!b.inNetwork) {
    notes.push(
      'This estimate assumes the hospital is in your network. Out of network, your '
      + 'plan may pay less and the hospital may bill you for the difference.'
    );
  }

  return {
    patient,
    plan: A - patient,
    allowed: A,
    toDeductible, toCoinsurance, toCopay,
    cappedByOopMax,
    deductibleAfter: Math.min(deductible, deductibleMet + toDeductible),
    oopAfter: oopMet + patient,
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
