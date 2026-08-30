import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Explain from './Explain.jsx';
import MoneyInput from './MoneyInput.jsx';
import ChoiceRow from './ChoiceRow.jsx';
import CarrierPicker from './CarrierPicker.jsx';
import { fmtUSD } from '../lib/estimate.js';

const $ = (d) => d * 100;

// The round numbers real US plans actually use. Anything else goes in "Other".
const DEDUCTIBLES = [
  { label: 'None', value: 0 },
  { label: '$500', value: $(500) },
  { label: '$1,000', value: $(1000) },
  { label: '$2,000', value: $(2000) },
  { label: '$3,000', value: $(3000) },
  { label: '$5,000', value: $(5000) },
];
const COINSURANCE = [
  { label: '0%', value: 0 },
  { label: '10%', value: 0.1 },
  { label: '20%', value: 0.2 },
  { label: '30%', value: 0.3 },
  { label: '40%', value: 0.4 },
];
const OOP = [
  { label: '$3,000', value: $(3000) },
  { label: '$5,000', value: $(5000) },
  { label: '$7,500', value: $(7500) },
  { label: '$9,200', value: $(9200) },
];

function Field({ title, explain, children }) {
  return (
    <div className="py-6 border-t rule first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3.5">
        <h4 className="text-[1rem] font-semibold tracking-[-0.014em]">{title}</h4>
        {explain}
      </div>
      {children}
    </div>
  );
}

