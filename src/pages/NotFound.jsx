import { Link } from 'react-router-dom';
import SearchBox from '../components/SearchBox.jsx';

export default function NotFound() {
  return (
    <div className="max-w-2xl mx-auto px-6 pt-40 pb-28">
      <p className="t-label opacity-45">404</p>
      <h1 className="t-display mt-4">That page is not here.</h1>
      <p className="t-body mt-5 opacity-70">
        The link may be old, or the procedure code may have changed. Search for what you need instead.
      </p>
      <div className="mt-9"><SearchBox /></div>
      <Link to="/" className="btn btn-ghost mt-8">Back to the start</Link>
    </div>
  );
}
