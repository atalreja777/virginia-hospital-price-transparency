import { Link } from 'react-router-dom';
import { fmtUSD } from '../lib/estimate.js';
import { approxRoadMiles } from '../lib/geo.js';
import {
  chargeSummaryFor, alsoPublished, formulaLabel, WITHHELD_NOTE,
  sourceOf, freshness, isPerUnitGroup,
} from '../lib/prices.js';
import PriceTrack from './PriceTrack.jsx';
import RateSpark from './RateSpark.jsx';

const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of');

const SCALE = ['#0F7B72', '#4F9A4A', '#C69214', '#E2692A', '#B62419'];

const FRESH_STYLE = {
  current: { bg: 'var(--color-low-tint)', fg: '#0F7B72' },
  stale: { bg: 'rgb(226 105 42 / 0.12)', fg: '#9A3412' },
  unknown: { bg: 'var(--color-paper-3)', fg: 'inherit' },
};

/** How old the file behind an entry is, as a chip beside its date. */
function FreshnessBadge({ src }) {
  const f = freshness(src?.updated);
  const style = FRESH_STYLE[f.state] || FRESH_STYLE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 t-small">
      <span className="opacity-55">
        {src?.updated ? `hospital says updated ${src.updated}` : 'no update date stated'}
      </span>
      <span
        className="px-1.5 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide"
        style={{ background: style.bg, color: style.fg }}
      >
        {f.label}
      </span>
    </span>
  );
}

/** A labelled money range that never collapses two different numbers into one. */
function Figure({ label, help, low, high, colour, top }) {
  const has = low != null;
  const range = has && high != null && high !== low;
  const width = !has ? 0 : Math.max(2, ((range ? high : low) / (top || 1)) * 100);
  return (
    <div>
      <div className="t-figure text-[1.0625rem] leading-tight">
        {!has ? '—' : range
          ? <>{fmtUSD(low, { round: true })} – {fmtUSD(high, { round: true })}</>
          : fmtUSD(low, { round: true })}
      </div>
      <div className="h-[5px] rounded-full bg-paper-3 mt-2 overflow-hidden">
        <div className="h-full rounded-full bar-grow" style={{ width: `${width}%`, background: colour }} />
      </div>
      <div className="t-small opacity-55 mt-1.5">{label}</div>
      <div className="t-small opacity-35">{help}</div>
    </div>
  );
}

/**
 * One hospital's price, as a ledger row rather than a card.
 *
 * A column of these should read like a table of evidence: rank, name, price,
 * with a colour bar on the left that matches the map exactly, so a pin and a
 * row are obviously the same hospital. Detail stays folded away until asked for.
 */
