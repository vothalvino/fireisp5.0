// =============================================================================
// FireISP 5.0 — Device Config Backup Viewer
// =============================================================================
// Read-only page at /device-config-backups. Lists captured device configuration
// snapshots (per device, versioned) with their format, size, checksum and how
// the backup was triggered. Backups are produced by the scheduled config-backup
// job and on-demand captures, so this is a history/list view and exposes no
// create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceConfigBackup {
  id: number;
  device_id: number;
  version: number;
  config_type: string;
  file_size: number;
  checksum: string;
  capture_method: string;
  created_at: string | null;
}

interface DeviceConfigBackupResponse {
  data: DeviceConfigBackup[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;
const METHOD_FILTER_OPTIONS = ['', 'manual', 'scheduled', 'pre_change', 'post_change'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchBackups(page: number, methodFilter: string): Promise<DeviceConfigBackupResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (methodFilter) query.capture_method = methodFilter;
  const res = await api.GET('/device-config-backups', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load device config backups');
  return res.data as unknown as DeviceConfigBackupResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBytes(n: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function methodLabel(method: string): string {
  return method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// DeviceConfigBackupList component
// ---------------------------------------------------------------------------

export function DeviceConfigBackupList() {
  const [page, setPage] = useState(1);
  const [methodFilter, setMethodFilter] = useState('');

  const backupsQ = useQuery({
    queryKey: ['device-config-backups', page, methodFilter],
    queryFn: () => fetchBackups(page, methodFilter),
  });

  function handleFilterChange(value: string) {
    setMethodFilter(value);
    setPage(1);
  }

  const backups = backupsQ.data?.data ?? [];
  const meta = backupsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>💾 Device Config Backups</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Capture method:</label>
        <select
          style={styles.filterSelect}
          value={methodFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {METHOD_FILTER_OPTIONS.map(m => (
            <option key={m} value={m}>{m ? methodLabel(m) : 'All'}</option>
          ))}
        </select>
        {methodFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {backupsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : backupsQ.error ? (
          <p style={styles.msgError}>Failed to load device config backups.</p>
        ) : backups.length === 0 ? (
          <p style={styles.msg}>No device config backups found{methodFilter ? ` via "${methodLabel(methodFilter)}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Device', 'Version', 'Type', 'Size', 'Checksum', 'Method', 'Captured'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.id} style={styles.tr}>
                      <td style={styles.td}>#{b.id}</td>
                      <td style={styles.td}>#{b.device_id}</td>
                      <td style={styles.td}>v{b.version}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{b.config_type}</td>
                      <td style={styles.td}>{fmtBytes(b.file_size)}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.72rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.checksum}>
                        {b.checksum ? `${b.checksum.slice(0, 12)}…` : '—'}
                      </td>
                      <td style={styles.td}>{methodLabel(b.capture_method)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{b.created_at ? fmtDate(b.created_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
