// =============================================================================
// FireISP 5.0 — Login Page
// =============================================================================

import { type FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password, needsTotp ? totpCode : undefined);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the server says TOTP is required, show the TOTP field.
      if (msg.toLowerCase().includes('totp') || msg.toLowerCase().includes('two-factor')) {
        setNeedsTotp(true);
        setError('Enter your two-factor authentication code.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>🔥 FireISP 5.0</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        {error && <div style={styles.error}>{error}</div>}

        <label style={styles.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={styles.input}
          />
        </label>

        {needsTotp && (
          <label style={styles.label}>
            Two-Factor Code
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value)}
              required
              autoComplete="one-time-code"
              style={styles.input}
              placeholder="6-digit code"
            />
          </label>
        )}

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#f0f2f5',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: '#fff',
    padding: '2rem',
    borderRadius: 8,
    boxShadow: '0 2px 16px rgba(0,0,0,.1)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    width: '100%',
    maxWidth: 380,
  },
  title: { margin: 0, fontSize: '1.5rem', color: '#e25822' },
  subtitle: { margin: 0, color: '#666', fontSize: '0.9rem' },
  error: {
    background: '#fff0f0',
    border: '1px solid #fca5a5',
    color: '#b91c1c',
    padding: '0.6rem 0.8rem',
    borderRadius: 4,
    fontSize: '0.85rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    fontSize: '0.9rem',
    color: '#333',
  },
  input: {
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: '1rem',
  },
  button: {
    padding: '0.6rem',
    background: '#e25822',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: '1rem',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
} as const;
