import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Loading from '../components/Loading.jsx';
import Reveal from '../components/Reveal.jsx';
import { fmtUSD } from '../lib/estimate.js';
import { freshness } from '../lib/prices.js';
import useDocumentMeta from '../lib/useDocumentMeta.js';

const BASE = import.meta.env.BASE_URL || '/';
const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

export default function Hospital() {
  const { ccn } = useParams();
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);

  useDocumentMeta(
    h ? titleCase(h.name) : undefined,
    h ? `Published prices, coverage and sources for ${titleCase(h.name)}, a Virginia hospital.` : undefined,
  );

  useEffect(() => {
    setH(null); setErr(null);
    fetch(`${BASE}data/hospital/${encodeURIComponent(ccn)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then(setH).catch((e) => setErr(e.message));
  }, [ccn]);

  if (err) {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-40 pb-28">
        <p className="t-label opacity-45">Not found</p>
        <h1 className="t-display mt-4">No page for this hospital.</h1>
        <p className="t-body mt-5 opacity-70">
          Either the identifier is wrong, or this hospital published no prices we could read.
        </p>
        <Link to="/data" className="btn btn-ink mt-8">See statewide coverage</Link>
      </div>
    );
  }
  if (!h) return <Loading label="Loading hospital" />;

  const src = h.sources?.[0];
  const cashShare = h.stats.cashComparisons ? h.stats.cashBeatsInsured / h.stats.cashComparisons : null;
  // `stats.rates` became `stats.priceEntries` under the new contract.
  const priceEntries = h.stats.priceEntries ?? h.stats.rates ?? 0;
  // Values that exist but are not prices, reported rather than dropped.
  const also = [
    h.stats.withheldEntries ? `${h.stats.withheldEntries.toLocaleString()} withheld below one cent` : null,
    h.stats.formulaEntries ? `${h.stats.formulaEntries.toLocaleString()} formula-based with no dollar amount` : null,
  ].filter(Boolean);

  return (
    <>
      <header className="on-dark pt-36 pb-16">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label text-accent">Virginia hospital</Reveal>
          <Reveal as="h1" className="t-display mt-4 max-w-[22ch]" delay={60}>{titleCase(h.name)}</Reveal>
          <Reveal as="p" className="t-lede mt-5 opacity-75" delay={110}>
            {titleCase(h.address)}, {titleCase(h.city)}, VA {h.zip}
          </Reveal>
          <Reveal delay={160} className="flex flex-wrap gap-2.5 mt-8">
            <a href={`https://www.medicare.gov/care-compare/details/hospital/${h.ccn}`} target="_blank" rel="noopener noreferrer" className="btn btn-accent">
              Quality and safety ratings
            </a>
            {src?.url && <a href={src.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">The hospital's price file</a>}
          </Reveal>
        </div>
      </header>

      <section className="bg-paper py-16 sm:py-20 border-b rule">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 grid grid-cols-2 lg:grid-cols-4 gap-10">
          {[
            [h.stats.codes.toLocaleString(), 'Schedulable procedures priced'],
            [priceEntries.toLocaleString(), 'Published price entries'],
            [h.stats.payers, 'Distinct payer names in the file'],
            [cashShare != null ? `${Math.round(cashShare * 100)}%` : '—', 'Of prices where cash beats insured'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="t-num text-[2.25rem]">{v}</div>
              <div className="t-label opacity-50 mt-3">{l}</div>
            </div>
          ))}
        </div>
        {also.length > 0 && (
          <div className="max-w-[92rem] mx-auto px-5 sm:px-8 mt-8">
            <p className="t-small opacity-55">Also published here: {also.join('; ')}.</p>
          </div>
        )}
      </section>

      {h.basket?.length > 0 && (
        <section className="bg-paper py-20 sm:py-28">
          <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
            <Reveal as="h2" className="t-title">Common procedures here, against the state.</Reveal>
            <Reveal as="p" className="t-body mt-4 opacity-70 max-w-[54ch]" delay={60}>
              This hospital's median negotiated price next to the median across every Virginia
              hospital that published the same code.
            </Reveal>

            <div className="mt-10 overflow-x-auto scroll-thin">
              <table className="w-full min-w-[46rem] text-[0.9375rem]">
                <thead>
                  <tr className="text-left border-b rule">
                    <th className="py-3 pr-4 font-medium">Procedure</th>
                    <th className="py-3 px-4 font-medium text-right">Here</th>
                    <th className="py-3 px-4 font-medium text-right">Virginia median</th>
                    <th className="py-3 px-4 font-medium text-right">Difference</th>
                    <th className="py-3 pl-4 font-medium text-right">Cash price</th>
                  </tr>
                </thead>
                <tbody>
                  {h.basket.map((b) => {
                    const diff = b.median != null && b.stateMedian != null ? b.median - b.stateMedian : null;
                    return (
                      <tr key={`${b.type}-${b.code}`} className="border-b rule hover:bg-paper-2 transition-colors">
                        <td className="py-3 pr-4">
                          <Link to={`/procedure/${b.type}/${b.code}`} className="link-draw font-medium">{b.label}</Link>
                          <span className="block t-small opacity-50 t-mono">{b.type === 'MS-DRG' ? 'DRG' : b.type} {b.code}</span>
                        </td>
                        <td className="py-3 px-4 text-right tnum font-medium">{fmtUSD(b.median, { round: true })}</td>
                        <td className="py-3 px-4 text-right tnum opacity-70">{fmtUSD(b.stateMedian, { round: true })}</td>
                        <td className={`py-3 px-4 text-right tnum font-medium ${diff == null ? '' : diff > 0 ? 'text-[var(--color-p5)]' : 'text-[var(--color-p1)]'}`}>
                          {diff == null ? '—' : `${diff > 0 ? '+' : '−'}${fmtUSD(Math.abs(diff), { round: true }).replace('$', '$')}`}
                        </td>
                        {/* A hospital can publish more than one cash price for a
                            code — one per setting and billing class. Showing the
                            max, as this once did, invents a price nobody published. */}
                        <td className="py-3 pl-4 text-right tnum opacity-70">
                          {(() => {
                            const lo = b.cashLow ?? b.cash ?? null;
                            const hi = b.cashHigh ?? b.cash ?? null;
                            if (lo == null) return '—';
                            return hi != null && hi !== lo
                              ? <span title="This hospital published more than one cash price for this code.">
                                  {fmtUSD(lo, { round: true })} – {fmtUSD(hi, { round: true })}
                                </span>
                              : fmtUSD(lo, { round: true });
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="bg-paper-2 py-20 sm:py-28">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-12">
          <div>
            <h2 className="t-title">Where these prices come from</h2>
            <p className="t-body mt-4 opacity-75 max-w-[48ch]">
              Federal rule 45 CFR Part 180 requires this hospital to publish a machine-readable
              file of its standard charges. Everything above was read from that file and nothing else.
            </p>
            {h.stats.brands?.length > 0 && (
              <>
                <p className="t-label opacity-45 mt-8 mb-3">Insurers named in the file</p>
                <div className="flex flex-wrap gap-1.5">
                  {h.stats.brands.slice(0, 24).map((b) => (
                    <span key={b} className="px-2.5 py-1 rounded-full bg-paper border rule text-[0.8125rem]">{b}</span>
                  ))}
                </div>
              </>
            )}
          </div>

          {src && (
            <div className="panel p-6">
              <p className="t-label opacity-45 mb-4">The file itself</p>
              <dl className="space-y-3 t-small">
                {[
                  ['Schema version', src.version || 'not stated'],
                  ['Hospital says updated', `${src.updated || 'not stated'} (${freshness(src.updated).label})`],
                  ['We fetched it', src.fetched || '—'],
                  ['Size', src.bytes ? `${(src.bytes / 1048576).toFixed(1)} MB` : '—'],
                  // The full digest, not a prefix with an ellipsis: being able to
                  // check it against the published file is the point of carrying it.
                  ['Content hash', src.sha256 || '—'],
                  ['Attestation confirmed', src.attested === true ? 'yes' : src.attested === false ? 'no' : 'not stated'],
                  ['Federal ID (CCN)', h.ccn],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b rule pb-2.5">
                    <dt className="opacity-60">{k}</dt>
                    <dd className="t-mono text-[0.75rem] text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              <a href={src.url} target="_blank" rel="noopener noreferrer" className="btn btn-ink mt-6 w-full justify-center">
                Open the original file
              </a>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
