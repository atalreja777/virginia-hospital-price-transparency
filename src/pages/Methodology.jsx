import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal.jsx';
import { loadMeta } from '../lib/data.js';

export default function Methodology() {
  const [meta, setMeta] = useState(null);
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);

  return (
    <>
      <header className="on-dark pt-36 pb-20">
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8">
          <Reveal as="p" className="t-label text-accent">Method</Reveal>
          <Reveal as="h1" className="t-display mt-5 max-w-[20ch]" delay={60}>How this was built, and what it cannot tell you.</Reveal>
          <Reveal as="p" className="t-lede mt-7 max-w-[54ch] opacity-80" delay={120}>
            A price tool is only worth as much as its provenance. Every number here traces to one
            hospital's own file, and the limits below are as important as the prices.
          </Reveal>
        </div>
      </header>

      <section className="bg-paper py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 space-y-14">
          {[
            {
              h: 'Where the data comes from',
              p: [
                'Since 2021, federal rule 45 CFR Part 180 has required every US hospital to publish a machine-readable file listing its gross charges, its discounted cash price, and the rate it has negotiated with each insurance plan.',
                'An automated pipeline finds those files for Virginia hospitals, downloads them, and records the source URL, the file size, a SHA-256 hash of the exact bytes, the schema version, and the date the hospital says the file was last updated. Nothing is ever hand-entered.',
              ],
            },
            {
              h: 'What is included',
              p: [
                'Planned, schedulable care: CPT procedure codes, HCPCS codes, and MS-DRG inpatient stays.',
                'Emergency department visit codes and ambulance codes are deliberately excluded. Nobody price-shops an emergency, and including those codes would suggest they could.',
                'Device and supply pass-through codes are searchable but never used in any comparison on the statistics page. They are billed per unit, so a gap between two hospitals usually reflects a unit of measure rather than a price.',
              ],
            },
            {
              h: 'How bad data is handled',
              p: [
                'Hospital files contain errors. Prices of exactly $0.01, exactly zero, strings of nines used as placeholders, and values far outside a file\'s own stated minimum and maximum are flagged during loading and withheld from the site rather than shown as real.',
                'Nothing is silently deleted. Every withheld value keeps its label in the database, so the decision can be revisited without re-downloading anything.',
                'Where a hospital publishes only a percentage rather than a dollar amount, a dollar figure is derived only when the same row carries a gross charge, and it is stored separately so it is never mixed with reported dollars.',
              ],
            },
            {
              h: 'How prices are compared',
              p: [
                'A hospital usually publishes many rates for one code, one per plan. Its median is used as that hospital\'s representative price.',
                'Ranges on the landing and statistics pages run from the 10th to the 90th percentile hospital, not from the single cheapest to the single dearest. One mistyped row should never become a headline.',
                'A procedure is only compared when at least eight Virginia hospitals published a price for it.',
              ],
            },
            {
              h: 'How distance works',
              p: [
                'Hospital coordinates are resolved from their registered street address using the US Census geocoder, falling back to OpenStreetMap and then to a ZIP centroid. 124 of 125 Virginia hospitals resolved; the one that did not is a military facility.',
                'Distances are straight-line. Real driving distance is roughly a quarter further, and the site says so rather than pretending to know your route.',
              ],
            },
            {
              h: 'What this cannot tell you',
              p: [
                'This is not a bill, a quote, or a guarantee of coverage. It is an estimate for planning.',
                'One procedure is rarely one charge. A surgery may generate separate bills from the facility, the surgeon, the anaesthetist and the pathologist. This site shows the codes hospitals published, not the whole episode.',
                'Being cheap is not being good. Always check quality and safety ratings, and confirm the hospital is in your network, before deciding.',
                'Files go stale. Each hospital page shows when its file was last published and when it was fetched.',
                'Insurance estimates depend entirely on the numbers you enter. If your deductible is wrong, the estimate is wrong.',
              ],
            },
            {
              h: 'Privacy',
              p: [
                'There is no account, no server, and no database call. Every price is a static file your browser downloads, and all filtering and arithmetic happens on your device.',
                'Your ZIP code, your insurer, your deductible and everything else you type stays in your browser. None of it is sent anywhere or stored.',
              ],
            },
          ].map((s, i) => (
            <Reveal key={s.h} delay={i * 50}>
              <h2 className="t-title">{s.h}</h2>
              {s.p.map((t, j) => <p key={j} className="t-body mt-4 opacity-80">{t}</p>)}
            </Reveal>
          ))}

          {meta && (
            <Reveal className="panel p-6">
              <p className="t-label opacity-45 mb-4">This build</p>
              <dl className="space-y-2.5 t-small">
                {[
                  ['Assembled', new Date(meta.builtAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })],
                  ['Hospitals', meta.counts.hospitals],
                  ['Procedures', meta.counts.codes.toLocaleString()],
                  ['Prices', meta.counts.rates.toLocaleString()],
                  ['Payer names', meta.counts.payers],
                  ['Data files', meta.counts.shards.toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b rule pb-2">
                    <dt className="opacity-60">{k}</dt><dd className="t-mono tnum">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="t-small opacity-60 mt-5">{meta.scope}</p>
            </Reveal>
          )}

          <Reveal className="flex flex-wrap gap-2.5">
            <Link to="/data" className="btn btn-ink">See the figures</Link>
            <Link to="/" className="btn btn-ghost">Look up a price</Link>
            <a href="https://www.cms.gov/hospital-price-transparency" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">The federal rule</a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
