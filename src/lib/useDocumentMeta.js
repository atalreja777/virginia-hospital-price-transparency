import { useEffect } from 'react';

const SITE = 'What Virginia Hospitals Charge';

/**
 * Per-route <title> and meta description, with no routing library involved.
 * Restores the previous values on unmount so a fast back-navigation never
 * leaves a stale title from a page that no longer exists.
 */
export default function useDocumentMeta(title, description) {
  useEffect(() => {
    const prevTitle = document.title;
    const el = document.querySelector('meta[name="description"]');
    const prevDesc = el?.getAttribute('content') ?? null;

    document.title = title ? `${title} — ${SITE}` : SITE;
    if (el && description) el.setAttribute('content', description);

    return () => {
      document.title = prevTitle;
      if (el && prevDesc != null) el.setAttribute('content', prevDesc);
    };
  }, [title, description]);
}
