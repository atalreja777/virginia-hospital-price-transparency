import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// GitHub Pages serves 404.html for deep links; that page stashes the intended
// path in sessionStorage and bounces here. Restore it before the router mounts.
// sessionStorage can throw (SecurityError) when storage is disabled entirely —
// a locked-down browser setting, not an application bug — and the app must
// still render rather than going blank over a redirect nicety.
try {
  const redirect = sessionStorage.redirect;
  if (redirect) {
    delete sessionStorage.redirect;
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    if (redirect !== location.href) history.replaceState(null, '', redirect.replace(location.origin, '') || base + '/');
  }
} catch {
  // Storage disabled — proceed with whatever URL the browser already has.
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
