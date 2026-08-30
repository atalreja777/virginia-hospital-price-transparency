import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

const LINKS = [
  { to: '/',            label: 'Find a price',   note: 'Search any procedure' },
  { to: '/insurance',   label: 'Insurance terms', note: 'Deductible, coinsurance, copay, explained' },
  { to: '/data',        label: 'The numbers',     note: 'What the published files show about Virginia' },
  { to: '/methodology', label: 'Method',          note: 'Where the data comes from, and its limits' },
];

/**
 * Wordmark and a menu. Nothing else.
 *
 * A row of links plus a call-to-action pill was competing with the one thing
 * every page is actually for — the search — and looked like chrome bolted on
 * top. The pages are all one click away here and listed again in the footer.
 */
export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const onDark = pathname === '/'
              || ['/data', '/insurance', '/methodology'].includes(pathname)
              || pathname.startsWith('/hospital/');

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-50 no-print transition-[background-color,border-color] duration-500
          ${scrolled && !open
            ? (onDark ? 'bg-ink/85 backdrop-blur-xl border-b border-hair' : 'bg-paper/85 backdrop-blur-xl border-b border-rule')
            : 'border-b border-transparent'}
          ${onDark || open ? 'text-paper' : 'text-ink'}`}
      >
        <div className="max-w-[92rem] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="Home">
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
              <rect width="32" height="32" rx="8" className={onDark || open ? 'fill-paper' : 'fill-ink'} />
              <path d="M8 21.5 13 10l5 8 2-3.5 4 7" stroke="#2ED3B7" strokeWidth="2.4" fill="none"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-semibold tracking-[-0.026em] text-[0.9375rem] leading-none whitespace-nowrap">
              What Virginia Hospitals Charge
            </span>
          </Link>

          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex items-center gap-2.5 text-[0.8125rem] font-semibold tracking-[-0.01em] py-2 -mr-1"
          >
            {open ? 'Close' : 'Menu'}
            <span className="grid gap-[5px]" aria-hidden="true">
              <span className={`block h-px w-[18px] bg-current transition-transform duration-300 ${open ? 'translate-y-[3px] rotate-45' : ''}`} />
              <span className={`block h-px w-[18px] bg-current transition-transform duration-300 ${open ? '-translate-y-[3px] -rotate-45' : ''}`} />
            </span>
          </button>
        </div>
      </header>

      {/* full-height panel, so the links get room to say what they are */}
      {open && (
        <div className="fixed inset-0 z-40 on-dark" style={{ animation: 'menuIn .4s cubic-bezier(.16,1,.3,1) both' }}>
          <nav className="h-full max-w-[92rem] mx-auto px-5 sm:px-8 pt-28 pb-10 flex flex-col justify-center">
            {LINKS.map((l, i) => (
              <NavLink
                key={l.to} to={l.to} end={l.to === '/'}
                className={({ isActive }) =>
                  `group border-t border-hair last:border-b py-6 sm:py-7 flex items-baseline justify-between gap-6
                   transition-opacity ${isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                style={{ animation: `menuRow .5s cubic-bezier(.16,1,.3,1) ${80 + i * 70}ms both` }}
              >
                <span className="t-display !text-[clamp(1.75rem,4.5vw,3rem)]">{l.label}</span>
                <span className="t-small opacity-45 text-right max-w-[26ch] hidden sm:block">{l.note}</span>
              </NavLink>
            ))}
          </nav>
          <style>{`
            @keyframes menuIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes menuRow { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
          `}</style>
        </div>
      )}
    </>
  );
}
