import { Link } from 'react-router-dom';
import { fmtUSD } from '../lib/estimate.js';
import { approxRoadMiles } from '../lib/geo.js';

const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

const SCALE = ['#0F7B72', '#4F9A4A', '#C69214', '#E2692A', '#B62419'];

/**
 * One hospital's price, as a ledger row rather than a card.
 *
 * A column of these should read like a table of evidence: rank, name, price,
 * with a colour bar on the left that matches the map exactly, so a pin and a
 * row are obviously the same hospital. Detail stays folded away until asked for.
 */
export default function HospitalRow({ row, rank, band, cheapest, selected, onSelect, dicts, estimateFn, showDistance }) {
  const est = estimateFn && row.median != null ? estimateFn(row.median) : null;
  const spread = row.low != null && row.high != null && row.high > row.low;
  const colour = SCALE[band ?? 2];

  return (
    <li className={`relative transition-colors ${selected ? 'bg-paper-2' : 'hover:bg-paper-2/70'}`}>
      {/* the band that ties this row to its map pin */}
      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: colour }} />

      <button
        type="button" onClick={onSelect} aria-expanded={selected}
        className="w-full text-left pl-5 pr-4 sm:pl-6 sm:pr-5 py-5"
      >
        <div className="flex items-start gap-4 sm:gap-6">
          <span className="t-mono text-[0.6875rem] opacity-30 pt-1.5 tabular-nums shrink-0 w-5">
            {String(rank).padStart(2, '0')}
          </span>

          <span className="min-w-0 flex-1">
            {cheapest && (
              <span className="t-label mb-1.5 block" style={{ color: SCALE[0] }}>Lowest in this search</span>
            )}
            <span className="block font-semibold tracking-[-0.02em] text-[1.0625rem] leading-snug">
              {titleCase(row.name)}
            </span>
            <span className="block t-small opacity-55 mt-1">
              {titleCase(row.city)}
              {showDistance && row.miles != null && (
                <> · <span className="tabular-nums">{row.miles.toFixed(0)} mi</span>
                  <span className="opacity-70"> ({approxRoadMiles(row.miles).toFixed(0)} driving)</span></>
              )}
            </span>
          </span>

          <span className="text-right shrink-0">
            {row.median == null ? (
              <span className="t-small opacity-45">No price published</span>
            ) : (
              <>
                <span className="t-num text-[1.5rem] block">{fmtUSD(row.median, { round: true })}</span>
                <span className="t-mono text-[0.6875rem] opacity-45 tabular-nums block mt-1">
                  {spread ? `${fmtUSD(row.low, { round: true })} – ${fmtUSD(row.high, { round: true })}` : 'negotiated'}
                </span>
              </>
            )}
          </span>
        </div>

        {est && (
          <div className="mt-4 ml-9 sm:ml-11 pt-3.5 border-t rule flex flex-wrap items-baseline gap-x-7 gap-y-2">
            <span className="t-label opacity-40">You pay</span>
            <span className="t-num text-[1.375rem]" style={{ color: SCALE[0] }}>{fmtUSD(est.patient)}</span>
            <span className="t-small opacity-55">
              plan pays <span className="tabular-nums">{fmtUSD(est.plan)}</span>
            </span>
            {est.cappedByOopMax && (
              <span className="t-small" style={{ color: SCALE[0] }}>capped by your out-of-pocket maximum</span>
            )}
          </div>
        )}
      </button>

      {selected && (
        <div className="pl-5 pr-4 sm:pl-11 sm:pr-5 pb-6 -mt-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 py-5 border-t rule">
            {[
              ['Gross charge', row.gross, 'list price'],
              ['Cash price', row.cash, 'if you self-pay'],
              ['Lowest negotiated', row.minNegotiated, 'any plan'],
              ['Highest negotiated', row.maxNegotiated, 'any plan'],
            ].map(([label, v, help], i) => (
              <div key={label} className={i > 0 ? 'sm:pl-6 sm:border-l rule' : ''}>
                <div className="t-figure text-[1.0625rem]">{fmtUSD(v, { round: true })}</div>
                <div className="t-small opacity-55 mt-1">{label}</div>
                <div className="t-small opacity-35">{help}</div>
              </div>
            ))}
          </div>

          {row.cash != null && row.median != null && row.cash < row.median && (
            <p className="t-small mt-4 px-4 py-3 rounded-[12px]" style={{ background: 'var(--color-low-tint)', color: 'var(--color-ink)' }}>
              The cash price here is <strong className="tabular-nums">{fmtUSD(row.median - row.cash, { round: true })}</strong> lower
              than the typical insured rate. Paying cash usually will not count toward your deductible,
              so weigh that before deciding.
            </p>
          )}

          {est && (
            <div className="mt-4 py-5 border-t rule">
              <p className="t-label opacity-40 mb-3.5">How your share was worked out</p>
              <dl className="space-y-2 t-small tabular-nums max-w-md">
                <div className="flex justify-between"><dt className="opacity-60">Negotiated price</dt><dd className="t-figure">{fmtUSD(est.allowed)}</dd></div>
                {est.toDeductible > 0 && <div className="flex justify-between"><dt className="opacity-60">Toward your deductible</dt><dd className="t-figure">{fmtUSD(est.toDeductible)}</dd></div>}
                {est.toCoinsurance > 0 && <div className="flex justify-between"><dt className="opacity-60">Coinsurance</dt><dd className="t-figure">{fmtUSD(est.toCoinsurance)}</dd></div>}
                {est.toCopay > 0 && <div className="flex justify-between"><dt className="opacity-60">Copay</dt><dd className="t-figure">{fmtUSD(est.toCopay)}</dd></div>}
                <div className="flex justify-between pt-2 border-t rule font-semibold"><dt>Your share</dt><dd className="t-figure">{fmtUSD(est.patient)}</dd></div>
                <div className="flex justify-between opacity-60"><dt>Your plan pays</dt><dd className="t-figure">{fmtUSD(est.plan)}</dd></div>
              </dl>
              {est.notes.map((n, i) => <p key={i} className="t-small opacity-60 mt-2.5 max-w-[56ch]">{n}</p>)}
            </div>
          )}

          {row.matching.length > 0 && (
            <details className="mt-5 group">
              <summary className="t-small font-medium cursor-pointer select-none list-none flex items-center gap-2">
                <span className="t-mono text-[0.625rem] opacity-40 group-open:rotate-90 transition-transform inline-block">▸</span>
                All {row.matching.length} published {row.matching.length === 1 ? 'rate' : 'rates'} here
              </summary>
              <div className="mt-3 max-h-72 overflow-y-auto scroll-thin border rule rounded-[12px]">
                <table className="w-full text-[0.8125rem]">
                  <thead className="sticky top-0 bg-paper-2 text-left">
                    <tr>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Insurer</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Plan</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.matching.slice().sort((a, b) => a.price - b.price).map((r, i) => (
                      <tr key={i} className="border-t rule">
                        <td className="px-3 py-2">{dicts.payers[r.payer] || '—'}</td>
                        <td className="px-3 py-2 opacity-60">{dicts.plans[r.plan] || '—'}</td>
                        <td className="px-3 py-2 text-right t-figure">{fmtUSD(r.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            {row.ccn && <Link to={`/hospital/${row.ccn}`} className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">About this hospital</Link>}
            {row.ccn && (
              <a href={`https://www.medicare.gov/care-compare/details/hospital/${row.ccn}`} target="_blank" rel="noopener noreferrer"
                 className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                Quality and safety
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            )}
            {row.sources?.[0]?.url && (
              <a href={row.sources[0].url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                The hospital's own file
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            )}
          </div>

          {row.sources?.[0] && (
            <p className="t-mono text-[0.625rem] opacity-35 mt-4">
              File version {row.sources[0].version || 'unstated'}
              {row.sources[0].updated && ` · hospital says updated ${row.sources[0].updated}`}
              {row.sources[0].sha256 && ` · sha256 ${row.sources[0].sha256}…`}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
