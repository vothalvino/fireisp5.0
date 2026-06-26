// =============================================================================
// FireISP 5.0 — NAS WireGuard Provisioning Modal
// =============================================================================
// Three-phase flow:
//   idle       → intro + "Discover Subnets" button
//   discovering → POST /nas/{id}/wg/discover pending
//   select     → checkbox list of proposed CIDRs; PUT /wg/routes then POST /wg/bootstrap
//   done       → colored step report; if method==='snippet', read-only textarea + Copy
//
// i18n keys live under nasWireguard.* (locale files owned by the i18n task).
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WgStep {
  step: string;
  status: string;
  detail: string;
}

interface DiscoverResult {
  subnets: string[];
}

interface BootstrapResult {
  ok: boolean;
  method: 'api' | 'snippet' | 'manual';
  steps: WgStep[];
  snippet?: string;
  state?: string;
}

export interface NasWireguardModalProps {
  /** Minimal NAS shape — compatible with both NasList's Nas and NasDetail's NasRecord. */
  nas: { id: number; name: string };
  onClose: () => void;
}

type Phase = 'idle' | 'discovering' | 'select' | 'done';

// ---------------------------------------------------------------------------
// Color palettes
// ---------------------------------------------------------------------------

const WG_STEP_COLORS: Record<string, { bg: string; color: string }> = {
  created:   { bg: '#d1fae5', color: '#065f46' },
  updated:   { bg: '#dbeafe', color: '#1e40af' },
  unchanged: { bg: '#f3f4f6', color: '#374151' },
  skipped:   { bg: '#f3f4f6', color: '#374151' },
  ok:        { bg: '#d1fae5', color: '#065f46' },
  error:     { bg: '#fee2e2', color: '#991b1b' },
};

