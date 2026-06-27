// =============================================================================
// FireISP 5.0 — NAS WireGuard Provisioning Modal
// =============================================================================
// Four-phase flow:
//   idle        → intro + "Discover Subnets" button
//   discovering → POST /nas/{id}/wg/discover pending
//   select      → checkbox list of proposed CIDRs + manual-add field; then
//                 PUT /wg/routes (selected) followed by POST /wg/bootstrap
//   done        → colored step report; if method==='snippet', read-only textarea + Copy
//
// The discover response is read through the generated OpenAPI type
// (operations['discoverNasWgSubnets']) so the field name (`proposed`) can't drift
// from the backend again. i18n keys live under nasWireguard.*.
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { styles, modalStyles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WgStep {
  step: string;
  status: string;
  detail: string;
}

/** Discover payload shape, sourced from the generated OpenAPI types. */
type WgDiscoverData = NonNullable<
  operations['discoverNasWgSubnets']['responses'][200]['content']['application/json']['data']
>;

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
// Helpers
// ---------------------------------------------------------------------------

/** Validate an IPv4 CIDR string (e.g. "10.199.0.0/24"). Discovery is IPv4-only. */
export function isValidCidr(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s.trim());
  if (!m) return false;
  if ([m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) return false;
  return Number(m[5]) <= 32;
}

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

async function wgDiscover(nasId: number): Promise<WgDiscoverData> {
  const res = (await api.POST('/nas/{id}/wg/discover' as never, {
    params: { path: { id: nasId } },
  } as never)) as {
    data?: { data?: WgDiscoverData };
    error?: { error?: { message?: string } };
  };
  if (res.error) throw new Error(res.error?.error?.message ?? 'Discover failed');
  return (res.data?.data ?? { proposed: [] }) as WgDiscoverData;
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

/** Flatten topology addresses into "10.199.0.1/24 (bridge-lan-test)" reference strings. */
function topologyAddresses(data: WgDiscoverData): string[] {
  return (data.topology?.addresses ?? [])
    .map((a) => {
      const addr = typeof a.address === 'string' ? a.address : '';
      const iface = typeof a.interface === 'string' ? a.interface : '';
      if (!addr) return '';
      return iface ? `${addr} (${iface})` : addr;
    })
    .filter(Boolean);
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
  const [manualSubnets, setManualSubnets] = useState<string[]>([]);
  const [selectedSubnets, setSelectedSubnets] = useState<Set<string>>(new Set());
  const [deviceAddresses, setDeviceAddresses] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState('');
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Proposed first, then any manually-added CIDRs not already proposed.
  const allSubnets = [...proposedSubnets, ...manualSubnets.filter((s) => !proposedSubnets.includes(s))];

  // --- discover ---
  const discoverMutation = useMutation({
    mutationFn: () => wgDiscover(nas.id),
    onSuccess: (data) => {
      const subnets = data.proposed ?? [];
      setProposedSubnets(subnets);
      setSelectedSubnets(new Set(subnets)); // pre-select all proposed
      setManualSubnets([]);
      setManualInput('');
      setManualError('');
      setDeviceAddresses(topologyAddresses(data));
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

  function addManual() {
    const v = manualInput.trim();
    if (!v) return;
    if (!isValidCidr(v)) { setManualError(t('nasWireguard.manualInvalid')); return; }
    if (proposedSubnets.includes(v) || manualSubnets.includes(v)) {
      setManualError(t('nasWireguard.manualDuplicate'));
      return;
    }
    setManualSubnets(prev => [...prev, v]);
    setSelectedSubnets(prev => new Set(prev).add(v));
    setManualInput('');
    setManualError('');
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
    setManualSubnets([]);
    setSelectedSubnets(new Set());
    setDeviceAddresses([]);
    setManualInput('');
    setManualError('');
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

            {/* Router interface addresses — reference for manual entry */}
            {deviceAddresses.length > 0 && (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {t('nasWireguard.deviceAddressesLabel')}:{' '}
                <span style={{ fontFamily: 'monospace' }}>{deviceAddresses.join(', ')}</span>
              </p>
            )}

            {allSubnets.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t('nasWireguard.noSubnetsFound')}
              </p>
            ) : (
              <div
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  maxHeight: 200, overflowY: 'auto', padding: '0.25rem 0',
                }}
              >
                {allSubnets.map(subnet => (
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

            {/* Manual add — for subnets discovery can't see (static/OSPF/non-connected) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {t('nasWireguard.manualAddLabel')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={manualInput}
                  placeholder={t('nasWireguard.manualAddPlaceholder')}
                  aria-label={t('nasWireguard.manualAddLabel')}
                  onChange={e => { setManualInput(e.target.value); if (manualError) setManualError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '0.82rem',
                    padding: '0.4rem 0.55rem', border: '1px solid var(--border)',
                    borderRadius: 6, boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  style={{ ...styles.btnSecondary, padding: '0.35rem 0.8rem' }}
                  onClick={addManual}
                  disabled={!manualInput.trim()}
                >
                  {t('nasWireguard.manualAdd')}
                </button>
              </div>
              {manualError && (
                <span style={{ fontSize: '0.75rem', color: '#991b1b' }}>{manualError}</span>
              )}
            </div>

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
