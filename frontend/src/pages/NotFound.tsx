// =============================================================================
// FireISP 5.0 — 404 Not Found
// =============================================================================

import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        gap: 12,
        color: '#444',
      }}
    >
      <h1 style={{ fontSize: '3rem', margin: 0 }}>404</h1>
      <p style={{ margin: 0 }}>Page not found.</p>
      <Link to="/" style={{ color: '#e25822' }}>
        ← Back to dashboard
      </Link>
    </div>
  );
}