const STATE_COLORS: Record<string, { bg: string; color: string }> = {
  active:   { bg: '#d1fae5', color: '#065f46' },
  manual:   { bg: '#dbeafe', color: '#1e40af' },
  pending:  { bg: '#fef3c7', color: '#92400e' },
  degraded: { bg: '#fee2e2', color: '#991b1b' },
  error:    { bg: '#fee2e2', color: '#991b1b' },
  disabled: { bg: '#f3f4f6', color: '#6b7280' },
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function wgDiscover(nasId: number): Promise<DiscoverResult> {
  const res = (await api.POST('/nas/{id}/wg/discover' as never, {
    params: { path: { id: nasId } },
  } as never)) as {
    data?: { data?: DiscoverResult };
    error?: { error?: { message?: string } };
  };
  if (res.error) throw new Error(res.error?.error?.message ?? 'Discover failed');
  return (res.data?.data ?? { subnets: [] }) as DiscoverResult;
}

async function wgPutRoutes(nasId: number, subnets: string[]): Promise<void> {
  const res = (await api.PUT('/nas/{id}/wg/routes' as never, {
    params: { path: { id: nasId } },
    body: { subnets } as never,
  } as never)) as { error?: { error?: { message?: string } } };
  if (res.error) throw new Error(res.error?.error?.message ?? 'Route update failed');
}

async function wgBootstrap(nasId: number): Promise<BootstrapResult> {
  const res = (await api.POST('/nas/{id}/wg/bootstrap' as never, {
    params: { path: { id: nasId } },
  } as never)) as {
    data?: { data?: BootstrapResult };
    error?: { error?: { message?: string } };
  };
  if (res.error) throw new Error(res.error?.error?.message ?? 'Bootstrap failed');
  return (res.data?.data ?? { ok: false, method: 'manual', steps: [] }) as BootstrapResult;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepReport({ steps }: { steps: WgStep[] }) {
  if (!steps.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((s, i) => {
        const c = WG_STEP_COLORS[s.status] ?? WG_STEP_COLORS.skipped;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.82rem' }}>
            <span
              style={{
                background: c.bg, color: c.color,
                padding: '2px 8px', borderRadius: 12,
                fontWeight: 600, fontSize: '0.7rem',
                textTransform: 'capitalize', whiteSpace: 'nowrap',
                minWidth: 64, textAlign: 'center',
              }}
            >
              {s.status}
            </span>
            <span style={{ color: 'var(--text-primary)' }}>
              <strong>{s.step}</strong>
              {s.detail ? ` — ${s.detail}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function NasWireguardModal({ nas, onClose }: NasWireguardModalProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [proposedSubnets, setProposedSubnets] = useState<string[]>([]);
  const [selectedSubnets, setSelectedSubnets] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // --- discover ---
  const discoverMutation = useMutation({
    mutationFn: () => wgDiscover(nas.id),
    onSuccess: (data) => {
      const subnets = data.subnets ?? [];
      setProposedSubnets(subnets);
      setSelectedSubnets(new Set(subnets)); // pre-select all
      setPhase('select');
      setError('');
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : t('nasWireguard.discoverFailed'));
      setPhase('idle');
    },
  });

  // --- routes + bootstrap (sequential inside one mutationFn) ---
  const bootstrapMutation = useMutation({
    mutationFn: async (): Promise<BootstrapResult> => {
      const subnets = Array.from(selectedSubnets);
      await wgPutRoutes(nas.id, subnets);
      return wgBootstrap(nas.id);
    },
    onSuccess: (data) => {
      setResult(data);
      setPhase('done');
      setError('');
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : t('nasWireguard.bootstrapFailed'));
    },
  });

  function toggleSubnet(subnet: string) {
    setSelectedSubnets(prev => {
      const next = new Set(prev);
      if (next.has(subnet)) next.delete(subnet); else next.add(subnet);
      return next;
    });
  }

  function handleCopy() {
    if (!result?.snippet) return;
    navigator.clipboard.writeText(result.snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleStartOver() {
    setPhase('idle');
    setResult(null);
    setProposedSubnets([]);
    setSelectedSubnets(new Set());
    setError('');
  }

  function startDiscover() {
    setPhase('discovering');
    discoverMutation.mutate();
  }

  const isDiscovering = discoverMutation.isPending;
  const isBootstrapping = bootstrapMutation.isPending;

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 560 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${t('nasWireguard.title')} — ${nas.name}`}
      >
        {/* Header */}
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>
            {t('nasWireguard.title')} — {nas.name}
          </h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── IDLE ─────────────────────────────────────── */}
        {phase === 'idle' && (
          <div style={modalStyles.form}>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {t('nasWireguard.intro')}
            </p>
            {error && <p style={modalStyles.error}>{error}</p>}
            <div style={modalStyles.actions}>
              <button type="button" style={styles.btnSecondary} onClick={onClose}>
                {t('nasWireguard.cancel')}
              </button>
              <button
                type="button"
                style={styles.btnPrimary}
                disabled={isDiscovering}
                onClick={startDiscover}
              >
                {t('nasWireguard.discover')}
              </button>
            </div>
          </div>
        )}

        {/* ── DISCOVERING ──────────────────────────────── */}
        {phase === 'discovering' && (
          <div style={modalStyles.form}>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {t('nasWireguard.discovering')}
            </p>
          </div>
        )}

        {/* ── SELECT ───────────────────────────────────── */}
        {phase === 'select' && (
          <div style={modalStyles.form}>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {t('nasWireguard.selectSubnets')}
            </p>

            {proposedSubnets.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t('nasWireguard.noSubnetsFound')}
              </p>
            ) : (
              <div
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  maxHeight: 220, overflowY: 'auto', padding: '0.25rem 0',
                }}
              >
                {proposedSubnets.map(subnet => (
                  <label
                    key={subnet}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      cursor: 'pointer', fontSize: '0.85rem',
                      fontFamily: 'monospace', color: 'var(--text-primary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSubnets.has(subnet)}
                      onChange={() => toggleSubnet(subnet)}
                    />
                    {subnet}
                  </label>
                ))}
              </div>
            )}

            {error && <p style={modalStyles.error}>{error}</p>}

            <div style={modalStyles.actions}>
              <button type="button" style={styles.btnSecondary} onClick={onClose} disabled={isBootstrapping}>
                {t('nasWireguard.cancel')}
              </button>
              <button
                type="button"
                style={styles.btnSecondary}
                disabled={isBootstrapping || isDiscovering}
                onClick={startDiscover}
              >
                {t('nasWireguard.rediscover')}
              </button>
              <button
                type="button"
                style={styles.btnPrimary}
                disabled={isBootstrapping}
                onClick={() => bootstrapMutation.mutate()}
              >
                {isBootstrapping ? t('nasWireguard.bootstrapping') : t('nasWireguard.bootstrap')}
              </button>
            </div>
          </div>
        )}

        {/* ── DONE ─────────────────────────────────────── */}
        {phase === 'done' && result && (
          <div style={modalStyles.form}>
            {/* State badge + summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
              {result.state && (() => {
                const c = STATE_COLORS[result.state!] ?? { bg: '#f3f4f6', color: '#374151' };
                return (
                  <span
                    style={{
                      background: c.bg, color: c.color,
                      padding: '2px 8px', borderRadius: 12,
                      fontSize: '0.72rem', fontWeight: 600,
                      textTransform: 'capitalize',
                    }}
                  >
                    {result.state}
                  </span>
                );
              })()}
              <span
                style={{ fontSize: '0.9rem', fontWeight: 600, color: result.ok ? '#065f46' : '#92400e' }}
              >
                {result.ok ? t('nasWireguard.successApi') : t('nasWireguard.successSnippet')}
              </span>
            </div>

            {/* Step report */}
            <StepReport steps={result.steps} />

            {/* Snippet (paste-once RouterOS CLI) */}
            {result.method === 'snippet' && result.snippet && (
              <div>
                <div
                  style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {t('nasWireguard.pasteSnippet')}
                  </span>
                  <button
                    type="button"
                    style={{ ...styles.btnSecondary, padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                    onClick={handleCopy}
                  >
                    {copied ? t('nasWireguard.copied') : t('nasWireguard.copy')}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={result.snippet}
                  aria-label={t('nasWireguard.pasteSnippet')}
                  style={{
                    width: '100%',
                    minHeight: 180,
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '0.65rem',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={modalStyles.actions}>
              <button type="button" style={styles.btnSecondary} onClick={handleStartOver}>
                {t('nasWireguard.runAgain')}
              </button>
              <button type="button" style={styles.btnPrimary} onClick={onClose}>
                {t('nasWireguard.done')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
