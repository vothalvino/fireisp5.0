// =============================================================================
// FireISP 5.0 — Login Page
// =============================================================================

import { type FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
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
        setError(t('login.totpPrompt'));
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
        <h1 style={styles.title}>{t('login.title')}</h1>
        <p style={styles.subtitle}>{t('login.subtitle')}</p>

        {error && <div style={styles.error}>{error}</div>}

        <label style={styles.label}>
          {t('login.emailLabel')}
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
          {t('login.passwordLabel')}
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
            {t('login.totpLabel')}
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value)}
              required
              autoComplete="one-time-code"
              style={styles.input}
              placeholder={t('login.totpPlaceholder')}
            />
          </label>
        )}

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? t('common.signingIn') : t('common.signIn')}
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
    background: 'var(--bg-body)',
    fontFamily: 'var(--font-sans)',
  },
  card: {
    background: 'var(--bg-card)',
    padding: '2rem',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    width: '100%',
    maxWidth: 380,
  },
  title: { margin: 0, fontSize: '1.5rem', color: 'var(--accent)' },
  subtitle: { margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' },
  error: {
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger-border)',
    color: 'var(--danger)',
    padding: '0.6rem 0.8rem',
    borderRadius: 4,
    fontSize: '0.85rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
  },
  input: {
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--input-border)',
    borderRadius: 4,
    fontSize: '1rem',
    color: 'var(--text-primary)',
    background: 'var(--input-bg)',
  },
  button: {
    padding: '0.6rem',
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    border: 'none',
    borderRadius: 4,
    fontSize: '1rem',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
};
