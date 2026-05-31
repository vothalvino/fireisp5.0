// =============================================================================
// FireISP 5.0 — Webhook Management
// =============================================================================
// Standalone page at /webhooks. Lists outbound webhook subscriptions with a
// "New Webhook" create modal plus per-row Edit and Delete (soft-delete). All
// mutations go through the typed `api` client + React Query, invalidating the
// ['webhooks'] query so the list refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Webhook {
  id: number;
  url: string;
  events: string | string[];
  is_enabled?: number | boolean;
  is_active?: number | boolean;
  max_retries: number;
  timeout_seconds: number;
}

interface WebhooksResponse {
  data: Webhook[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface WebhookBody {
  url: string;
  events: string;
  secret?: string;
  max_retries?: number;
  timeout_seconds?: number;
  is_enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventsToString(events: string | string[]): string {
  if (Array.isArray(events)) return events.join(', ');
  return events ?? '';
}

function isEnabled(w: Webhook): boolean {
  return Boolean(w.is_enabled ?? w.is_active);
}

async function fetchWebhooks(page: number): Promise<WebhooksResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/webhooks', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load webhooks');
  return res.data as unknown as WebhooksResponse;
}

async function createWebhook(body: WebhookBody): Promise<void> {
  const res = await api.POST('/webhooks', { body: body as never });
  if (res.error) throw new Error('Failed to create webhook');
}

async function updateWebhook(id: number, body: Partial<WebhookBody>): Promise<void> {
  const res = await api.PUT('/webhooks/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update webhook');
}

async function deleteWebhook(id: number): Promise<void> {
  const res = await api.DELETE('/webhooks/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete webhook');
}

// ---------------------------------------------------------------------------
// Enabled badge
// ---------------------------------------------------------------------------

function EnabledBadge({ enabled }: { enabled: boolean }) {
  const s = enabled
    ? { bg: '#d1fae5', color: '#065f46', label: 'Enabled' }
    : { bg: '#fee2e2', color: '#991b1b', label: 'Disabled' };
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
// Webhook form modal (create + edit)
// ---------------------------------------------------------------------------

interface WebhookModalProps {
  webhook: Webhook | null;
  onClose: () => void;
  onSaved: () => void;
}

function WebhookModal({ webhook, onClose, onSaved }: WebhookModalProps) {
  const isEdit = webhook !== null;
  const [form, setForm] = useState({
    url: webhook?.url ?? '',
    events: webhook ? eventsToString(webhook.events) : '',
    secret: '',
    max_retries: webhook?.max_retries != null ? String(webhook.max_retries) : '5',
    timeout_seconds: webhook?.timeout_seconds != null ? String(webhook.timeout_seconds) : '30',
    is_enabled: webhook ? isEnabled(webhook) : true,
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: WebhookBody = {
        url: form.url.trim(),
        events: form.events.trim(),
        is_enabled: form.is_enabled,
      };
      if (form.secret) body.secret = form.secret;
      if (form.max_retries) body.max_retries = Number(form.max_retries);
      if (form.timeout_seconds) body.timeout_seconds = Number(form.timeout_seconds);
      return isEdit ? updateWebhook(webhook.id, body) : createWebhook(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save webhook. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim()) {
      setError('URL is required.');
      return;
    }
    if (!form.events.trim()) {
      setError('At least one event is required.');
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
        aria-label={isEdit ? `Edit webhook ${webhook.url}` : 'New webhook'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Webhook #${webhook.id}` : '🔗 New Webhook'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Target URL <RequiredMark />
            <input
              style={modalStyles.input}
              type="url"
              maxLength={2000}
              value={form.url}
              onChange={e => setField('url', e.target.value)}
              placeholder="https://example.com/hooks/fireisp"
              required
            />
          </label>

          <label style={modalStyles.label}>
            Events (comma-separated) <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={2000}
              value={form.events}
              onChange={e => setField('events', e.target.value)}
              placeholder="invoice.created, payment.received"
              required
            />
          </label>

          <label style={modalStyles.label}>
            Signing secret {isEdit && '(leave blank to keep current)'}
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.secret}
              onChange={e => setField('secret', e.target.value)}
              placeholder="HMAC signing secret"
            />
          </label>

          <label style={modalStyles.label}>
            Max retries
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              max={10}
              value={form.max_retries}
              onChange={e => setField('max_retries', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Timeout (seconds)
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              max={60}
              value={form.timeout_seconds}
              onChange={e => setField('timeout_seconds', e.target.value)}
            />
          </label>

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={e => setField('is_enabled', e.target.checked)}
            />
            Enabled
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Webhook'}
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
// WebhookList component
// ---------------------------------------------------------------------------

export function WebhookList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [editWebhook, setEditWebhook] = useState<Webhook | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const webhooksQ = useQuery({
    queryKey: ['webhooks', page],
    queryFn: () => fetchWebhooks(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteWebhook(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  }

  const webhooks = webhooksQ.data?.data ?? [];
  const meta = webhooksQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🔗 Webhooks</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Webhook
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {webhooksQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : webhooksQ.error ? (
          <p style={styles.msgError}>Failed to load webhooks.</p>
        ) : webhooks.length === 0 ? (
          <p style={styles.msg}>No webhooks found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'URL', 'Events', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map(w => (
                    <tr key={w.id} style={styles.tr}>
                      <td style={styles.td}>#{w.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500, maxWidth: 280, overflowWrap: 'anywhere' }}>{w.url}</td>
                      <td style={styles.td}>{eventsToString(w.events)}</td>
                      <td style={styles.td}><EnabledBadge enabled={isEnabled(w)} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditWebhook(w)} title="Edit this webhook">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(w.id)}
                          title="Delete this webhook"
                        >
                          🗑 Delete
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
        <WebhookModal webhook={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editWebhook && (
        <WebhookModal webhook={editWebhook} onClose={() => setEditWebhook(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this webhook? It will be soft-deleted and stop receiving events."
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
