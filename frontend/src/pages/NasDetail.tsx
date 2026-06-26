// =============================================================================
// FireISP 5.0 — NAS Detail
// =============================================================================
// Route: /nas/:id
// Data: GET /nas/{id} via REST api client
// IMPORTANT: Never display api_password_encrypted or any secret field.
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { NasWireguardModal } from './NasWireguardModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NasRecord {
  id: number;
  name: string;
  ip_address: string;
  ipv6_address: string | null;
  type: string | null;
  ports: number | null;
  coa_port: number | null;
  location: string | null;
  site_id: number | null;
  health_status: string;
  last_health_check_at: string | null;
  status: string;
  api_port: number | null;
  api_username: string | null;
  api_use_tls: boolean | null;
  // NEVER include: api_password_encrypted, secret
}

interface ConnectionLogRow {
  id: number;
  username: string | null;
  ip_address: string | null;
  mac_address: string | null;
  nas_port_id: string | null;
}

interface ListResp<T> { data: T[]; }

interface WgTunnelRecord {
  id?: number;
  interface_name?: string;
  tunnel_address?: string | null;
  nas_public_key?: string | null;
  nas_config_method?: string | null;
  routed_subnets?: string[] | null;
  state?: string | null;
  server_peer_synced?: boolean;
  last_handshake_at?: string | null;
  last_error?: string | null;
  provisioned_at?: string | null;
}

