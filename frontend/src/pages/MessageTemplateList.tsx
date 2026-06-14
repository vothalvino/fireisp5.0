// =============================================================================
// FireISP 5.0 — Message Template Management
// =============================================================================
// Standalone page at /message-templates (promoted out of the Settings page).
// Lists notification templates (email / SMS / WhatsApp) with a channel filter,
// a paginated table, a "New Template" create modal plus per-row Edit and Delete
// (soft-delete). All mutations go through the typed `api` client + React Query,
// invalidating the ['message-templates'] query so the list refreshes.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageTemplate {
  id: number;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string | null;
}

interface MessageTemplatesResponse {
  data: MessageTemplate[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface MessageTemplateBody {
  name: string;
  channel: string;
  subject?: string;
  body: string;
  variables?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
// Channels accepted by both the API validation schema and the database enum.
const CHANNELS = ['email', 'sms', 'whatsapp', 'push'];
const CHANNEL_FILTER_OPTIONS = ['', ...CHANNELS];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchTemplates(page: number, channelFilter: string): Promise<MessageTemplatesResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (channelFilter) query.channel = channelFilter;
  const res = await api.GET('/message-templates', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load message templates');
  return res.data as unknown as MessageTemplatesResponse;
}

async function createTemplate(body: MessageTemplateBody): Promise<void> {
  const res = await api.POST('/message-templates', { body: body as never });
  if (res.error) throw new Error('Failed to create template');
}

async function updateTemplate(id: number, body: Partial<MessageTemplateBody>): Promise<void> {
  const res = await api.PUT('/message-templates/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update template');
}

async function deleteTemplate(id: number): Promise<void> {
  const res = await api.DELETE('/message-templates/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete template');
}

// ---------------------------------------------------------------------------
// Channel badge
// ---------------------------------------------------------------------------

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    email: { bg: '#dbeafe', color: '#1e40af' },
    sms: { bg: '#d1fae5', color: '#065f46' },
    whatsapp: { bg: '#dcfce7', color: '#166534' },
    push: { bg: '#f3e8ff', color: '#6b21a8' },
  };
  const s = map[channel] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {channel}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Template form modal (create + edit)
// ---------------------------------------------------------------------------

interface TemplateModalProps {
  template: MessageTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateModal({ template, onClose, onSaved }: TemplateModalProps) {
  const isEdit = template !== null;
  const [form, setForm] = useState({
    name: template?.name ?? '',
    channel: template?.channel ?? 'email',
    subject: template?.subject ?? '',
    body: template?.body ?? '',
    variables: template?.variables ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: MessageTemplateBody = {
        name: form.name.trim(),
        channel: form.channel,
        body: form.body,
      };
      if (form.subject) body.subject = form.subject;
      if (form.variables) body.variables = form.variables;
      return isEdit ? updateTemplate(template.id, body) : createTemplate(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save template. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.body.trim()) {
      setError('Body is required.');
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
        aria-label={isEdit ? `Edit template ${template.name}` : 'New template'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Template #${template.id}` : '✉️ New Template'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={200}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder='e.g. "invoice_reminder", "welcome_email"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Channel <RequiredMark />
            <select
              style={modalStyles.select}
              value={form.channel}
              onChange={e => setField('channel', e.target.value)}
            >
              {CHANNELS.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Subject
            <input
              style={modalStyles.input}
              type="text"
              maxLength={500}
              value={form.subject}
              onChange={e => setField('subject', e.target.value)}
              placeholder="Email subject (leave blank for SMS / WhatsApp)"
            />
          </label>

          <label style={modalStyles.label}>
            Body <RequiredMark /> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(use {'{{variable}}'} placeholders)</span>
            <textarea
              style={{ ...modalStyles.input, minHeight: 140, resize: 'vertical' }}
              value={form.body}
              onChange={e => setField('body', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Variables (comma-separated list)
            <input
              style={modalStyles.input}
              type="text"
              maxLength={2000}
              value={form.variables}
              onChange={e => setField('variables', e.target.value)}
              placeholder="e.g. client_name, invoice_total"
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
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
// MessageTemplateList component
// ---------------------------------------------------------------------------

export function MessageTemplateList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const templatesQ = useQuery({
    queryKey: ['message-templates', page, channelFilter],
    queryFn: () => fetchTemplates(page, channelFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['message-templates'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['message-templates'] });
  }

  function handleFilterChange(value: string) {
    setChannelFilter(value);
    setPage(1);
  }

  const templates = templatesQ.data?.data ?? [];
  const meta = templatesQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>✉️ Message Templates</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Template
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Channel:</label>
        <select
          style={styles.filterSelect}
          value={channelFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {CHANNEL_FILTER_OPTIONS.map(c => (
            <option key={c} value={c}>{c ? capitalize(c) : 'All'}</option>
          ))}
        </select>
        {channelFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {templatesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : templatesQ.error ? (
          <p style={styles.msgError}>Failed to load message templates.</p>
        ) : templates.length === 0 ? (
          <p style={styles.msg}>No templates found{channelFilter ? ` for channel "${channelFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Channel', 'Subject', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{t.name}</td>
                      <td style={styles.td}><ChannelBadge channel={t.channel} /></td>
                      <td style={{ ...styles.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.subject || '—'}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditTemplate(t)} title="Edit this template">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(t.id)}
                          title="Delete this template"
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
        <TemplateModal template={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editTemplate && (
        <TemplateModal template={editTemplate} onClose={() => setEditTemplate(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this template? It will be soft-deleted and removed from the list."
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
