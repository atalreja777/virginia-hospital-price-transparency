import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CarrierPicker from './CarrierPicker.jsx';
import ChoiceRow from './ChoiceRow.jsx';
import MoneyInput from './MoneyInput.jsx';
import Explain from './Explain.jsx';
import { fmtUSD } from '../lib/estimate.js';

const $ = (d) => d * 100;
const DEDUCTIBLES = [
  { label: 'None', value: 0 }, { label: '$500', value: $(500) }, { label: '$1,000', value: $(1000) },
  { label: '$2,000', value: $(2000) }, { label: '$3,000', value: $(3000) }, { label: '$5,000', value: $(5000) },
];
const COINSURANCE = [
  { label: '0%', value: 0 }, { label: '10%', value: 0.1 }, { label: '20%', value: 0.2 },
  { label: '30%', value: 0.3 }, { label: '40%', value: 0.4 },
];
const OOP = [
  { label: '$3,000', value: $(3000) }, { label: '$5,000', value: $(5000) },
  { label: '$7,500', value: $(7500) }, { label: '$9,200', value: $(9200) },
];

/**
 * The insurance details, asked one question at a time.
 *
 * Six fields on one screen is a wall; the same six as four short steps is a
 * conversation. Every step can be skipped, because a partial answer still
 * improves the estimate, and the last step shows what the answers bought you.
 *
 * Deliberately not opened on arrival. People reach this page worried about a
 * bill, and a dialog that blocks the prices they came for is the pattern
 * everyone has learned to dismiss without reading.
 */
