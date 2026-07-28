// =============================================================================
// FireISP 5.0 — Portal Privacy Notice (LFPDPPP §16)
// =============================================================================
// Renders the org's privacy notice (org-authored or the bundled template —
// the backend decides) and records acceptance. The notice CONTENT arrives in
// the org's language from the backend; only the chrome around it is i18n'd.
// =============================================================================

import { lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const MarkdownView = lazy(() => import('@/components/MarkdownView'));

const API_BASE = '/api/v1/portal';

interface PrivacyNotice {
  version: string;
  content: string;
  accepted: boolean;
  accepted_at: string | null;
}

async function portalFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message || 'Request failed');
  }
  return res.json() as Promise<T>;
}

export function PortalPrivacy() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const notice = useQuery({
    queryKey: ['portal-privacy-notice'],
    queryFn: () => portalFetch<{ data: PrivacyNotice }>('/privacy-notice'),
  });

  const accept = useMutation({
    mutationFn: () => portalFetch('/privacy-notice/accept', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-privacy-notice'] }),
  });

  if (notice.isLoading) return <p>{t('common.loading')}</p>;
  if (notice.isError || !notice.data) return <p>{t('portalPrivacy.loadError')}</p>;

  const n = notice.data.data;

  return (
    <div>
      <div style={styles.statusBar}>
        {n.accepted ? (
          <span style={styles.accepted}>
            {t('portalPrivacy.acceptedOn', {
              date: n.accepted_at ? new Date(n.accepted_at).toLocaleDateString() : '',
            })}
          </span>
        ) : (
          <>
            <span style={styles.pending}>{t('portalPrivacy.pendingPrompt')}</span>
            <button
              style={styles.acceptBtn}
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
            >
              {accept.isPending ? t('common.saving') : t('portalPrivacy.acceptButton')}
            </button>
          </>
        )}
        {accept.isError && <span style={styles.error}>{t('portalPrivacy.acceptError')}</span>}
      </div>

      <Suspense fallback={<p>{t('common.loading')}</p>}>
        <MarkdownView markdown={n.content} />
      </Suspense>

      <p style={styles.versionLine}>{t('portalPrivacy.versionLabel', { version: n.version })}</p>
    </div>
  );
}

const styles = {
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap' as const,
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-subtle)',
  },
  accepted: { color: 'var(--success, #2e7d32)', fontSize: '0.9rem' },
  pending: { fontSize: '0.9rem', color: 'var(--text-secondary)' },
  acceptBtn: {
    padding: '0.4rem 1rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  error: { color: 'var(--danger, #c62828)', fontSize: '0.85rem' },
  versionLine: {
    marginTop: '1.5rem',
    fontSize: '0.8rem',
    color: 'var(--text-dimmed)',
  },
};

export default PortalPrivacy;
