import { Link } from "react-router-dom";

function NotFound() {
  return (
    <div className="page-container not-found-page">
      <div className="empty-state-card center not-found-card">
        <p className="eyebrow">Route Missing</p>
        <h2>404 - Page Not Found</h2>
        <p>The page you requested does not exist in the current workspace map.</p>
        <Link to="/" className="btn btn-primary">
          Return To Dashboard
        </Link>
      </div>
    </div>
  );
}

export default NotFound;

