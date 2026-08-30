import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loadSearch, searchProcedures } from '../lib/data.js';
import { fmtUSD } from '../lib/estimate.js';

/** A few things people actually search for, offered before they type. */
const SUGGESTED = [
  { type: 'CPT', code: '45378', label: 'Colonoscopy' },
  { type: 'CPT', code: '70450', label: 'CT scan, head' },
  { type: 'CPT', code: '72148', label: 'MRI, lower back' },
  { type: 'CPT', code: '27447', label: 'Knee replacement' },
  { type: 'CPT', code: '59400', label: 'Childbirth, vaginal' },
  { type: 'CPT', code: '80053', label: 'Metabolic blood panel' },
  { type: 'CPT', code: '29881', label: 'Knee arthroscopy' },
  { type: 'CPT', code: '66984', label: 'Cataract surgery' },
];

const TYPE_LABEL = { CPT: 'CPT', HCPCS: 'HCPCS', 'MS-DRG': 'DRG' };

export default function SearchBox({ dark = false, autoFocus = false, size = 'lg' }) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  // Load the 1.8 MB index only once the user shows intent.
  const ensureIndex = () => {
    if (index || loading) return;
    setLoading(true);
    loadSearch().then(setIndex).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const results = useMemo(() => {
    if (!index || q.trim().length < 2) return [];
    return searchProcedures(index, q, 24);
  }, [index, q]);

  useEffect(() => setActive(0), [q]);

  // Carry the current ZIP and radius across, so switching procedure from the
  // results page keeps the search you already set up — and the new URL stays
  // shareable rather than silently relying on component state.
  const go = (row) => {
    if (!row) return;
    const keep = new URLSearchParams(loc.search);
    for (const k of [...keep.keys()]) if (!['zip', 'r'].includes(k)) keep.delete(k);
    const qs = keep.toString();
    nav(`/procedure/${encodeURIComponent(row.type)}/${encodeURIComponent(row.code)}${qs ? `?${qs}` : ''}`);
  };

  const onKey = (e) => {
    if (!open || !results.length) {
      if (e.key === 'ArrowDown') { setOpen(true); ensureIndex(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  const big = size === 'lg';

  return (
    <div ref={boxRef} className="relative w-full">
      <div className={`relative flex items-center rounded-[2px] transition-[border-color,box-shadow] duration-200
        ${dark ? 'bg-ink-2 border border-hair focus-within:border-accent' : 'bg-card border border-rule focus-within:border-ink'}
        ${big ? 'h-[4.5rem]' : 'h-14'} focus-within:shadow-[0_0_0_3px_rgb(255_74_28/0.22)]`}>
        <svg className={`absolute pointer-events-none opacity-40 ${big ? 'left-6' : 'left-4'}`}
             width={big ? 22 : 18} height={big ? 22 : 18} viewBox="0 0 20 20" fill="none"
             stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <circle cx="9" cy="9" r="6.25" /><path d="m13.6 13.6 4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); ensureIndex(); }}
          onFocus={() => { setOpen(true); ensureIndex(); }}
          onKeyDown={onKey}
          type="search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search for a procedure by name or billing code"
          placeholder="Try “MRI”, “colonoscopy”, or a code like 45378"
          className={`w-full h-full bg-transparent outline-none tracking-[-0.015em]
            ${big ? 'pl-16 pr-6 text-[1.25rem] tracking-[-0.022em]' : 'pl-11 pr-4 text-[0.9375rem]'}
            ${dark ? 'text-paper placeholder:text-paper/35' : 'placeholder:text-ink/35'}`}
        />
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className={`absolute z-40 mt-2 w-full rounded-[2px] overflow-hidden shadow-[0_18px_54px_rgb(0_0_0/0.18)]
            ${dark ? 'bg-ink-2 border border-hair' : 'bg-card border border-rule'}`}
        >
          {q.trim().length < 2 ? (
            <div className="p-4">
              <p className="t-label opacity-45 px-2 pb-3">Commonly searched</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED.map((s) => (
                  <button
                    key={s.code}
                    onMouseDown={(e) => { e.preventDefault(); go(s); }}
                    className={`px-3 py-1.5 rounded-full text-[0.8125rem] font-medium transition-colors
                      ${dark ? 'bg-ink-3 hover:bg-hair' : 'bg-paper-2 hover:bg-paper-3'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : !index ? (
            <div className="px-5 py-6 t-small opacity-55">Loading the procedure list…</div>
          ) : results.length === 0 ? (
            <div className="px-5 py-6">
              <p className="t-body">No procedure matches “{q}”.</p>
              <p className="t-small opacity-60 mt-2">
                Try a shorter word, or enter the CPT code from your doctor's order.
                Emergency and ambulance codes are not included, because you cannot shop for those.
              </p>
            </div>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto scroll-thin">
              {results.map((r, i) => (
                <li key={`${r.type}-${r.code}`}>
                  <button
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); go(r); }}
                    className={`w-full text-left px-4 sm:px-5 py-3 flex items-center gap-4 transition-colors
                      ${i === active ? (dark ? 'bg-ink-3' : 'bg-paper-2') : ''}`}
                  >
                    <span className={`t-mono text-[0.6875rem] px-1.5 py-1 rounded shrink-0 tnum
                      ${dark ? 'bg-hair' : 'bg-paper-3'}`}>
                      {TYPE_LABEL[r.type] || r.type} {r.code}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[0.9375rem] font-medium tracking-[-0.012em]">{r.desc || 'No description published'}</span>
                      <span className="block t-small opacity-55 tnum">
                        {r.hospitals} {r.hospitals === 1 ? 'hospital' : 'hospitals'}
                        {r.p50 != null && <> · typically {fmtUSD(r.p50, { round: true })}</>}
                      </span>
                    </span>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                         strokeWidth="1.8" className="opacity-30 shrink-0" aria-hidden="true">
                      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
