// =============================================================================
// FireISP 5.0 — API Token Management
// =============================================================================
// Standalone page at /api-tokens. Lists personal/organization API tokens with a
// "New Token" create modal (the plaintext token is shown exactly once on
// creation) plus per-row Delete (revoke). All mutations go through the typed
// `api` client + React Query, invalidating the ['api-tokens'] query.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiTokenItem {
  id: number;
  name: string;
  scopes: string[] | string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface TokensResponse {
  data: ApiTokenItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface CreateTokenBody {
  name: string;
  scopes?: string[];
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopesToString(scopes: string[] | string | null): string {
  if (Array.isArray(scopes)) return scopes.length ? scopes.join(', ') : 'All scopes';
  if (typeof scopes === 'string' && scopes) {
    try {
      const parsed = JSON.parse(scopes);
      if (Array.isArray(parsed)) return parsed.length ? parsed.join(', ') : 'All scopes';
    } catch {
      return scopes;
    }
  }
  return 'All scopes';
}

function tokenStatus(t: ApiTokenItem): { label: string; bg: string; color: string } {
  if (t.revoked_at) return { label: 'Revoked', bg: '#fee2e2', color: '#991b1b' };
  if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) {
    return { label: 'Expired', bg: '#fef3c7', color: '#92400e' };
  }
  return { label: 'Active', bg: '#d1fae5', color: '#065f46' };
}

async function fetchTokens(page: number): Promise<TokensResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/api-tokens', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load API tokens');
  return res.data as unknown as TokensResponse;
}

async function createToken(body: CreateTokenBody): Promise<string> {
  const res = await api.POST('/api-tokens', { body: body as never });
  if (res.error) throw new Error('Failed to create API token');
  return (res.data as unknown as { data: { token: string } }).data.token;
}

async function deleteToken(id: number): Promise<void> {
  const res = await api.DELETE('/api-tokens/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete API token');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ token }: { token: ApiTokenItem }) {
  const s = tokenStatus(token);
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Token created result dialog (shows plaintext token once)
// ---------------------------------------------------------------------------

function TokenResultDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="API token created"
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>🔑 Token Created</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '0 0 0.5rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Copy this token now — it will not be shown again.
          </p>
          <code
            style={{
              display: 'block',
              padding: '0.75rem',
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: 6,
              fontSize: '0.8rem',
              overflowWrap: 'anywhere',
              color: 'var(--text-primary)',
            }}
          >
            {token}
          </code>
          <div style={{ ...modalStyles.actions, marginTop: '1rem' }}>
            <button type="button" style={styles.btnSecondary} onClick={copy}>
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button type="button" style={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token create modal
// ---------------------------------------------------------------------------

interface TokenModalProps {
  onClose: () => void;
  onCreated: (token: string) => void;
}

function TokenModal({ onClose, onCreated }: TokenModalProps) {
  const [form, setForm] = useState({ name: '', scopes: '', expires_at: '' });
  const [error, setError] = useState('');

  function setField(name: string, value: string) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreateTokenBody = { name: form.name.trim() };
      const scopes = form.scopes
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (scopes.length) body.scopes = scopes;
      if (form.expires_at) body.expires_at = form.expires_at;
      return createToken(body);
    },
    onSuccess: token => {
      onCreated(token);
      onClose();
    },
    onError: () => setError('Failed to create token. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New API token"
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>🔑 New API Token</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder='e.g. "Grafana read-only"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Scopes (comma or space separated; blank = all scopes)
            <input
              style={modalStyles.input}
              type="text"
              value={form.scopes}
              onChange={e => setField('scopes', e.target.value)}
              placeholder="clients.read, invoices.read"
            />
          </label>

          <label style={modalStyles.label}>
            Expires at
            <input
              style={modalStyles.input}
              type="date"
              value={form.expires_at}
              onChange={e => setField('expires_at', e.target.value)}
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create Token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiTokenList component
// ---------------------------------------------------------------------------

export function ApiTokenList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const tokensQ = useQuery({
    queryKey: ['api-tokens', page],
    queryFn: () => fetchTokens(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
  }

  const tokens = tokensQ.data?.data ?? [];
  const meta = tokensQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🔑 API Tokens</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Token
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {tokensQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : tokensQ.error ? (
          <p style={styles.msgError}>Failed to load API tokens.</p>
        ) : tokens.length === 0 ? (
          <p style={styles.msg}>No API tokens found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Scopes', 'Last Used', 'Expires', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tokens.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{t.name}</td>
                      <td style={{ ...styles.td, maxWidth: 260, overflowWrap: 'anywhere' }}>{scopesToString(t.scopes)}</td>
                      <td style={styles.td}>{t.last_used_at ? fmtDate(t.last_used_at) : 'Never'}</td>
                      <td style={styles.td}>{t.expires_at ? fmtDate(t.expires_at) : 'Never'}</td>
                      <td style={styles.td}><StatusBadge token={t} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(t.id)}
                          title="Revoke this token"
                        >
                          🗑 Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <TokenModal onClose={() => setShowNew(false)} onCreated={token => { setNewToken(token); invalidate(); }} />
      )}
      {newToken && (
        <TokenResultDialog token={newToken} onClose={() => setNewToken(null)} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Revoke this API token? Any client using it will immediately lose access."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
