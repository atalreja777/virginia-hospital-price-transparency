import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Carrier selection.
 *
 * A native <select> holding 89 entries is the worst control for this job: it
 * cannot be searched, shows one row at a time, and renders differently on every
 * platform. This shows the carriers that actually appear for this procedure,
 * commonest first, with how many published rates each one has — which is the
 * information that tells you whether picking it will help.
 */
export default function CarrierPicker({ options, value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const f = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options;
  }, [options, q]);

  // The handful people are most likely to want, offered without any typing.
  const quick = options.slice(0, 4);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full h-14 px-4 rounded-[12px] border bg-card flex items-center justify-between gap-3 text-left
                    transition-colors ${open ? 'border-ink' : 'rule hover:border-ink/40'}`}
      >
        <span className={`text-[1rem] truncate ${value ? 'font-semibold' : 'opacity-45'}`}>
          {value || 'All insurers — showing every published price'}
        </span>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8"
             className={`shrink-0 opacity-45 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="M4.5 7 9 11.5 13.5 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!open && !value && quick.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {quick.map((o) => (
            <button
              key={o.name} type="button" onClick={() => onChange(o.name)}
              className="px-3.5 h-9 rounded-full bg-card border rule text-[0.8125rem] font-semibold
                         hover:border-ink/40 hover:bg-paper-2 transition-colors"
            >
              {o.name}
              <span className="opacity-40 ml-1.5 tabular-nums">{o.n}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-40 mt-2 w-full rounded-[14px] bg-card border rule overflow-hidden
                        shadow-[0_18px_50px_-12px_rgb(20_18_15/0.22)]">
          <div className="p-2.5 border-b rule">
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search insurers"
              className="w-full h-10 px-3 rounded-[9px] bg-paper-2 outline-none text-[0.9375rem]
                         placeholder:opacity-45 focus:bg-card focus:ring-2 focus:ring-accent/25"
            />
          </div>
          <ul className="max-h-[19rem] overflow-y-auto scroll-thin py-1">
            <li>
              <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-paper-2 text-[0.9375rem]">
                All insurers
                <span className="block t-small opacity-45">Show every published price</span>
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.name}>
                <button
                  type="button"
                  onClick={() => { onChange(o.name); setOpen(false); setQ(''); }}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-paper-2
                              ${value === o.name ? 'bg-paper-2' : ''}`}
                >
                  <span className="text-[0.9375rem] truncate">{o.name}</span>
                  <span className="t-small opacity-40 tabular-nums shrink-0">{o.n} rates</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-6 t-small opacity-55">
                No insurer here matches “{q}”. Hospitals write these names themselves, so try a
                shorter word — “Blue”, “United”, “Medicare”.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
