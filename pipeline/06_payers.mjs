#!/usr/bin/env node
/**
 * Groups the payer names hospitals wrote in their files into the carriers
 * patients actually recognise.
 *
 * Hospitals spell the same insurer a dozen ways — "AETNA", "Aetna - BoB",
 * "AETNA MEDICARE [1003]". Asking a patient to pick the right string is asking
 * them to do the hospital's data entry. This maps every variant onto one brand,
 * and selecting the brand matches all of its variants.
 *
 * Conservative by design: a name that matches no known carrier keeps its own
 * wording rather than being forced into a bucket.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const payers = JSON.parse(fs.readFileSync(path.join(DATA, 'payers.json'), 'utf8'));

/** Commercial carriers, checked against the whole name. */
const CARRIERS = [
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

/**
 * Classify one raw payer name.
 * Government programmes are decided first, because "UNITED HEALTHCARE MEDICARE"
 * is Medicare coverage to the patient, not a commercial UnitedHealthcare plan.
 */
function classify(raw) {
  const s = (raw || '').toLowerCase();
  if (!s.trim()) return 'Unnamed payer';

  const carrier = CARRIERS.find(([, re]) => re.test(s));

  if (/\bmedicaid\b|\bcardinal care\b|\bfamis\b|\bdmas\b/.test(s)) {
    return carrier ? `Medicaid managed care (${carrier[0]})` : 'Medicaid (Virginia Cardinal Care)';
  }
  if (/\bmedicare\b/.test(s)) {
    const advantage = carrier || /\badvantage\b|\badv\b|\bpart c\b|\bmanaged medicare\b/.test(s);
    return advantage ? `Medicare Advantage${carrier ? ` (${carrier[0]})` : ''}` : 'Medicare (traditional)';
  }
  if (/\btricare\b|\bchampus\b|\bhumana military\b|\bva community care\b/.test(s)) return 'TRICARE / military';
  if (/\bworkers?['\s]?comp\b|\bwork comp\b|\bcorvel\b|\bsedgwick\b/.test(s)) return 'Workers compensation';
  if (/\bself\s?pay\b|\buninsured\b|\bcharity\b/.test(s)) return 'Self-pay / uninsured';

  return carrier ? carrier[0] : (raw || '').trim();
}

const groups = new Map();
const brandOf = payers.map((name, i) => {
  const brand = classify(name);
  let s = groups.get(brand);
  if (!s) groups.set(brand, s = new Set());
  s.add(i);
  return brand;
});

// A group is "known" when it is one of our curated names rather than a raw
// string we could not place. Known carriers sort first — they are what people look for.
const KNOWN = new Set([
  ...CARRIERS.map(([b]) => b),
  'Medicare (traditional)', 'Medicaid (Virginia Cardinal Care)',
  'TRICARE / military', 'Workers compensation', 'Self-pay / uninsured',
]);
const isKnown = (b) => KNOWN.has(b) || /^Medicare Advantage|^Medicaid managed care/.test(b);

const list = [...groups.entries()]
  .map(([brand, set]) => ({ brand, members: [...set].sort((a, b) => a - b), known: isKnown(brand) }))
  .sort((a, b) => (b.known - a.known) || (b.members.length - a.members.length) || a.brand.localeCompare(b.brand));

fs.writeFileSync(path.join(DATA, 'payer_groups.json'), JSON.stringify({ brandOf, groups: list }));

console.log(`${payers.length} raw payer names -> ${list.length} groups`);
for (const g of list.filter((g) => g.known).slice(0, 16)) {
  console.log(`   ${String(g.members.length).padStart(3)}  ${g.brand}`);
}
console.log(`   (${list.filter((g) => !g.known).length} names kept as-is because they match no known carrier)`);
