/**
 * Every published rate at one hospital, as a strip of ticks.
 *
 * A hospital rarely has one price — it has forty, one per plan. Showing the
 * spread as ticks makes the shape of that visible: tightly clustered means the
 * hospital charges everyone about the same, widely spread means what you pay
 * depends heavily on which insurer you carry.
 */
export default function RateSpark({ prices, colour = 'var(--color-p3)' }) {
  if (!prices?.length || prices.length < 3) return null;

  const lo = prices[0];
  const hi = prices[prices.length - 1];
  if (hi <= lo) return null;

  // Cap the ticks drawn; forty is plenty to read the shape, and some hospitals
  // publish hundreds.
  const step = Math.max(1, Math.floor(prices.length / 40));
  const sample = prices.filter((_, i) => i % step === 0);

  // Ticks landing on the same pixel column are stacked; drawing them darker
  // there turns the strip into a rough histogram rather than a flat comb.
  const weight = new Map();
  for (const p of sample) {
    const k = Math.round(((p - lo) / (hi - lo)) * 100);
    weight.set(k, (weight.get(k) || 0) + 1);
  }
  const busiest = Math.max(...weight.values(), 1);

  return (
    <div className="relative h-[30px] w-full" aria-hidden="true">
      <span className="absolute inset-x-0 bottom-0 h-px bg-paper-3" />
      {[...weight.entries()].map(([k, n]) => (
        <span
          key={k}
          className="absolute bottom-0 w-[2px] rounded-t-[1px]"
          style={{
            left: `${k}%`,
            height: `${34 + (n / busiest) * 66}%`,
            background: colour,
            opacity: 0.3 + (n / busiest) * 0.55,
          }}
        />
      ))}
    </div>
  );
}
