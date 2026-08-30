import { useId, useState } from 'react';

/**
 * A short plain-English answer to "what is this and where do I find it".
 *
 * People arrive at a price tool without knowing what coinsurance means, and a
 * form that assumes they do is a form they abandon. Presented as a quiet text
 * link rather than a tiny circled question mark: a 17px target is hard to hit
 * and reads as an afterthought.
 */
export default function Explain({ term, children, where, label = "What's this?" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="text-[0.8125rem] font-medium text-accent hover:underline underline-offset-2 decoration-1"
      >
        {open ? 'Hide' : label}
      </button>
      {open && (
        <div id={id} className="mt-3 p-4 rounded-[12px] bg-low-tint/60 border border-[color:var(--color-low)]/15 text-[0.875rem] leading-[1.6] max-w-[62ch]">
          <p className="font-semibold mb-1.5">{term}</p>
          <p className="opacity-80">{children}</p>
          {where && (
            <p className="opacity-75 mt-2.5">
              <span className="font-semibold">Where to find it: </span>{where}
            </p>
          )}
        </div>
      )}
    </>
  );
}
