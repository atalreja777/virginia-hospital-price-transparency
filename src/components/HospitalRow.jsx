import { Link } from 'react-router-dom';
import { fmtUSD } from '../lib/estimate.js';
import { approxRoadMiles } from '../lib/geo.js';

const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

/** One hospital's price for the chosen procedure, with the detail behind a click. */
export default function HospitalRow({ row, cheapest, selected, onSelect, dicts, estimateFn, showDistance }) {
  const est = estimateFn && row.median != null ? estimateFn(row.median) : null;
  const spread = row.low != null && row.high != null && row.high > row.low;

  return (
    <li
      className={`panel overflow-hidden transition-[border-color,box-shadow] scroll-mt-36
        ${selected ? 'border-ink shadow-[0_6px_28px_rgb(0_0_0/0.09)]' : ''}
        ${cheapest ? 'ring-1 ring-[var(--color-p1)]' : ''}`}
    >
      <button type="button" onClick={onSelect} aria-expanded={selected}
              className="w-full text-left px-5 py-4 hover:bg-paper-2 transition-colors">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            {cheapest && (
              <span className="t-label text-[var(--color-p1)] block mb-1.5">Lowest in this search</span>
            )}
            <h3 className="font-semibold tracking-[-0.016em] text-[1.0625rem] leading-snug">
              {titleCase(row.name)}
            </h3>
            <p className="t-small opacity-60 mt-1">
              {titleCase(row.city)}
              {showDistance && row.miles != null && (
                <> · <span className="tnum">{row.miles.toFixed(0)} mi</span> away
                   <span className="opacity-70"> (about {approxRoadMiles(row.miles).toFixed(0)} driving)</span></>
              )}
            </p>
          </div>

          <div className="text-right shrink-0">
            {row.median == null ? (
              <span className="t-small opacity-50">No price published</span>
            ) : (
              <>
                <div className="t-num text-[1.5rem]">
                  {fmtUSD(row.median, { round: true })}
                </div>
                <div className="t-small opacity-55 tnum">
                  {spread ? `${fmtUSD(row.low, { round: true })}–${fmtUSD(row.high, { round: true })}` : 'negotiated'}
                </div>
              </>
            )}
          </div>
        </div>

        {est && (
          <div className="mt-3.5 pt-3.5 border-t rule flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
            <span className="t-label opacity-50">You would pay</span>
            <span className="t-num text-[1.375rem] text-[var(--color-p1)]">
              {fmtUSD(est.patient)}
            </span>
            <span className="t-small opacity-60">
              your plan pays <span className="tnum">{fmtUSD(est.plan)}</span>
            </span>
            {est.cappedByOopMax && <span className="t-small text-[var(--color-p1)]">capped by your out-of-pocket maximum</span>}
          </div>
        )}
      </button>

      {selected && (
        <div className="px-5 pb-5 border-t rule pt-4 bg-paper-2/60">
          {/* what the hospital charges everyone */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            {[
              ['Gross charge', row.gross, 'The list price, before any discount.'],
              ['Cash price', row.cash, 'What the hospital accepts from a self-paying patient.'],
              ['Lowest negotiated', row.minNegotiated, 'Across every plan in the file.'],
              ['Highest negotiated', row.maxNegotiated, 'Across every plan in the file.'],
            ].map(([label, v, help]) => (
              <div key={label}>
                <div className="t-label opacity-45">{label}</div>
                <div className="t-mono text-[0.9375rem] font-medium tnum mt-1">{fmtUSD(v, { round: true })}</div>
                <div className="t-small opacity-50 mt-0.5 leading-snug">{help}</div>
              </div>
            ))}
          </div>

          {row.cash != null && row.median != null && row.cash < row.median && (
            <p className="t-small mb-5 px-3.5 py-2.5 rounded-[2px] bg-[#EAF6F2] border border-[#B9DED3]">
              The cash price here is <strong className="tnum">{fmtUSD(row.median - row.cash, { round: true })}</strong> lower
              than the typical insured rate. Paying cash usually will not count toward your deductible,
              so weigh that before deciding.
            </p>
          )}

          {est && (
            <div className="mb-5 p-4 rounded-[2px] bg-white border rule">
              <p className="t-label opacity-50 mb-3">How your share was worked out</p>
              <dl className="space-y-1.5 t-small tnum">
                <div className="flex justify-between"><dt className="opacity-70">Negotiated price</dt><dd>{fmtUSD(est.allowed)}</dd></div>
                {est.toDeductible > 0 && <div className="flex justify-between"><dt className="opacity-70">Toward your deductible</dt><dd>{fmtUSD(est.toDeductible)}</dd></div>}
                {est.toCoinsurance > 0 && <div className="flex justify-between"><dt className="opacity-70">Coinsurance</dt><dd>{fmtUSD(est.toCoinsurance)}</dd></div>}
                {est.toCopay > 0 && <div className="flex justify-between"><dt className="opacity-70">Copay</dt><dd>{fmtUSD(est.toCopay)}</dd></div>}
                <div className="flex justify-between font-semibold pt-1.5 border-t rule"><dt>Your share</dt><dd>{fmtUSD(est.patient)}</dd></div>
                <div className="flex justify-between opacity-70"><dt>Your plan pays</dt><dd>{fmtUSD(est.plan)}</dd></div>
              </dl>
              {est.notes.map((n, i) => <p key={i} className="t-small opacity-65 mt-2.5">{n}</p>)}
            </div>
          )}

          {/* every published rate */}
          {row.matching.length > 0 && (
            <details className="mb-4">
              <summary className="t-small font-medium cursor-pointer select-none">
                All {row.matching.length} published {row.matching.length === 1 ? 'rate' : 'rates'} at this hospital
              </summary>
              <div className="mt-3 max-h-72 overflow-y-auto scroll-thin rounded-[2px] border rule bg-white">
                <table className="w-full text-[0.8125rem]">
                  <thead className="sticky top-0 bg-paper-2 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Insurer</th>
                      <th className="px-3 py-2 font-medium">Plan</th>
                      <th className="px-3 py-2 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.matching.slice().sort((a, b) => a.price - b.price).map((r, i) => (
                      <tr key={i} className="border-t rule">
                        <td className="px-3 py-2">{dicts.payers[r.payer] || '—'}</td>
                        <td className="px-3 py-2 opacity-70">{dicts.plans[r.plan] || '—'}</td>
                        <td className="px-3 py-2 text-right tnum font-medium">{fmtUSD(r.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            {row.ccn && <Link to={`/hospital/${row.ccn}`} className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">About this hospital</Link>}
            {row.ccn && (
              <a href={`https://www.medicare.gov/care-compare/details/hospital/${row.ccn}`}
                 target="_blank" rel="noopener noreferrer" className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                Quality and safety ratings
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
            {row.sources?.[0]?.url && (
              <a href={row.sources[0].url} target="_blank" rel="noopener noreferrer"
                 className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                The hospital's own price file
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>

          {row.sources?.[0] && (
            <p className="t-small opacity-45 mt-3 t-mono">
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
