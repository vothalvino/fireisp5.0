// =============================================================================
// FireISP 5.0 — My WireGuard Tunnels (self-service)
// =============================================================================
// Any authenticated user with wireguard.peers.* permissions can:
//   • View their own peers (table: name, tunnel IP, scope count, last handshake)
//   • Add a new peer (name only — server generates keypair + assigns IP)
//   • Download the .conf file for a peer (re-downloadable from profile)
//   • Show QR code (SVG rendered server-side; no client QR library needed)
//   • Revoke a peer (soft-delete + kernel peer removal)
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WgPeer {
  id: number;
  name: string;
  tunnel_address: string;
  allowed_ips_snapshot: string[] | null;
  last_handshake_at: string | null;
  server_peer_synced: boolean | number;
  revoked_at: string | null;
  created_at: string;
}

interface PeersResponse {
  data: WgPeer[];
}

interface CreatePeerResponse {
  data: WgPeer;
  config: string;
  config_base64: string;
  qr_svg: string;
}

// ---------------------------------------------------------------------------
// Constants + API helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiErrorMessage(json: unknown, fallback: string): string {
  const e = (json as { error?: { message?: string; details?: Array<{ message?: string }> } })?.error;
  const details = e?.details?.map((d) => d.message).filter(Boolean).join(', ');
  return details || e?.message || fallback;
}

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

