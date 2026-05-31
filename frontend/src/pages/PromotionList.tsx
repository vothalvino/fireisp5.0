// =============================================================================
// FireISP 5.0 — Promotion Management
// =============================================================================
// Standalone page at /promotions. Lists promotions/coupons with a type filter,
// paginated table, and "New Promotion" create modal plus per-row Edit and
// Delete (soft-delete). All mutations go through the typed `api` client +
// React Query, invalidating the ['promotions'] query so the list refreshes.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Promotion {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  discount_type: string;
  discount_value: number | string;
  promotion_type: string;
  applies_to: string;
  max_uses: number | null;
  max_uses_per_client: number | null;
  min_order_value: number | string | null;
  duration_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: number | boolean;
}

interface PromotionResponse {
  data: Promotion[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PromotionBody {
  name: string;
  code?: string;
  description?: string;
  discount_type: string;
  discount_value: number;
  promotion_type?: string;
  applies_to?: string;
  max_uses?: number;
  max_uses_per_client?: number;
  min_order_value?: number;
  duration_months?: number;
  starts_at?: string;
  ends_at?: string;
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const DISCOUNT_TYPES = ['percentage', 'fixed_amount'];
const PROMOTION_TYPES = ['coupon', 'promotional', 'referral'];
const APPLIES_TO = ['contract', 'invoice', 'plan'];
const TYPE_FILTER_OPTIONS = ['', ...PROMOTION_TYPES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchPromotions(page: number, typeFilter: string): Promise<PromotionResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (typeFilter) query.promotion_type = typeFilter;
  const res = await api.GET('/promotions', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load promotions');
  return res.data as unknown as PromotionResponse;
}

async function createPromotion(body: PromotionBody): Promise<void> {
  const res = await api.POST('/promotions', { body: body as never });
  if (res.error) throw new Error('Failed to create promotion');
}

async function updatePromotion(id: number, body: Partial<PromotionBody>): Promise<void> {
  const res = await api.PUT('/promotions/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update promotion');
}

async function deletePromotion(id: number): Promise<void> {
  const res = await api.DELETE('/promotions/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete promotion');
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        background: active ? '#d1fae5' : '#f3f4f6',
        color: active ? '#065f46' : '#374151',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
      }}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function formatDiscount(p: Promotion): string {
  const v = Number(p.discount_value);
  return p.discount_type === 'percentage' ? `${v}%` : `$${v.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Promotion form modal (create + edit)
// ---------------------------------------------------------------------------

interface PromotionModalProps {
  promotion: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}

function PromotionModal({ promotion, onClose, onSaved }: PromotionModalProps) {
  const isEdit = promotion !== null;
  const [form, setForm] = useState({
    name: promotion?.name ?? '',
    code: promotion?.code ?? '',
    description: promotion?.description ?? '',
    discount_type: promotion?.discount_type ?? 'percentage',
    discount_value: promotion?.discount_value != null ? String(promotion.discount_value) : '',
    promotion_type: promotion?.promotion_type ?? 'coupon',
    applies_to: promotion?.applies_to ?? 'invoice',
    max_uses: promotion?.max_uses != null ? String(promotion.max_uses) : '',
    max_uses_per_client: promotion?.max_uses_per_client != null ? String(promotion.max_uses_per_client) : '',
    min_order_value: promotion?.min_order_value != null ? String(promotion.min_order_value) : '',
    duration_months: promotion?.duration_months != null ? String(promotion.duration_months) : '',
    starts_at: promotion?.starts_at ? promotion.starts_at.slice(0, 10) : '',
    ends_at: promotion?.ends_at ? promotion.ends_at.slice(0, 10) : '',
    is_active: promotion ? Boolean(promotion.is_active) : true,
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: PromotionBody = {
        name: form.name.trim(),
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        promotion_type: form.promotion_type,
        applies_to: form.applies_to,
        is_active: form.is_active,
      };
      if (form.code.trim()) body.code = form.code.trim();
      if (form.description.trim()) body.description = form.description.trim();
      if (form.max_uses) body.max_uses = Number(form.max_uses);
      if (form.max_uses_per_client) body.max_uses_per_client = Number(form.max_uses_per_client);
      if (form.min_order_value) body.min_order_value = Number(form.min_order_value);
      if (form.duration_months) body.duration_months = Number(form.duration_months);
      if (form.starts_at) body.starts_at = form.starts_at;
      if (form.ends_at) body.ends_at = form.ends_at;
      return isEdit ? updatePromotion(promotion.id, body) : createPromotion(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save promotion. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.discount_value || Number(form.discount_value) <= 0) {
      setError('Discount value must be greater than zero.');
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
        aria-label={isEdit ? `Edit promotion ${promotion.name}` : 'New promotion'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Promotion #${promotion.id}` : '🏷️ New Promotion'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={150}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder='e.g. "Summer 2026 – 20% off"'
              required
            />
          </label>

          <label style={modalStyles.label}>
            Coupon code
            <input
              style={modalStyles.input}
              type="text"
              maxLength={50}
              value={form.code}
              onChange={e => setField('code', e.target.value)}
              placeholder="e.g. SUMMER20 (leave blank for auto-applied)"
            />
          </label>

          <label style={modalStyles.label}>
            Description
            <input
              style={modalStyles.input}
              type="text"
              maxLength={5000}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Discount type
            <select
              style={modalStyles.select}
              value={form.discount_type}
              onChange={e => setField('discount_type', e.target.value)}
            >
              {DISCOUNT_TYPES.map(d => <option key={d} value={d}>{capitalize(d.replace(/_/g, ' '))}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Discount value <RequiredMark />
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.discount_value}
              onChange={e => setField('discount_value', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            Promotion type
            <select
              style={modalStyles.select}
              value={form.promotion_type}
              onChange={e => setField('promotion_type', e.target.value)}
            >
              {PROMOTION_TYPES.map(t => <option key={t} value={t}>{capitalize(t)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Applies to
            <select
              style={modalStyles.select}
              value={form.applies_to}
              onChange={e => setField('applies_to', e.target.value)}
            >
              {APPLIES_TO.map(a => <option key={a} value={a}>{capitalize(a)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Max total uses
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.max_uses}
              onChange={e => setField('max_uses', e.target.value)}
              placeholder="Blank = unlimited"
            />
          </label>

          <label style={modalStyles.label}>
            Max uses per client
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.max_uses_per_client}
              onChange={e => setField('max_uses_per_client', e.target.value)}
              placeholder="Blank = unlimited"
            />
          </label>

          <label style={modalStyles.label}>
            Minimum order value
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.min_order_value}
              onChange={e => setField('min_order_value', e.target.value)}
              placeholder="Blank = no minimum"
            />
          </label>

          <label style={modalStyles.label}>
            Duration (months)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              max={255}
              value={form.duration_months}
              onChange={e => setField('duration_months', e.target.value)}
              placeholder="Blank = one-time / perpetual"
            />
          </label>

          <label style={modalStyles.label}>
            Starts at
            <input
              style={modalStyles.input}
              type="date"
              value={form.starts_at}
              onChange={e => setField('starts_at', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Ends at
            <input
              style={modalStyles.input}
              type="date"
              value={form.ends_at}
              onChange={e => setField('ends_at', e.target.value)}
            />
          </label>

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setField('is_active', e.target.checked)}
            />
            Active
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Promotion'}
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
// PromotionList component
// ---------------------------------------------------------------------------

export function PromotionList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editPromotion, setEditPromotion] = useState<Promotion | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const promotionsQ = useQuery({
    queryKey: ['promotions', page, typeFilter],
    queryFn: () => fetchPromotions(page, typeFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePromotion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['promotions'] });
  }

  function handleFilterChange(value: string) {
    setTypeFilter(value);
    setPage(1);
  }

  const promotions = promotionsQ.data?.data ?? [];
  const meta = promotionsQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🏷️ Promotions</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Promotion
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Type:</label>
        <select
          style={styles.filterSelect}
          value={typeFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {TYPE_FILTER_OPTIONS.map(t => (
            <option key={t} value={t}>{t ? capitalize(t) : 'All'}</option>
          ))}
        </select>
        {typeFilter && (
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
        {promotionsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : promotionsQ.error ? (
          <p style={styles.msgError}>Failed to load promotions.</p>
        ) : promotions.length === 0 ? (
          <p style={styles.msg}>No promotions found{typeFilter ? ` of type "${typeFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Code', 'Type', 'Discount', 'Applies To', 'Active', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {promotions.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{p.name}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.code ?? '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{p.promotion_type}</td>
                      <td style={styles.td}>{formatDiscount(p)}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{p.applies_to}</td>
                      <td style={styles.td}><ActiveBadge active={Boolean(p.is_active)} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditPromotion(p)} title="Edit this promotion">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(p.id)}
                          title="Delete this promotion"
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
        <PromotionModal promotion={null} onClose={() => setShowNew(false)} onSaved={invalidate} />
      )}
      {editPromotion && (
        <PromotionModal promotion={editPromotion} onClose={() => setEditPromotion(null)} onSaved={invalidate} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this promotion? It will be soft-deleted and removed from the list."
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
