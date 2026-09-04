/**
 * Who the payer is, and what kind of coverage the patient actually has.
 *
 * Pure functions, no file access, so the rules can be tested directly and read
 * without running a build. 06_payers.mjs is the IO around them.
 */
/** Commercial carriers, checked against the whole name. */
export const CARRIERS = [
  ['Aetna',                          /\baetna\b/],
  ['Anthem Blue Cross Blue Shield',  /\banthem\b|\bhealthkeepers?\b/],
  ['CareFirst BlueCross BlueShield', /\bcarefirst\b/],
  ['Cigna',                          /\bcigna\b|\bevernorth\b|\bhealthspring\b/],
  ['UnitedHealthcare',               /\bunited\s?health|\bunitedhealthcare\b|\buhc\b|\buhg\b|\boptum\b|\bgolden rule\b|\boxford health\b/],
  ['Humana',                         /\bhumana\b/],
  ['Kaiser Permanente',              /\bkaiser\b/],
  ['Sentara Health Plans (Optima)',  /\bsentara\b|\boptima\b|\bvirginia premier\b/],
  ['Ambetter / Centene',             /\bambetter\b|\bcentene\b|\bmagellan\b/],
  ['Molina Healthcare',              /\bmolina\b/],
  ['Oscar Health',                   /\boscar\b/],
  ['Devoted Health',                 /\bdevoted\b/],
  ['WellCare',                       /\bwellcare\b/],
  ['Alignment Health',               /\balignment\b/],
  ['Piedmont Community Health',      /\bpiedmont\b/],
  ['Blue Cross Blue Shield (other)', /\bblue\s?cross\b|\bblue\s?shield\b|\bbcbs\w*\b|\bhighmark\b|\bfederal employee program\b|\bfep\b/],
  ['MultiPlan / PHCS',               /\bmultiplan\b|\bphcs\b|\bprivate healthcare systems\b/],
  ['First Health / Coventry',        /\bfirst health\b|\bcoventry\b/],
];

export const SEGMENTS = ['medicare', 'medicare_advantage', 'medicaid', 'exchange', 'commercial', 'other'];

/**
 * Which kind of coverage is this, from the payer and plan strings together.
 *
 * Deliberately conservative, and the order matters. A name mentioning both
 * Medicare and a carrier is Medicare Advantage — that is the product being sold
 * — while a bare "MEDICARE" is traditional fee-for-service. Anything with no
 * signal at all is `commercial` at low confidence rather than being asserted,
 * and anything that is plainly not insurance is `other`.
 *
 * Returns { segment, confidence: 'high' | 'medium' | 'low', signal }.
 */
export function classifySegment(payerRaw, planRaw = '') {
  const s = `${payerRaw || ''} ${planRaw || ''}`.toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { segment: 'other', confidence: 'low', signal: 'empty name' };

  const carrier = CARRIERS.find(([, re]) => re.test(s));
  const hit = (re, label) => (re.test(s) ? label : null);

  // Not insurance at all.
  const notInsurance = hit(/\bself\s?pay\b|\buninsured\b|\bcharity\b|\bcash\b|\bgross charge\b|\bchargemaster\b/, 'self pay')
    || hit(/\bworkers?['\s]?comp\b|\bwork comp\b|\bcorvel\b|\bsedgwick\b|\bliability\b|\bauto\b|\bpip\b/, 'workers comp / liability')
    || hit(/\btricare\b|\bchampus\b|\bhumana military\b|\bva community care\b|\bveterans\b|\bchampva\b/, 'military / veterans')
    || hit(/\bcorrection|\binmate\b|\bsheriff\b|\bjail\b/, 'corrections');
  if (notInsurance) return { segment: 'other', confidence: 'high', signal: notInsurance };

  // Medicaid first: a Medicaid managed-care product carries a commercial brand
  // but is Medicaid coverage to the patient.
  const medicaid = hit(/\bmedicaid\b|\bcardinal care\b|\bfamis\b|\bdmas\b|\bcommunity plan\b|\bmedallion\b|\bccc plus\b/, 'medicaid wording');
  if (medicaid) return { segment: 'medicaid', confidence: carrier ? 'high' : 'medium', signal: medicaid };

  if (/\bmedicare\b|\bmcr\b(?!\w)/.test(s)) {
    const advantage = /\badvantage\b|\bma\b(?!\w)|\bpart c\b|\bmanaged medicare\b|\bhmo\b|\bppo\b|\bsnp\b|\bdual\b/.test(s) || !!carrier;
    if (advantage) {
      return {
        segment: 'medicare_advantage',
        confidence: carrier && /\badvantage\b|\bpart c\b|\bsnp\b/.test(s) ? 'high' : 'medium',
        signal: carrier ? `medicare + ${carrier[0]}` : 'medicare + advantage wording',
      };
    }
    return { segment: 'medicare', confidence: 'high', signal: 'medicare, no managed-care marker' };
  }

  const exchange = hit(/\bexchange\b|\bmarketplace\b|\bhealthcare\.gov\b|\bqhp\b|\bon\s?ex\b|\bindividual (and|&) family\b|\bmetal\b|\b(bronze|silver|gold|platinum)\b/, 'exchange wording');
  if (exchange) return { segment: 'exchange', confidence: 'medium', signal: exchange };

  if (carrier) return { segment: 'commercial', confidence: 'high', signal: carrier[0] };
  return { segment: 'commercial', confidence: 'low', signal: 'no segment marker; treated as commercial' };
}

/** Classify one raw payer name into the carrier brand a patient would recognise. */
export function classifyBrand(raw) {
  const s = (raw || '').toLowerCase();
  if (!s.trim()) return 'Unnamed payer';
  const carrier = CARRIERS.find(([, re]) => re.test(s));
  const seg = classifySegment(raw, '');
  if (seg.segment === 'medicaid') return carrier ? `Medicaid managed care (${carrier[0]})` : 'Medicaid (Virginia Cardinal Care)';
  if (seg.segment === 'medicare_advantage') return `Medicare Advantage${carrier ? ` (${carrier[0]})` : ''}`;
  if (seg.segment === 'medicare') return 'Medicare (traditional)';
  if (seg.segment === 'other') {
    if (/\btricare\b|\bchampus\b|\bhumana military\b|\bva community care\b|\bveterans\b|\bchampva\b/.test(s)) return 'TRICARE / military';
    if (/\bworkers?['\s]?comp\b|\bwork comp\b|\bcorvel\b|\bsedgwick\b/.test(s)) return 'Workers compensation';
    if (/\bself\s?pay\b|\buninsured\b|\bcharity\b/.test(s)) return 'Self-pay / uninsured';
  }
  return carrier ? carrier[0] : (raw || '').trim();
}

