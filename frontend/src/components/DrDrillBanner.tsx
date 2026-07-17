// =============================================================================
// FireISP 5.0 — DR Drill Warning Banner
// =============================================================================
// Shows a modal popup once per browser session when the quarterly DR drill
// is overdue (> 90 days since the last passing run) or the last run failed.
//
// Only rendered for admin users.  Dismissed state is stored in sessionStorage
// so the modal reappears on the next login but does not reappear on every
// navigation within the current session.
// =============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrDrillStatus {
  last_run_at: string | null;
  status: 'pass' | 'fail' | 'error' | null;
  days_since_drill: number | null;
  overdue: boolean;
  last_error: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchDrillStatus(): Promise<DrDrillStatus> {
  // Call through a loose signature: `Parameters<typeof api.GET>[0]` forces
  // TypeScript to instantiate the client's full path union (TS2589 once the
  // OpenAPI schema grew past ~470 paths), and the typed response is discarded
  // below anyway.
  const get = api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>;
  const res = await get('/dr-drill/status');
  if (res.error) throw new Error('Failed to load DR drill status');
  return (res.data as unknown as { data: DrDrillStatus }).data;
}

// ---------------------------------------------------------------------------
// Dismiss key — unique per session
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'drDrillBannerDismissed';

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function setDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // sessionStorage not available (private browsing, etc.) — ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DrDrillBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [dismissed, setDismissedState] = useState(() => isDismissed());

  // Only fetch for admin users
  const isAdmin = user?.role === 'admin';

  const { data: drStatus } = useQuery<DrDrillStatus>({
    queryKey: ['dr-drill-status'],
    queryFn: fetchDrillStatus,
    enabled: isAdmin && !dismissed,
    // Stale after 10 minutes — this is a slow-moving metric
    staleTime: 10 * 60 * 1000,
    // Don't retry on error — quietly skip if endpoint is unavailable
    retry: false,
  });

  // If another tab cleared the dismiss flag while this tab was open, pick up
  // the latest value when the component re-evaluates.
  useEffect(() => {
    setDismissedState(isDismissed());
  }, []);

  if (!isAdmin) return null;
  if (dismissed) return null;
  if (!drStatus) return null;
  if (!drStatus.overdue) return null;

  const handleDismiss = () => {
    setDismissed();
    setDismissedState(true);
  };

  const { last_run_at, status, days_since_drill, last_error } = drStatus;

  const isNeverRun = last_run_at === null;
  const isFailed = status === 'fail' || status === 'error';

  let headline: string;
  let detail: string;
  let accentColor: string;

  if (isNeverRun) {
    headline = t('drDrill.neverRun.headline');
    detail = t('drDrill.neverRun.detail');
    accentColor = '#d97706'; // amber
  } else if (isFailed) {
    const dateStr = new Date(last_run_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    headline = t('drDrill.failed.headline', { date: dateStr });
    detail = last_error
      ? t('drDrill.failed.detailWithReason', { reason: last_error })
      : t('drDrill.failed.detail');
    accentColor = '#dc2626'; // red
  } else {
    const dateStr = new Date(last_run_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    headline = t('drDrill.overdue.headline', { days: days_since_drill, date: dateStr });
    detail = t('drDrill.overdue.detail');
    accentColor = '#d97706'; // amber
  }

  return (
    <>
      {/* Backdrop */}
      <div style={styles.backdrop} aria-hidden="true" />

      {/* Modal dialog */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dr-drill-modal-title"
        aria-describedby="dr-drill-modal-desc"
        style={{ ...styles.modal, borderTop: `4px solid ${accentColor}` }}
      >
        <div style={styles.iconRow}>
          <span style={{ fontSize: '2rem' }}>{isFailed ? '🚨' : '⚠️'}</span>
        </div>

        <h2 id="dr-drill-modal-title" style={{ ...styles.title, color: accentColor }}>
          {t('drDrill.modalTitle')}
        </h2>

        <p id="dr-drill-modal-desc" style={styles.headline}>{headline}</p>
        <p style={styles.detail}>{detail}</p>

        <p style={styles.hint}>
          {t('drDrill.hint')}
        </p>

        <div style={styles.actions}>
          {/* In-app runbook on the /dr-drill page (the old /docs/dr-drill.md
              href pointed at a repo file nothing serves → SPA 404). Dismiss on
              navigate so the modal doesn't cover the page it just opened. */}
          <Link to="/dr-drill" onClick={handleDismiss} style={styles.docsLink}>
            {t('drDrill.openRunbook')}
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            style={styles.dismissBtn}
          >
            {t('drDrill.dismiss')}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
  },
  modal: {
    position: 'fixed' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 1001,
    background: 'var(--bg-card)',
    borderRadius: 8,
    padding: '2rem',
    maxWidth: 520,
    width: 'calc(100% - 2rem)',
    boxShadow: '0 8px 40px rgba(0,0,0,.25)',
    fontFamily: 'var(--font-sans)',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '0.85rem',
  },
  iconRow: {
    textAlign: 'center' as const,
  },
  title: {
    margin: 0,
    fontSize: '1.15rem',
    fontWeight: 700,
    textAlign: 'center' as const,
  },
  headline: {
    margin: 0,
    fontWeight: 600,
    fontSize: '0.92rem',
    color: 'var(--text-primary)',
    lineHeight: '1.4',
  },
  detail: {
    margin: 0,
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
  },
  hint: {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    borderTop: '1px solid var(--border)',
    paddingTop: '0.75rem',
    lineHeight: '1.5',
  },
  actions: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '0.5rem',
    marginTop: '0.25rem',
  },
  docsLink: {
    textAlign: 'center' as const,
    padding: '0.5rem',
    background: 'var(--bg-subtle)',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    textDecoration: 'none',
    fontWeight: 600,
  },
  dismissBtn: {
    padding: '0.6rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