interface WgTunnelResponse {
  tunnel: WgTunnelRecord | null;
  serverPublicKey?: string | null;
  serverEndpoint?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#6b7280' },
    up:       { bg: '#d1fae5', color: '#065f46' },
    down:     { bg: '#fee2e2', color: '#991b1b' },
    unknown:  { bg: '#f3f4f6', color: '#374151' },
  };
  const s = colorMap[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function WgStateBadge({ state }: { state: string | null | undefined }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    manual:   { bg: '#dbeafe', color: '#1e40af' },
    pending:  { bg: '#fef3c7', color: '#92400e' },
    degraded: { bg: '#fee2e2', color: '#991b1b' },
    error:    { bg: '#fee2e2', color: '#991b1b' },
    disabled: { bg: '#f3f4f6', color: '#6b7280' },
  };
  const s = colorMap[state ?? ''] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {state ?? 'none'}
    </span>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, ...(mono ? { fontFamily: 'monospace' } : {}) }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'health' | 'sessions' | 'wireguard';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NasDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showWgModal, setShowWgModal] = useState(false);

  // Mirror the backend route guards: health-check requires nas.health,
  // test-connection requires devices.update.
  const canHealthCheck = can(user?.role, 'nas.health');
  const canTestConn = can(user?.role, 'devices.update');

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview',   label: t('nasDetail.tabs.overview') },
    { id: 'health',     label: t('nasDetail.tabs.health') },
    { id: 'sessions',   label: t('nasDetail.tabs.liveSessions') },
    { id: 'wireguard',  label: t('nasDetail.tabs.wireguard') },
  ];

  const { data: nas, isLoading, error } = useQuery({
    queryKey: ['nas-detail', id],
    queryFn: async () => {
      const res = await api.GET('/nas/{id}' as never, { params: { path: { id: Number(id) } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('NAS not found');
      const d = (res as { data: unknown }).data;
      return (((d as { data?: NasRecord }).data) ?? d) as NasRecord;
    },
    enabled: Boolean(id),
  });

  const { data: sessions } = useQuery({
    queryKey: ['nas-sessions', id, nas?.ip_address],
    queryFn: async () => {
      if (!nas?.ip_address) return [];
      const res = await api.GET('/connection-logs/active' as never, {
        params: { query: { nas_ip_address: nas.ip_address, limit: 50 } as never },
      } as never);
      if ((res as { error?: unknown }).error) return [];
      const d = (res as { data: unknown }).data as ListResp<ConnectionLogRow> | ConnectionLogRow[];
      return Array.isArray(d) ? d : (d as ListResp<ConnectionLogRow>).data ?? [];
    },
    enabled: Boolean(id) && Boolean(nas?.ip_address) && activeTab === 'sessions',
  });

  const { data: wgData, refetch: refetchWg } = useQuery({
    queryKey: ['nas-wg', id],
    queryFn: async () => {
      const res = await api.GET('/nas/{id}/wg' as never, {
        params: { path: { id: Number(id) } },
      } as never);
      if ((res as { error?: unknown }).error) return null;
      const d = (res as { data: unknown }).data;
      return (((d as { data?: WgTunnelResponse }).data) ?? d) as WgTunnelResponse;
    },
    enabled: Boolean(id) && activeTab === 'wireguard',
  });

  async function runHealthCheck() {
    setActionPending('health-check');
    setActionResult(null);
    setActionError(null);
    try {
      const res = await api.POST('/nas/{id}/health-check' as never, {
        params: { path: { id: Number(id) } },
      } as never);
      if ((res as { error?: unknown }).error) {
        const msg = ((res as { error: { error?: { message?: string } } }).error?.error?.message) ?? 'Health check failed';
        setActionError(msg);
      } else {
        const d = (res as { data: unknown }).data;
        setActionResult(JSON.stringify(d, null, 2));
        queryClient.invalidateQueries({ queryKey: ['nas-detail', id] });
      }
    } catch {
      setActionError('Health check request failed.');
    } finally {
      setActionPending(null);
    }
  }

  async function runTestConnection() {
    setActionPending('test-connection');
    setActionResult(null);
    setActionError(null);
    try {
      const res = await api.POST('/nas/{id}/test-connection' as never, {
        params: { path: { id: Number(id) } },
      } as never);
      if ((res as { error?: unknown }).error) {
        const msg = ((res as { error: { error?: { message?: string } } }).error?.error?.message) ?? 'Connection test failed';
        setActionError(msg);
      } else {
        const d = (res as { data: unknown }).data;
        setActionResult(JSON.stringify(d, null, 2));
      }
    } catch {
      setActionError('Connection test request failed.');
    } finally {
      setActionPending(null);
    }
  }

  if (isLoading) {
    return <div style={styles.page}><p style={styles.msg}>{t('nasDetail.loading')}</p></div>;
  }

  if (error || !nas) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>{t('nasDetail.notFound')}</p>
        <Link to="/nas" style={styles.backLink}>← {t('nasDetail.backToList')}</Link>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/nas" style={styles.breadcrumbLink}>NAS Devices</Link>
        <span style={styles.breadcrumbSep}>›</span>
        <span style={styles.breadcrumbCurrent}>{nas.name}</span>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{nas.name}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={nas.status} />
            <span style={styles.idLabel}>ID #{nas.id}</span>
          </div>
        </div>
      </div>

      {/* Info card */}
      <div style={styles.infoCard}>
        <div style={styles.infoGrid}>
          <InfoRow label={t('nasDetail.fields.ipAddress')}         value={nas.ip_address}                          mono />
          <InfoRow label={t('nasDetail.fields.ipv6Address')}       value={nas.ipv6_address}                         mono />
          <InfoRow label={t('nasDetail.fields.type')}              value={nas.type}                                 />
          <InfoRow label={t('nasDetail.fields.ports')}             value={nas.ports != null ? String(nas.ports) : null} />
          <InfoRow label={t('nasDetail.fields.coaPort')}           value={nas.coa_port != null ? String(nas.coa_port) : null} />
          <InfoRow label={t('nasDetail.fields.location')}          value={nas.location}                             />
          <InfoRow label={t('nasDetail.fields.siteId')}            value={nas.site_id != null ? String(nas.site_id) : null} />
          <InfoRow label={t('nasDetail.fields.healthStatus')}      value={nas.health_status}                        />
          <InfoRow label={t('nasDetail.fields.lastHealthCheckAt')} value={fmt(nas.last_health_check_at)}            />
          <InfoRow label={t('nasDetail.fields.apiPort')}           value={nas.api_port != null ? String(nas.api_port) : null} />
          <InfoRow label={t('nasDetail.fields.apiUsername')}       value={nas.api_username}                         />
          <InfoRow label={t('nasDetail.fields.apiUseTls')}         value={nas.api_use_tls != null ? (nas.api_use_tls ? 'Yes' : 'No') : null} />
        </div>
        {nas.site_id && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            <Link to={`/sites/${nas.site_id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
              {t('nasDetail.viewSite')} →
            </Link>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ ...styles.tabBtn, ...(activeTab === tab.id ? styles.tabBtnActive : {}) }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'overview' && (
          <p style={styles.msg}>{t('nasDetail.overview.hint')}</p>
        )}

        {activeTab === 'health' && (
          <div style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <StatusBadge status={nas.health_status} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {t('nasDetail.health.lastCheck')}: {fmt(nas.last_health_check_at)}
              </span>
            </div>

            {(canHealthCheck || canTestConn) && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {canHealthCheck && (
                  <button
                    style={styles.actionBtn}
                    onClick={runHealthCheck}
                    disabled={actionPending !== null}
                  >
                    {actionPending === 'health-check' ? t('nasDetail.health.running') : t('nasDetail.health.runHealthCheck')}
                  </button>
                )}
                {canTestConn && (
                  <button
                    style={styles.actionBtn}
                    onClick={runTestConnection}
                    disabled={actionPending !== null}
                  >
                    {actionPending === 'test-connection' ? t('nasDetail.health.running') : t('nasDetail.health.testConnection')}
                  </button>
                )}
              </div>
            )}

            {actionError && (
              <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                {actionError}
              </div>
            )}

            {actionResult && (
              <pre style={{ background: '#f9fafb', border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem', fontSize: '0.8rem', overflowX: 'auto', color: 'var(--text-secondary)' }}>
                {actionResult}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'sessions' && (
          <div style={{ overflowX: 'auto' }}>
            {!sessions?.length ? (
              <p style={styles.msg}>{t('nasDetail.sessions.empty')}</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[t('nasDetail.sessions.username'), t('nasDetail.sessions.ipAddress'), t('nasDetail.sessions.macAddress'), t('nasDetail.sessions.nasPortId')].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map(s => (
                    <tr key={s.id} style={styles.tr}>
                      <td style={styles.td}>{s.username ?? '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{s.ip_address ?? '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{s.mac_address ?? '—'}</td>
                      <td style={styles.td}>{s.nas_port_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'wireguard' && (() => {
          const wgTunnel = wgData?.tunnel ?? null;
          const serverPublicKey = wgData?.serverPublicKey ?? null;
          const serverEndpoint = wgData?.serverEndpoint ?? null;
          return (
            <div style={{ padding: '1.25rem' }}>
              {!wgTunnel ? (
                /* No tunnel provisioned yet */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {t('nasDetail.tunnel.notProvisioned')}
                  </p>
                  {can(user?.role, 'devices.update') && (
                    <button style={styles.actionBtn} onClick={() => setShowWgModal(true)}>
                      {t('nasDetail.tunnel.configure')}
                    </button>
                  )}
                </div>
              ) : (
                /* Tunnel exists — show details */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* State + actions row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const }}>
                    <WgStateBadge state={wgTunnel.state} />
                    {can(user?.role, 'devices.update') && (
                      <button style={styles.actionBtn} onClick={() => setShowWgModal(true)}>
                        {t('nasDetail.tunnel.rebootstrap')}
                      </button>
                    )}
                  </div>

                  {/* Key-value details */}
                  <div style={styles.infoGrid}>
                    <InfoRow label={t('nasDetail.tunnel.tunnelIp')}      value={wgTunnel.tunnel_address}   mono />
                    <InfoRow label={t('nasDetail.tunnel.configMethod')}  value={wgTunnel.nas_config_method} />
                    <InfoRow label={t('nasDetail.tunnel.serverPubkey')}  value={serverPublicKey}            mono />
                    <InfoRow label={t('nasDetail.tunnel.serverEndpoint')} value={serverEndpoint}            mono />
                    <InfoRow label={t('nasDetail.tunnel.lastHandshake')} value={fmt(wgTunnel.last_handshake_at)} />
                    <InfoRow label={t('nasDetail.tunnel.provisioned')}   value={fmt(wgTunnel.provisioned_at)} />
                  </div>

                  {/* Routed subnets */}
                  {Array.isArray(wgTunnel.routed_subnets) && wgTunnel.routed_subnets.length > 0 && (
                    <div>
                      <p style={{ margin: '0 0 0.4rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dimmed)' }}>
                        {t('nasDetail.tunnel.routedSubnets')}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                        {wgTunnel.routed_subnets.map(s => (
                          <span
                            key={s}
                            style={{ fontFamily: 'monospace', fontSize: '0.82rem', background: 'var(--bg-subtle, #f3f4f6)', padding: '2px 8px', borderRadius: 4, color: 'var(--text-secondary)' }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Last error */}
                  {wgTunnel.last_error && (
                    <div style={{ padding: '0.65rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: '0.82rem' }}>
                      <strong>{t('nasDetail.tunnel.lastError')}:</strong> {wgTunnel.last_error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* WireGuard provisioning modal */}
      {showWgModal && nas && (
        <NasWireguardModal
          nas={nas}
          onClose={() => {
            setShowWgModal(false);
            refetchWg();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: { padding: '2rem', fontFamily: 'var(--font-sans)', maxWidth: 1100 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1.25rem', fontSize: '0.85rem' },
  breadcrumbLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:  { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' },
  title:  { margin: '0 0 0.35rem', color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  idLabel: { color: 'var(--text-dimmed)', fontSize: '0.8rem' },
  infoCard: { background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 0 0 1px var(--border)', padding: '1rem 1.25rem', marginBottom: '1.5rem' },
  infoGrid: { display: 'grid' as const, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.5rem 1.5rem' },
  infoRow:  { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 80 },
  infoValue: { color: 'var(--text-secondary)' },
  tabBar: { display: 'flex', gap: '0.25rem', borderBottom: '2px solid var(--border)', marginBottom: '0' },
  tabBtn: { padding: '0.6rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: '-2px', fontFamily: 'var(--font-sans)', fontWeight: 500, whiteSpace: 'nowrap' as const, transition: 'color .15s' },
  tabBtnActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)', fontWeight: 600 },
  tabContent: { background: 'var(--bg-card)', borderRadius: '0 0 8px 8px', boxShadow: '0 0 0 1px var(--border)', minHeight: 200 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: { padding: '0.6rem 0.75rem', textAlign: 'left' as const, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '2px solid var(--border-subtle)', whiteSpace: 'nowrap' as const },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
  actionBtn: {
    padding: '0.45rem 0.85rem',
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 500,
  } as React.CSSProperties,
};
