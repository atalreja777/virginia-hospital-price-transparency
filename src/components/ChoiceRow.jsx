import { useState } from 'react';
import MoneyInput from './MoneyInput.jsx';

/**
 * A row of preset choices with an escape hatch for anything else.
 *
 * Asking someone to type six dollar amounts is asking them to go and find six
 * dollar amounts. Almost every US plan lands on one of a handful of round
 * numbers, so offering those as one tap gets most people to an answer without
 * leaving the page — and the "Other" field is there when they do not fit.
 */
export default function ChoiceRow({ value, onChange, options, allowOther = true, suffix, id, unknownLabel = "I don't know" }) {
  const known = options.some((o) => o.value === value);
  const isUnknown = value == null;
  const [other, setOther] = useState(!known && !isUnknown);

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
        {options.map((o) => {
          const on = !other && !isUnknown && value === o.value;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => { setOther(false); onChange(o.value); }}
              aria-pressed={on}
              className={`px-4 h-11 rounded-[10px] text-[0.9375rem] font-semibold tabular-nums transition-all duration-200
                ${on
                  ? 'bg-ink text-paper shadow-[0_1px_2px_rgb(20_18_15/0.2)]'
                  : 'bg-card border rule hover:border-ink/40 hover:bg-paper-2'}`}
            >
              {o.label}
            </button>
          );
        })}
        {allowOther && (
          <button
            type="button"
            onClick={() => setOther(true)}
            aria-pressed={other}
            className={`px-4 h-11 rounded-[10px] text-[0.9375rem] font-semibold transition-all duration-200
              ${other ? 'bg-ink text-paper' : 'bg-card border rule hover:border-ink/40 hover:bg-paper-2'}`}
          >
            Other
          </button>
        )}
        {unknownLabel !== false && (
          <button
            type="button"
            onClick={() => { setOther(false); onChange(null); }}
            aria-pressed={isUnknown && !other}
            className={`px-4 h-11 rounded-[10px] text-[0.9375rem] font-medium transition-all duration-200
              ${isUnknown && !other ? 'bg-ink text-paper' : 'bg-transparent border border-dashed rule opacity-70 hover:opacity-100 hover:border-ink/40'}`}
          >
            {unknownLabel}
          </button>
        )}
      </div>

      {other && (
        <div className="mt-2.5 max-w-[12rem]">
          {suffix === '%' ? (
            <div className="relative">
              <input
                type="number" min="0" max="100" autoFocus
                className="field h-11 pr-9 tabular-nums text-[0.9375rem]"
                value={Math.round((value ?? 0) * 100)}
                onChange={(e) => onChange(Math.min(100, Math.max(0, +e.target.value || 0)) / 100)}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 opacity-45">%</span>
            </div>
          ) : (
            <MoneyInput id={id} value={value} onChange={onChange} placeholder="0" />
          )}
        </div>
      )}
    </div>
  );
}
