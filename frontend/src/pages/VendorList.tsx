// =============================================================================
// FireISP 5.0 — Vendor Management (§14.2 — Inventory Phase 1)
// =============================================================================
// Page at /vendors. Full CRUD for suppliers so a Purchase Order can record
// "who this was bought from" — mirrors WarehouseList.tsx/InventoryList.tsx's
// list-with-modal pattern, but i18n'd (this resource is new, so it follows the
// newer i18n convention used by InventoryManagement.tsx/QuoteDetail.tsx rather
// than the older un-i18n'd WarehouseList.tsx).
// The backend (src/routes/vendors.js) has had full CRUD since §14.2; this page
// is the first UI that can ever reach it.
// =============================================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { extractApiError } from '@/components/ClientFormModal';
import { styles, modalStyles, RequiredMark } from './crudStyles';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Vendor {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: string | null;
  currency: string | null;
  notes: string | null;
  status: string;
}

interface VendorListResponse {
  data: Vendor[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface VendorSubmitBody {
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  tax_id?: string;
  payment_terms?: string;
  currency?: string;
  notes?: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchVendors(page: number, pageSize: number, statusFilter: string): Promise<VendorListResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/vendors' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load vendors');
  return (res as { data: unknown }).data as unknown as VendorListResponse;
}

async function createVendor(body: VendorSubmitBody): Promise<void> {
  const res = await api.POST('/vendors' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to create vendor'));
  }
}

async function updateVendor(id: number, body: VendorSubmitBody): Promise<void> {
  const res = await api.PUT('/vendors/{id}' as never, {
    params: { path: { id } as never },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to update vendor'));
  }
}

async function deleteVendor(id: number): Promise<void> {
  const res = await api.DELETE('/vendors/{id}' as never, { params: { path: { id } as never } } as never);
  if ((res as { error?: unknown }).error) {
    throw new Error(extractApiError((res as { error: unknown }).error, 'Failed to delete vendor'));
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Vendor Form Modal (New / Edit)
// ---------------------------------------------------------------------------

interface VendorFormValues {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  tax_id: string;
  payment_terms: string;
  currency: string;
  notes: string;
  status: string;
}

const EMPTY_FORM: VendorFormValues = {
  name: '', contact_name: '', email: '', phone: '', website: '',
  address: '', tax_id: '', payment_terms: '', currency: 'MXN',
  notes: '', status: 'active',
};

interface VendorFormModalProps {
  vendor?: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}

function VendorFormModal({ vendor, onClose, onSaved }: VendorFormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!vendor;
  const qc = useQueryClient();
  const [form, setForm] = useState<VendorFormValues>(
    vendor
      ? {
          name: vendor.name,
          contact_name: vendor.contact_name ?? '',
          email: vendor.email ?? '',
          phone: vendor.phone ?? '',
          website: vendor.website ?? '',
          address: vendor.address ?? '',
          tax_id: vendor.tax_id ?? '',
          payment_terms: vendor.payment_terms ?? '',
          currency: vendor.currency ?? 'MXN',
          notes: vendor.notes ?? '',
          status: vendor.status,
        }
      : { ...EMPTY_FORM },
  );
  const [error, setError] = useState('');

  function set(field: keyof VendorFormValues, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: VendorSubmitBody = { name: form.name, status: form.status };
      if (form.contact_name) body.contact_name = form.contact_name;
      if (form.email) body.email = form.email;
      if (form.phone) body.phone = form.phone;
      if (form.website) body.website = form.website;
      if (form.address) body.address = form.address;
      if (form.tax_id) body.tax_id = form.tax_id;
      if (form.payment_terms) body.payment_terms = form.payment_terms;
      if (form.currency) body.currency = form.currency;
      if (form.notes) body.notes = form.notes;
      return isEdit && vendor ? updateVendor(vendor.id, body) : createVendor(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendorList'] });
      onSaved();
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('vendors.form.genericError')),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} role="dialog" aria-modal="true" aria-label={isEdit ? t('vendors.editTitle') : t('vendors.newTitle')}>
      <div style={modalStyles.panel}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{isEdit ? t('vendors.editTitle') : t('vendors.newTitle')}</h3>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p style={modalStyles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            {t('vendors.form.name')} <RequiredMark />
            <input style={modalStyles.input} required maxLength={255} value={form.name}
              onChange={e => set('name', e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('vendors.form.contactName')}
              <input style={modalStyles.input} maxLength={100} value={form.contact_name}
                onChange={e => set('contact_name', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('vendors.form.email')}
              <input style={modalStyles.input} type="email" maxLength={255} value={form.email}
                onChange={e => set('email', e.target.value)} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('vendors.form.phone')}
              <input style={modalStyles.input} maxLength={50} value={form.phone}
                onChange={e => set('phone', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('vendors.form.website')}
              <input style={modalStyles.input} maxLength={255} value={form.website}
                onChange={e => set('website', e.target.value)} placeholder="https://…" />
            </label>
          </div>

          <label style={modalStyles.label}>
            {t('vendors.form.address')}
            <input style={modalStyles.input} value={form.address}
              onChange={e => set('address', e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
            <label style={modalStyles.label}>
              {t('vendors.form.taxId')}
              <input style={modalStyles.input} maxLength={100} value={form.tax_id}
                onChange={e => set('tax_id', e.target.value)} />
            </label>
            <label style={modalStyles.label}>
              {t('vendors.form.paymentTerms')}
              <input style={modalStyles.input} maxLength={100} value={form.payment_terms}
                onChange={e => set('payment_terms', e.target.value)} placeholder="Net 30" />
            </label>
            <label style={modalStyles.label}>
              {t('vendors.form.currency')}
              <input style={modalStyles.input} maxLength={3} value={form.currency}
                onChange={e => set('currency', e.target.value.toUpperCase())} placeholder="MXN" />
            </label>
          </div>

          <label style={modalStyles.label}>
            {t('vendors.form.status')}
            <select style={modalStyles.select} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">{t('vendors.status.active')}</option>
              <option value="inactive">{t('vendors.status.inactive')}</option>
            </select>
          </label>

          <label style={modalStyles.label}>
            {t('vendors.form.notes')}
            <textarea style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' as const }} value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </label>

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              {t('vendors.actions.cancel')}
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? t('vendors.actions.saving') : isEdit ? t('vendors.actions.save') : t('vendors.actions.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm delete dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()} role="alertdialog" aria-label={t('vendors.deleteConfirmTitle')}>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>{t('vendors.actions.cancel')}</button>
          <button onClick={onConfirm} style={styles.btnDanger}>{t('vendors.actions.delete')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function VendorList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('active');

  const [showNewModal, setShowNewModal] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vendorList', page, pageSize, statusFilter],
    queryFn: () => fetchVendors(page, pageSize, statusFilter),
    placeholderData: (prev: VendorListResponse | undefined) => prev,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['vendorList'] });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteVendor(id),
    onSuccess: invalidate,
    onError: (err: unknown) => alert(err instanceof Error ? err.message : t('vendors.deleteFailed')),
  });

  const vendors = data?.data ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🏬 {t('vendors.title')}</h1>
        {data && <span style={styles.countBadge}>{data.meta.total} {t('vendors.total')}</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNewModal(true)}>
          + {t('vendors.newVendor')}
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>{t('vendors.filters.status')}</label>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">{t('vendors.filters.all')}</option>
          <option value="active">{t('vendors.status.active')}</option>
          <option value="inactive">{t('vendors.status.inactive')}</option>
        </select>
      </div>

      <div style={styles.tableCard}>
        {isLoading ? (
          <p style={styles.msg}>{t('vendors.loading')}</p>
        ) : isError ? (
          <p style={styles.msgError}>{t('vendors.loadError')}</p>
        ) : vendors.length === 0 ? (
          <p style={styles.msg}>{t('vendors.noItems')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      t('vendors.table.name'), t('vendors.table.contactName'), t('vendors.table.email'),
                      t('vendors.table.phone'), t('vendors.table.paymentTerms'), t('vendors.table.currency'),
                      t('vendors.table.status'), t('vendors.table.actions'),
                    ].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id} style={styles.tr}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{v.name}</td>
                      <td style={styles.td}>{v.contact_name ?? '—'}</td>
                      <td style={styles.td}>{v.email ?? '—'}</td>
                      <td style={styles.td}>{v.phone ?? '—'}</td>
                      <td style={styles.td}>{v.payment_terms ?? '—'}</td>
                      <td style={styles.td}>{v.currency ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={v.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button style={styles.actionBtn} onClick={() => setEditVendor(v)}>{t('vendors.actions.edit')}</button>
                        <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setConfirmDelete(v)}>{t('vendors.actions.delete')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={data?.meta.totalPages ?? 1}
              total={data?.meta.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {showNewModal && (
        <VendorFormModal onClose={() => setShowNewModal(false)} onSaved={invalidate} />
      )}

      {editVendor && (
        <VendorFormModal vendor={editVendor} onClose={() => setEditVendor(null)} onSaved={invalidate} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={t('vendors.deleteConfirmMessage', { name: confirmDelete.name })}
          onConfirm={() => { deleteMutation.mutate(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