export default function InsuranceWizard({
  open, onClose, carriers, plans, availablePlans,
  brand, planId, onBrand, onPlan, benefits, onBenefits, preview,
}) {
  const [step, setStep] = useState(0);
  const panel = useRef(null);
  const set = (k, v) => onBenefits({ ...benefits, [k]: v });

  useEffect(() => { if (open) setStep(0); }, [open]);

  // Escape closes; focus moves in; the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const planOptions = useMemo(() => {
    const list = [...availablePlans].map((i) => ({ i, name: plans[i] || '' })).filter((p) => p.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [availablePlans, plans]);

  if (!open) return null;

  const STEPS = ['Insurer', 'Deductible', 'Your share', 'Estimate'];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <button
        aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        style={{ animation: 'fadeIn .25s ease both' }}
      />

      <div
        ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add your insurance"
        className="relative w-full sm:max-w-[38rem] max-h-[92vh] sm:max-h-[86vh] flex flex-col
                   bg-card rounded-t-[28px] sm:rounded-[28px] overflow-hidden outline-none
                   shadow-[0_28px_80px_-20px_rgb(20_18_15/0.4)]"
        style={{ animation: 'sheetUp .42s cubic-bezier(.16,1,.3,1) both' }}
      >
        {/* progress */}
        <div className="px-6 pt-5 pb-4 border-b rule">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[1.125rem] font-semibold tracking-[-0.018em]">Add your insurance</h2>
            <button onClick={onClose} aria-label="Close"
                    className="w-9 h-9 rounded-full grid place-items-center hover:bg-paper-2 transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-4">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1">
                <div className="h-[3px] rounded-full overflow-hidden bg-paper-3">
                  <div className="h-full rounded-full transition-[width] duration-500 ease-out"
                       style={{ width: i <= step ? '100%' : '0%', background: 'var(--color-accent)' }} />
                </div>
                <div className={`t-small mt-1.5 transition-opacity ${i === step ? 'opacity-100 font-semibold' : 'opacity-35'}`}>
                  {s}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-6 py-6">
          {step === 0 && (
            <div style={{ animation: 'stepIn .35s cubic-bezier(.16,1,.3,1) both' }}>
              <h3 className="text-[1.375rem] font-semibold tracking-[-0.022em]">Who insures you?</h3>
              <p className="t-small opacity-60 mt-2 mb-5 max-w-[46ch]">
                Pick the name on your card. Hospitals spell insurers many ways in their files —
                choosing here matches every spelling, so you see all of that insurer's rates.
              </p>
              <CarrierPicker options={carriers} value={brand} onChange={onBrand} />
              {brand && planOptions.length > 0 && (
                <div className="mt-5">
                  <label className="text-[0.9375rem] font-semibold block mb-2">Which plan? <span className="opacity-40 font-normal">Optional</span></label>
                  <select className="field h-13 text-[0.9375rem]" value={planId ?? ''}
                          onChange={(e) => onPlan(e.target.value === '' ? null : +e.target.value)}>
                    <option value="">Any plan from {brand}</option>
                    {planOptions.map((p) => <option key={p.i} value={p.i}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div style={{ animation: 'stepIn .35s cubic-bezier(.16,1,.3,1) both' }}>
              <h3 className="text-[1.375rem] font-semibold tracking-[-0.022em]">What is your yearly deductible?</h3>
              <p className="t-small opacity-60 mt-2 mb-4 max-w-[46ch]">
                What you pay yourself each year before insurance starts paying its share.
              </p>
              <div className="mb-5">
                <Explain term="Deductible" where="Your insurance card, or your Summary of Benefits and Coverage.">
                  If your deductible is $2,000, you pay the first $2,000 of your care each year.
                  Most plans reset it every January, so the same procedure can cost very different
                  amounts in December and January.
                </Explain>
              </div>
              <ChoiceRow id="wded" value={benefits.deductible} onChange={(v) => set('deductible', v)} options={DEDUCTIBLES} />
              {benefits.deductible > 0 && (
                <div className="mt-6">
                  <label className="text-[0.9375rem] font-semibold block mb-2">How much have you already paid toward it this year?</label>
                  <div className="w-[11rem]">
                    <MoneyInput id="wdedmet" value={benefits.deductibleMet} onChange={(v) => set('deductibleMet', v)} />
                  </div>
                  <p className="t-small opacity-50 mt-2">Leave at zero if you have had no care this year.</p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div style={{ animation: 'stepIn .35s cubic-bezier(.16,1,.3,1) both' }}>
              <h3 className="text-[1.375rem] font-semibold tracking-[-0.022em]">What is your share after that?</h3>
              <p className="t-small opacity-60 mt-2 mb-4 max-w-[46ch]">
                Once the deductible is met, you and your plan split the rest.
              </p>
              <div className="mb-5">
                <Explain term="Coinsurance" where="Summary of Benefits and Coverage, next to each type of service.">
                  At 20% coinsurance on a $1,000 procedure you pay $200 and the plan pays $800.
                  This is why which hospital you pick still matters after your deductible is met.
                </Explain>
              </div>
              <ChoiceRow id="wcoins" value={benefits.coinsurance} onChange={(v) => set('coinsurance', v)} options={COINSURANCE} suffix="%" />

              <div className="mt-8 pt-6 border-t rule">
                <h4 className="text-[1rem] font-semibold mb-2">And the most you can pay in a year?</h4>
                <p className="t-small opacity-55 mb-4 max-w-[46ch]">
                  Your out-of-pocket maximum. Once you reach it, the plan pays everything else it covers.
                </p>
                <ChoiceRow id="woop" value={benefits.outOfPocketMax} onChange={(v) => set('outOfPocketMax', v)} options={OOP} />
                {benefits.outOfPocketMax > 0 && (
                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <label className="t-small opacity-65">Already paid toward it</label>
                    <div className="w-[9rem]">
                      <MoneyInput id="woopmet" value={benefits.outOfPocketMet} onChange={(v) => set('outOfPocketMet', v)} />
                    </div>
                  </div>
                )}
                <label className="flex items-center gap-2.5 mt-5 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-[var(--color-accent)]"
                         checked={!benefits.copayWaivesDeductible}
                         onChange={(e) => set('copayWaivesDeductible', !e.target.checked)} />
                  <span className="text-[0.9375rem]">This is a high-deductible health plan</span>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ animation: 'stepIn .35s cubic-bezier(.16,1,.3,1) both' }}>
              {preview ? (
                <>
                  <h3 className="text-[1.375rem] font-semibold tracking-[-0.022em]">Here is what you would pay</h3>
                  <p className="t-small opacity-60 mt-2 mb-6 max-w-[46ch]">
                    Using {brand || 'every published rate'} at the hospitals in your search.
                  </p>
                  <div className="rounded-[20px] bg-ink text-paper p-6">
                    <div className="t-label opacity-45">At the cheapest hospital</div>
                    <div className="t-num text-[3rem] mt-1.5" style={{ color: 'var(--color-accent-dk)' }}>
                      {fmtUSD(preview.cheapest, { round: true })}
                    </div>
                    <div className="flex items-baseline gap-6 mt-5 pt-5 border-t border-hair flex-wrap">
                      <div>
                        <div className="t-figure text-[1.25rem] opacity-75">{fmtUSD(preview.dearest, { round: true })}</div>
                        <div className="t-small opacity-45 mt-0.5">at the dearest</div>
                      </div>
                      {preview.saving > 0 && (
                        <div>
                          <div className="t-figure text-[1.25rem]" style={{ color: 'var(--color-accent-dk)' }}>
                            {fmtUSD(preview.saving, { round: true })}
                          </div>
                          <div className="t-small opacity-45 mt-0.5">saved by choosing well</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="t-small opacity-55 mt-5 max-w-[52ch]">
                    An estimate for planning, not a bill. One procedure often generates several
                    bills — the facility, the surgeon, the anaesthetist. Confirm with the hospital
                    and your insurer before scheduling.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-[1.375rem] font-semibold tracking-[-0.022em]">Not enough to estimate yet</h3>
                  <p className="t-small opacity-60 mt-2 max-w-[46ch]">
                    Add a deductible or an out-of-pocket maximum and the site can work out your
                    share. Even without them, picking your insurer already shows you that
                    insurer's real negotiated rates.
                  </p>
                  <div className="mt-5">
                    <Link to="/insurance" className="btn btn-ghost">Read the plain-English guide</Link>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t rule flex items-center justify-between gap-3 bg-paper-2/50">
          <button
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="btn btn-ghost !py-2.5"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex items-center gap-2">
            {!last && (
              <button onClick={() => setStep(STEPS.length - 1)} className="t-small opacity-50 hover:opacity-100 px-2">
                Skip
              </button>
            )}
            <button
              onClick={() => (last ? onClose() : setStep(step + 1))}
              className="btn btn-accent !py-2.5 !px-5"
            >
              {last ? 'See the prices' : 'Continue'}
              {!last && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sheetUp { from { opacity: 0; transform: translateY(28px) scale(.985) } to { opacity: 1; transform: none } }
        @keyframes stepIn { from { opacity: 0; transform: translateX(14px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}
