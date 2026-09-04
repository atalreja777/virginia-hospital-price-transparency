import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { loadMeta } from '../lib/data.js';

export default function Footer() {
  const [meta, setMeta] = useState(null);
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);

  return (
    <footer className="on-dark mt-px">
      <div className="max-w-[92rem] mx-auto px-5 sm:px-8 py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="t-label opacity-50">What this is</p>
            <p className="t-body mt-4 max-w-md opacity-80">
              Most hospitals covered by 45 CFR Part 180 must publish what they charge and what
              they have agreed to accept from each insurance plan; federal and certain other
              facilities are excepted. Almost nobody reads those files. This site reads them for
              Virginia and puts the numbers side by side.
            </p>
            <p className="t-small mt-5 opacity-55">
              Prices are estimates for planning. They are not a bill, a quote, or a guarantee of
              coverage. Confirm with the hospital and your insurer before you schedule care.
            </p>
          </div>

          <nav className="flex flex-col gap-3 text-[0.9375rem]">
            <p className="t-label opacity-50 mb-1">Pages</p>
            <Link className="link-draw w-fit opacity-85 hover:opacity-100" to="/">Find a price</Link>
            <Link className="link-draw w-fit opacity-85 hover:opacity-100" to="/insurance">Insurance terms</Link>
            <Link className="link-draw w-fit opacity-85 hover:opacity-100" to="/data">The numbers</Link>
            <Link className="link-draw w-fit opacity-85 hover:opacity-100" to="/methodology">Where this comes from</Link>
          </nav>

          <div className="text-[0.9375rem]">
            <p className="t-label opacity-50 mb-4">If you need help</p>
            <ul className="flex flex-col gap-3 opacity-85">
              <li><a className="link-draw" href="https://www.healthcare.gov/glossary/" target="_blank" rel="noopener noreferrer">Healthcare.gov glossary</a></li>
              <li><a className="link-draw" href="https://scc.virginia.gov/pages/Consumer-Services" target="_blank" rel="noopener noreferrer">Virginia Bureau of Insurance</a></li>
              <li><a className="link-draw" href="https://www.cms.gov/hospital-price-transparency" target="_blank" rel="noopener noreferrer">CMS price transparency</a></li>
              <li><a className="link-draw" href="https://www.medicare.gov/care-compare/" target="_blank" rel="noopener noreferrer">Medicare Care Compare</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-hair flex flex-col sm:flex-row gap-4 sm:items-end justify-between">
          <p className="t-small opacity-55 max-w-xl">
            Built from hospital machine-readable files published under 45 CFR Part 180.
            {meta && <> Data assembled {new Date(meta.builtAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</>}
          </p>
          {meta && (
            <p className="t-mono text-[0.6875rem] opacity-45 tnum">
              {meta.counts.rates.toLocaleString()} prices · {meta.counts.codes.toLocaleString()} procedures · {meta.counts.hospitals} hospitals
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