async function fetchMyPeers(): Promise<PeersResponse> {
  const res = await fetch(`${API_BASE}/wg-peers`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load peers');
  return res.json() as Promise<PeersResponse>;
}

async function createPeer(name: string, fullTunnel: boolean): Promise<CreatePeerResponse> {
  const res = await fetch(`${API_BASE}/wg-peers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, full_tunnel: fullTunnel }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to create peer'));
  }
  return res.json() as Promise<CreatePeerResponse>;
}

async function deletePeer(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/wg-peers/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to revoke peer');
}

async function fetchPeerConfig(id: number, format: 'conf' | 'qr'): Promise<string> {
  const params = format === 'conf' ? 'format=conf&download=1' : 'format=qr';
  const res = await fetch(`${API_BASE}/wg-peers/${id}/config?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.text();
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Add Peer Modal
// ---------------------------------------------------------------------------

interface AddPeerModalProps {
  onClose: () => void;
  onCreated: (res: CreatePeerResponse) => void;
}

function AddPeerModal({ onClose, onCreated }: AddPeerModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [fullTunnel, setFullTunnel] = useState(true);
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => createPeer(name.trim(), fullTunnel),
    onSuccess: (res) => onCreated(res),
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h3 style={{ margin: '0 0 1rem' }}>{t('wgTunnels.addPeer')}</h3>
        {err && <div style={errStyle}>{err}</div>}
        <label style={labelStyle}>{t('wgTunnels.peerName')} *</label>
        <input
          style={inputStyle}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('wgTunnels.peerNamePlaceholder')}
          maxLength={100}
          autoFocus
        />
        <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '6px 0 0' }}>
          {t('wgTunnels.peerNameHint')}
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: '1rem' }}>
          <input
            id="full-tunnel-checkbox"
            type="checkbox"
            checked={fullTunnel}
            onChange={e => setFullTunnel(e.target.checked)}
            style={{ marginTop: 3, cursor: 'pointer' }}
          />
          <div>
            <label
              htmlFor="full-tunnel-checkbox"
              style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {t('wgTunnels.fullTunnelLabel')}
            </label>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '2px 0 0' }}>
              {t('wgTunnels.fullTunnelHint')}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name.trim()}
          >
            {mutation.isPending ? t('wgTunnels.creating') : t('wgTunnels.createPeer')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Peer Result Modal — shows QR + download after creation.
// The private key is only returned here; after this modal is closed the user
// must use "Download .conf" (re-fetches from server) to get it again.
// ---------------------------------------------------------------------------

interface NewPeerResultModalProps {
  result: CreatePeerResponse;
  onClose: () => void;
}

function NewPeerResultModal({ result, onClose }: NewPeerResultModalProps) {
  const { t } = useTranslation();
  const svgDataUrl = result.qr_svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.qr_svg)}`
    : null;

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 540 }}>
        <h3 style={{ margin: '0 0 0.5rem', color: '#065f46' }}>{t('wgTunnels.peerCreated')}</h3>
        <p style={{ fontSize: '0.83rem', color: '#555', margin: '0 0 1rem', lineHeight: 1.5 }}>
          {t('wgTunnels.peerCreatedNote')}
        </p>

        {svgDataUrl && (
          <div style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            <img
              src={svgDataUrl}
              alt={t('wgTunnels.qrAlt')}
              style={{ width: 220, height: 220, display: 'block', margin: '0 auto' }}
            />
          </div>
        )}

        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: 6, padding: '6px 10px', marginBottom: '1rem',
          fontSize: '0.78rem', color: '#374151',
        }}>
          <strong>{t('wgTunnels.tunnelIp')}:</strong>{' '}
          <code>{result.data.tunnel_address}</code>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: '1rem' }}>
          <button
            style={btnSecondary}
            onClick={() => triggerDownload(result.config, `${result.data.name}.conf`)}
          >
            {t('wgTunnels.downloadConf')}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={btnPrimary} onClick={onClose}>{t('common.done')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR View Modal — fetches QR on demand (persistent re-download)
// ---------------------------------------------------------------------------

interface QrModalProps {
  peer: WgPeer;
  onClose: () => void;
}

function QrModal({ peer, onClose }: QrModalProps) {
  const { t } = useTranslation();
  const { data: svgText, isLoading, error } = useQuery({
    queryKey: ['wg-peer-qr', peer.id],
    queryFn: () => fetchPeerConfig(peer.id, 'qr'),
  });

  const svgDataUrl = svgText
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
    : null;

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 340, textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{peer.name}</h3>
        <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem' }}>
          {peer.tunnel_address}
        </p>
        {isLoading && <p style={{ color: '#888' }}>{t('wgTunnels.loadingQr')}</p>}
        {error && <p style={{ color: '#e00' }}>{t('wgTunnels.qrError')}</p>}
        {svgDataUrl && (
          <img
            src={svgDataUrl}
            alt={t('wgTunnels.qrAlt')}
            style={{ width: 240, height: 240, display: 'block', margin: '0 auto 1rem' }}
          />
        )}
        <button style={btnSecondary} onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm Revoke Dialog
// ---------------------------------------------------------------------------

interface ConfirmRevokeProps {
  peer: WgPeer;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function ConfirmRevoke({ peer, onClose, onConfirm, isPending }: ConfirmRevokeProps) {
  const { t } = useTranslation();
  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 420 }}>
        <h3 style={{ margin: '0 0 0.75rem', color: '#991b1b' }}>{t('wgTunnels.revokeTitle')}</h3>
        <p style={{ fontSize: '0.88rem', color: '#555', lineHeight: 1.5 }}>
          {t('wgTunnels.revokeConfirm', { name: peer.name })}
        </p>
        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '6px 0 0' }}>
          {t('wgTunnels.revokeNote')}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </button>
          <button
            style={{ ...btnPrimary, background: '#dc2626' }}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? t('wgTunnels.revoking') : t('wgTunnels.revoke')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function UserWgTunnels() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [newPeerResult, setNewPeerResult] = useState<CreatePeerResponse | null>(null);
  const [qrPeer, setQrPeer] = useState<WgPeer | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<WgPeer | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['wg-peers-mine'],
    queryFn: fetchMyPeers,
  });

  const peers = data?.data ?? [];

  const revokeMutation = useMutation({
    mutationFn: (id: number) => deletePeer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wg-peers-mine'] });
      setRevokeTarget(null);
    },
  });

  async function handleDownload(peer: WgPeer) {
    setDownloadingId(peer.id);
    try {
      const conf = await fetchPeerConfig(peer.id, 'conf');
      triggerDownload(conf, `${peer.name}.conf`);
    } catch {
      // silently ignore; user can retry
    } finally {
      setDownloadingId(null);
    }
  }

  function scopeLabel(peer: WgPeer): string {
    const s = peer.allowed_ips_snapshot;
    if (!s || s.length === 0) return '—';
    return `${s.length} subnet${s.length === 1 ? '' : 's'}`;
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1020 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1rem',
      }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{t('wgTunnels.title')}</h1>
        <button style={btnPrimary} onClick={() => setShowAdd(true)}>
          {t('wgTunnels.addPeer')}
        </button>
      </div>

      {/* Info banner */}
      <div style={{
        background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: 6, padding: '8px 12px', marginBottom: '1rem',
        fontSize: '0.8rem', color: '#1e40af', lineHeight: 1.5,
      }}>
        {t('wgTunnels.banner')}
      </div>

      {isLoading && <p style={{ color: '#888' }}>{t('wgTunnels.loading')}</p>}
      {error && <p style={{ color: '#e00' }}>{t('wgTunnels.error')}</p>}

      {!isLoading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>{t('wgTunnels.table.name')}</th>
                <th style={th}>{t('wgTunnels.table.assignedIp')}</th>
                <th style={th}>{t('wgTunnels.table.scopeCount')}</th>
                <th style={th}>{t('wgTunnels.table.lastHandshake')}</th>
                <th style={th}>{t('wgTunnels.table.status')}</th>
                <th style={th}>{t('wgTunnels.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {peers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#888', padding: '2rem' }}>
                    {t('wgTunnels.noPeers')}
                  </td>
                </tr>
              )}
              {peers.map(peer => (
                <tr key={peer.id} style={{ opacity: peer.revoked_at ? 0.55 : 1 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{peer.name}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.82rem' }}>
                    {peer.tunnel_address}
                  </td>
                  <td style={{ ...td, fontSize: '0.82rem' }}>{scopeLabel(peer)}</td>
                  <td style={td}>{fmt(peer.last_handshake_at)}</td>
                  <td style={td}>
                    {peer.revoked_at ? (
                      <span style={badgeRed}>{t('wgTunnels.statusRevoked')}</span>
                    ) : peer.server_peer_synced ? (
                      <span style={badgeGreen}>{t('wgTunnels.statusActive')}</span>
                    ) : (
                      <span style={badgeGray}>{t('wgTunnels.statusPending')}</span>
                    )}
                  </td>
                  <td style={td}>
                    {!peer.revoked_at && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button
                          style={{ ...btnAction }}
                          onClick={() => handleDownload(peer)}
                          disabled={downloadingId === peer.id}
                        >
                          {downloadingId === peer.id
                            ? t('wgTunnels.downloading')
                            : t('wgTunnels.downloadConf')}
                        </button>
                        <button
                          style={{ ...btnAction }}
                          onClick={() => setQrPeer(peer)}
                        >
                          {t('wgTunnels.showQr')}
                        </button>
                        <button
                          style={{ ...btnAction, borderColor: '#dc2626', color: '#dc2626' }}
                          onClick={() => setRevokeTarget(peer)}
                        >
                          {t('wgTunnels.revoke')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddPeerModal
          onClose={() => setShowAdd(false)}
          onCreated={res => {
            setShowAdd(false);
            setNewPeerResult(res);
            queryClient.invalidateQueries({ queryKey: ['wg-peers-mine'] });
          }}
        />
      )}
      {newPeerResult && (
        <NewPeerResultModal
          result={newPeerResult}
          onClose={() => setNewPeerResult(null)}
        />
      )}
      {qrPeer && (
        <QrModal
          peer={qrPeer}
          onClose={() => setQrPeer(null)}
        />
      )}
      {revokeTarget && (
        <ConfirmRevoke
          peer={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
          isPending={revokeMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
};
const btnAction: React.CSSProperties = {
  background: 'var(--bg-card)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  padding: '3px 9px', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)',
  borderRadius: 8, overflow: 'hidden', boxShadow: '0 0 0 1px var(--border)',
};
const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: '0.78rem',
  fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-body)',
  borderBottom: '1px solid var(--border)',
};
const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalBox: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem',
  width: 520, maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,.18)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 3, marginTop: 10,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--input-border)',
  borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box',
};
const errStyle: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b',
  padding: '8px 12px', borderRadius: 6, fontSize: '0.83rem', marginBottom: 8,
};
const badgeGreen: React.CSSProperties = {
  background: '#d1fae5', color: '#065f46',
  padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
};
const badgeGray: React.CSSProperties = {
  background: '#f3f4f6', color: '#6b7280',
  padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
};
const badgeRed: React.CSSProperties = {
  background: '#fee2e2', color: '#991b1b',
  padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
};
