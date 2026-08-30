/**
 * A running ticker of figures. Editorial sites use these to keep a page alive
 * without asking for attention; here it carries the scale of the dataset.
 * The track is duplicated so the loop is seamless, and it pauses on hover so
 * anyone who wants to read a number can.
 */
export default function Marquee({ items, speed = 46, className = '' }) {
  const Track = ({ hidden }) => (
    <div className="marquee__track" style={{ '--speed': `${speed}s` }} aria-hidden={hidden || undefined}>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-3 shrink-0">
          <span className="t-num text-[1.25rem]">{it.value}</span>
          <span className="t-label opacity-45">{it.label}</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-25 ml-3" />
        </span>
      ))}
    </div>
  );
  return (
    <div className={`marquee ${className}`}>
      <Track />
      <Track hidden />
    </div>
  );
}
