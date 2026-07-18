// =============================================================================
// FireISP 5.0 — Organization Management
// =============================================================================
// Admin page at /organizations. Lists tenant organizations with a paginated
// table, a "New Organization" create modal, a per-row "Manage" link to the
// detail page (/organizations/:id — where Edit, Settings, Quota, and the
// per-function Mail identities live as tabs), and a per-row Delete
// (soft-delete). All mutations go through the typed `api` client + React
// Query, invalidating the ['organizations'] query so the list refreshes.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Organization {
  id: number;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  currency: string | null;
  locale: string | null;
  tax_id: string | null;
  logo_url: string | null;
  status: string | null;
}

interface OrganizationsResponse {
  data: Organization[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface OrganizationBody {
  name: string;
  legal_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  currency?: string;
  locale?: string;
  tax_id?: string;
  logo_url?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;
const LOCALES = ['global', 'MX'];
const STATUSES = ['active', 'inactive'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchOrganizations(page: number): Promise<OrganizationsResponse> {
  const res = await api.GET('/organizations', { params: { query: { page, limit: DEFAULT_PAGE_SIZE } as never } });
  if (res.error) throw new Error('Failed to load organizations');
  return res.data as unknown as OrganizationsResponse;
}

async function createOrganization(body: OrganizationBody): Promise<void> {
  const res = await api.POST('/organizations', { body: body as never });
  if (res.error) throw new Error('Failed to create organization');
}

async function updateOrganization(id: number, body: Partial<OrganizationBody>): Promise<void> {
  const res = await api.PUT('/organizations/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update organization');
}

async function deleteOrganization(id: number): Promise<void> {
  const res = await api.DELETE('/organizations/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete organization');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status ?? ''] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status ?? '—'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Organization form modal (create + edit)
// ---------------------------------------------------------------------------

interface OrgModalProps {
  organization: Organization | null;
  onClose: () => void;
  onSaved: () => void;
}

function OrgModal({ organization, onClose, onSaved }: OrgModalProps) {
  const isEdit = organization !== null;
  const [form, setForm] = useState({
    name: organization?.name ?? '',
    legal_name: organization?.legal_name ?? '',
    email: organization?.email ?? '',
    phone: organization?.phone ?? '',
    website: organization?.website ?? '',
    address: organization?.address ?? '',
    city: organization?.city ?? '',
    state: organization?.state ?? '',
    zip_code: organization?.zip_code ?? '',
    country: organization?.country ?? '',
    currency: organization?.currency ?? 'MXN',
    locale: organization?.locale ?? 'global',
    tax_id: organization?.tax_id ?? '',
    logo_url: organization?.logo_url ?? '',
    status: organization?.status ?? 'active',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: OrganizationBody = { name: form.name.trim(), locale: form.locale, status: form.status };
      // Always send currency — it has a valid 3-letter default so the input is never empty.
      const currencyVal = form.currency.trim().toUpperCase();
      if (currencyVal.length === 3) body.currency = currencyVal;
      const optional: (keyof OrganizationBody)[] = [
        'legal_name', 'email', 'phone', 'website', 'address',
        'city', 'state', 'zip_code', 'country', 'tax_id', 'logo_url',
      ];
      for (const k of optional) {
        const v = (form as Record<string, string>)[k].trim();
        if (v) (body as unknown as Record<string, string>)[k] = v;
      }
      return isEdit ? updateOrganization(organization.id, body) : createOrganization(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save organization. Check all fields and try again.'),
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
        aria-label={isEdit ? `Edit organization ${organization.name}` : 'New organization'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `🏢 Edit Organization #${organization.id}` : '🏢 New Organization'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input style={modalStyles.input} type="text" maxLength={255} value={form.name} onChange={e => setField('name', e.target.value)} required />
          </label>

          <label style={modalStyles.label}>
            Legal name
            <input style={modalStyles.input} type="text" maxLength={255} value={form.legal_name} onChange={e => setField('legal_name', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Email
            <input style={modalStyles.input} type="email" maxLength={255} value={form.email} onChange={e => setField('email', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Phone
            <input style={modalStyles.input} type="text" maxLength={30} value={form.phone} onChange={e => setField('phone', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Website
            <input style={modalStyles.input} type="text" maxLength={255} value={form.website} onChange={e => setField('website', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Tax ID
            <input style={modalStyles.input} type="text" maxLength={50} value={form.tax_id} onChange={e => setField('tax_id', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Address
            <input style={modalStyles.input} type="text" maxLength={255} value={form.address} onChange={e => setField('address', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            City
            <input style={modalStyles.input} type="text" maxLength={100} value={form.city} onChange={e => setField('city', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            State
            <input style={modalStyles.input} type="text" maxLength={100} value={form.state} onChange={e => setField('state', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            ZIP code
            <input style={modalStyles.input} type="text" maxLength={20} value={form.zip_code} onChange={e => setField('zip_code', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Country
            <input style={modalStyles.input} type="text" maxLength={100} value={form.country} onChange={e => setField('country', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Currency <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={3}
              value={form.currency}
              onChange={e => setField('currency', e.target.value.toUpperCase())}
              placeholder="e.g. MXN"
            />
          </label>

          <label style={modalStyles.label}>
            Logo URL
            <input style={modalStyles.input} type="text" maxLength={500} value={form.logo_url} onChange={e => setField('logo_url', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Locale <RequiredMark />
            <select style={modalStyles.select} value={form.locale} onChange={e => setField('locale', e.target.value)}>
              {LOCALES.map(l => <option key={l} value={l}>{l === 'MX' ? 'Mexico (MX)' : capitalize(l)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Status <RequiredMark />
            <select style={modalStyles.select} value={form.status} onChange={e => setField('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Organization'}
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

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
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
// OrganizationList component
// ---------------------------------------------------------------------------

export function OrganizationList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const orgsQ = useQuery({
    queryKey: ['organizations', page],
    queryFn: () => fetchOrganizations(page),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteOrganization(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['organizations'] });
  }

  const orgs = orgsQ.data?.data ?? [];
  const meta = orgsQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🏢 Organizations</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Organization
        </button>
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {orgsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : orgsQ.error ? (
          <p style={styles.msgError}>Failed to load organizations.</p>
        ) : orgs.length === 0 ? (
          <p style={styles.msg}>No organizations found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Email', 'Locale', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(o => (
                    <tr key={o.id} style={styles.tr}>
                      <td style={styles.td}>#{o.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{o.name}</td>
                      <td style={styles.td}>{o.email || '—'}</td>
                      <td style={styles.td}>{o.locale === 'MX' ? 'MX' : 'Global'}</td>
                      <td style={styles.td}><StatusBadge status={o.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <Link to={`/organizations/${o.id}`} style={{ ...styles.actionBtn, textDecoration: 'none' }} title="Manage organization (edit, settings, quota, mail)">⚙️ Manage</Link>
                        <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => setDeleteId(o.id)} title="Delete this organization">🗑 Delete</button>
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

      {showNew && <OrgModal organization={null} onClose={() => setShowNew(false)} onSaved={invalidate} />}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this organization? It will be soft-deleted and removed from the list."
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
