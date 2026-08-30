import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  loadCode, loadHospitals, loadPayers, loadPlans, loadSettings, loadMethods, loadZips,
  loadSearch, loadPayerGroups,
} from '../lib/data.js';
import { estimate, emptyBenefits, fmtUSD } from '../lib/estimate.js';
import { withDistance, zipToPoint, isValidZip, approxRoadMiles } from '../lib/geo.js';
import InsurancePanel from '../components/InsurancePanel.jsx';
import HospitalRow from '../components/HospitalRow.jsx';
import Loading from '../components/Loading.jsx';
import SearchBox from '../components/SearchBox.jsx';

const HospitalMap = lazy(() => import('../components/HospitalMap.jsx'));

const RADII = [10, 25, 50, 100, 0];
const radiusLabel = (r) => (r === 0 ? 'Anywhere in Virginia' : `${r} miles`);

export default function Procedure() {
  const { type, code } = useParams();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [hospitals, setHospitals] = useState(null);
  const [dicts, setDicts] = useState(null);
  const [zips, setZips] = useState(null);
  const [error, setError] = useState(null);

  const [zip, setZip] = useState(params.get('zip') || '');
  const [radius, setRadius] = useState(Number(params.get('r') ?? 50));
  const [brand, setBrand] = useState(null);          // carrier group, e.g. "Aetna"
  const [planId, setPlanId] = useState(null);
  const [benefits, setBenefits] = useState(emptyBenefits);
  const [insOpen, setInsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('price');
  const [showMap, setShowMap] = useState(true);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    Promise.all([
      loadCode(type, code), loadHospitals(), loadPayers(), loadPlans(),
      loadSettings(), loadMethods(), loadZips(), loadSearch(), loadPayerGroups(),
    ])
      .then(([d, h, payers, plans, settings, methods, z, idx, pg]) => {
        if (!alive) return;
        if (!d) { setError('notfound'); return; }
        setData(d); setHospitals(h); setZips(z);
        setDicts({ payers, plans, settings, methods, index: idx, payerGroups: pg });
      })
      .catch((e) => alive && setError(e.message || 'load'));
    return () => { alive = false; };
  }, [type, code]);

  // keep the URL shareable
  useEffect(() => {
    const next = new URLSearchParams(params);
    zip ? next.set('zip', zip) : next.delete('zip');
    next.set('r', String(radius));
    setParams(next, { replace: true });
  }, [zip, radius]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** Hospitals joined to geography, filtered by the user's choices, priced. */
  const rows = useMemo(() => {
    if (!data || !hospitals) return [];
    let out = data.hospitals.map((h) => {
      const info = hospitals[h.hIdx] || {};
      const matching = h.rates.filter(
        (r) => (!brandMembers || brandMembers.has(r.payer)) && (planId == null || r.plan === planId)
      );
      const prices = matching.map((r) => r.price).sort((a, b) => a - b);
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
      return {
        ...h,
        ccn: info.ccn, name: info.name, city: info.city, address: info.address,
        zip: info.zip, lat: info.lat, lon: info.lon, ownership: info.ownership,
        sources: info.sources || [],
        matching, prices, median,
        low: prices[0] ?? null,
        high: prices[prices.length - 1] ?? null,
        hasMatch: prices.length > 0,
      };
    });

    // With a carrier chosen, a hospital that never named it has nothing to say.
    if (brandMembers) out = out.filter((r) => r.hasMatch);

    out = withDistance(out, origin, radius || null);

    const price = (r) => r.median ?? r.low ?? Infinity;
    if (sort === 'price') out.sort((a, b) => price(a) - price(b));
    else if (sort === 'distance') out.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
    else if (sort === 'name') out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return out;
  }, [data, hospitals, brandMembers, planId, origin, radius, sort]);

  const priced = rows.filter((r) => r.median != null);
  const cheapest = priced.length ? priced.reduce((a, b) => (a.median <= b.median ? a : b)) : null;
  const dearest = priced.length ? priced.reduce((a, b) => (a.median >= b.median ? a : b)) : null;
  const savings = cheapest && dearest ? dearest.median - cheapest.median : 0;

  const est = (cents) => estimate(cents, benefits);

  /* The list and the map must colour a hospital the same way, or the two stop
     reading as one view. Both use this band, over the current result set. */
  const priceBand = (price) => {
    if (price == null || !priced.length) return 2;
    const lo = Math.min(...priced.map((r) => r.median));
    const hi = Math.max(...priced.map((r) => r.median));
    if (hi === lo) return 2;
    return Math.min(4, Math.max(0, Math.floor(((price - lo) / (hi - lo)) * 5)));
  };
  const usingBenefits = benefits.deductible > 0 || benefits.copay != null || benefits.outOfPocketMax > 0;

  if (error === 'notfound') {
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
  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-40 pb-28">
        <h1 className="t-title">The price data would not load.</h1>
        <p className="t-body mt-4 opacity-70">{error}</p>
        <button className="btn btn-ink mt-6" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }
  if (!data) return <Loading label="Loading published prices" />;

  return (
    <div className="pt-16">
      {/* ------------------------------------------------------------ header */}
      <header className="border-b rule bg-paper">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-8 sm:py-10">
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            <span className="t-mono text-[0.6875rem] px-2 py-1 rounded bg-paper-3 tnum">
              {type === 'MS-DRG' ? 'DRG' : type} {code}
            </span>
            <span className="t-small opacity-55 tnum">
              {priced.length} of {rows.length} hospitals published a price
            </span>
          </div>

          <h1 className="t-title max-w-[36ch]">{data.desc || `Code ${code}`}</h1>

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
      <div className="sticky top-16 z-30 bg-paper/92 backdrop-blur-xl border-b rule no-print">
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

          <button onClick={() => setShowMap((v) => !v)} className="chip ml-auto lg:hidden" data-on={showMap}>
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        </div>

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
          <div className="mb-5">
            <InsurancePanel
              payers={dicts.payers} plans={dicts.plans}
              availableBrands={availableBrands} availablePlans={availablePlans}
              brand={brand} planId={planId}
              onBrand={(v) => { setBrand(v); setPlanId(null); }}
              onPlan={setPlanId}
              benefits={benefits} onBenefits={setBenefits}
              open={insOpen} onToggle={() => setInsOpen((v) => !v)}
            />
          </div>

          {rows.length === 0 ? (
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
          ) : (
            <ul className="ledger border-y rule">
              {rows.map((r, i) => (
                <HospitalRow
                  key={r.ccn || r.hIdx}
                  row={r}
                  rank={i + 1}
                  band={priceBand(r.median)}
                  cheapest={cheapest?.ccn === r.ccn}
                  selected={selected === r.ccn}
                  onSelect={() => setSelected(selected === r.ccn ? null : r.ccn)}
                  dicts={dicts}
                  estimateFn={usingBenefits ? est : null}
                  showDistance={!!origin}
                />
              ))}
            </ul>
          )}

          <p className="t-small opacity-55 mt-7 max-w-[62ch]">
            Prices come from each hospital's own machine-readable file. They are estimates for
            planning, not a bill or a quote. A hospital stay usually involves several codes —
            the surgeon, the anaesthetist and the facility may bill separately. Confirm with the
            hospital and your insurer before you schedule anything.
          </p>
        </div>

        {/* map */}
        <div className={`order-1 lg:order-2 ${showMap ? '' : 'hidden lg:block'}`}>
          <div className="lg:sticky lg:top-[8.5rem]">
            <div className="panel overflow-hidden h-[22rem] lg:h-[calc(100vh-11rem)]">
              <Suspense fallback={<div className="w-full h-full shimmer" />}>
                <HospitalMap
                  items={rows.filter((r) => r.median != null)}
                  origin={origin} radiusMiles={radius || null}
                  selected={selected} onSelect={setSelected}
                  priceKey="median"
                />
              </Suspense>
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
