import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchBox from '../components/SearchBox.jsx';
import Reveal from '../components/Reveal.jsx';
import SpreadBar from '../components/SpreadBar.jsx';
import Marquee from '../components/Marquee.jsx';
import PriceDemo from '../components/PriceDemo.jsx';
import { fmtUSD } from '../lib/estimate.js';

const BASE = import.meta.env.BASE_URL || '/';

export default function Landing() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch(`${BASE}data/stats.json`).then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const basket = stats?.basket ?? [];
  const top = basket.slice(0, 10);
  // Shared log domain so every bar in the column is comparable.
  const domain = top.length ? [Math.min(...top.map((b) => b.low)), Math.max(...top.map((b) => b.high))] : null;
  const ct = basket.find((b) => b.code === '70450');

  const ticker = stats ? [
    { value: stats.totals.hospitalsPublishing, label: 'hospitals compared' },
    { value: stats.totals.prices.toLocaleString(), label: 'published prices' },
    { value: stats.totals.procedures.toLocaleString(), label: 'procedures' },
    { value: stats.totals.payers, label: 'insurance plan names' },
    { value: `${stats.spread.medianRatio.toFixed(1)}×`, label: 'median price gap' },
    { value: `${Math.round(stats.cash.share * 100)}%`, label: 'cash beats insured' },
    { value: stats.spread.over10x.toLocaleString(), label: 'procedures vary 10× or more' },
  ] : [];

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="bg-paper pt-28 sm:pt-32 pb-16 sm:pb-20">
        <div className="max-w-[80rem] mx-auto px-5 sm:px-8">
          <Reveal delay={40}>
            <span className="badge">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Free · No account · Nothing you type leaves your browser
            </span>
          </Reveal>

          <h1 className="t-hero mt-7 max-w-[16ch]">
            <Reveal mask delay={110}>Know what a</Reveal>
            <Reveal mask delay={190}>hospital charges</Reveal>
            <Reveal mask delay={270}>before you go.</Reveal>
          </h1>

          <Reveal delay={420} className="mt-8 grid lg:grid-cols-[minmax(0,34rem)_minmax(0,30rem)] gap-8 lg:gap-14 lg:items-end">
            <p className="t-lede opacity-70">
              Search a procedure, set how far you will travel, and add your insurance.
              You get the real negotiated price at each Virginia hospital and an estimate
              of what you would actually pay — from the files hospitals are required by
              law to publish, and almost nobody reads.
            </p>
            <div>
              <SearchBox size="lg" />
              <p className="t-small opacity-45 mt-2.5">
                Try “MRI”, “colonoscopy”, or the code from your doctor's order.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ live demo */}
      <section className="bg-paper pb-20 sm:pb-28">
        <div className="max-w-[80rem] mx-auto px-5 sm:px-8">
          <Reveal delay={80}>
            <div className="flex items-end justify-between gap-6 flex-wrap mb-5">
              <div>
                <p className="t-label opacity-40">See it working</p>
                <h2 className="t-title mt-2.5 max-w-[24ch]">
                  Real prices, at real Virginia hospitals, right now.
                </h2>
              </div>
              <p className="t-small opacity-50 max-w-[34ch]">
                Pick a procedure. Each bar is one hospital's median negotiated price for
                exactly the same billing code.
              </p>
            </div>
          </Reveal>
          <Reveal delay={140}><PriceDemo /></Reveal>
        </div>
      </section>

      {/* -------------------------------------------------------------- ticker */}
      <section className="bg-ink text-paper py-5 overflow-hidden">
        {ticker.length > 0 && <Marquee items={ticker} />}
      </section>

      {/* -------------------------------------------------------- the argument */}
      <section className="bg-paper py-24 sm:py-36">
        <div className="max-w-[96rem] mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-[minmax(0,24rem)_1fr] gap-14 lg:gap-24">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal as="p" className="t-label opacity-40">01 — The gap</Reveal>
              <Reveal as="h2" className="t-display mt-6" delay={60}>
                Same procedure.<br />Same state.<br />
                <span className="t-serif italic">Wildly</span> different price.
              </Reveal>
              <Reveal delay={130}>
                <p className="t-body mt-7 opacity-70 max-w-[40ch]">
                  Each bar runs from what the cheaper Virginia hospitals accept to what the
                  dearer ones charge, for exactly the same billing code.
                </p>
                <p className="t-small mt-5 opacity-50 max-w-[42ch]">
                  Bars span the 10th to the 90th percentile hospital, so one mistyped row in
                  one file cannot stretch them.
                </p>
                <Link to="/data" className="btn btn-ink mt-8">
                  All {stats ? stats.spread.comparableProcedures.toLocaleString() : ''} procedures
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </Reveal>
            </div>

            <div className="ledger border-t rule">
              {top.length === 0 && Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[86px] shimmer" />)}
              {top.map((b, i) => (
                <Reveal key={b.code} delay={i * 50}>
                  <Link to={`/procedure/${b.type}/${b.code}`} className="block row-hover py-1">
                    <SpreadBar
                      label={b.label} low={b.low} high={b.high} ratio={b.ratio}
                      hospitals={b.hospitals} domain={domain} delay={i * 50}
                    />
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- cash twist */}
      {stats?.cash?.share != null && (
        <section className="on-dark py-24 sm:py-32">
          <div className="max-w-[96rem] mx-auto px-5 sm:px-8 grid lg:grid-cols-[1fr_1fr] gap-14 lg:gap-24 items-center">
            <div>
              <Reveal as="p" className="t-label text-accent">02 — What nobody tells you</Reveal>
              <Reveal as="div" className="t-stat mt-7 text-accent" delay={60}>
                {Math.round(stats.cash.share * 100)}%
              </Reveal>
              <Reveal as="p" className="t-title mt-7 max-w-[18ch] font-normal" delay={110}>
                of the time, the cash price beats the insured price.
              </Reveal>
            </div>
            <Reveal delay={180}>
              <p className="t-body opacity-75 max-w-[46ch]">
                Hospitals publish a discounted cash price next to what they have negotiated with
                each insurer. In Virginia the cash price is lower almost half the time. If you have
                a high deductible and have not met it, you may pay less by not using your insurance.
              </p>
              <p className="t-small mt-5 opacity-50 max-w-[46ch]">
                The catch: paying cash usually will not count toward your deductible or your
                out-of-pocket maximum. That trade-off is worth the arithmetic, and this site
                shows you both numbers.
              </p>
              <Link to="/insurance" className="btn btn-accent mt-9">How to work out which is cheaper</Link>
            </Reveal>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- how it works */}
      <section className="bg-paper py-24 sm:py-32">
        <div className="max-w-[96rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label opacity-40">03 — How it works</Reveal>
          <Reveal as="h2" className="t-display mt-6 max-w-[14ch]" delay={60}>Four steps to a real number.</Reveal>

          <div className="ledger mt-14 border-y rule">
            {[
              ['Name the procedure', 'Type what your doctor called it, or the code from the order. Emergency care is left out, because nobody shops for an ambulance.'],
              ['Set how far you will travel', 'Enter your ZIP and a radius. Driving an extra thirty minutes is often the whole difference.'],
              ['Add your insurance', 'Pick your carrier from the names hospitals published. The site then uses your actual negotiated rate, not an average.'],
              ['Enter your deductible', 'Deductible, coinsurance, copay, out-of-pocket maximum. If you do not know them, every field explains where to look.'],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="grid sm:grid-cols-[5rem_minmax(0,22ch)_1fr] gap-4 sm:gap-8 py-7 row-hover items-baseline">
                  <span className="t-label text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="t-title !text-[1.375rem]">{title}</h3>
                  <p className="t-body opacity-65 max-w-[56ch]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <section className="bg-paper-2 py-24 sm:py-36 border-t rule">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <Reveal as="h2" className="t-display">Find what your care costs.</Reveal>
          <Reveal as="p" className="t-lede mt-6 opacity-65 max-w-[40ch] mx-auto" delay={70}>
            Free, no account, and nothing you type ever leaves your browser.
          </Reveal>
          <Reveal className="mt-10" delay={130}><SearchBox size="lg" /></Reveal>
        </div>
      </section>
    </>
  );
}