export default function InsurancePanel({
  payers, plans, availableBrands, availablePlans,
  brand, planId, onBrand, onPlan,
  benefits, onBenefits, open, onToggle, preview,
}) {
  const set = (k, v) => onBenefits({ ...benefits, [k]: v });

  const carriers = useMemo(() => {
    const list = [...availableBrands.entries()].map(([name, n]) => ({ name, n }));
    list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return list;
  }, [availableBrands]);

  const planOptions = useMemo(() => {
    const list = [...availablePlans].map((i) => ({ i, name: plans[i] || '' })).filter((p) => p.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [availablePlans, plans]);

  return (
    <section className="rounded-[18px] bg-card border rule overflow-hidden">
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-paper-2/60 transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-[1.125rem] font-semibold tracking-[-0.018em]">
            Add your insurance
          </span>
          <span className="block t-small opacity-55 mt-1">
            {!brand
              ? 'Optional. Uses your real negotiated rate and estimates what you would pay.'
              : `${brand}${planId != null && plans[planId] ? ` · ${plans[planId]}` : ''}`}
          </span>
        </span>
        <span className={`shrink-0 w-9 h-9 rounded-full grid place-items-center transition-colors
                          ${open ? 'bg-ink text-paper' : 'bg-paper-2'}`}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2"
               className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
            <path d="M4.5 7 9 11.5 13.5 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t rule">
          <Field
            title="Who insures you"
            explain={
              <Explain term="Finding your insurer" label="Not sure?"
                       where="The name printed on the front of your insurance card.">
                Hospitals write insurer names their own way — “AETNA”, “Aetna - BoB”,
                “AETNA MEDICARE [1003]”. Picking a carrier here matches every spelling of it,
                so you see all of that insurer's rates rather than one file's version.
              </Explain>
            }
          >
            <CarrierPicker options={carriers} value={brand} onChange={onBrand} />
          </Field>

          {brand && planOptions.length > 0 && (
            <Field title="Which plan" explain={<span className="t-small opacity-45">Optional</span>}>
              <select
                className="field h-14 text-[1rem]"
                value={planId ?? ''}
                onChange={(e) => onPlan(e.target.value === '' ? null : +e.target.value)}
              >
                <option value="">Any plan from {brand}</option>
                {planOptions.map((p) => <option key={p.i} value={p.i}>{p.name}</option>)}
              </select>
              <p className="t-small opacity-50 mt-2.5">
                Your plan name is on your card, usually under the insurer's logo.
              </p>
            </Field>
          )}

          <Field
            title="Your yearly deductible"
            explain={
              <Explain term="Deductible"
                       where="Your insurance card, or the Summary of Benefits and Coverage your insurer or employer sent you.">
                What you pay yourself each year before insurance starts paying its share. If your
                deductible is $2,000, you pay the first $2,000 of your care. Most plans reset it
                every January.
              </Explain>
            }
          >
            <ChoiceRow id="ded" value={benefits.deductible} onChange={(v) => set('deductible', v)} options={DEDUCTIBLES} />
            {benefits.deductible > 0 && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <label htmlFor="dedmet" className="t-small opacity-65">Already paid toward it this year</label>
                <div className="w-[9rem]">
                  <MoneyInput id="dedmet" value={benefits.deductibleMet} onChange={(v) => set('deductibleMet', v)} />
                </div>
              </div>
            )}
          </Field>

          <Field
            title="Your coinsurance"
            explain={
              <Explain term="Coinsurance" where="Summary of Benefits and Coverage, listed next to each type of service.">
                Your share of the bill after the deductible is met, as a percentage. At 20% on a
                $1,000 procedure you pay $200 and the plan pays $800. This is why the hospital you
                pick still matters after you have met your deductible.
              </Explain>
            }
          >
            <ChoiceRow id="coins" value={benefits.coinsurance} onChange={(v) => set('coinsurance', v)} options={COINSURANCE} suffix="%" />
          </Field>

          <Field
            title="Your out-of-pocket maximum"
            explain={
              <Explain term="Out-of-pocket maximum" where="Summary of Benefits and Coverage, near the deductible.">
                The most you can be made to pay in one year for covered, in-network care. Once you
                reach it, the plan pays everything else it covers. This is the number that protects
                you from a catastrophic bill.
              </Explain>
            }
          >
            <ChoiceRow id="oop" value={benefits.outOfPocketMax} onChange={(v) => set('outOfPocketMax', v)} options={OOP} />
            {benefits.outOfPocketMax > 0 && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <label htmlFor="oopmet" className="t-small opacity-65">Already paid toward it this year</label>
                <div className="w-[9rem]">
                  <MoneyInput id="oopmet" value={benefits.outOfPocketMet} onChange={(v) => set('outOfPocketMet', v)} />
                </div>
              </div>
            )}
          </Field>

          <Field
            title="Anything else about your plan"
            explain={
              <Explain term="Copays and high-deductible plans" where="The front of your insurance card, and your plan documents.">
                A copay is a flat fee for a visit, like $40, instead of a percentage. On a
                high-deductible plan you pay the full negotiated price until the deductible is met,
                even for services that would normally have a copay.
              </Explain>
            }
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox" className="w-4 h-4 accent-[var(--color-accent)]"
                  checked={!benefits.copayWaivesDeductible}
                  onChange={(e) => set('copayWaivesDeductible', !e.target.checked)}
                />
                <span className="text-[0.9375rem]">High-deductible health plan</span>
              </label>
              <div className="flex items-center gap-3">
                <label htmlFor="copay" className="text-[0.9375rem]">Flat copay</label>
                <div className="w-[8.5rem]">
                  <MoneyInput id="copay" value={benefits.copay ?? 0} onChange={(v) => set('copay', v === 0 ? null : v)} placeholder="none" />
                </div>
              </div>
            </div>
          </Field>

          {/* the answer, kept on screen while the form is filled in */}
          {preview && (
            <div className="mt-2 -mx-6 -mb-6 px-6 py-6 bg-ink text-paper">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <span className="t-label opacity-50">With these numbers, you would pay</span>
                {preview.saving > 0 && (
                  <span className="t-small" style={{ color: 'var(--color-accent-dk)' }}>
                    choosing well saves {fmtUSD(preview.saving, { round: true })}
                  </span>
                )}
              </div>
              <div className="flex items-end gap-8 mt-4 flex-wrap">
                <div>
                  <div className="t-num text-[2.5rem]" style={{ color: 'var(--color-accent-dk)' }}>
                    {fmtUSD(preview.cheapest, { round: true })}
                  </div>
                  <div className="t-small opacity-50 mt-1">at the cheapest hospital</div>
                </div>
                <div>
                  <div className="t-num text-[1.5rem] opacity-70">{fmtUSD(preview.dearest, { round: true })}</div>
                  <div className="t-small opacity-50 mt-1">at the dearest</div>
                </div>
              </div>
            </div>
          )}

          {!preview && (
            <div className="mt-2 p-5 rounded-[14px] bg-paper-2">
              <p className="text-[0.9375rem] font-semibold">Do not know these numbers?</p>
              <p className="t-small opacity-70 mt-1.5 max-w-[64ch]">
                Every plan must give you a Summary of Benefits and Coverage — a short standard
                document listing your deductible, coinsurance, copays and out-of-pocket maximum on
                the first page. Ask your employer's benefits contact, or download it from your
                insurer's website.
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Link to="/insurance" className="btn btn-ink !py-2 !px-4 !text-[0.8125rem]">Plain-English guide</Link>
                <a href="https://www.healthcare.gov/glossary/" target="_blank" rel="noopener noreferrer"
                   className="btn btn-ghost !py-2 !px-4 !text-[0.8125rem]">
                  Healthcare.gov glossary
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </a>
              </div>
            </div>
          )}

          {benefits.outOfPocketMax > 0 && benefits.outOfPocketMax < benefits.deductible && (
            <p className="t-small mt-4 px-4 py-3 rounded-[12px] bg-[var(--color-mid-tint)]">
              Your out-of-pocket maximum is lower than your deductible. That is unusual — worth
              checking both numbers on your plan documents.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