export default function HospitalRow({
  row, rank, band, cheapest, selected, onSelect, dicts, estimateFn, showDistance,
  domainLow, domainHigh, dearest, ctx, groupByIndex,
}) {
  const est = estimateFn && row.median != null ? estimateFn(row.median) : null;
  const spread = row.low != null && row.high != null && row.high > row.low;
  const colour = SCALE[band ?? 2];
  const saving = dearest != null && row.median != null ? dearest - row.median : 0;

  const settings = dicts?.settings || [];
  const billingClasses = dicts?.billingClasses || [];
  const methods = dicts?.methods || [];
  const sources = row.sources || [];

  // Charges for the context on screen, not the maximum across every setting.
  const charges = chargeSummaryFor(row.charges, ctx);
  const also = alsoPublished(row);
  const formulaOnly = (row.rates?.length ?? 0) === 0 && (row.formula?.length ?? 0) > 0;

  // Every distinct file behind anything shown for this hospital. A price from
  // the second file must never be labelled with the first file's URL and hash.
  const usedSrc = [...new Set([
    ...(row.matching || []).map((r) => r.src),
    ...(row.withheld || []).map((r) => r.src),
    ...(row.formula || []).map((r) => r.src),
    ...(row.charges || []).map((c) => c.src),
  ].filter((s) => s != null))].sort((a, b) => a - b);
  const usedSources = usedSrc.map((i) => ({ i, src: sourceOf(sources, i) })).filter((x) => x.src);
  const manyFiles = usedSources.length > 1;

  const label = (dict, i) => (i == null ? null : (dict[i] || null));
  const perDiem = (r) => isPerUnitGroup(groupByIndex?.[r.method]);

  return (
    <li
      className={`relative rounded-[24px] overflow-hidden transition-all duration-300
        ${selected
          ? 'bg-card shadow-[0_10px_36px_-10px_rgb(20_18_15/0.18)] ring-1 ring-[color:var(--color-rule)]'
          : 'bg-card/70 hover:bg-card hover:shadow-[0_6px_24px_-10px_rgb(20_18_15/0.14)] ring-1 ring-[color:var(--color-rule)]/70'}`}
    >
      {/* colour strip: the same scale as the map pin, so a card and a pin are
          obviously the same hospital */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background: colour }} />

      <button
        type="button" onClick={onSelect} aria-expanded={selected}
        className="w-full text-left px-5 sm:px-6 pt-6 pb-5"
      >
        <div className="flex items-start gap-4 sm:gap-6">
          <span className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-[0.75rem] font-bold tabular-nums"
                style={{ background: cheapest ? SCALE[0] : 'var(--color-paper-2)', color: cheapest ? '#fff' : 'inherit' }}>
            {rank}
          </span>

          <span className="min-w-0 flex-1">
            {cheapest && (
              <span className="t-label mb-1.5 block" style={{ color: SCALE[0] }}>Lowest in this search</span>
            )}
            <span className="block font-semibold tracking-[-0.02em] text-[1.125rem] leading-snug">
              {titleCase(row.name)}
            </span>
            <span className="block t-small opacity-55 mt-1">
              {titleCase(row.city)}
              {showDistance && row.miles != null && (
                <> · <span className="tabular-nums">{row.miles.toFixed(0)} mi</span>
                  <span className="opacity-70"> (approx. {approxRoadMiles(row.miles).toFixed(0)} road miles — straight line × 1.25)</span></>
              )}
            </span>
          </span>

          <span className="text-right shrink-0">
            {row.median == null ? (
              formulaOnly ? (
                <>
                  <span className="t-small font-semibold" style={{ color: '#9A3412' }}>Formula-based only</span>
                  <span className="block t-small opacity-45 mt-1">no dollar amount published</span>
                </>
              ) : (
                <span className="t-small opacity-45">No price published</span>
              )
            ) : (
              <>
                <span className="t-num text-[1.75rem] block">{fmtUSD(row.median, { round: true })}</span>
                <span className="t-mono text-[0.6875rem] opacity-45 tabular-nums block mt-1">
                  {spread ? `${fmtUSD(row.low, { round: true })} – ${fmtUSD(row.high, { round: true })}` : 'negotiated'}
                </span>
              </>
            )}
          </span>
        </div>

        {row.median != null && (
          <div className="mt-4 ml-12 sm:ml-14 grid grid-cols-[1fr_auto] items-center gap-x-5">
            <PriceTrack
              low={row.low} median={row.median} high={row.high}
              domainLow={domainLow} domainHigh={domainHigh}
              band={band} delay={rank * 45}
            />
            <span className="t-small tabular-nums whitespace-nowrap">
              {saving > 0
                ? <span style={{ color: SCALE[0] }}>save {fmtUSD(saving, { round: true })}</span>
                : <span className="opacity-35">most expensive here</span>}
            </span>
          </div>
        )}

        {/* Values that exist but are not prices are counted here rather than
            silently dropped, so a hospital never looks emptier than it is. */}
        {also && <p className="mt-3 ml-12 sm:ml-14 t-small opacity-50">{also}</p>}

        {est && (
          <div className="mt-4 ml-12 sm:ml-14 pt-4 border-t rule flex flex-wrap items-baseline gap-x-7 gap-y-2">
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
        <div className="px-5 sm:px-6 pb-6 -mt-1">
          {charges.combinations > 0 && (() => {
            const top = Math.max(
              charges.grossHigh ?? 0, charges.cashHigh ?? 0,
              charges.maxNegotiated ?? 0, 1,
            );
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 py-5 border-t rule">
                  <Figure label="Gross charge" help="list price" low={charges.grossLow} high={charges.grossHigh} colour="#8A8578" top={top} />
                  <Figure label="Cash price" help="if you self-pay" low={charges.cashLow} high={charges.cashHigh} colour={SCALE[1]} top={top} />
                  <Figure label="Lowest negotiated" help="in the file" low={charges.minNegotiated} colour={SCALE[0]} top={top} />
                  <Figure label="Highest negotiated" help="in the file" low={charges.maxNegotiated} colour={SCALE[4]} top={top} />
                </div>

                {/* Never quietly take the max: say when there is more than one. */}
                {charges.varies && (
                  <p className="t-small opacity-60 -mt-1 mb-1">
                    Cash price varies by setting and billing class — {charges.distinctCash} different
                    values are published for this code, shown as a range rather than one number.
                  </p>
                )}
                {charges.merged && (
                  <p className="t-small opacity-60 -mt-1 mb-1">
                    This dataset merged every setting and billing class into one figure. The split
                    is available once the data is rebuilt.
                  </p>
                )}
                {!charges.scoped && charges.combinations > 0 && (
                  <p className="t-small opacity-60 -mt-1 mb-1">
                    Nothing was published for the setting selected above; showing every combination
                    this hospital published.
                  </p>
                )}
                {charges.hasWithheld && (
                  <p className="t-small opacity-60 -mt-1 mb-1">
                    One or more charge fields here were {WITHHELD_NOTE}.
                  </p>
                )}
              </>
            );
          })()}

          {charges.cashLow != null && row.median != null && charges.cashHigh < row.median && (
            <p className="t-small mt-4 px-4 py-3 rounded-[12px]" style={{ background: 'var(--color-low-tint)', color: 'var(--color-ink)' }}>
              The cash price here is <strong className="tabular-nums">{fmtUSD(row.median - charges.cashHigh, { round: true })}</strong> lower
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

          {row.prices?.length >= 3 && (
            <div className="mt-5 pt-5 border-t rule">
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <span className="t-label opacity-40">Every plan's rate here</span>
                <span className="t-small opacity-45 tabular-nums">
                  {row.prices.length} entries, {fmtUSD(row.prices[0], { round: true })} to {fmtUSD(row.prices[row.prices.length - 1], { round: true })}
                </span>
              </div>
              <RateSpark prices={row.prices} colour={colour} />
              <p className="t-small opacity-45 -mt-1">
                Each tick is one published price entry; a plan can appear more than once. Bunched
                together means this hospital charges everyone about the same; spread out means
                what you pay depends on your insurer.
              </p>
            </div>
          )}

          {row.matching?.length > 0 && (
            <details className="mt-5 group">
              <summary className="t-small font-medium cursor-pointer select-none list-none flex items-center gap-2">
                <span className="t-mono text-[0.625rem] opacity-40 group-open:rotate-90 transition-transform inline-block">▸</span>
                All {row.matching.length} published price {row.matching.length === 1 ? 'entry' : 'entries'} here
              </summary>
              <div className="mt-3 max-h-72 overflow-y-auto scroll-thin border rule rounded-[12px]">
                <table className="w-full text-[0.8125rem]">
                  <thead className="sticky top-0 bg-paper-2 text-left">
                    <tr>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Insurer</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Plan</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Setting</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Billing class</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium">Method</th>
                      <th className="px-3 py-2 t-label opacity-50 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.matching.slice().sort((a, b) => a.price - b.price).map((r, i) => {
                      const s = sourceOf(sources, r.src);
                      return (
                        <tr key={i} className="border-t rule">
                          <td className="px-3 py-2">{label(dicts.payers, r.payer) || '—'}</td>
                          <td className="px-3 py-2 opacity-60">{label(dicts.plans, r.plan) || '—'}</td>
                          <td className="px-3 py-2 opacity-60">{label(settings, r.setting) || '—'}</td>
                          <td className="px-3 py-2 opacity-60">{label(billingClasses, r.billingClass) || 'not stated'}</td>
                          <td className="px-3 py-2 opacity-60">
                            {label(methods, r.method) || '—'}
                            {perDiem(r) && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-paper-3 text-[0.625rem] font-semibold uppercase tracking-wide">
                                per day
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right t-figure whitespace-nowrap">
                            {fmtUSD(r.price)}
                            {manyFiles && s?.url && (
                              <a href={s.url} target="_blank" rel="noopener noreferrer"
                                 title={`From ${s.url}`}
                                 className="ml-1.5 t-mono text-[0.625rem] opacity-40 hover:opacity-100 underline">
                                f{r.src + 1}
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Published, but not a price. Shown as what it is rather than as $0.01. */}
          {row.withheld?.length > 0 && (
            <details className="mt-4 group">
              <summary className="t-small font-medium cursor-pointer select-none list-none flex items-center gap-2">
                <span className="t-mono text-[0.625rem] opacity-40 group-open:rotate-90 transition-transform inline-block">▸</span>
                {row.withheld.length} withheld {row.withheld.length === 1 ? 'value' : 'values'}
              </summary>
              <p className="t-small opacity-60 mt-2 max-w-[62ch]">
                This hospital published a value below one cent for these plans. It is not a usable
                price, so it is not shown as one.
              </p>
              <ul className="mt-2.5 space-y-1 t-small">
                {row.withheld.map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 opacity-70">
                    <span>{label(dicts.payers, r.payer) || '—'}</span>
                    <span className="opacity-60">{label(dicts.plans, r.plan) || ''}</span>
                    <span className="opacity-50">{label(settings, r.setting) || ''}</span>
                    <span className="opacity-50">{label(methods, r.method) || ''}</span>
                    <span className="opacity-45">— {WITHHELD_NOTE}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {row.formula?.length > 0 && (
            <details className="mt-4 group">
              <summary className="t-small font-medium cursor-pointer select-none list-none flex items-center gap-2">
                <span className="t-mono text-[0.625rem] opacity-40 group-open:rotate-90 transition-transform inline-block">▸</span>
                {row.formula.length} formula-based {row.formula.length === 1 ? 'rate' : 'rates'}
              </summary>
              <p className="t-small opacity-60 mt-2 max-w-[62ch]">
                These rates are published as a rule rather than a dollar amount, so no price can be
                shown for them. They are real published rates, not missing data.
              </p>
              <ul className="mt-2.5 space-y-1 t-small">
                {row.formula.slice(0, 60).map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 opacity-70">
                    <span>{label(dicts.payers, r.payer) || '—'}</span>
                    <span className="opacity-60">{label(dicts.plans, r.plan) || ''}</span>
                    <span className="opacity-45">— {formulaLabel(r, { percentageScale: dicts.percentageScale })}</span>
                  </li>
                ))}
              </ul>
              {row.formula.length > 60 && (
                <p className="t-small opacity-45 mt-2">…and {row.formula.length - 60} more.</p>
              )}
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
            {/* One link per file actually behind the entries above — not sources[0]. */}
            {usedSources.map(({ i, src }) => (
              <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !py-1.5 !px-3 !text-[0.8125rem]">
                {manyFiles ? `The hospital's file ${i + 1}` : "The hospital's own file"}
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M4 2h6v6M10 2 3 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
            ))}
          </div>

          {usedSources.map(({ i, src }) => (
            <div key={i} className="mt-4">
              <p className="t-small opacity-45 flex flex-wrap items-center gap-x-2">
                {manyFiles && <span className="t-mono text-[0.625rem]">file {i + 1}</span>}
                <FreshnessBadge src={src} />
              </p>
              <details className="mt-1.5">
                <summary className="t-small opacity-45 cursor-pointer select-none">File details and content hash</summary>
                <dl className="mt-2 space-y-1.5 t-small">
                  {[
                    ['Schema version', src.version || 'not stated'],
                    ['Hospital says updated', src.updated || 'not stated'],
                    ['We fetched it', src.fetched || '—'],
                    ['File version id', src.fileVersionId ?? '—'],
                    ['Source page', src.pageUrl || 'not stated'],
                    ['sha256', src.sha256 || '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b rule pb-1.5">
                      <dt className="opacity-60 shrink-0">{k}</dt>
                      <dd className="t-mono text-[0.6875rem] text-right break-all">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
