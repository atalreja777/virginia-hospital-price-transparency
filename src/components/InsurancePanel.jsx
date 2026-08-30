import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Explain from './Explain.jsx';
import MoneyInput from './MoneyInput.jsx';
import { fmtUSD } from '../lib/estimate.js';

/**
 * Insurance selection and benefits entry.
 *
 * The payer and plan lists are the names the hospitals themselves published in
 * their files, not a tidied-up marketing list. That is deliberate: matching the
 * user to the exact string in the file is what makes the rate real rather than
 * an average.
 */
export default function InsurancePanel({
  payers, plans, availableBrands, availablePlans,
  brand, planId, onBrand, onPlan,
  benefits, onBenefits, open, onToggle,
}) {
  const [payerQuery, setPayerQuery] = useState('');
  const set = (k, v) => onBenefits({ ...benefits, [k]: v });

  // Carriers that actually appear for this procedure, commonest first.
  const brandOptions = useMemo(() => {
    const list = [...availableBrands.entries()].map(([name, n]) => ({ name, n }));
    list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const q = payerQuery.trim().toLowerCase();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [availableBrands, payerQuery]);

  const planOptions = useMemo(() => {
    const list = [...availablePlans].map((i) => ({ i, name: plans[i] || '' })).filter((p) => p.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [availablePlans, plans]);

  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-paper-2 transition-colors"
      >
        <span>
          <span className="t-label opacity-45 block">Step 2</span>
          <span className="font-semibold tracking-[-0.016em] text-[1.0625rem] block mt-1">
            Your insurance
          </span>
          <span className="t-small opacity-60 block mt-0.5">
            {!brand
              ? 'Optional. Adds your real negotiated rate and what you would pay.'
              : `${brand}${planId != null && plans[planId] ? ` · ${plans[planId]}` : ''}`}
          </span>
        </span>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8"
             className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="M4.5 7 9 11.5 13.5 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t rule pt-5 space-y-6">
          {/* ---------------------------------------------------- insurer */}
          <div>
            <label htmlFor="payer" className="t-label opacity-55 block mb-2">Who insures you</label>
            <input
              className="field mb-2"
              placeholder="Type to filter, e.g. Anthem, Aetna, Cigna, Medicare"
              value={payerQuery}
              onChange={(e) => setPayerQuery(e.target.value)}
            />
            <select
              id="payer"
              className="field"
              value={brand ?? ''}
              onChange={(e) => onBrand(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">Not selected — show all published prices</option>
              {brandOptions.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <p className="t-small opacity-55 mt-2">
              Hospitals spell insurers many different ways in their files. Picking a carrier here
              matches every spelling of it, so you see all of that insurer's rates.
            </p>
          </div>

          {/* ------------------------------------------------------- plan */}
          {brand && planOptions.length > 0 && (
            <div>
              <label htmlFor="plan" className="t-label opacity-55 block mb-2">Which plan</label>
              <select
                id="plan" className="field"
                value={planId ?? ''}
                onChange={(e) => onPlan(e.target.value === '' ? null : +e.target.value)}
              >
                <option value="">Any plan from this insurer</option>
                {planOptions.map((p) => <option key={p.i} value={p.i}>{p.name}</option>)}
              </select>
              <p className="t-small opacity-55 mt-2">
                Your plan name is printed on your insurance card, usually under the insurer's logo.
              </p>
            </div>
          )}

          {/* --------------------------------------------------- benefits */}
          <div className="pt-5 border-t rule">
            <p className="font-semibold tracking-[-0.016em] text-[1.0625rem]">What your plan makes you pay</p>
            <p className="t-small opacity-65 mt-1.5 mb-5">
              Fill in what you know. Every box is optional, and each one has an explanation
              if the word is unfamiliar. Nothing you type leaves your browser.
            </p>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="ded" className="t-small font-medium">
                  Yearly deductible
                  <Explain
                    term="Deductible"
                    where="Your insurance card, or the Summary of Benefits and Coverage your insurer or employer sent you. Your insurer's website shows it under plan details."
                  >
                    The amount you pay yourself each year before your insurance starts paying
                    its share. If your deductible is $2,000, you pay the first $2,000 of your
                    care. Most plans reset it every January.
                  </Explain>
                </label>
                <div className="mt-2"><MoneyInput id="ded" value={benefits.deductible} onChange={(v) => set('deductible', v)} placeholder="2,000" /></div>
              </div>

              <div>
                <label htmlFor="dedmet" className="t-small font-medium">
                  Already paid toward it
                  <Explain
                    term="Deductible met so far"
                    where="Log in to your insurer's website and look for “deductible” on your plan summary. It updates as claims are processed."
                  >
                    How much of this year's deductible you have already paid. If you have had
                    no care this year, this is zero.
                  </Explain>
                </label>
                <div className="mt-2"><MoneyInput id="dedmet" value={benefits.deductibleMet} onChange={(v) => set('deductibleMet', v)} /></div>
              </div>

              <div>
                <label htmlFor="coins" className="t-small font-medium">
                  Coinsurance
                  <Explain
                    term="Coinsurance"
                    where="Summary of Benefits and Coverage, usually written as “20% coinsurance” next to each service."
                  >
                    Your share of the bill after you have met your deductible, written as a
                    percentage. At 20% coinsurance on a $1,000 procedure, you pay $200 and
                    the plan pays $800.
                  </Explain>
                </label>
                <div className="relative mt-2">
                  <input
                    id="coins" type="number" min="0" max="100" step="1"
                    className="field pr-9 tnum"
                    value={Math.round((benefits.coinsurance ?? 0) * 100)}
                    onChange={(e) => set('coinsurance', Math.min(100, Math.max(0, +e.target.value || 0)) / 100)}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 opacity-45 pointer-events-none">%</span>
                </div>
              </div>

              <div>
                <label htmlFor="copay" className="t-small font-medium">
                  Copay for this service
                  <Explain
                    term="Copay"
                    where="Printed on the front of your insurance card, often as separate amounts for “office visit”, “specialist” and “emergency”."
                  >
                    A flat fee for a visit or service, like $40, no matter what the hospital
                    charges. Where a plan uses a copay, it usually replaces coinsurance for
                    that service. Leave this blank if your plan does not use one.
                  </Explain>
                </label>
                <div className="mt-2">
                  <MoneyInput id="copay" value={benefits.copay ?? 0} onChange={(v) => set('copay', v === 0 ? null : v)} placeholder="none" />
                </div>
              </div>

              <div>
                <label htmlFor="oop" className="t-small font-medium">
                  Out-of-pocket maximum
                  <Explain
                    term="Out-of-pocket maximum"
                    where="Summary of Benefits and Coverage, near the deductible. Your insurer's website shows how much of it you have used."
                  >
                    The most you can be made to pay in one year. Once you reach it, your plan
                    pays everything else it covers for the rest of the year. This is the number
                    that protects you from a catastrophic bill.
                  </Explain>
                </label>
                <div className="mt-2"><MoneyInput id="oop" value={benefits.outOfPocketMax} onChange={(v) => set('outOfPocketMax', v)} placeholder="8,000" /></div>
              </div>

              <div>
                <label htmlFor="oopmet" className="t-small font-medium">
                  Already paid toward the maximum
                  <Explain term="Out-of-pocket met so far" where="Your insurer's website, on the same page as your deductible.">
                    Everything you have paid this year that counts toward the maximum, including
                    what went to your deductible.
                  </Explain>
                </label>
                <div className="mt-2"><MoneyInput id="oopmet" value={benefits.outOfPocketMet} onChange={(v) => set('outOfPocketMet', v)} /></div>
              </div>
            </div>

            <label className="flex items-start gap-2.5 mt-5 cursor-pointer">
              <input
                type="checkbox" className="mt-1"
                checked={!benefits.copayWaivesDeductible}
                onChange={(e) => set('copayWaivesDeductible', !e.target.checked)}
              />
              <span className="t-small">
                My plan is a high-deductible health plan
                <Explain term="High-deductible health plan" where="Your plan documents. If you have a health savings account, you almost certainly have one.">
                  On these plans you pay the full negotiated price until the deductible is met,
                  even for services that would otherwise have a copay. Ticking this makes the
                  estimate apply your deductible first.
                </Explain>
              </span>
            </label>

            <div className="mt-6 p-4 rounded-[2px] bg-paper-2 border rule">
              <p className="t-small font-medium">Do not know these numbers?</p>
              <p className="t-small opacity-75 mt-1.5">
                Every plan must give you a Summary of Benefits and Coverage, a short standard
                document listing your deductible, coinsurance, copays and out-of-pocket maximum.
                Ask your employer's benefits contact, or download it from your insurer's website.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/insurance" className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">Read the plain-English guide</Link>
                <a href="https://www.healthcare.gov/glossary/" target="_blank" rel="noopener noreferrer"
                   className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                  Healthcare.gov glossary
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </div>
            </div>

            {benefits.outOfPocketMax > 0 && benefits.outOfPocketMax < benefits.deductible && (
              <p className="t-small mt-4 px-3 py-2.5 rounded-[2px] bg-[#FDF3E7] border border-[#E8C9A0]">
                Your out-of-pocket maximum is lower than your deductible. That is unusual — worth
                double-checking both numbers on your plan documents.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
