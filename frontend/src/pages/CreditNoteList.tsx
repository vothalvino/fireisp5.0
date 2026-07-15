// =============================================================================
// FireISP 5.0 — Credit Note Management
// =============================================================================
// Standalone page at /credit-notes. Lists credit notes with:
//   • Status filter
//   • Paginated table (number, client, reason, total, status)
//   • "New Credit Note" create modal, per-row Edit and Delete (soft-delete).
// All mutations go through the typed `api` client + React Query.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  styles,
  modalStyles,
  RequiredMark,
  fmtMoney,
  capitalize,
} from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditNote {
  id: number;
  client_id: number;
  invoice_id: number | null;
  credit_note_number: string | null;
  reason: string | null;
  subtotal: string | number | null;
  tax_rate: string | number | null;
  tax_amount: string | number | null;
  total: string | number | null;
  currency: string | null;
  notes: string | null;
  status: string;
  issue_date?: string | null;
}

interface CreditNotesResponse {
  data: CreditNote[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Client {
  id: number;
  name: string;
}

interface CreditNoteBody {
  client_id: number;
  invoice_id?: number;
  credit_note_number?: string;
  reason?: string;
  subtotal?: number;
  tax_rate?: number;
  tax_amount?: number;
  total?: number;
  notes?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const STATUSES = ['draft', 'issued', 'applied', 'cancelled'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];
const REASONS = [
  'billing_error',
  'service_interruption',
  'overpayment',
  'promotional_credit',
  'contract_cancellation',
  'other',
];

export function reasonLabel(reason: string): string {
  return reason.split('_').map(capitalize).join(' ');
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchCreditNotes(page: number, statusFilter: string): Promise<CreditNotesResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/credit-notes', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load credit notes');
  return res.data as unknown as CreditNotesResponse;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', { params: { query: { limit: 500 } as never } });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function createCreditNote(body: CreditNoteBody): Promise<void> {
  const res = await api.POST('/credit-notes', { body: body as never });
  if (res.error) throw new Error('Failed to create credit note');
}

async function updateCreditNote(id: number, body: Partial<CreditNoteBody>): Promise<void> {
  const res = await api.PUT('/credit-notes/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (res.error) throw new Error('Failed to update credit note');
}

async function deleteCreditNote(id: number): Promise<void> {
  const res = await api.DELETE('/credit-notes/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete credit note');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#374151' },
    issued:    { bg: '#dbeafe', color: '#1e40af' },
    applied:   { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Credit note form modal (create + edit)
// ---------------------------------------------------------------------------

interface CreditNoteModalProps {
  creditNote: CreditNote | null;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
  /** Pin the credit note to one client (e.g. opened from that client's page):
   *  pre-selects the client and disables the selector on create. */
  lockedClientId?: number;
}

export function CreditNoteModal({ creditNote, clients, onClose, onSaved, lockedClientId }: CreditNoteModalProps) {
  const isEdit = creditNote !== null;
  const [form, setForm] = useState({
    client_id: creditNote?.client_id != null
      ? String(creditNote.client_id)
      : lockedClientId != null ? String(lockedClientId) : '',
    invoice_id: creditNote?.invoice_id != null ? String(creditNote.invoice_id) : '',
    credit_note_number: creditNote?.credit_note_number ?? '',
    reason: creditNote?.reason ?? 'billing_error',
    subtotal: creditNote?.subtotal != null ? String(creditNote.subtotal) : '',
    tax_rate: creditNote?.tax_rate != null ? String(creditNote.tax_rate) : '',
    tax_amount: creditNote?.tax_amount != null ? String(creditNote.tax_amount) : '',
    total: creditNote?.total != null ? String(creditNote.total) : '',
    notes: creditNote?.notes ?? '',
    status: creditNote?.status ?? 'draft',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      // client_id is immutable on the update schema; only include it on create.
      const common: Partial<CreditNoteBody> = {
        reason: form.reason,
        status: form.status,
      };
      if (form.invoice_id) common.invoice_id = Number(form.invoice_id);
      if (form.credit_note_number) common.credit_note_number = form.credit_note_number;
      if (form.subtotal) common.subtotal = Number(form.subtotal);
      if (form.tax_rate) common.tax_rate = Number(form.tax_rate);
      if (form.tax_amount) common.tax_amount = Number(form.tax_amount);
      if (form.total) common.total = Number(form.total);
      if (form.notes) common.notes = form.notes;
      if (isEdit) {
        return updateCreditNote(creditNote.id, common);
      }
      return createCreditNote({ ...common, client_id: Number(form.client_id) } as CreditNoteBody);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save credit note. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEdit && !form.client_id) {
      setError('Client is required.');
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
        aria-label={isEdit ? `Edit credit note ${creditNote.credit_note_number ?? creditNote.id}` : 'New credit note'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Credit Note #${creditNote.id}` : '🧾 New Credit Note'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Client <RequiredMark />
            <select style={modalStyles.select} value={form.client_id} onChange={e => setField('client_id', e.target.value)} required disabled={isEdit || lockedClientId != null}>
              <option value="">— select client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Invoice ID (optional)
            <input style={modalStyles.input} type="number" min={1} value={form.invoice_id} onChange={e => setField('invoice_id', e.target.value)} placeholder="link to an invoice" />
          </label>

          <label style={modalStyles.label}>
            Credit Note Number
            <input style={modalStyles.input} type="text" maxLength={50} value={form.credit_note_number} onChange={e => setField('credit_note_number', e.target.value)} placeholder="auto-generated if blank" />
          </label>

          <label style={modalStyles.label}>
            Reason
            <select style={modalStyles.select} value={form.reason} onChange={e => setField('reason', e.target.value)}>
              {REASONS.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Subtotal
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.subtotal} onChange={e => setField('subtotal', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Tax Rate (0–1, e.g. 0.16)
            <input style={modalStyles.input} type="number" min={0} max={1} step="0.0001" value={form.tax_rate} onChange={e => setField('tax_rate', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Tax Amount
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.tax_amount} onChange={e => setField('tax_amount', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Total
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.total} onChange={e => setField('total', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Notes
            <input style={modalStyles.input} type="text" maxLength={5000} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Status
            <select style={modalStyles.select} value={form.status} onChange={e => setField('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Credit Note'}
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
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()} role="alertdialog" aria-label="Confirm action">
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
// CreditNoteList component
// ---------------------------------------------------------------------------

export function CreditNoteList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editNote, setEditNote] = useState<CreditNote | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const notesQ = useQuery({
    queryKey: ['credit-notes', page, statusFilter],
    queryFn: () => fetchCreditNotes(page, statusFilter),
  });

  const clientsQ = useQuery({
    queryKey: ['clients-lookup'],
    queryFn: fetchClients,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCreditNote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credit-notes'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const notes = notesQ.data?.data ?? [];
  const meta = notesQ.data?.meta;
  const clients = clientsQ.data ?? [];
  const clientName = (id: number) => clients.find(c => c.id === id)?.name ?? `#${id}`;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧾 Credit Notes</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Credit Note
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => handleFilterChange(e.target.value)}>
          {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{s ? capitalize(s) : 'All'}</option>)}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>Clear filter</button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>Action failed. Please try again.</p>
      )}

      <div style={styles.tableCard}>
        {notesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : notesQ.error ? (
          <p style={styles.msgError}>Failed to load credit notes.</p>
        ) : notes.length === 0 ? (
          <p style={styles.msg}>No credit notes found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Number', 'Client', 'Reason', 'Total', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {notes.map(n => (
                    <tr key={n.id} style={styles.tr}>
                      <td style={styles.td}>#{n.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{n.credit_note_number || '—'}</td>
                      <td style={styles.td}>
                        <Link to={`/clients/${n.client_id}`} style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 500 }}>
                          {clientName(n.client_id)}
                        </Link>
                      </td>
                      <td style={styles.td}>{n.reason ? reasonLabel(n.reason) : '—'}</td>
                      <td style={styles.td}>{fmtMoney(n.total, n.currency ?? 'USD')}</td>
                      <td style={styles.td}><StatusBadge status={n.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditNote(n)} title="Edit this credit note">✏️ Edit</button>
                        <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setDeleteId(n.id)} title="Delete this credit note">🗑 Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
                <span style={styles.pageInfo}>Page {page} of {meta.totalPages}</span>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <CreditNoteModal creditNote={null} clients={clients} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}

      {editNote && (
        <CreditNoteModal creditNote={editNote} clients={clients} onClose={() => setEditNote(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this credit note? It will be soft-deleted and removed from the list."
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
