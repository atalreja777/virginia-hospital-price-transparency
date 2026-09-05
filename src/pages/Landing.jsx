import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchBox from '../components/SearchBox.jsx';
import Reveal from '../components/Reveal.jsx';
import SpreadBar, { decadeTicks } from '../components/SpreadBar.jsx';
import PriceDemo from '../components/PriceDemo.jsx';
import VirginiaDots from '../components/VirginiaDots.jsx';
import HeroField from '../components/HeroField.jsx';
import { fmtUSD } from '../lib/estimate.js';
import useDocumentMeta from '../lib/useDocumentMeta.js';

const BASE = import.meta.env.BASE_URL || '/';

const dearest = (b) => (b.prices?.length ? b.prices[b.prices.length - 1] : b.high);

// The same three questions people ask of the list on a procedure page: which
// varies most, which is widely published, which costs the most to begin with.
const SORTS = [
  { key: 'gap', label: 'Biggest gap', cmp: (a, b) => b.ratio - a.ratio },
  { key: 'hospitals', label: 'Most hospitals', cmp: (a, b) => b.hospitals - a.hospitals },
  { key: 'price', label: 'Highest price', cmp: (a, b) => dearest(b) - dearest(a) },
];

export default function Landing() {
  useDocumentMeta(
    null,
    'Search a procedure at Virginia hospitals, filter by insurance, and get a planning estimate '
    + 'from the benefit numbers you enter — built from the prices hospitals are required to publish.',
  );
  const [stats, setStats] = useState(null);
  const [sort, setSort] = useState('gap');
  useEffect(() => {
    fetch(`${BASE}data/stats.json`).then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const basket = stats?.basket ?? [];
  const top = [...basket].sort(SORTS.find((s) => s.key === sort).cmp).slice(0, 10);
  // Shared log domain so every bar in the column is comparable.
  // Every hospital is drawn, so the axis has to reach the real extremes rather
  // than the 10th and 90th percentile the band is built from. It is measured
  // over the whole basket, not the visible ten, so re-sorting reorders the rows
  // without moving the scale under them.
  const ends = basket.flatMap((b) => (b.prices?.length ? [b.prices[0], b.prices[b.prices.length - 1]] : [b.low, b.high]));
  const domain = ends.length ? [Math.min(...ends), Math.max(...ends)] : null;
  const ticks = decadeTicks(domain);
  const ct = basket.find((b) => b.code === '70450');

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="on-dark relative min-h-[92svh] flex flex-col justify-end">
        <HeroField />

        <div className="relative max-w-[80rem] mx-auto w-full px-5 sm:px-8 pt-32 pb-14 sm:pb-20">
          <h1 className="t-hero max-w-[15ch]">
            <Reveal mask delay={100}>Know what a</Reveal>
            <Reveal mask delay={180}>hospital charges</Reveal>
            <Reveal mask delay={260}>before you go.</Reveal>
          </h1>

          <Reveal delay={420} className="mt-9 grid lg:grid-cols-[minmax(0,30rem)_minmax(0,30rem)] gap-8 lg:gap-14 lg:items-end">
            <p className="t-lede opacity-65">
              Search a procedure, set how far you will travel, add your insurance.
              You get the negotiated price each Virginia hospital published and a
              planning estimate of your share.
            </p>
            <div>
              <SearchBox dark size="lg" />
              <p className="t-small opacity-40 mt-2.5">
                Try “MRI”, “colonoscopy”, or the code from your doctor's order.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- the problem, stated */}
      <section className="on-dark border-t border-hair py-24 sm:py-32">
        <div className="max-w-[80rem] mx-auto px-5 sm:px-8">
          <Reveal>
            <p className="t-display max-w-[24ch] font-normal">
              For decades the price of American healthcare was settled in private,
              between a hospital and an insurer, long before anyone got a bill.
            </p>
          </Reveal>

          <div className="grid lg:grid-cols-[minmax(0,20rem)_1fr] gap-10 lg:gap-16 mt-16">
            <Reveal delay={80}>
              <p className="t-body opacity-60">
                Since 2021 federal law has required every hospital to publish what it
                charges and what each insurance plan has agreed to pay. The files exist.
                They are enormous, inconsistently formatted, and almost nobody reads them.
                This site reads them for Virginia.
              </p>
            </Reveal>

            {/* the ledger: the figures, at a size that makes them the argument */}
            <Reveal delay={140}>
              <dl className="border-t border-hair">
                {[
                  // `totals.prices` became `totals.priceEntries`.
                  [stats ? (stats.totals.priceEntries ?? stats.totals.prices ?? 0).toLocaleString() : '—', 'Published price entries read from Virginia hospital files'],
                  [stats ? stats.totals.hospitalsPublishing : '—', 'Hospitals with prices you can compare'],
                  // Null when no code cleared the coverage threshold — a real
                  // state for a narrow release, not a reason to blank the page.
                  [stats?.spread?.medianRatio != null ? `${stats.spread.medianRatio.toFixed(1)}×` : '—', 'Typical gap between the cheaper and dearer hospital for the same code'],
                  [stats ? `${Math.round(stats.cash.share * 100)}%` : '—', 'Of the time, the cash price beats the insured price'],
                ].map(([value, label], i) => (
                  <div key={label} className="grid sm:grid-cols-[1fr_minmax(0,22ch)] gap-x-8 gap-y-1 items-baseline py-7 border-b border-hair">
                    <div className="t-num text-[clamp(2.75rem,6vw,4.75rem)] font-normal tracking-[-0.05em]"
                         style={{ animation: `figIn .8s cubic-bezier(.16,1,.3,1) ${i * 90}ms both` }}>
                      {value}
                    </div>
                    <div className="t-small opacity-45 sm:text-right">{label}</div>
                  </div>
                ))}
              </dl>
              <style>{`@keyframes figIn { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }`}</style>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ live demo */}
      <section className="bg-paper pb-20 sm:pb-28">
        <div className="max-w-[80rem] mx-auto px-5 sm:px-8">
          <Reveal delay={80}>
            <div className="flex items-end justify-between gap-6 flex-wrap mb-5">
              <div>
                <h2 className="t-title max-w-[24ch]">
                  Real prices, from the latest file we located for each hospital, with its declared date.
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

      {/* -------------------------------------------------------- the argument */}
      <section className="bg-paper py-24 sm:py-36">
        <div className="max-w-[96rem] mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-[minmax(0,24rem)_1fr] gap-14 lg:gap-24">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal as="h2" className="t-display" delay={60}>
                Same procedure.<br />Same state.<br />
                <span className="t-serif italic">Wildly</span> different price.
              </Reveal>
              <Reveal delay={130}>
                <p className="t-body mt-7 opacity-70 max-w-[40ch]">
                  Every dot is one Virginia hospital, placed at what it accepts for exactly
                  the same billing code. Most cluster. A few do not.
                </p>
                <p className="t-small mt-5 opacity-50 max-w-[42ch]">
                  The shaded band holds the middle 80% of hospitals and the multiple compares
                  its two ends, so one mistyped row cannot stretch the number.
                </p>
                <Link to="/data" className="btn btn-ink mt-8">
                  All {stats ? stats.spread.comparableProcedures.toLocaleString() : ''} procedures
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </Reveal>
            </div>

            <div className="spread-col">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-paper-2 rounded-[var(--radius-soft)] px-4 py-3 mb-8">
                <span className="t-label opacity-45 mr-1.5">Sort</span>
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="chip"
                    data-on={sort === s.key}
                    aria-pressed={sort === s.key}
                    onClick={() => setSort(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* The scale, stated once. Every bar below is a span on this ruler,
                  so where a bar sits means as much as how long it is. */}
              <div className="relative h-4 mb-2.5">
                <div className="absolute spread-track inset-y-0" aria-hidden="true">
                  {ticks.map((t) => (
                    <span
                      key={t.cents}
                      className="absolute top-0 t-figure text-[0.75rem] opacity-50 whitespace-nowrap"
                      style={{ left: `${t.pct}%`, transform: 'translateX(-50%)' }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
                <span className="absolute right-0 top-0 t-label opacity-40 leading-none">Gap</span>
              </div>

              <div className="relative border-t rule">
                <div className="absolute spread-track inset-y-0 pointer-events-none" aria-hidden="true">
                  {ticks.map((t) => (
                    <div key={t.cents} className="absolute inset-y-0 w-px bg-rule/55" style={{ left: `${t.pct}%` }} />
                  ))}
                </div>

                <div className="ledger relative">
                  {top.length === 0 && Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[118px] shimmer" />)}
                  {top.map((b, i) => (
                    <Reveal key={b.code} delay={i * 50}>
                      <Link to={`/procedure/${b.type}/${b.code}`} className="spread-link block">
                        <SpreadBar
                          label={b.label} low={b.low} high={b.high} ratio={b.ratio}
                          prices={b.prices} hospitals={b.hospitals}
                          domain={domain} delay={i * 50}
                        />
                      </Link>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- cash twist */}
      {stats?.cash?.share != null && (
        <section className="on-dark py-24 sm:py-32">
          <div className="max-w-[96rem] mx-auto px-5 sm:px-8 grid lg:grid-cols-[1fr_1fr] gap-14 lg:gap-24 items-center">
            <div>
              <Reveal as="div" className="t-stat text-accent" delay={60}>
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

      {/* ------------------------------------------------------------- coverage */}
      <section id="coverage" className="bg-paper py-24 sm:py-32 scroll-mt-20">
        <div className="max-w-[80rem] mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-[minmax(0,26rem)_1fr] gap-10 lg:gap-16 items-center">
            <div>
              <Reveal as="h2" className="t-display" delay={60}>
                Who actually<br />publishes.
              </Reveal>
              <Reveal delay={120}>
                <p className="t-body mt-6 opacity-70 max-w-[40ch]">
                  The rule has applied since 2021. Each dot is one Virginia hospital, placed
                  at its geocoded address; approximate ZIP-center pins are marked. Filled dots
                  publish prices this site could read and use.
                  Hollow ones do not.
                </p>
                <Link to="/data" className="btn btn-ghost mt-7">See what is missing</Link>
              </Reveal>
            </div>
            <Reveal delay={100}><VirginiaDots /></Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- how it works */}
      <section className="bg-paper py-24 sm:py-32">
        <div className="max-w-[96rem] mx-auto px-5 sm:px-8">
          <Reveal as="h2" className="t-display max-w-[14ch]">Four steps to a real number.</Reveal>

          <div className="ledger mt-14 border-y rule">
            {[
              ['Name the procedure', 'Type what your doctor called it, or the code from the order. Emergency care is left out, because nobody shops for an ambulance.'],
              ['Set how far you will travel', 'Enter your ZIP and a radius. Driving an extra thirty minutes is often the whole difference.'],
              ['Add your insurance', 'Pick your carrier from the names hospitals published. The site then uses a rate the hospital published under this payer and plan name, not an average.'],
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
