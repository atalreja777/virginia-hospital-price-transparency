import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  loadCode, loadHospitals, loadPayers, loadPlans, loadSettings, loadMethods, loadZips,
  loadSearch, loadPayerGroups, loadBillingClasses, loadPayerSegments, loadMeta, hasNewBuild,
} from '../lib/data.js';
import {
  defaultContext, rateMatches, contextMedian, methodGroupsByIndex,
  METHOD_GROUPS, isFormulaOnly,
} from '../lib/prices.js';
import { estimate, emptyBenefits, fmtUSD } from '../lib/estimate.js';
import { withDistance, zipToPoint, isValidZip, approxRoadMiles } from '../lib/geo.js';
import useDocumentMeta from '../lib/useDocumentMeta.js';
import InsuranceWizard from '../components/InsuranceWizard.jsx';
import InsuranceCue from '../components/InsuranceCue.jsx';
import PriceDistanceChart from '../components/PriceDistanceChart.jsx';
import HospitalRow from '../components/HospitalRow.jsx';
import Loading from '../components/Loading.jsx';
import SearchBox from '../components/SearchBox.jsx';

const HospitalMap = lazy(() => import('../components/HospitalMap.jsx'));

const RADII = [10, 25, 50, 100, 0];
const radiusLabel = (r) => (r === 0 ? 'Anywhere in Virginia' : `${r} miles`);

/** Only mount the map once its container is actually about to be seen. */
function useInView(ref) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (inView || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setInView(true); obs.disconnect(); } },
      { rootMargin: '200px' },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [inView, ref]);
  return inView;
}

