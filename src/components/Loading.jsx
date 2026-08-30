export default function Loading({ label = 'Loading' }) {
  return (
    <div className="min-h-[60vh] grid place-items-center px-6" role="status" aria-live="polite">
      <div className="w-full max-w-md">
        <div className="t-label opacity-60 mb-4">{label}</div>
        <div className="h-px w-full bg-rule relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/3 bg-ink animate-[slide_1.1s_ease-in-out_infinite]" />
        </div>
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}
