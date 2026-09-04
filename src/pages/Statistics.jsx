import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import SpreadBar from '../components/SpreadBar.jsx';
import Loading from '../components/Loading.jsx';
import { fmtUSD } from '../lib/estimate.js';
import useDocumentMeta from '../lib/useDocumentMeta.js';
import { loadStageCounts, loadRelease } from '../lib/data.js';
import { groupStageCounts } from '../lib/prices.js';

const BASE = import.meta.env.BASE_URL || '/';

const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());

function Stat({ value, label, note, accent }) {
  return (
    <div>
      <div className={`t-num text-[2.75rem] sm:text-[3.5rem] ${accent ? 'text-accent' : ''}`}>
        {value}
      </div>
      <div className="t-label opacity-50 mt-3">{label}</div>
      {note && <p className="t-small opacity-60 mt-2 max-w-[30ch]">{note}</p>}
    </div>
  );
}

export default function Statistics() {
  useDocumentMeta(
    'The numbers',
    'What the published files show about Virginia hospital prices: price spreads, cash-versus-'
    + 'insured comparisons, and which hospitals published nothing usable.',
  );
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  // Both are absent on a dataset built before the contract; the page falls back
  // to the flat list rather than showing nothing.
  const [stageCounts, setStageCounts] = useState(null);
  const [release, setRelease] = useState(null);
  useEffect(() => {
    fetch(`${BASE}data/stats.json`).then((r) => r.json()).then(setS).catch((e) => setErr(String(e)));
    loadStageCounts().then(setStageCounts).catch(() => setStageCounts(null));
    loadRelease().then(setRelease).catch(() => setRelease(null));
  }, []);

  if (err) return <div className="pt-40 px-6 max-w-2xl mx-auto"><h1 className="t-title">The figures would not load.</h1><p className="t-body mt-3 opacity-70">{err}</p></div>;
  if (!s) return <Loading label="Loading the figures" />;

  // Shared log domain so every bar in the column is comparable.
  const domain = [Math.min(...s.basket.map((b) => b.low)), Math.max(...s.basket.map((b) => b.high))];
  const notPublishing = s.totals.hospitalsSeeded - s.totals.hospitalsPublishing;
  // `totals.prices` became `totals.priceEntries`, and now counts retained
  // distinct entries rather than post-collapse rows.
  const priceEntries = s.totals.priceEntries ?? s.totals.prices ?? 0;
  const outcomeGroups = stageCounts?.length ? groupStageCounts(stageCounts) : null;
  const excludedCount = s.excludedFromHeadline?.codes ?? s.excludedFromHeadline?.count ?? null;

  return (
    <>
      <header className="on-dark pt-36 pb-20">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label text-accent">The numbers</Reveal>
          <Reveal as="h1" className="t-display mt-5 max-w-[22ch]" delay={60}>
            What the published files show about Virginia.
          </Reveal>
          <Reveal as="p" className="t-lede mt-7 max-w-[56ch] opacity-80" delay={130}>
            Every figure here comes from prices Virginia hospitals published themselves, under
            the federal rule that requires it. Nothing is modelled, estimated, or filled in.
            Where the data is thin or wrong, that is said plainly.
          </Reveal>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 mt-16 pt-10 border-t border-hair">
            <Reveal delay={60}><Stat value={s.totals.hospitalsPublishing} label="Hospitals with usable prices" note={`of ${s.totals.hospitalsSeeded} Virginia hospitals in the federal registry`} /></Reveal>
            <Reveal delay={110}><Stat value={priceEntries.toLocaleString()} label="Published price entries" /></Reveal>
            <Reveal delay={160}><Stat value={s.totals.procedures.toLocaleString()} label="Schedulable procedures" note="Emergency and ambulance codes excluded" /></Reveal>
            <Reveal delay={210}><Stat value={s.spread?.medianRatio != null ? `${s.spread.medianRatio.toFixed(1)}×` : '—'} label="Median price spread" note="Typical gap between cheaper and dearer hospitals for the same code" accent /></Reveal>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ the basket */}
      <section className="bg-paper py-24 sm:py-32">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-[minmax(0,25rem)_1fr] gap-14 lg:gap-24">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal as="p" className="t-label opacity-45">Care people actually schedule</Reveal>
              <Reveal as="h2" className="t-display mt-5" delay={60}>A basket of 28 procedures.</Reveal>
              <Reveal delay={120}>
                <p className="t-body mt-6 opacity-75 max-w-[42ch]">
                  These are the procedures a Virginian might plan next month. Each bar runs from
                  the 10th percentile hospital to the 90th, so no single mistyped row can stretch it.
                </p>
                <p className="t-small mt-5 opacity-60 max-w-[44ch]">
                  Bars sit on a shared logarithmic scale, because these procedures span
                  four orders of magnitude and a linear axis would hide every cheap one.
                  Drug and supply codes are deliberately excluded from every comparison on this page.
                  They are billed per unit, so a difference between two hospitals often reflects a
                  unit of measure rather than a price.
                  {/* `count` became `codes` when the audit gained its reasons breakdown. */}
                  {excludedCount != null && ` ${excludedCount.toLocaleString()} such codes were set aside.`}
                </p>
              </Reveal>
            </div>
            <div>
              {s.basket.map((b, i) => (
                <Reveal key={`${b.type}-${b.code}`} delay={Math.min(i * 35, 400)}>
                  <Link to={`/procedure/${b.type}/${b.code}`} className="block border-b rule hover:bg-paper-2 -mx-3 px-3 rounded transition-colors">
                    <SpreadBar label={b.label} low={b.low} high={b.high} ratio={b.ratio} hospitals={b.hospitals} domain={domain} delay={Math.min(i * 35, 400)} />
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- distribution */}
      <section className="on-dark py-24 sm:py-32">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label text-accent">How common is a big gap</Reveal>
          <Reveal as="h2" className="t-display mt-5 max-w-[20ch]" delay={60}>
            It is not a handful of outliers.
          </Reveal>
          <Reveal as="p" className="t-body mt-6 opacity-80 max-w-[52ch]" delay={110}>
            Of the {s.spread.comparableProcedures.toLocaleString()} procedures published by at least
            eight Virginia hospitals, most vary by more than a factor of two.
          </Reveal>

          <div className="grid sm:grid-cols-3 gap-px mt-14 bg-hair rounded-[3px] overflow-hidden">
            {[
              [s.spread.over2x, '2× or more', 'The dearer hospitals charge at least double the cheaper ones.'],
              [s.spread.over5x, '5× or more', 'A gap this size is larger than most people\'s annual deductible.'],
              [s.spread.over10x, '10× or more', 'Same billing code, same state, ten times the price.'],
            ].map(([n, label, note], i) => {
              // A release too narrow to have any comparable procedure divides
              // by zero here; show no share rather than "NaN%".
              const share = s.spread.comparableProcedures
                ? (n / s.spread.comparableProcedures) * 100
                : null;
              return (
                <Reveal key={label} delay={i * 80} className="bg-ink p-7 sm:p-9">
                  <div className="t-num text-[3rem] text-accent">
                    {(n ?? 0).toLocaleString()}
                  </div>
                  <div className="t-label opacity-55 mt-3">procedures vary {label}</div>
                  <p className="t-small opacity-65 mt-3">{note}</p>
                  <div className="mt-5 h-1.5 rounded-full bg-ink-3 overflow-hidden">
                    <div className="h-full bg-accent bar-grow" style={{ width: `${share ?? 0}%`, animationDelay: `${i * 80}ms` }} />
                  </div>
                  <div className="t-small opacity-45 mt-2 tnum">
                    {share == null ? 'no comparable procedures in this release' : `${Math.round(share)}% of comparable procedures`}
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cash */}
      {/* With no comparison made, "in 0% of pairs cash beat insured" would be a
          finding drawn from no data. Say nothing instead. */}
      {s.cash?.comparisons > 0 && (
      <section className="bg-paper py-24 sm:py-32">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <div className="grid lg:grid-cols-2 gap-14">
            <div>
              <Reveal as="p" className="t-label opacity-45">Insurance is not always cheaper</Reveal>
              <Reveal as="h2" className="t-display mt-5" delay={60}>
                In {Math.round(s.cash.share * 100)}% of analyzed<br />hospital/procedure pairs, cash beat insured.
              </Reveal>
              <Reveal as="p" className="t-body mt-6 opacity-75 max-w-[46ch]" delay={110}>
                Across {s.cash.comparisons.toLocaleString()} hospital and procedure combinations
                where both numbers were published, the discounted cash price was lower than the
                hospital's median negotiated price.{' '}
                <Link to="/methodology" className="link-draw">How this was compared</Link>.
              </Reveal>
              <Reveal as="p" className="t-small mt-5 opacity-60 max-w-[48ch]" delay={150}>
                This matters most for people with high deductibles, who pay the full negotiated rate
                anyway until the deductible is met. The trade-off is that cash payments usually do
                not count toward the deductible or the out-of-pocket maximum.
              </Reveal>
            </div>
            <Reveal delay={140}>
              <p className="t-label opacity-45 mb-4">Largest gaps found</p>
              <ul className="space-y-px bg-rule rounded-[3px] overflow-hidden border rule">
                {s.cash.examples.slice(0, 7).map((c, i) => (
                  <li key={i} className="bg-paper p-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[0.9375rem] font-medium truncate">{c.desc}</span>
                      <span className="t-mono text-[0.8125rem] font-semibold tnum text-[var(--color-p1)] shrink-0">
                        save {fmtUSD(c.saving, { round: true })}
                      </span>
                    </div>
                    <div className="t-small opacity-60 mt-1 tnum">
                      cash {fmtUSD(c.cash, { round: true })} · insured {fmtUSD(c.insured, { round: true })} · {c.hospital?.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase())}
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>
      )}

      {/* -------------------------------------------------------------- coverage */}
      <section className="bg-paper-2 py-24 sm:py-32">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label opacity-45">What is missing</Reveal>
          <Reveal as="h2" className="t-display mt-5 max-w-[22ch]" delay={60}>
            {notPublishing} Virginia hospitals published nothing we could use.
          </Reveal>
          <Reveal as="p" className="t-body mt-6 opacity-75 max-w-[58ch]" delay={110}>
            The federal rule has applied since 2021. Of the {s.totals.hospitalsSeeded} Virginia
            hospitals in the federal registry, {s.totals.hospitalsPublishing} published a file this
            pipeline could read and price. The rest either published nothing findable, published
            something unreadable, are exempt, or are federal or state facilities the rule treats
            differently. Every one is recorded rather than quietly dropped.
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px mt-12 bg-rule rounded-[3px] overflow-hidden">
            {Object.entries(s.totals.byStatus).map(([k, v], i) => (
              <Reveal key={k} delay={i * 60} className="bg-paper p-6">
                <div className="t-mono text-[2rem] font-semibold tnum leading-none">{v}</div>
                <div className="t-label opacity-50 mt-2.5">{k}</div>
                <p className="t-small opacity-60 mt-2">
                  {k === 'success' && 'A file was found, downloaded and parsed.'}
                  {k === 'pending' && 'Not yet resolved by the discovery crawler.'}
                  {k === 'blocked' && 'The hospital\'s site refused automated access.'}
                  {k === 'exempt' && 'Outside the rule, such as federal or state facilities.'}
                </p>
              </Reveal>
            ))}
          </div>

          {/* Grouped by why, not one flat list. "Published nothing" and "published
              local codes only" are different findings, and a psychiatric facility
              that published a readable file belongs in the second. */}
          {outcomeGroups ? (
            <Reveal delay={200} className="mt-10">
              <p className="t-label opacity-45 mb-4">Why, hospital by hospital</p>
              <div className="space-y-px bg-rule rounded-[3px] overflow-hidden border rule">
                {outcomeGroups.map((g) => (
                  <details key={g.id} className="bg-paper">
                    <summary className="p-4 cursor-pointer flex items-baseline gap-3">
                      <span className="t-mono text-[1.25rem] font-semibold tnum shrink-0">{g.count}</span>
                      <span className="flex-1">
                        <span className="font-medium">{g.label}</span>
                        <span className="block t-small opacity-60 mt-0.5">{g.note}</span>
                      </span>
                    </summary>
                    <ul className="px-4 pb-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 t-small opacity-75">
                      {g.hospitals.map((h, i) => (
                        <li key={i} className="truncate" title={h.name}>
                          {titleCase(h.name)}
                          {h.ccn && <span className="opacity-40 t-mono"> · {h.ccn}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </Reveal>
          ) : s.noPrices?.length > 0 && (
            <Reveal delay={200} className="mt-10">
              <details className="panel p-5">
                <summary className="t-small font-medium cursor-pointer">
                  The {s.noPrices.length} hospitals with no usable shoppable prices
                </summary>
                <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 t-small opacity-75">
                  {s.noPrices.map((h, i) => (
                    <li key={i} className="truncate">
                      {titleCase(h.name)}
                      <span className="opacity-50"> · {h.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Reveal>
          )}
        </div>
      </section>

      <section className="on-dark py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <Reveal as="h2" className="t-title">Every number here is checkable.</Reveal>
          <Reveal as="p" className="t-body mt-5 opacity-75" delay={70}>
            Each price links back to the hospital's own file, with its version, publication date
            and content hash. Read how the data was gathered and what its limits are.
          </Reveal>
          <Reveal delay={120} className="flex flex-wrap gap-2.5 justify-center mt-8">
            <Link to="/methodology" className="btn btn-accent">How this was built</Link>
            <Link to="/" className="btn btn-ghost">Look up a procedure</Link>
          </Reveal>
          {release?.releaseId && (
            <Reveal delay={170}>
              <p className="t-small opacity-45 mt-8 t-mono">
                Data release {release.releaseId}
                {release.builtAt && `, built ${new Date(release.builtAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
              </p>
            </Reveal>
          )}
        </div>
      </section>
    </>
  );
}
