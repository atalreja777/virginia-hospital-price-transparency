import { useId, useState } from 'react';

/**
 * A short plain-English answer to "what is this and where do I find it".
 *
 * People arrive at a price tool without knowing what coinsurance means, and a
 * form that assumes they do is a form they abandon. Each explainer says what
 * the term means, then exactly where to look it up.
 */
export default function Explain({ term, children, where }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full border border-rule
                   text-[10px] font-semibold opacity-55 hover:opacity-100 hover:border-ink transition align-middle ml-1.5"
      >
        {open ? '−' : '?'}
        <span className="sr-only">What is {term}?</span>
      </button>
      {open && (
        <div id={id} className="mt-2.5 p-3.5 rounded-[2px] bg-paper-2 border rule text-[0.8125rem] leading-[1.55]">
          <p className="font-medium mb-1.5">{term}</p>
          <p className="opacity-80">{children}</p>
          {where && <p className="opacity-70 mt-2.5"><span className="font-medium">Where to find it: </span>{where}</p>}
        </div>
      )}
    </>
  );
}
