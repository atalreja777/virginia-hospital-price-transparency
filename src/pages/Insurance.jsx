import { useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import { estimate, emptyBenefits, fmtUSD } from '../lib/estimate.js';
import useDocumentMeta from '../lib/useDocumentMeta.js';

const TERMS = [
  {
    term: 'Deductible',
    short: 'What you pay before the plan pays anything.',
    body: 'The amount you pay yourself each year before your insurance starts covering care. '
        + 'If your deductible is $2,000, you pay the first $2,000. Most plans reset it every January, '
        + 'so care in December and care in January can cost very different amounts.',
    where: 'The front of your insurance card, or the Summary of Benefits and Coverage from your insurer or employer. '
         + 'Your insurer\'s website shows how much you have already paid this year.',
  },
  {
    term: 'Coinsurance',
    short: 'Your percentage share after the deductible.',
    body: 'Once you have met your deductible, you and your plan split the rest. Coinsurance is your '
        + 'share, written as a percentage. At 20% coinsurance on a $1,000 procedure you pay $200 and '
        + 'the plan pays $800. Coinsurance is why the hospital you pick still matters after you have '
        + 'met your deductible: 20% of a cheap hospital is less than 20% of an expensive one.',
    where: 'Summary of Benefits and Coverage, usually listed next to each type of service.',
  },
  {
    term: 'Copay',
    short: 'A flat fee for a visit.',
    body: 'A fixed amount, like $40 for a doctor visit, no matter what the hospital charges. Where a '
        + 'plan uses a copay it usually replaces coinsurance for that service. High-deductible plans '
        + 'often have no copays at all until the deductible is met.',
    where: 'Printed on the front of your insurance card, often broken out by visit type.',
  },
  {
    term: 'Out-of-pocket maximum',
    short: 'The most you can pay in a year.',
    body: 'The ceiling on what you can be charged for covered, in-network care in one year. Once you '
        + 'hit it, your plan pays 100% of covered care for the rest of the year. This is the number '
        + 'that protects you from a catastrophic bill, and it is the one most people cannot name.',
    where: 'Summary of Benefits and Coverage, near the deductible.',
  },
  {
    term: 'Negotiated rate',
    short: 'What your insurer actually agreed to pay.',
    body: 'Hospitals and insurers negotiate a price for each procedure. That number, not the list '
        + 'price, is what your deductible and coinsurance are calculated on. It is normally invisible '
        + 'to patients. Federal law now requires hospitals to publish it, and it is what this site shows.',
    where: 'This site. Also on the Explanation of Benefits your insurer sends after care, as the "allowed amount".',
  },
  {
    term: 'Gross charge',
    short: 'The list price almost nobody pays.',
    body: 'The hospital\'s sticker price before any discount. Insurers pay far less; cash patients '
        + 'usually pay less too. It mainly matters if you are uninsured and do not ask for the cash price.',
    where: 'Your itemised bill, and this site.',
  },
  {
    term: 'Cash or self-pay price',
    short: 'What you pay if you skip insurance.',
    body: 'A discounted price for paying directly. In Virginia it beats the typical insured rate '
        + 'almost half the time. The catch: what you pay in cash usually does not count toward your '
        + 'deductible or out-of-pocket maximum, so it can cost you later in a year with a lot of care.',
    where: 'This site, and by asking the hospital\'s billing office directly.',
  },
  {
    term: 'In network and out of network',
    short: 'Whether your plan has a deal with that hospital.',
    body: 'In-network hospitals have agreed prices with your insurer. Out of network, your plan pays '
        + 'less or nothing, and the hospital may bill you for the difference. Always confirm a hospital '
        + 'is in your network before you schedule, even if the price here looks good.',
    where: 'Your insurer\'s provider directory, or by calling the number on your card.',
  },
  {
    term: 'Good faith estimate',
    short: 'A written price you can demand.',
    body: 'If you are uninsured or paying cash, federal law entitles you to a written estimate before '
        + 'scheduled care. If the final bill is more than $400 above it, you can dispute it.',
    where: 'Ask the hospital when you schedule. They must provide it.',
  },
];

export default function Insurance() {
  useDocumentMeta(
    'Insurance terms',
    'Deductible, coinsurance, copay and out-of-pocket maximum, explained in plain English with an '
    + 'interactive calculator and where to find each number on your plan.',
  );
  const [b, setB] = useState(() => ({ ...emptyBenefits(), deductible: 200000, coinsurance: 0.2, outOfPocketMax: 800000 }));
  const [price, setPrice] = useState(500000);
  const r = estimate(price, b);
  const set = (k, v) => setB({ ...b, [k]: v });

  return (
    <>
      <header className="on-dark pt-36 pb-20">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label text-accent">Plain English</Reveal>
          <Reveal as="h1" className="t-display mt-5 max-w-[20ch]" delay={60}>
            The words on your insurance card, explained.
          </Reveal>
          <Reveal as="p" className="t-lede mt-7 max-w-[54ch] opacity-80" delay={130}>
            You need four numbers to work out what a procedure will cost you: your deductible,
            your coinsurance, your copay, and your out-of-pocket maximum. Here is what each one
            means and exactly where to find it.
          </Reveal>
        </div>
      </header>

      {/* ------------------------------------------------------- the calculator */}
      <section className="bg-paper py-20 sm:py-28">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="h2" className="t-title">See how the pieces fit together.</Reveal>
          <Reveal as="p" className="t-body mt-4 opacity-70 max-w-[58ch]" delay={60}>
            Change any number and watch your share move. This is the same arithmetic the site runs
            on every hospital price.
          </Reveal>

          <div className="grid lg:grid-cols-[minmax(0,24rem)_1fr] gap-10 mt-10">
            <div className="panel p-6 space-y-5">
              <div>
                <label htmlFor="p" className="t-small font-medium">The negotiated price</label>
                <div className="mt-2"><MoneyInput id="p" value={price} onChange={setPrice} /></div>
              </div>
              <div>
                <label htmlFor="d" className="t-small font-medium">Your deductible</label>
                <div className="mt-2"><MoneyInput id="d" value={b.deductible} onChange={(v) => set('deductible', v)} /></div>
              </div>
              <div>
                <label htmlFor="dm" className="t-small font-medium">Already paid toward it</label>
                <div className="mt-2"><MoneyInput id="dm" value={b.deductibleMet} onChange={(v) => set('deductibleMet', v)} /></div>
              </div>
              <div>
                <label htmlFor="c" className="t-small font-medium">Coinsurance</label>
                <div className="relative mt-2">
                  <input id="c" type="number" min="0" max="100" className="field pr-9 tnum"
                         value={Math.round(b.coinsurance * 100)}
                         onChange={(e) => set('coinsurance', Math.min(100, Math.max(0, +e.target.value || 0)) / 100)} />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 opacity-45">%</span>
                </div>
              </div>
              <div>
                <label htmlFor="o" className="t-small font-medium">Out-of-pocket maximum</label>
                <div className="mt-2"><MoneyInput id="o" value={b.outOfPocketMax} onChange={(v) => set('outOfPocketMax', v)} /></div>
              </div>
            </div>

            <div className="panel p-7 sm:p-10 flex flex-col justify-center">
              <p className="t-label opacity-45">You would pay</p>
              <div className="t-stat mt-4 tnum text-accent">{fmtUSD(r.patient, { round: true })}</div>
              <p className="t-body mt-4 opacity-70">
                Your plan pays <span className="tnum font-semibold">{fmtUSD(r.plan, { round: true })}</span> of
                the <span className="tnum font-semibold">{fmtUSD(r.allowed, { round: true })}</span> negotiated price.
              </p>

              <div className="mt-8 h-11 rounded-[2px] overflow-hidden flex border rule">
                {r.toDeductible > 0 && (
                  <div className="h-full bg-[var(--color-p5)] flex items-center justify-center text-white text-[0.6875rem] font-semibold"
                       style={{ width: `${(r.toDeductible / r.allowed) * 100}%` }}
                       title={`Deductible ${fmtUSD(r.toDeductible)}`}>
                    {r.toDeductible / r.allowed > 0.12 && 'Deductible'}
                  </div>
                )}
                {r.toCoinsurance > 0 && (
                  <div className="h-full bg-[var(--color-p4)] flex items-center justify-center text-white text-[0.6875rem] font-semibold"
                       style={{ width: `${(r.toCoinsurance / r.allowed) * 100}%` }}
                       title={`Coinsurance ${fmtUSD(r.toCoinsurance)}`}>
                    {r.toCoinsurance / r.allowed > 0.12 && 'Coinsurance'}
                  </div>
                )}
                {r.toCopay > 0 && (
                  <div className="h-full bg-[var(--color-p3)]" style={{ width: `${(r.toCopay / r.allowed) * 100}%` }} title={`Copay ${fmtUSD(r.toCopay)}`} />
                )}
                <div className="h-full bg-[var(--color-p1)] flex items-center justify-center text-white text-[0.6875rem] font-semibold"
                     style={{ width: `${(r.plan / r.allowed) * 100}%` }} title={`Plan pays ${fmtUSD(r.plan)}`}>
                  {r.plan / r.allowed > 0.15 && 'Your plan'}
                </div>
              </div>

              <dl className="mt-7 space-y-2 t-small tnum max-w-sm">
                {r.toDeductible > 0 && <div className="flex justify-between"><dt className="opacity-70">Toward your deductible</dt><dd className="font-medium">{fmtUSD(r.toDeductible)}</dd></div>}
                {r.toCoinsurance > 0 && <div className="flex justify-between"><dt className="opacity-70">Coinsurance</dt><dd className="font-medium">{fmtUSD(r.toCoinsurance)}</dd></div>}
                {r.toCopay > 0 && <div className="flex justify-between"><dt className="opacity-70">Copay</dt><dd className="font-medium">{fmtUSD(r.toCopay)}</dd></div>}
                <div className="flex justify-between pt-2 border-t rule font-semibold"><dt>Your share</dt><dd>{fmtUSD(r.patient)}</dd></div>
              </dl>
              {r.notes.map((n, i) => <p key={i} className="t-small opacity-65 mt-3">{n}</p>)}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- glossary */}
      <section className="bg-paper-2 py-20 sm:py-28">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="h2" className="t-display max-w-[18ch]">Every term, and where to find it.</Reveal>
          <div className="grid md:grid-cols-2 gap-px mt-12 bg-rule rounded-[3px] overflow-hidden">
            {TERMS.map((t, i) => (
              <Reveal key={t.term} delay={i * 45} className="bg-paper p-6 sm:p-7">
                <h3 className="t-title !text-[1.1875rem]">{t.term}</h3>
                <p className="t-small font-medium mt-1.5 text-accent-dim">{t.short}</p>
                <p className="t-body !text-[0.9375rem] mt-3 opacity-80">{t.body}</p>
                <p className="t-small mt-4 opacity-65"><span className="font-medium">Where to find it: </span>{t.where}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- do not know */}
      <section className="on-dark py-20 sm:py-28">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-12">
          <div>
            <Reveal as="h2" className="t-display max-w-[16ch]">If you cannot find your numbers.</Reveal>
            <Reveal as="p" className="t-body mt-6 opacity-80 max-w-[48ch]" delay={70}>
              Every plan must give you a Summary of Benefits and Coverage. It is a short standard
              document, the same shape for every insurer, and it lists all four numbers on the
              first page. You are entitled to it free.
            </Reveal>
          </div>
          <Reveal delay={120}>
            <ol className="space-y-5">
              {[
                ['Look at your card first', 'Deductible and copays are often printed right on it.'],
                ['Log in to your insurer', 'Search "deductible" or "plan summary". This also shows how much you have used this year, which the card cannot.'],
                ['Ask your employer', 'If you get insurance through work, the benefits or HR contact can send you the Summary of Benefits and Coverage.'],
                ['Call the number on the card', 'Ask: what is my deductible, how much have I met, what is my coinsurance, and what is my out-of-pocket maximum.'],
                ['Ask the hospital for a good faith estimate', 'If you are uninsured or paying cash, they must give you a written estimate before scheduled care.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="t-mono text-[0.75rem] text-accent shrink-0 pt-1">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="block font-semibold tracking-[-0.014em]">{t}</span>
                    <span className="block t-small opacity-70 mt-1">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2.5 mt-9">
              <a href="https://www.healthcare.gov/glossary/" target="_blank" rel="noopener noreferrer" className="btn btn-accent">Healthcare.gov glossary</a>
              <a href="https://scc.virginia.gov/pages/Consumer-Services" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Virginia Bureau of Insurance</a>
              <Link to="/" className="btn btn-ghost">Find a price</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
