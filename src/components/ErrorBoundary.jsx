import { Component } from 'react';
import { Link } from 'react-router-dom';

/**
 * A price tool that white-screens is worse than one that admits a problem.
 * Anything that throws below this point renders as a plain explanation with a
 * way back, and the original error stays in the console for debugging.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Render failed:', error, info); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-2xl mx-auto px-6 py-28">
        <p className="t-label opacity-60">Something broke</p>
        <h1 className="t-title mt-3">This page could not load.</h1>
        <p className="t-body mt-4 opacity-75">
          The price data is served as static files. A failure here usually means a file
          did not download. Reloading often fixes it.
        </p>
        <pre className="mt-6 p-4 bg-paper-2 rounded-[2px] text-xs overflow-x-auto t-mono">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="flex gap-3 mt-8">
          <button className="btn btn-ink" onClick={() => location.reload()}>Reload</button>
          <Link className="btn btn-ghost" to="/">Start over</Link>
        </div>
      </div>
    );
  }
}
