// =============================================================================
// FireISP 5.0 — Portal Login
// =============================================================================

import { type FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePortalAuth } from '@/auth/PortalAuthContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function PortalLogin() {
  const { login } = usePortalAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/portal';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('portalLogin.failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.langBar}>
        <LanguageSwitcher variant="bar" />
      </div>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>🔥 FireISP</h1>
        <p style={styles.subtitle}>{t('portalLogin.subtitle')}</p>

        {error && <div style={styles.error}>{error}</div>}

        <label style={styles.label}>
          {t('common.email')}
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
          {t('common.password')}
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={styles.input}
          />
        </label>

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? t('common.signingIn') : t('common.signIn')}
        </button>

        <p style={styles.hint}>
          {t('portalLogin.hint')}
        </p>
      </form>
    </div>
  );
}

const styles = {
  container: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg-body)',
    fontFamily: 'var(--font-sans)',
  },
  langBar: {
    position: 'absolute' as const,
    top: 16,
    right: 16,
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
    color: 'var(--text-secondary)',
  },
  input: {
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--input-border)',
    borderRadius: 4,
    fontSize: '1rem',
  },
  button: {
    padding: '0.6rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: '1rem',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  hint: {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--text-dimmed)',
    textAlign: 'center' as const,
  },
};
