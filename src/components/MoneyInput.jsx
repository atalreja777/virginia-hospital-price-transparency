/** A dollar field that stores integer cents and never lets a stray character through. */
export default function MoneyInput({ value, onChange, id, placeholder = '0', max = 100_000_00 }) {
  const shown = value == null || value === 0 ? '' : (value / 100).toString();
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-45 pointer-events-none text-[0.9375rem]">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          if (raw === '') return onChange(0);
          const parts = raw.split('.');
          const clean = parts.length > 2 ? `${parts[0]}.${parts[1]}` : raw;
          const n = Math.round(parseFloat(clean) * 100);
          onChange(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0);
        }}
        className="field pl-7 tnum"
      />
    </div>
  );
}
