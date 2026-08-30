import { useEffect, useRef, useState } from 'react';

/**
 * Reveals its children once, as they scroll into view.
 *
 * Motion is an enhancement here, never a precondition for reading. Three rules
 * make that true:
 *
 *   1. Anything already on screen at mount appears immediately. No delay on
 *      first paint, and no animation the reader has to wait out.
 *   2. A failsafe timer shows the content even if IntersectionObserver never
 *      fires — which happens in embedded webviews, some headless renderers and
 *      older browsers. Content that depends on an observer to be visible is
 *      content that can vanish.
 *   3. Reduced motion, or no observer support, means shown straight away.
 *
 * The failure mode is always "visible without animation", never "invisible".
 */
const FAILSAFE_MS = 900;

export default function Reveal({ children, delay = 0, as: Tag = 'div', className = '', mask = false, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) { setShown(true); return; }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    // Already on screen: show it now rather than animating something the
    // reader is already looking at.
    const r = el.getBoundingClientRect();
    if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
      setShown(true);
      return;
    }

    let done = false;
    const finish = () => { if (!done) { done = true; setShown(true); } };

    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { finish(); io.disconnect(); } },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
    );
    io.observe(el);

    // If the observer never reports — some environments simply do not — show anyway.
    const t = setTimeout(finish, FAILSAFE_MS);

    return () => { clearTimeout(t); io.disconnect(); };
  }, []);

  return (
    <Tag
      ref={ref}
      data-shown={shown}
      style={{ '--d': `${delay}ms` }}
      className={`${mask ? 'line-mask' : 'reveal'} ${className}`}
      {...rest}
    >
      {mask ? <span>{children}</span> : children}
    </Tag>
  );
}
