// =============================================================================
// FireISP 5.0 — Portal Forgot Password Page
// =============================================================================
// Public (unauthenticated) page: collects an email and requests a portal
// password reset link. Uses a raw fetch() to
// /portal/auth/password-reset/request — the same pre-auth networking
// convention as PortalAuthContext.tsx's login() (no Bearer token, no CSRF
// header — portal auth never uses cookies, see src/middleware/csrf.js).
//
// The backend always returns the same generic message regardless of whether
// the email is registered, has portal access enabled, or is active
// (anti-enumeration) — this page must NOT try to infer or display anything
// more specific than that.
// =============================================================================

import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function PortalForgotPassword() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/portal/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Request failed');
      }

      // Always show the generic success message — the server response carries
      // no signal about whether the account exists or has portal access
      // enabled (anti-enumeration).
      setSubmitted(true);
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
        <h1 style={styles.title}>{t('portalForgotPassword.title')}</h1>

        {submitted ? (
          <>
            <p style={styles.subtitle}>{t('portalForgotPassword.successMessage')}</p>
            <Link to="/portal/login" style={styles.link}>{t('portalForgotPassword.backToLogin')}</Link>
          </>
        ) : (
          <form style={styles.form} onSubmit={handleSubmit}>
            <p style={styles.subtitle}>{t('portalForgotPassword.subtitle')}</p>

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

            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? t('portalForgotPassword.submitting') : t('portalForgotPassword.submitButton')}
            </button>

            <Link to="/portal/login" style={styles.link}>{t('portalForgotPassword.backToLogin')}</Link>
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