export default function Procedure() {
  const { type, code } = useParams();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [hospitals, setHospitals] = useState(null);
  const [dicts, setDicts] = useState(null);
  const [zips, setZips] = useState(null);
  const [error, setError] = useState(null);

  // Read once on arrival; the URL is not kept in sync automatically after
  // that, so typing a ZIP never publishes it to the address bar without
  // being asked to (see the "copy link with my ZIP" control below).
  const [zip, setZip] = useState(params.get('zip') || '');
  const [radius, setRadius] = useState(Number(params.get('r') ?? 50));
  const [brand, setBrand] = useState(null);          // carrier group, e.g. "Aetna"
  const [planId, setPlanId] = useState(null);
  const [benefits, setBenefits] = useState(emptyBenefits);
  const [insOpen, setInsOpen] = useState(false);
  const [view, setView] = useState('list');     // list | chart
  const [switching, setSwitching] = useState(false);   // procedure search open
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('price');
  const [showMap, setShowMap] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  // What counts as one comparable thing. Null until the dictionaries say what
  // settings and billing classes this dataset actually distinguishes.
  const [ctx, setCtx] = useState(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [commercialOnly, setCommercialOnly] = useState(false);

  const closeIns = useCallback(() => setInsOpen(false), []);
  const openIns = useCallback(() => setInsOpen(true), []);
  const mapWrapRef = useRef(null);
  const mapInView = useInView(mapWrapRef);

  useEffect(() => {
    // `alive` — not a real network abort — is what actually has to protect
    // this: loadCode shares a memoised fetch per shard file across every
    // caller (two neighbouring codes, e.g. "with contrast" / "without
    // contrast", often live in the same shard), so aborting the underlying
    // request on route change would cancel it out from under a different
    // code's in-flight request too. Ignoring a stale response once it
    // arrives is what keeps a fast route change from painting the wrong
    // procedure; the timeout below is what keeps a hung request from
    // spinning forever.
    let alive = true;
    setData(null); setError(null);

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('Timed out waiting for the price data.'), { name: 'TimeoutError' })), 15000);
    });

    Promise.race([
      Promise.all([
        loadCode(type, code), loadHospitals(), loadPayers(), loadPlans(),
        loadSettings(), loadMethods(), loadZips(), loadSearch(), loadPayerGroups(),
        loadBillingClasses(), loadPayerSegments(), loadMeta().catch(() => null),
      ]),
      timeout,
    ])
      .then(([d, h, payers, plans, settings, methods, z, idx, pg, bc, pseg, meta]) => {
        if (!alive) return;
        if (d.status === 'absent') { setError({ kind: 'absent' }); return; }
        const next = {
          payers, plans, settings, methods, index: idx, payerGroups: pg,
          billingClasses: bc || [], payerSegments: pseg || null,
          percentageScale: meta?.shard?.percentageScale ?? 100,
        };
        setData(d); setHospitals(h); setZips(z);
        setDicts(next);
        setCtx((prev) => prev || defaultContext(next));
      })
      .catch((e) => {
        if (!alive) return;
        const id = Date.now().toString(36).slice(-6);
        const message = e?.message || 'The price data could not be loaded.';
        // A 404 on a file this build's index says should exist is exactly what
        // happens when a new deploy has removed or renamed shards underneath
        // an already-open tab. Worth a different prompt than "try again",
        // since "try again" on the same stale tab would just repeat it.
        (e?.status === 404 ? hasNewBuild() : Promise.resolve(false)).then((stale) => {
          if (!alive) return;
          setError({ kind: 'error', id, message, stale });
        });
      });
    return () => { alive = false; };
  }, [type, code]);

  const copyShareLink = async () => {
    const next = new URLSearchParams(params);
    zip ? next.set('zip', zip) : next.delete('zip');
    radius ? next.set('r', String(radius)) : next.delete('r');
    const qs = next.toString();
    const shareUrl = `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setParams(next, { replace: true }); // clipboard unavailable — fall back to a shareable address bar
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useDocumentMeta(
    data ? (data.desc || `${type} ${code}`) : undefined,
    data
      ? `${data.desc || `${type} code ${code}`}: compare published prices across Virginia hospitals `
        + 'and get a planning estimate from your insurance benefits.'
      : undefined,
  );

  const origin = useMemo(() => (zips && isValidZip(zip) ? zipToPoint(zips, zip) : null), [zips, zip]);

  /** The payer indices that belong to the chosen carrier. */
  const brandMembers = useMemo(() => {
    if (!brand || !dicts?.payerGroups) return null;
    const g = dicts.payerGroups.groups.find((x) => x.brand === brand);
    return g ? new Set(g.members) : null;
  }, [brand, dicts]);

  /** Which carriers and plans actually appear for this procedure. */
  const { availableBrands, availablePlans } = useMemo(() => {
    const counts = new Map(), pl = new Set();
    if (data && dicts?.payerGroups) {
      const { brandOf } = dicts.payerGroups;
      for (const h of data.hospitals) {
        for (const r of h.rates) {
          const b = brandOf[r.payer];
          if (b) counts.set(b, (counts.get(b) || 0) + 1);
          if (!brandMembers || brandMembers.has(r.payer)) pl.add(r.plan);
        }
      }
    }
    return { availableBrands: counts, availablePlans: pl };
  }, [data, dicts, brandMembers]);

  /** Methodology index -> method group, computed once per dataset. */
  const groupByIndex = useMemo(() => methodGroupsByIndex(dicts?.methods), [dicts]);

  /** Payer indices whose segment is commercial, for the "commercial only" toggle. */
  const commercialPayers = useMemo(() => {
    const seg = dicts?.payerSegments;
    if (!seg?.payers) return null;
    return new Set(seg.payers.filter((p) => p.segment === 'commercial').map((p) => p.i));
  }, [dicts]);

  /** Hospitals joined to geography, filtered by the user's choices, priced. */
  const rows = useMemo(() => {
    if (!data || !hospitals) return [];
    const carrierOk = (r) => (!brandMembers || brandMembers.has(r.payer))
      && (planId == null || r.plan === planId)
      && (!commercialOnly || !commercialPayers || commercialPayers.has(r.payer));

    let out = data.hospitals.map((h) => {
      const info = hospitals[h.hIdx] || {};
      // Everything this hospital published that fits the chosen carrier AND the
      // chosen comparison context. Per-diem entries stay in this list — they
      // are real published rates — but are held out of the ranking below.
      const matching = h.rates.filter((r) => carrierOk(r) && rateMatches(r, ctx, groupByIndex));
      const ranked = contextMedian(h.rates.filter(carrierOk), ctx, groupByIndex, { forRanking: true });
      const formula = (h.formula || []).filter(carrierOk);
      const withheld = (h.withheld || []).filter(carrierOk);

      return {
        ...h,
        ccn: info.ccn, name: info.name, city: info.city, address: info.address,
        zip: info.zip, lat: info.lat, lon: info.lon, ownership: info.ownership,
        sources: info.sources || [], locationSrc: info.src,
        matching, formula, withheld,
        prices: ranked.prices,
        median: ranked.median,
        low: ranked.low,
        high: ranked.high,
        hasMatch: ranked.n > 0,
        // A hospital that published only formulas is a finding, not an absence.
        formulaOnly: ranked.n === 0 && formula.length > 0,
      };
    });

    // With a carrier chosen, a hospital that never named it has nothing to say
    // — unless what it published for that carrier is a formula, which is an
    // answer of its own and must not disappear.
    if (brandMembers) out = out.filter((r) => r.hasMatch || r.formulaOnly);

    const beforeRadius = out.filter((r) => r.median != null).length;
    out = withDistance(out, origin, radius || null);
    out.beforeRadius = beforeRadius;

    const price = (r) => r.median ?? r.low ?? Infinity;
    if (sort === 'price') out.sort((a, b) => price(a) - price(b));
    else if (sort === 'distance') out.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
    else if (sort === 'name') out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return out;
  }, [data, hospitals, brandMembers, planId, origin, radius, sort, ctx, groupByIndex,
      commercialOnly, commercialPayers]);

  const carriers = useMemo(() => {
    const list = [...availableBrands.entries()].map(([name, n]) => ({ name, n }));
    list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return list;
  }, [availableBrands]);

  const priced = rows.filter((r) => r.median != null);
  // How many the radius is hiding — shown as a one-click way to widen.
  const hiddenByRadius = Math.max(0, (rows.beforeRadius ?? priced.length) - priced.length);
  const cheapest = priced.length ? priced.reduce((a, b) => (a.median <= b.median ? a : b)) : null;
  const dearest = priced.length ? priced.reduce((a, b) => (a.median >= b.median ? a : b)) : null;
  const savings = cheapest && dearest ? dearest.median - cheapest.median : 0;

  const est = (cents) => estimate(cents, benefits);

  /* The list and the map must colour a hospital the same way, or the two stop
     reading as one view. Both use this band, over the current result set. */
  // The price range of everything currently on screen, shared by every row's
  // track so the bars are comparable to each other.
  const domainLow = priced.length ? Math.min(...priced.map((r) => r.low ?? r.median)) : null;
  const domainHigh = priced.length ? Math.max(...priced.map((r) => r.high ?? r.median)) : null;

  const priceBand = (price) => {
    if (price == null || !priced.length) return 2;
    const lo = Math.min(...priced.map((r) => r.median));
    const hi = Math.max(...priced.map((r) => r.median));
    if (hi === lo) return 2;
    return Math.min(4, Math.max(0, Math.floor(((price - lo) / (hi - lo)) * 5)));
  };
  // Any known cost-sharing input is enough to attempt an estimate — a $0
  // deductible with 30% coinsurance is a complete, known plan, not "nothing
  // entered". estimate() itself decides whether what is known is enough to
  // produce a number, or whether to report what is still missing.
  const usingBenefits = benefits.deductible != null || benefits.coinsurance != null
    || benefits.copay != null || (benefits.outOfPocketMax != null && benefits.outOfPocketMax > 0);

  /* What the entered benefits mean in money, shown in the corner card. Null
     until there is a price to estimate against and nothing is still unknown. */
  const cheapestEst = cheapest ? est(cheapest.median) : null;
  const dearestEst = dearest ? est(dearest.median) : null;
  const previewNumbers = usingBenefits && cheapestEst && dearestEst
    && !cheapestEst.missing.length && !dearestEst.missing.length
    ? {
        cheapest: cheapestEst.patient,
        dearest: dearestEst.patient,
        saving: dearestEst.patient - cheapestEst.patient,
      }
    : null;

  if (error?.kind === 'absent') {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-40 pb-28">
        <p className="t-label opacity-45">No prices published</p>
        <h1 className="t-display mt-4">Nothing for {type} {code}.</h1>
        <p className="t-body mt-5 opacity-70">
          No Virginia hospital published a usable price for this code in its machine-readable file.
          That is itself a finding, and it is counted on the data page.
        </p>
        <div className="mt-9"><SearchBox /></div>
        <Link to="/data" className="btn btn-ghost mt-8">See what is missing statewide</Link>
      </div>
    );
  }
  if (error?.kind === 'error') {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-40 pb-28">
        <h1 className="t-title">The price data could not be loaded.</h1>
        <p className="t-body mt-4 opacity-70">
          {error.stale
            ? 'This site was updated since this page loaded, and this tab is looking for a file that no longer exists at that address. Reloading gets the current version.'
            : 'This is a static file that did not download — not a finding about the procedure. Reloading usually fixes it.'}
        </p>
        <p className="t-small opacity-45 mt-2">Error id {error.id}</p>
        <button className="btn btn-ink mt-6" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  if (!data) return <Loading label="Loading published prices" />;

  return (
    <div className="pt-16">
      {/* ------------------------------------------------------------ header */}
      <header className={`border-b rule bg-paper ${switching ? 'relative z-40' : ''}`}>
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-8 sm:py-10">
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            <span className="t-mono text-[0.6875rem] px-2.5 py-1 rounded-full bg-paper-3 tnum">
              {type === 'MS-DRG' ? 'DRG' : type} {code}
            </span>
            <span className="t-small opacity-60 tnum">
              {origin && radius
                ? <>Showing <strong>{priced.length}</strong> {priced.length === 1 ? 'hospital' : 'hospitals'} within {radius} miles of {zip}</>
                : <><strong>{priced.length}</strong> Virginia {priced.length === 1 ? 'hospital publishes' : 'hospitals publish'} a price</>}
            </span>
            {origin && radius > 0 && hiddenByRadius > 0 && (
              <button onClick={() => setRadius(0)} className="t-small underline underline-offset-2 opacity-55 hover:opacity-100">
                {hiddenByRadius} more further away
              </button>
            )}

            {/* Sits with the metadata rather than beside the title, where it was
                competing with the one thing the page is about. */}
            <button
              onClick={() => setSwitching((v) => !v)}
              aria-expanded={switching}
              className="ml-auto inline-flex items-center gap-1.5 t-small font-medium opacity-55 hover:opacity-100 transition-opacity"
            >
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="9" r="6.25" /><path d="m13.6 13.6 4 4" strokeLinecap="round" />
              </svg>
              {switching ? 'Close' : 'Change procedure'}
            </button>
          </div>

          <h1 className="t-title max-w-[36ch]">{data.desc || `Code ${code}`}</h1>

          {/* Switching procedure here rather than sending people back to the
              home page — comparing two procedures is a normal thing to want,
              and a round trip loses the ZIP, radius and insurance already entered. */}
          {switching && (
            <div className="mt-5 max-w-2xl relative z-50" style={{ animation: 'searchIn .35s cubic-bezier(.16,1,.3,1) both' }}>
              <SearchBox autoFocus />
              <p className="t-small opacity-45 mt-2.5">
                Your ZIP, radius and insurance carry over.
              </p>
              <style>{`@keyframes searchIn { from { opacity:0; transform: translateY(-6px) } to { opacity:1; transform:none } }`}</style>
            </div>
          )}

          {cheapest && dearest && savings > 0 && (
            <p className="t-lede mt-5 max-w-[52ch] opacity-80">
              Within your search, the price runs from{' '}
              <strong className="font-semibold tnum">{fmtUSD(cheapest.median, { round: true })}</strong>{' '}
              at {cheapest.name?.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} to{' '}
              <strong className="font-semibold tnum">{fmtUSD(dearest.median, { round: true })}</strong>.
              That is <strong className="font-semibold tnum">{fmtUSD(savings, { round: true })}</strong> between
              the same procedure at two Virginia hospitals.
            </p>
          )}
        </div>
      </header>

      {/* ----------------------------------------------------------- controls */}
      <div className={`sticky top-16 bg-paper/92 backdrop-blur-xl border-b rule no-print ${switching ? 'z-20' : 'z-30'}`}>
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-3 flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="zip" className="t-label opacity-50">Your ZIP</label>
            <input
              id="zip" inputMode="numeric" maxLength={5} placeholder="23219"
              value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              className="w-[5.5rem] px-3 py-1.5 rounded-full border rule bg-white text-[0.8125rem] tnum
                         focus:outline-none focus:border-ink"
            />
          </div>

          {zip && (
            <button onClick={copyShareLink} className="chip" type="button">
              {linkCopied ? 'Link copied' : 'Copy link with my ZIP'}
            </button>
          )}

          <div className="flex items-center gap-1.5">
            {RADII.map((r) => (
              <button key={r} onClick={() => setRadius(r)} data-on={radius === r} className="chip"
                      disabled={!origin && r !== 0} title={!origin && r !== 0 ? 'Enter your ZIP first' : undefined}>
                {r === 0 ? 'All' : `${r} mi`}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-rule mx-1 hidden sm:block" />

          <label className="t-label opacity-50" htmlFor="sort">Sort</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}
                  className="px-3 py-1.5 rounded-full border rule bg-white text-[0.8125rem]">
            <option value="price">Lowest price</option>
            <option value="distance">Closest</option>
            <option value="name">Name</option>
          </select>

          <button onClick={() => setCtxOpen((v) => !v)} aria-expanded={ctxOpen} className="chip" data-on={ctxOpen}>
            What is being compared
          </button>

          <button onClick={() => setShowMap((v) => !v)} className="chip ml-auto lg:hidden" data-on={showMap}>
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        </div>

        {/* What counts as one comparable thing. A median over a case rate and a
            per-diem rate describes neither, so the choice is explicit and the
            defaults are the narrow, honest ones. */}
        {ctxOpen && ctx && (
          <div className="max-w-[92rem] mx-auto px-5 sm:px-8 pb-4 pt-1 border-t rule">
            <div className="grid sm:grid-cols-3 gap-5 pt-3">
              <div>
                <p className="t-label opacity-50 mb-2">Setting</p>
                <div className="flex flex-wrap gap-1.5">
                  {[['default', 'Outpatient'], ['inpatient', 'Inpatient'], ['any', 'Any']].map(([k, lbl]) => {
                    const on = k === 'any' ? ctx.settings == null
                      : k === 'inpatient' ? !!ctx.settings?.length && ctx.settings.every((i) => /inpatient/i.test(dicts.settings[i] || ''))
                      : !!ctx.settings?.length && ctx.settings.some((i) => /^outpatient$/i.test(dicts.settings[i] || ''));
                    return (
                      <button key={k} className="chip" data-on={on} onClick={() => setCtx((c) => ({
                        ...c,
                        settings: k === 'any' ? null
                          : k === 'inpatient'
                            ? dicts.settings.map((s, i) => [s, i]).filter(([s]) => /inpatient|both/i.test(s)).map(([, i]) => i)
                            : dicts.settings.map((s, i) => [s, i]).filter(([s]) => /^(outpatient|both)$/i.test(s)).map(([, i]) => i),
                      }))}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                <p className="t-small opacity-45 mt-1.5">
                  Outpatient includes files that publish “both”.
                </p>
              </div>

              <div>
                <p className="t-label opacity-50 mb-2">Billing class</p>
                {dicts.billingClasses?.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {dicts.billingClasses.map((b, i) => (
                      <button key={i} className="chip" data-on={ctx.billingClass === i}
                              onClick={() => setCtx((c) => ({ ...c, billingClass: c.billingClass === i ? null : i }))}>
                        {b || 'not stated'}
                      </button>
                    ))}
                    <button className="chip" data-on={ctx.billingClass == null}
                            onClick={() => setCtx((c) => ({ ...c, billingClass: null }))}>Any</button>
                  </div>
                ) : (
                  <p className="t-small opacity-45">
                    These files do not distinguish a billing class, so there is nothing to filter on.
                  </p>
                )}
              </div>

              <div>
                <p className="t-label opacity-50 mb-2">Rate method</p>
                <div className="flex flex-wrap gap-1.5">
                  {METHOD_GROUPS.map((g) => (
                    <button key={g.id} className="chip" data-on={ctx.methodGroups?.includes(g.id)}
                            onClick={() => setCtx((c) => ({
                              ...c,
                              methodGroups: c.methodGroups?.includes(g.id)
                                ? c.methodGroups.filter((x) => x !== g.id)
                                : [...(c.methodGroups || []), g.id],
                            }))}>
                      {g.label}{g.badge ? ` (${g.badge})` : ''}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 mt-2 t-small cursor-pointer">
                  <input type="checkbox" checked={!!ctx.includePerDiem}
                         onChange={(e) => setCtx((c) => ({ ...c, includePerDiem: e.target.checked }))} />
                  Include per-diem rates in the ranking
                </label>
                <p className="t-small opacity-45 mt-1">
                  A per-diem rate is a price per day. It is excluded from the cross-hospital
                  ranking by default because it cannot be ranked against a price per case.
                </p>
              </div>
            </div>

            {dicts.payerSegments && (
              <label className="flex items-center gap-2 mt-4 pt-3 border-t rule t-small cursor-pointer">
                <input type="checkbox" checked={commercialOnly} onChange={(e) => setCommercialOnly(e.target.checked)} />
                Commercial plans only
                <span className="opacity-45">
                  — keeps Medicare Advantage and Medicaid rates out of a commercial comparison.
                  Payer and plan names are always the hospital's own wording.
                </span>
              </label>
            )}
          </div>
        )}

        {zip && !origin && (
          <div className="max-w-[92rem] mx-auto px-5 sm:px-8 pb-3">
            <p className="t-small text-[#9A3412]">
              {isValidZip(zip) ? `We do not have coordinates for ZIP ${zip}.` : 'Enter a five-digit ZIP code.'}
              {' '}Showing every hospital instead.
            </p>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------- body */}
      <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-8 grid lg:grid-cols-[1fr_minmax(0,29rem)] gap-8">
        {/* list */}
        <div className="order-2 lg:order-1 min-w-0">
          <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
            <div className="inline-flex p-1 rounded-full bg-paper-2 border rule">
              {[['list', 'List'], ['chart', 'Price vs distance']].map(([k, label]) => (
                <button
                  key={k} onClick={() => setView(k)} aria-pressed={view === k}
                  disabled={k === 'chart' && !origin}
                  title={k === 'chart' && !origin ? 'Enter your ZIP to compare by distance' : undefined}
                  className={`px-4 h-9 rounded-full text-[0.8125rem] font-semibold transition-all duration-300
                    ${view === k ? 'bg-ink text-paper shadow-[0_1px_3px_rgb(20_18_15/0.25)]' : 'opacity-55 hover:opacity-100 disabled:opacity-25'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={openIns} className="btn btn-ghost !py-2 !px-4 !text-[0.8125rem]">
              {brand || usingBenefits ? 'Change insurance' : 'Add your insurance'}
            </button>
          </div>

          {view === 'chart' && rows.length > 0 && (
            <div className="mb-5">
              <PriceDistanceChart
                rows={priced}
                selected={selected}
                onSelect={(ccn) => { setSelected(ccn); setView('list'); }}
                estimateFn={usingBenefits ? est : null}
              />
            </div>
          )}

          {view === 'list' && rows.length === 0 ? (
            <div className="panel p-8 text-center">
              <p className="t-title !text-[1.25rem]">No hospitals match.</p>
              <p className="t-body mt-3 opacity-70 max-w-[44ch] mx-auto">
                {origin && radius
                  ? `No hospital within ${radius} miles of ${zip} published a price for this procedure${brand ? ` for ${brand}` : ''}.`
                  : 'Try widening the search or clearing the insurer filter.'}
              </p>
              <div className="flex gap-2 justify-center mt-6">
                <button className="btn btn-ink" onClick={() => setRadius(0)}>Search all of Virginia</button>
                {brand && <button className="btn btn-ghost" onClick={() => { setBrand(null); setPlanId(null); }}>Clear insurer</button>}
              </div>
            </div>
          ) : view === 'list' ? (
            <ul className="space-y-3">
              {rows.map((r, i) => (
                <HospitalRow
                  key={r.ccn || r.hIdx}
                  row={r}
                  rank={i + 1}
                  band={priceBand(r.median)}
                  domainLow={domainLow}
                  domainHigh={domainHigh}
                  dearest={dearest?.median ?? null}
                  cheapest={cheapest?.ccn === r.ccn}
                  selected={selected === r.ccn}
                  onSelect={() => setSelected(selected === r.ccn ? null : r.ccn)}
                  dicts={dicts}
                  ctx={ctx}
                  groupByIndex={groupByIndex}
                  estimateFn={usingBenefits ? est : null}
                  showDistance={!!origin}
                />
              ))}
            </ul>
          ) : null}

          <p className="t-small opacity-55 mt-7 max-w-[62ch]">
            Prices come from each hospital's own machine-readable file. They are estimates for
            planning, not a bill or a quote. A hospital stay usually involves several codes —
            the surgeon, the anaesthetist and the facility may bill separately. Confirm with the
            hospital and your insurer before you schedule anything.
          </p>
        </div>

        {/* insurance, as a guided flow rather than a wall of fields */}
        <InsuranceWizard
          open={insOpen} onClose={closeIns}
          carriers={carriers} plans={dicts.plans} availablePlans={availablePlans}
          brand={brand} planId={planId}
          onBrand={(v) => { setBrand(v); setPlanId(null); }} onPlan={setPlanId}
          benefits={benefits} onBenefits={setBenefits}
          cheapestMedian={cheapest?.median ?? null} dearestMedian={dearest?.median ?? null}
        />
        <InsuranceCue
          onOpen={openIns}
          brand={brand}
          hasBenefits={usingBenefits}
          preview={previewNumbers}
        />

        {/* map */}
        <div className={`order-1 lg:order-2 ${showMap ? '' : 'hidden lg:block'}`}>
          <div className="lg:sticky lg:top-[8.5rem]">
            <div ref={mapWrapRef} className="panel overflow-hidden h-[22rem] lg:h-[calc(100vh-11rem)]">
              {mapInView ? (
                <Suspense fallback={<div className="w-full h-full shimmer" />}>
                  <HospitalMap
                    items={rows.filter((r) => r.median != null)}
                    origin={origin} radiusMiles={radius || null}
                    selected={selected} onSelect={setSelected}
                    priceKey="median"
                  />
                </Suspense>
              ) : (
                <div className="w-full h-full shimmer" />
              )}
            </div>
            <p className="t-small opacity-50 mt-2.5">
              Pins show each hospital's median negotiated price. Colour runs from the cheapest
              in this search to the dearest. Straight-line distance; driving is roughly a quarter further.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
