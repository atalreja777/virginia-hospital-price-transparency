import { useEffect, useState } from 'react';
import { sanitizeMoneyText, parseMoneyToCents, centsToEditText } from '../lib/money.js';

/**
 * A dollar field that stores integer cents.
 *
 * While the field has focus it holds its own editing string, so a keystroke
 * is never rewritten out from under the person typing it — "123.45" reads
 * back as "123.45", not "$12,345". The value only commits (and reformats) to
 * cents on blur, Enter, or when the value changes from outside while unfocused.
 */
export default function MoneyInput({
  value, onChange, id, placeholder = '0', max = 100_000_00, label, 'aria-label': ariaLabel,
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => centsToEditText(value));

  // Only follow external value changes while the field is not being edited,
  // so a re-render from a parent's state update never clobbers a keystroke.
  useEffect(() => {
    if (!focused) setText(centsToEditText(value));
  }, [value, focused]);

  const commit = () => {
    const cents = parseMoneyToCents(text);
    const clamped = cents == null ? null : Math.min(max, Math.max(0, cents));
    onChange(clamped);
    setText(centsToEditText(clamped));
  };

  const shown = focused ? text : centsToEditText(value);

  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-45 pointer-events-none text-[0.9375rem]">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        aria-label={ariaLabel || label}
        onFocus={() => { setFocused(true); setText(centsToEditText(value)); }}
        onChange={(e) => setText(sanitizeMoneyText(e.target.value))}
        onBlur={() => { commit(); setFocused(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        className="field pl-7 tnum"
      />
    </div>
  );
}
