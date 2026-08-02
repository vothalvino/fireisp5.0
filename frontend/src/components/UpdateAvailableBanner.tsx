// =============================================================================
// FireISP 5.0 — "a newer release is available" banner
// =============================================================================
// Shows the INSTALL OPERATOR, once a day, that main has moved past the commit
// this instance is running.
//
// Only rendered for the legacy users.role === 'admin' — an EXACT check, the
// same one Layout.tsx uses. FireISP is multi-tenant: a reseller's org-admin has
// no shell on the box and cannot upgrade it, so telling them a newer version
// exists is noise they can never act on, and it advertises the provider's
// release cadence to its own tenants. The backend enforces this too (the
// endpoint 404s for everyone else) — this check only avoids a pointless
// request.
//
// The whole feature is inert unless the operator set FIREISP_UPDATE_CHECK=1 in
// .env.prod: without it the endpoint reports check_enabled false, no outbound
// request is ever made, and this renders nothing.
//
// DISMISSAL IS PER DAY, not per session, because that is what was asked for and
// because the underlying fact changes slowly. localStorage (survives restarts),
// keyed on the local calendar date.
// =============================================================================

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';

interface SystemVersion {
  running_sha: string | null;
  latest_sha: string | null;
  update_available: boolean;
  check_enabled: boolean;
  checked_at: string | null;
}

async function fetchVersion(): Promise<SystemVersion> {
  // Loose signature: `Parameters<typeof api.GET>[0]` makes TypeScript
  // instantiate the client's full path union (TS2589 past ~470 paths), and the
  // typed response is discarded anyway. Same approach as DrDrillBanner.
  const get = api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>;
  const res = await get('/system/version');
  if (res.error) throw new Error('Failed to load version');
  return (res.data as unknown as { data: SystemVersion }).data;
}

const DISMISS_KEY = 'fireispUpdateBannerDismissedOn';

/** Local calendar date, not UTC — "once a day" should mean the operator's day. */
function today(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The date it was last dismissed, or null. */
function readDismissedOn(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    // localStorage unavailable (private browsing, blocked cookies) — showing
    // the banner is the safer failure than hiding it forever.
    return null;
  }
}

function dismissForToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, today());
  } catch {
    // Unavailable — the banner reappears on navigation. Acceptable: it is a
    // notice, not a blocker, and never hides anything behind it.
  }
}

export function UpdateAvailableBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // The DATE it was dismissed, not a boolean. A boolean computed once cannot
  // expire: Layout renders this alongside <Outlet/>, React Router keeps the
  // layout mounted across every client-side navigation, so a NOC dashboard left
  // open all week would keep a `true` forever and never show the banner again.
  // Comparing against today() on each render makes the expiry actually happen.
  const [dismissedOn, setDismissedOn] = useState(() => readDismissedOn());
  const dismissed = dismissedOn === today();

  // EXACT check, deliberately — not hasRole(). See the header.
  // Backend-resolved (GET /auth/me) — see AuthUser.is_install_operator. A
  // tenant admin must not be told the install has an update they cannot apply.
  const isInstallOperator = user?.is_install_operator === true;

  const { data } = useQuery<SystemVersion>({
    // Settings' VersionTab shares this queryKey AND this unwrapped shape —
    // keep them in agreement, or whichever fetched second reads garbage off
    // the other's fresh cache entry.
    queryKey: ['system-version'],
    queryFn: fetchVersion,
    enabled: isInstallOperator && !dismissed,
    // The backend caches the upstream lookup for a day; this keeps the browser
    // from re-asking on every navigation within a session.
    staleTime: 60 * 60 * 1000,
    // Quietly skip if the endpoint is unavailable — an older backend, or a
    // non-admin who somehow got here, must not produce an error toast.
    retry: false,
  });

  // Re-read when the tab is brought back to the foreground. Render-time
  // comparison already covers a tab that navigates; this covers the one that
  // sits untouched across midnight and is simply returned to — and it picks up
  // a dismissal made in another tab.
  useEffect(() => {
    const sync = () => setDismissedOn(readDismissedOn());
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  if (!isInstallOperator) return null;
  if (dismissed) return null;
  if (!data?.update_available) return null;

  const handleDismiss = () => {
    dismissForToday();
    setDismissedOn(today());
  };

  const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '—');

  return (
    <div role="status" style={styles.bar}>
      <span style={styles.icon} aria-hidden="true">⬆️</span>
      <span style={styles.text}>
        {t('updateBanner.message', {
          running: short(data.running_sha),
          latest: short(data.latest_sha),
        })}
      </span>
      <div style={styles.actions}>
        <code style={styles.command}>sudo redeploy</code>
        <button
          type="button"
          style={styles.dismissBtn}
          onClick={handleDismiss}
          aria-label={t('updateBanner.dismiss')}
          title={t('updateBanner.dismiss')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: '0.6rem',
    padding: '0.55rem 1rem',
    background: 'var(--bg-subtle)',
    borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
  },
  icon: { fontSize: '1rem' },
  text: { color: 'var(--text-secondary)', flex: '1 1 auto' },
  actions: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '0.6rem',
    marginLeft: 'auto',
  },
  command: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.8rem',
    padding: '0.2rem 0.45rem',
    borderRadius: '4px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: 1,
    padding: '0.2rem',
  },
};
