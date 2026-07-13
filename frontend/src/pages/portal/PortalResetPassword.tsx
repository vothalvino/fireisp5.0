// =============================================================================
// FireISP 5.0 — Portal Reset Password Page
// =============================================================================
// Public (unauthenticated) page reached from the portal password-reset email
// link (?token=...). Submits a new password to
// POST /portal/auth/password-reset. Uses a raw fetch() — same pre-auth
// networking convention as PortalAuthContext.tsx's login() (portal auth
// never uses cookies, so this endpoint has no CSRF surface either).
// =============================================================================

import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function PortalResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalidToken, setInvalidToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInvalidToken(false);

    if (password !== confirmPassword) {
      setError(t('portalResetPassword.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/portal/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Invalid or expired token — a clear, actionable message rather
          // than the raw server error, plus a link back to request a new one.
          setInvalidToken(true);
          return;
        }
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Request failed');
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.langBar}>
        <LanguageSwitcher variant="bar" />
      </div>
      <div style={styles.card}>
        <h1 style={styles.title}>{t('portalResetPassword.title')}</h1>

        {!token ? (
          <>
            <p style={styles.subtitle}>{t('portalResetPassword.missingToken')}</p>
            <Link to="/portal/forgot-password" style={styles.link}>{t('portalResetPassword.requestNewLink')}</Link>
          </>
        ) : success ? (
          <>
            <p style={styles.subtitle}>{t('portalResetPassword.successMessage')}</p>
            <Link to="/portal/login" style={styles.link}>{t('portalResetPassword.goToLogin')}</Link>
          </>
        ) : invalidToken ? (
          <>
            <div style={styles.error}>{t('portalResetPassword.invalidOrExpired')}</div>
            <Link to="/portal/forgot-password" style={styles.link}>{t('portalResetPassword.requestNewLink')}</Link>
          </>
        ) : (
          <form style={styles.form} onSubmit={handleSubmit}>
            <p style={styles.subtitle}>{t('portalResetPassword.subtitle')}</p>

            {error && <div style={styles.error}>{error}</div>}

            <label style={styles.label}>
              {t('portalResetPassword.passwordLabel')}
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              {t('portalResetPassword.confirmPasswordLabel')}
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={styles.input}
              />
            </label>

            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? t('portalResetPassword.submitting') : t('portalResetPassword.submitButton')}
            </button>

            <Link to="/portal/login" style={styles.link}>{t('portalResetPassword.goToLogin')}</Link>
          </form>
        )}
      </div>
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
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
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
  link: {
    color: 'var(--accent)',
    fontSize: '0.85rem',
    textAlign: 'center' as const,
    textDecoration: 'none',
  },
};
