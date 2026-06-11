// =============================================================================
// FireISP 5.0 — PTR Record (Reverse DNS) Management
// =============================================================================
// Standalone page at /ptr-records. Lists PTR records with a status filter,
// paginated table, "New PTR Record" create modal, and per-row Edit and Delete.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PtrRecord {
  id: number;
  ip_address: string;
  ip_version: string;
  hostname: string;
  ttl: number;
  zone: string | null;
  status: string;
  notes: string | null;
}

interface PtrRecordsResponse {
  data: PtrRecord[];
  meta: { total: number; page: number; limit: number };
}

interface PtrRecordBody {
  ip_address: string;
  ip_version?: string;
  hostname: string;
  ttl?: number;
  zone?: string;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const IP_VERSIONS = ['ipv4', 'ipv6'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchRecords(page: number, statusFilter: string): Promise<PtrRecordsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/ptr-records' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load PTR records');
  return (res as { data: unknown }).data as unknown as PtrRecordsResponse;
}

async function createRecord(body: PtrRecordBody): Promise<void> {
  const res = await api.POST('/ptr-records' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create PTR record');
}

async function updateRecord(id: number, body: Partial<PtrRecordBody>): Promise<void> {
  const res = await api.PUT('/ptr-records/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update PTR record');
}

async function deleteRecord(id: number): Promise<void> {
  const res = await api.DELETE('/ptr-records/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete PTR record');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Record form modal
// ---------------------------------------------------------------------------

interface RecordFormProps {
  initial: Partial<PtrRecord>;
  onSave: (body: PtrRecordBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function RecordForm({ initial, onSave, onClose, saving, editMode }: RecordFormProps) {
  const { t } = useTranslation();
  const [ipAddress, setIpAddress] = useState(initial.ip_address ?? '');
  const [ipVersion, setIpVersion] = useState(initial.ip_version ?? 'ipv4');
  const [hostname, setHostname] = useState(initial.hostname ?? '');
  const [ttl, setTtl] = useState<string>(initial.ttl !== undefined ? String(initial.ttl) : '3600');
  const [zone, setZone] = useState(initial.zone ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: PtrRecordBody = { ip_address: ipAddress, hostname, status };
    if (ipVersion) body.ip_version = ipVersion;
    if (ttl) body.ttl = Number(ttl);
    if (zone) body.zone = zone;
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('ptr_records.edit', 'Edit PTR Record') : t('ptr_records.new', 'New PTR Record')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('ptr_records.ip_address', 'IP Address')}<RequiredMark /></label>
              <input style={inp} value={ipAddress} onChange={e => setIpAddress(e.target.value)} required placeholder="192.0.2.1" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('ptr_records.ip_version', 'IP Version')}</label>
              <select style={inp} value={ipVersion} onChange={e => setIpVersion(e.target.value)}>
                {IP_VERSIONS.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('ptr_records.hostname', 'Hostname')}<RequiredMark /></label>
            <input style={inp} value={hostname} onChange={e => setHostname(e.target.value)} required placeholder="host.example.com" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('ptr_records.ttl', 'TTL')}</label>
              <input style={inp} type="number" min={60} value={ttl} onChange={e => setTtl(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('ptr_records.zone', 'Zone')}</label>
              <input style={inp} value={zone} onChange={e => setZone(e.target.value)} placeholder="2.0.192.in-addr.arpa" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('ptr_records.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('ptr_records.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PtrRecordList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PtrRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const recordsQ = useQuery({
    queryKey: ['ptr-records', page, statusFilter],
    queryFn: () => fetchRecords(page, statusFilter),
  });

  const records = recordsQ.data?.data ?? [];
  const meta = recordsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptr-records'] });
      setShowForm(false);
      showMsg('ok', t('ptr_records.create_success', 'PTR record created.'));
    },
    onError: () => showMsg('err', t('ptr_records.create_error', 'Failed to create PTR record.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<PtrRecordBody> }) => updateRecord(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptr-records'] });
      setEditing(null);
      showMsg('ok', t('ptr_records.update_success', 'PTR record updated.'));
    },
    onError: () => showMsg('err', t('ptr_records.update_error', 'Failed to update PTR record.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptr-records'] });
      setDeleteConfirm(null);
      showMsg('ok', t('ptr_records.delete_success', 'PTR record deleted.'));
    },
    onError: () => showMsg('err', t('ptr_records.delete_error', 'Failed to delete PTR record.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('ptr_records.title', 'PTR Records (Reverse DNS)')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('ptr_records.new', 'New PTR Record')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Status:</span>
        <select style={styles.filterSelect} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {recordsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : recordsQ.error ? (
          <p style={styles.msgError}>{t('ptr_records.error', 'Failed to load PTR records.')}</p>
        ) : records.length === 0 ? (
          <p style={styles.msg}>{t('ptr_records.empty', 'No PTR records found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>IP Address</th>
                  <th style={styles.th}>Version</th>
                  <th style={styles.th}>Hostname</th>
                  <th style={styles.th}>TTL</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.tdMono}>{r.ip_address}</td>
                    <td style={styles.td}>{r.ip_version.toUpperCase()}</td>
                    <td style={styles.td}>{r.hostname}</td>
                    <td style={styles.td}>{r.ttl}</td>
                    <td style={styles.td}><StatusBadge status={r.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(r)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}

      {showForm && (
        <RecordForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <RecordForm
          initial={editing}
          onSave={body => updateMut.mutate({ id: editing.id, body })}
          onClose={() => setEditing(null)}
          saving={updateMut.isPending}
          editMode={true}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('ptr_records.delete_confirm', 'Delete this PTR record?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
