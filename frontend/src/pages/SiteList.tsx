// =============================================================================
// FireISP 5.0 — Site Management
// =============================================================================
// Standalone page at /sites. Lists network sites (POPs, towers, data centers)
// with a status filter, paginated table, and "New Site" create modal plus
// per-row Edit and Delete (soft-delete). All mutations go through the typed
// `api` client + React Query, invalidating the ['sites'] query so the list
// refreshes automatically.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Site {
  id: number;
  name: string;
  site_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  status: string;
  notes: string | null;
}

interface SitesResponse {
  data: Site[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface SiteBody {
  name: string;
  site_type?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SITE_TYPES = ['pop', 'data_center', 'tower', 'aggregation_node', 'other'];
const STATUSES = ['active', 'inactive'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

function labelType(t: string): string {
  return capitalize(t.replace(/_/g, ' '));
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchSites(page: number, pageSize: number, statusFilter: string): Promise<SitesResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/sites', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load sites');
  return res.data as unknown as SitesResponse;
}

async function createSite(body: SiteBody): Promise<void> {
  const res = await api.POST('/sites', { body: body as never });
  if (res.error) throw new Error('Failed to create site');
}

async function updateSite(id: number, body: Partial<SiteBody>): Promise<void> {
  const res = await api.PUT('/sites/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update site');
}

async function deleteSite(id: number): Promise<void> {
  const res = await api.DELETE('/sites/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete site');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
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
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Site form modal (create + edit)
// ---------------------------------------------------------------------------

interface SiteModalProps {
  site: Site | null;
  onClose: () => void;
  onSaved: () => void;
}

function SiteModal({ site, onClose, onSaved }: SiteModalProps) {
  const isEdit = site !== null;
  const [form, setForm] = useState({
    name: site?.name ?? '',
    site_type: site?.site_type ?? 'other',
    address: site?.address ?? '',
    city: site?.city ?? '',
    state: site?.state ?? '',
    zip_code: site?.zip_code ?? '',
    country: site?.country ?? '',
    latitude: site?.latitude != null ? String(site.latitude) : '',
    longitude: site?.longitude != null ? String(site.longitude) : '',
    status: site?.status ?? 'active',
    notes: site?.notes ?? '',
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: SiteBody = {
        name: form.name.trim(),
        site_type: form.site_type,
        status: form.status,
      };
      if (form.address) body.address = form.address;
      if (form.city) body.city = form.city;
      if (form.state) body.state = form.state;
      if (form.zip_code) body.zip_code = form.zip_code;
      if (form.country) body.country = form.country;
      if (form.latitude) body.latitude = Number(form.latitude);
      if (form.longitude) body.longitude = Number(form.longitude);
      if (form.notes) body.notes = form.notes;
      return isEdit ? updateSite(site.id, body) : createSite(body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to save site. Check all fields and try again.'),
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
        aria-label={isEdit ? `Edit site ${site.name}` : 'New site'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `📝 Edit Site #${site.id}` : '🏢 New Site'}</h2>
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
              required
            />
          </label>

          <label style={modalStyles.label}>
            Site Type
            <select
              style={modalStyles.select}
              value={form.site_type}
              onChange={e => setField('site_type', e.target.value)}
            >
              {SITE_TYPES.map(t => <option key={t} value={t}>{labelType(t)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Address
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.address}
              onChange={e => setField('address', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            City
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.city}
              onChange={e => setField('city', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            State
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.state}
              onChange={e => setField('state', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            ZIP Code
            <input
              style={modalStyles.input}
              type="text"
              maxLength={20}
              value={form.zip_code}
              onChange={e => setField('zip_code', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Country
            <input
              style={modalStyles.input}
              type="text"
              maxLength={100}
              value={form.country}
              onChange={e => setField('country', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Latitude
            <input
              style={modalStyles.input}
              type="number"
              step="any"
              min={-90}
              max={90}
              value={form.latitude}
              onChange={e => setField('latitude', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Longitude
            <input
              style={modalStyles.input}
              type="number"
              step="any"
              min={-180}
              max={180}
              value={form.longitude}
              onChange={e => setField('longitude', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Status
            <select
              style={modalStyles.select}
              value={form.status}
              onChange={e => setField('status', e.target.value)}
            >
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Notes
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={5000}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
            />
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Site'}
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
// SiteList component
// ---------------------------------------------------------------------------

export function SiteList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editSite, setEditSite] = useState<Site | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const sitesQ = useQuery({
    queryKey: ['sites', page, pageSize, statusFilter],
    queryFn: () => fetchSites(page, pageSize, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['sites'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const sites = sitesQ.data?.data ?? [];
  const meta = sitesQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🏢 Sites</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New Site
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? capitalize(s) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
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
        {sitesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : sitesQ.error ? (
          <p style={styles.msgError}>Failed to load sites.</p>
        ) : sites.length === 0 ? (
          <p style={styles.msg}>No sites found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Type', 'City', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sites.map(s => (
                    <tr key={s.id} style={styles.tr}>
                      <td style={styles.td}>#{s.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{s.name}</td>
                      <td style={styles.td}>{s.site_type ? labelType(s.site_type) : '—'}</td>
                      <td style={styles.td}>{s.city ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={s.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <Link to={`/sites/${s.id}`} style={{ ...styles.actionBtn, textDecoration: 'none', display: 'inline-block' }}>
                          View
                        </Link>
                        <button style={styles.actionBtn} onClick={() => setEditSite(s)} title="Edit this site">
                          ✏️ Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(s.id)}
                          title="Delete this site"
                        >
                          🗑 Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={meta?.totalPages ?? 1}
              total={meta?.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {showNew && <SiteModal site={null} onClose={() => setShowNew(false)} onSaved={invalidate} />}
      {editSite && <SiteModal site={editSite} onClose={() => setEditSite(null)} onSaved={invalidate} />}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this site? It will be soft-deleted and removed from the list."
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
