import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import Loading from './components/Loading.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ResearchPreviewBanner from './components/ResearchPreviewBanner.jsx';

const Landing     = lazy(() => import('./pages/Landing.jsx'));
const Procedure   = lazy(() => import('./pages/Procedure.jsx'));
const Hospital    = lazy(() => import('./pages/Hospital.jsx'));
const Insurance   = lazy(() => import('./pages/Insurance.jsx'));
const Statistics  = lazy(() => import('./pages/Statistics.jsx'));
const Methodology = lazy(() => import('./pages/Methodology.jsx'));
const NotFound    = lazy(() => import('./pages/NotFound.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) window.scrollTo(0, 0);
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-ink focus:text-paper focus:rounded-full">
        Skip to content
      </a>
      <ScrollToTop />
      <ResearchPreviewBanner />
      <Nav />
      <main id="main">
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/procedure/:type/:code" element={<Procedure />} />
              <Route path="/hospital/:ccn" element={<Hospital />} />
              <Route path="/insurance" element={<Insurance />} />
              <Route path="/data" element={<Statistics />} />
              <Route path="/methodology" element={<Methodology />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </>
  );
}
