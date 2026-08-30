import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

const LINKS = [
  { to: '/insurance',   label: 'Insurance' },
  { to: '/data',        label: 'The numbers' },
  { to: '/methodology', label: 'Method' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const onDark = pathname === '/' || pathname === '/data';

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 no-print transition-[background-color,border-color,backdrop-filter] duration-500
        ${scrolled || open
          ? (onDark ? 'bg-ink/85 backdrop-blur-xl border-b border-hair' : 'bg-paper/85 backdrop-blur-xl border-b border-rule')
          : 'border-b border-transparent'}
        ${onDark ? 'text-paper' : 'text-ink'}`}
    >
      <div className="max-w-[92rem] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="Home">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
            <rect width="32" height="32" rx="7" className={onDark ? 'fill-paper' : 'fill-ink'} />
            <path d="M8 21.5 13 10l5 8 2-3.5 4 7" stroke="#FF4A1C" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold tracking-[-0.026em] text-[0.9375rem] leading-none whitespace-nowrap">
            What Virginia Hospitals Charge
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-0.5 shrink-0">
          {LINKS.map((l) => (
            <NavLink
              key={l.to} to={l.to}
              className={({ isActive }) =>
                `px-3 py-2 text-[0.8125rem] font-medium tracking-[-0.01em] whitespace-nowrap transition-opacity
                 ${isActive ? 'opacity-100' : 'opacity-55 hover:opacity-100'}`}
            >
              {l.label}
            </NavLink>
          ))}
          <Link to="/" className="btn btn-accent ml-3 !py-2 !px-4 !text-[0.8125rem]">Find a price</Link>
        </nav>

        <button
          className="lg:hidden p-2 -mr-2" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {open ? <><path d="M5 5l12 12" /><path d="M17 5L5 17" /></>
                  : <><path d="M3 7h16" /><path d="M3 15h16" /></>}
          </svg>
        </button>
      </div>

      {open && (
        <nav className={`lg:hidden border-t ${onDark ? 'border-hair' : 'border-rule'} px-5 py-3 flex flex-col`}>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className="py-3 text-[0.9375rem] font-medium">{l.label}</NavLink>
          ))}
          <Link to="/" className="btn btn-accent mt-2 justify-center">Find a price</Link>
        </nav>
      )}
    </header>
  );
}
