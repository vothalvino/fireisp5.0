// =============================================================================
// FireISP 5.0 — Verify Email Page
// =============================================================================
// Public (unauthenticated) page reached from the verification email link
// (?token=...). Auto-calls POST /auth/verify-email on mount. Uses a raw
// fetch() — same pre-auth networking convention as AuthContext.tsx's
// login()/register() (the endpoint is CSRF-exempt, see
// src/middleware/csrf.js's CSRF_EXEMPT_SUFFIXES).
// =============================================================================

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

type Status = 'verifying' | 'success' | 'error';

export function VerifyEmail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'error');

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!cancelled) setStatus(res.ok ? 'success' : 'error');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={styles.container}>
      <div style={styles.langBar}>
        <LanguageSwitcher variant="bar" />
      </div>
      <div style={styles.card}>
        <h1 style={styles.title}>{t('verifyEmail.title')}</h1>

        {status === 'verifying' && (
          <p style={styles.subtitle}>{t('verifyEmail.verifying')}</p>
        )}

        {status === 'success' && (
          <>
            <p style={styles.subtitle}>{t('verifyEmail.successMessage')}</p>
            <Link to="/login" style={styles.link}>{t('verifyEmail.goToLogin')}</Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={styles.error}>
              {token ? t('verifyEmail.invalidOrExpired') : t('verifyEmail.missingToken')}
            </div>
            <Link to="/login" style={styles.link}>{t('verifyEmail.goToLogin')}</Link>
          </>
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
  link: {
    color: 'var(--accent)',
    fontSize: '0.85rem',
    textAlign: 'center' as const,
    textDecoration: 'none',
  },
};
