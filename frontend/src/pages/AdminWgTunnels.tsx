// =============================================================================
// FireISP 5.0 — Admin WireGuard Tunnels
// =============================================================================
// Admin-only page at /admin/user-tunnels. Provides:
//   • Paginated table of ALL org peers (User | Peer | IP | Endpoint | Handshake | Status)
//   • Revoke any peer (DELETE /wg-peers/admin/:id)
//   • Rotate any peer's keypair (POST /wg-peers/admin/:id/rotate)
//   • Site/NAS assignment editor per user (GET + PUT /wg-peers/admin/assignments/:userId)
//     Opens a modal with checkboxes for available sites and NAS devices,
//     pre-checked with the user's current assignments. Save calls PUT (full replace).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminPeer {
  id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  name: string;
  tunnel_address: string;
  endpoint_host: string | null;
  last_handshake_at: string | null;
  allowed_ips_snapshot: string[] | null;
  server_peer_synced: boolean | number;
  revoked_at: string | null;
  created_at: string;
}

interface AdminPeersResponse {
  data: AdminPeer[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Assignment {
  id: number;
  scope_type: 'site' | 'nas';
  scope_id: number;
}

interface AssignmentsResponse {
  data: Assignment[];
}

interface SiteRow { id: number; name: string; }
interface NasRow { id: number; name: string; }
interface ListResponse<T> { data: T[]; }

interface ScopeEntry { scope_type: 'site' | 'nas'; scope_id: number; }

// ---------------------------------------------------------------------------
// Constants + API helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';
const PAGE_SIZE = 25;

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

async function fetchAllPeers(page: number): Promise<AdminPeersResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  const res = await fetch(`${API_BASE}/wg-peers/admin/all?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load peers');
  return res.json() as Promise<AdminPeersResponse>;
}

async function adminRevokePeer(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/wg-peers/admin/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to revoke peer');
}

async function adminRotatePeer(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/wg-peers/admin/${id}/rotate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to rotate peer'));
  }
}

async function fetchAssignments(userId: number): Promise<AssignmentsResponse> {
  const res = await fetch(`${API_BASE}/wg-peers/admin/assignments/${userId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load assignments');
  return res.json() as Promise<AssignmentsResponse>;
}

async function putAssignments(userId: number, scopes: ScopeEntry[]): Promise<void> {
  const res = await fetch(`${API_BASE}/wg-peers/admin/assignments/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ scopes }),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(await res.json().catch(() => ({})), 'Failed to save assignments'));
  }
}

async function fetchSites(): Promise<ListResponse<SiteRow>> {
  const res = await fetch(`${API_BASE}/sites?limit=500`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load sites');
  return res.json() as Promise<ListResponse<SiteRow>>;
}

async function fetchNasList(): Promise<ListResponse<NasRow>> {
  const res = await fetch(`${API_BASE}/nas?limit=500`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load NAS list');
  return res.json() as Promise<ListResponse<NasRow>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopeKey(e: ScopeEntry): string {
  return `${e.scope_type}:${e.scope_id}`;
}

// ---------------------------------------------------------------------------
// Assignment Editor Modal
// ---------------------------------------------------------------------------

interface AssignmentEditorProps {
  userId: number;
  userName: string;
  onClose: () => void;
}

function AssignmentEditor({ userId, userName, onClose }: AssignmentEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: assignData, isLoading: aLoading, error: aError } = useQuery({
    queryKey: ['wg-assignments', userId],
    queryFn: () => fetchAssignments(userId),
  });
  const { data: siteData, isLoading: sLoading } = useQuery({
    queryKey: ['sites-for-wg'],
    queryFn: fetchSites,
    staleTime: 5 * 60_000,
  });
  const { data: nasData, isLoading: nLoading } = useQuery({
    queryKey: ['nas-for-wg'],
    queryFn: fetchNasList,
    staleTime: 5 * 60_000,
  });

  const sites = siteData?.data ?? [];
  const nasList = nasData?.data ?? [];

  // Build a Set of current assignment keys for fast lookup
  const currentKeys = new Set<string>(
    (assignData?.data ?? []).map(a => scopeKey({ scope_type: a.scope_type, scope_id: a.scope_id })),
  );

  // Local toggle state (starts from current assignments once loaded)
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [err, setErr] = useState('');

  // Once assignments load, initialise local state from server
  const effectiveSelected = selected ?? currentKeys;

  function toggle(entry: ScopeEntry) {
    const key = scopeKey(entry);
    setSelected(prev => {
      const s = new Set(prev ?? currentKeys);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  }

  const mutation = useMutation({
    mutationFn: () => {
      const scopes: ScopeEntry[] = [];
      for (const key of effectiveSelected) {
        const [type, idStr] = key.split(':');
        if ((type === 'site' || type === 'nas') && idStr) {
          scopes.push({ scope_type: type, scope_id: Number(idStr) });
        }
      }
      return putAssignments(userId, scopes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wg-assignments', userId] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const isLoading = aLoading || sLoading || nLoading;

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, width: 580, maxHeight: '85vh' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('adminWgTunnels.assignTitle')}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.83rem', color: '#6b7280' }}>
          {userName}
        </p>

        {isLoading && <p style={{ color: '#888' }}>{t('adminWgTunnels.loadingAssign')}</p>}
        {aError && <p style={{ color: '#e00' }}>{t('adminWgTunnels.assignError')}</p>}
        {err && <div style={errStyle}>{err}</div>}

        {!isLoading && (
          <>
            {/* Sites */}
            <div style={sectionHeader}>{t('adminWgTunnels.sitesSection')}</div>
            {sites.length === 0 && (
              <p style={{ fontSize: '0.83rem', color: '#9ca3af', margin: '4px 0 12px' }}>
                {t('adminWgTunnels.noSites')}
              </p>
            )}
            <div style={checkGrid}>
              {sites.map(site => {
                const entry: ScopeEntry = { scope_type: 'site', scope_id: site.id };
                const key = scopeKey(entry);
                return (
                  <label key={key} style={checkLabel}>
                    <input
                      type="checkbox"
                      checked={effectiveSelected.has(key)}
                      onChange={() => toggle(entry)}
                      style={{ marginRight: 6 }}
                    />
                    <span style={{ fontSize: '0.83rem' }}>{site.name}</span>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af', marginLeft: 4 }}>
                      #{site.id}
                    </span>
                  </label>
                );
              })}
            </div>

            {/* NAS */}
            <div style={{ ...sectionHeader, marginTop: 12 }}>{t('adminWgTunnels.nasSection')}</div>
            {nasList.length === 0 && (
              <p style={{ fontSize: '0.83rem', color: '#9ca3af', margin: '4px 0 12px' }}>
                {t('adminWgTunnels.noNas')}
              </p>
            )}
            <div style={checkGrid}>
              {nasList.map(nas => {
                const entry: ScopeEntry = { scope_type: 'nas', scope_id: nas.id };
                const key = scopeKey(entry);
                return (
                  <label key={key} style={checkLabel}>
                    <input
                      type="checkbox"
                      checked={effectiveSelected.has(key)}
                      onChange={() => toggle(entry)}
                      style={{ marginRight: 6 }}
                    />
                    <span style={{ fontSize: '0.83rem' }}>{nas.name}</span>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af', marginLeft: 4 }}>
                      #{nas.id}
                    </span>
                  </label>
                );
              })}
            </div>

            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 10 }}>
              {t('adminWgTunnels.assignNote')}
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </button>
          <button
            style={btnPrimary}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || isLoading}
          >
            {mutation.isPending ? t('adminWgTunnels.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm Revoke / Rotate Dialog
// ---------------------------------------------------------------------------

type ActionKind = 'revoke' | 'rotate';

interface ConfirmActionProps {
  peer: AdminPeer;
  kind: ActionKind;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function ConfirmAction({ peer, kind, onClose, onConfirm, isPending }: ConfirmActionProps) {
  const { t } = useTranslation();
  const isRevoke = kind === 'revoke';
  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxWidth: 420 }}>
        <h3 style={{
          margin: '0 0 0.75rem',
          color: isRevoke ? '#991b1b' : '#1e40af',
        }}>
          {isRevoke ? t('adminWgTunnels.revokeTitle') : t('adminWgTunnels.rotateTitle')}
        </h3>
        <p style={{ fontSize: '0.88rem', color: '#555', lineHeight: 1.5 }}>
          {isRevoke
            ? t('adminWgTunnels.revokeConfirm', { name: peer.name, user: peer.user_email ?? String(peer.user_id) })
            : t('adminWgTunnels.rotateConfirm', { name: peer.name })
          }
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button style={btnSecondary} onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </button>
          <button
            style={{ ...btnPrimary, background: isRevoke ? '#dc2626' : '#1d4ed8' }}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending
              ? (isRevoke ? t('adminWgTunnels.revoking') : t('adminWgTunnels.rotating'))
              : (isRevoke ? t('adminWgTunnels.revoke') : t('adminWgTunnels.rotate'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AdminWgTunnels() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [actionPeer, setActionPeer] = useState<{ peer: AdminPeer; kind: ActionKind } | null>(null);
  const [assignUser, setAssignUser] = useState<{ userId: number; userName: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['wg-peers-admin', page],
    queryFn: () => fetchAllPeers(page),
  });

  const peers = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  const revokeMutation = useMutation({
    mutationFn: (id: number) => adminRevokePeer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wg-peers-admin'] });
      setActionPeer(null);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (id: number) => adminRotatePeer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wg-peers-admin'] });
      setActionPeer(null);
    },
  });

  function handleConfirm() {
    if (!actionPeer) return;
    if (actionPeer.kind === 'revoke') {
      revokeMutation.mutate(actionPeer.peer.id);
    } else {
      rotateMutation.mutate(actionPeer.peer.id);
    }
  }

  const isPending = revokeMutation.isPending || rotateMutation.isPending;

  function userLabel(peer: AdminPeer): string {
    if (peer.user_name) return peer.user_name;
    if (peer.user_email) return peer.user_email;
    return `#${peer.user_id}`;
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{t('adminWgTunnels.title')}</h1>
        <span style={{ fontSize: '0.83rem', color: '#6b7280' }}>
          {meta && t('adminWgTunnels.totalPeers', { count: meta.total })}
        </span>
      </div>

      <div style={{
        background: '#fefce8', border: '1px solid #fde68a',
        borderRadius: 6, padding: '8px 12px', marginBottom: '1rem',
        fontSize: '0.8rem', color: '#92400e', lineHeight: 1.5,
      }}>
        {t('adminWgTunnels.banner')}
      </div>

      {isLoading && <p style={{ color: '#888' }}>{t('adminWgTunnels.loading')}</p>}
      {error && <p style={{ color: '#e00' }}>{t('adminWgTunnels.error')}</p>}

      {!isLoading && !error && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>{t('adminWgTunnels.table.user')}</th>
                  <th style={th}>{t('adminWgTunnels.table.peer')}</th>
                  <th style={th}>{t('adminWgTunnels.table.tunnelIp')}</th>
                  <th style={th}>{t('adminWgTunnels.table.endpoint')}</th>
                  <th style={th}>{t('adminWgTunnels.table.lastHandshake')}</th>
                  <th style={th}>{t('adminWgTunnels.table.status')}</th>
                  <th style={th}>{t('adminWgTunnels.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {peers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#888', padding: '2rem' }}>
                      {t('adminWgTunnels.noPeers')}
                    </td>
                  </tr>
                )}
                {peers.map(peer => (
                  <tr key={peer.id} style={{ opacity: peer.revoked_at ? 0.55 : 1 }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>{userLabel(peer)}</div>
                      {peer.user_email && peer.user_name && (
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{peer.user_email}</div>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{peer.name}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.81rem' }}>
                      {peer.tunnel_address}
                    </td>
                    <td style={{ ...td, fontSize: '0.81rem', color: '#6b7280' }}>
                      {peer.endpoint_host || '—'}
                    </td>
                    <td style={td}>{fmt(peer.last_handshake_at)}</td>
                    <td style={td}>
                      {peer.revoked_at ? (
                        <span style={badgeRed}>{t('adminWgTunnels.statusRevoked')}</span>
                      ) : peer.server_peer_synced ? (
                        <span style={badgeGreen}>{t('adminWgTunnels.statusActive')}</span>
                      ) : (
                        <span style={badgeGray}>{t('adminWgTunnels.statusPending')}</span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {!peer.revoked_at && (
                          <>
                            <button
                              style={{ ...btnAction, borderColor: '#dc2626', color: '#dc2626' }}
                              onClick={() => setActionPeer({ peer, kind: 'revoke' })}
                            >
                              {t('adminWgTunnels.revoke')}
                            </button>
                            <button
                              style={{ ...btnAction }}
                              onClick={() => setActionPeer({ peer, kind: 'rotate' })}
                            >
                              {t('adminWgTunnels.rotate')}
                            </button>
                          </>
                        )}
                        <button
                          style={{ ...btnAction, borderColor: '#6366f1', color: '#4f46e5' }}
                          onClick={() => setAssignUser({
                            userId: peer.user_id,
                            userName: userLabel(peer),
                          })}
                        >
                          {t('adminWgTunnels.manageScope')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '1rem' }}>
              <button
                style={btnSecondary}
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                {t('clientList.prevPage')}
              </button>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                {t('clientList.pageInfo', { page, total: totalPages })}
                {meta && ` (${meta.total} ${t('adminWgTunnels.peers')})`}
              </span>
              <button
                style={btnSecondary}
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                {t('clientList.nextPage')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {actionPeer && (
        <ConfirmAction
          peer={actionPeer.peer}
          kind={actionPeer.kind}
          onClose={() => setActionPeer(null)}
          onConfirm={handleConfirm}
          isPending={isPending}
        />
      )}
      {assignUser && (
        <AssignmentEditor
          userId={assignUser.userId}
          userName={assignUser.userName}
          onClose={() => setAssignUser(null)}
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
const sectionHeader: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 700, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '1px solid #e5e7eb', paddingBottom: 4, marginBottom: 8,
};
const checkGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginBottom: 8,
};
const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', cursor: 'pointer',
  padding: '3px 4px', borderRadius: 4,
};
