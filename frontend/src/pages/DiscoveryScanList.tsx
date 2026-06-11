// =============================================================================
// FireISP 5.0 — Discovery Scan Management
// =============================================================================
// Standalone page at /discovery-scans. Lists discovery scans with a paginated
// table, "New Discovery Scan" create modal, and per-row Delete (scans are
// immutable once created — no edit action).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveryScan {
  id: number;
  name: string;
  cidr_ranges: string;
  snmp_version: string;
  snmp_community: string | null;
  snmp_port: number;
  status: string;
  scanned_hosts: number;
  discovered_hosts: number;
  created_at: string;
}

interface DiscoveryScansResponse {
  data: DiscoveryScan[];
  meta: { total: number; page: number; limit: number };
}

interface DiscoveryScanBody {
  name: string;
  cidr_ranges: string[];
  snmp_version?: string;
  snmp_community?: string;
  snmp_port?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const SNMP_VERSIONS = ['v1', 'v2c', 'v3'];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchScans(page: number): Promise<DiscoveryScansResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  const res = await api.GET('/discovery-scans' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load discovery scans');
  return (res as { data: unknown }).data as unknown as DiscoveryScansResponse;
}

async function createScan(body: DiscoveryScanBody): Promise<void> {
  const res = await api.POST('/discovery-scans' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create discovery scan');
}

async function deleteScan(id: number): Promise<void> {
  const res = await api.DELETE('/discovery-scans/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete discovery scan');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    pending:   { bg: '#fef9c3', color: '#854d0e' },
    running:   { bg: '#dbeafe', color: '#1e40af' },
    completed: { bg: '#d1fae5', color: '#065f46' },
    failed:    { bg: '#fee2e2', color: '#991b1b' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Discovery scan form modal
// ---------------------------------------------------------------------------

interface ScanFormProps {
  onSave: (body: DiscoveryScanBody) => void;
  onClose: () => void;
  saving: boolean;
}

function ScanForm({ onSave, onClose, saving }: ScanFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [cidrRangesRaw, setCidrRangesRaw] = useState('');
  const [snmpVersion, setSnmpVersion] = useState('v2c');
  const [snmpCommunity, setSnmpCommunity] = useState('');
  const [snmpPort, setSnmpPort] = useState<string>('161');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cidrRanges = cidrRangesRaw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const body: DiscoveryScanBody = { name, cidr_ranges: cidrRanges, snmp_version: snmpVersion };
    if (snmpCommunity) body.snmp_community = snmpCommunity;
    if (snmpPort) body.snmp_port = Number(snmpPort);
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{t('discovery_scans.new', 'New Discovery Scan')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('discovery_scans.name', 'Scan Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('discovery_scans.cidr_ranges', 'CIDR Ranges')}<RequiredMark /></label>
            <textarea
              style={{ ...inp, minHeight: 72, resize: 'vertical' as const }}
              value={cidrRangesRaw}
              onChange={e => setCidrRangesRaw(e.target.value)}
              placeholder={t('discovery_scans.cidr_ranges_hint', 'Comma-separated, e.g. 192.168.1.0/24, 10.0.0.0/8')}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={modalStyles.label}>{t('discovery_scans.snmp_version', 'SNMP Version')}</label>
              <select style={inp} value={snmpVersion} onChange={e => setSnmpVersion(e.target.value)}>
                {SNMP_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={modalStyles.label}>{t('discovery_scans.snmp_community', 'Community String')}</label>
              <input style={inp} value={snmpCommunity} onChange={e => setSnmpCommunity(e.target.value)} placeholder="public" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('discovery_scans.snmp_port', 'Port')}</label>
              <input style={inp} type="number" min={1} max={65535} value={snmpPort} onChange={e => setSnmpPort(e.target.value)} />
            </div>
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

export function DiscoveryScanList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const scansQ = useQuery({
    queryKey: ['discovery-scans', page],
    queryFn: () => fetchScans(page),
  });

  const scans = scansQ.data?.data ?? [];
  const meta = scansQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createScan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-scans'] });
      setShowForm(false);
      showMsg('ok', t('discovery_scans.create_success', 'Discovery scan created.'));
    },
    onError: () => showMsg('err', t('discovery_scans.create_error', 'Failed to create discovery scan.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteScan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-scans'] });
      setDeleteConfirm(null);
      showMsg('ok', t('discovery_scans.delete_success', 'Discovery scan deleted.'));
    },
    onError: () => showMsg('err', t('discovery_scans.delete_error', 'Failed to delete discovery scan.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function formatCidrRanges(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed.join(', ') : raw;
    } catch {
      return raw;
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('discovery_scans.title', 'Discovery Scans')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('discovery_scans.new', 'New Discovery Scan')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {scansQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : scansQ.error ? (
          <p style={styles.msgError}>{t('discovery_scans.error', 'Failed to load discovery scans.')}</p>
        ) : scans.length === 0 ? (
          <p style={styles.msg}>{t('discovery_scans.empty', 'No discovery scans found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>CIDR Ranges</th>
                  <th style={styles.th}>SNMP</th>
                  <th style={styles.th}>{t('discovery_scans.scanned', 'Scanned')}</th>
                  <th style={styles.th}>{t('discovery_scans.discovered', 'Discovered')}</th>
                  <th style={styles.th}>{t('discovery_scans.status', 'Status')}</th>
                  <th style={styles.th}>Created</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {scans.map(s => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}><strong>{s.name}</strong></td>
                    <td style={{ ...styles.tdMono, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCidrRanges(s.cidr_ranges)}</td>
                    <td style={styles.td}>{capitalize(s.snmp_version)} / port {s.snmp_port}</td>
                    <td style={styles.td}>{s.scanned_hosts}</td>
                    <td style={styles.td}>{s.discovered_hosts}</td>
                    <td style={styles.td}><StatusBadge status={s.status} /></td>
                    <td style={styles.td}>{formatDate(s.created_at)}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(s.id)}>Delete</button>
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
        <ScanForm
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('discovery_scans.delete_confirm', 'Delete this discovery scan?')}</p>
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
