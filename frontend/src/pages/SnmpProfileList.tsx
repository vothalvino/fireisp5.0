// =============================================================================
// FireISP 5.0 — SNMP Profile Viewer
// =============================================================================
// Read-only page at /snmp-profiles. Lists the SNMP polling profiles that map
// device manufacturers/models to polling settings and OID sets used by the
// metrics collector. Profiles and their OID mappings are managed through the
// poller configuration flow, so this is a visibility/list view and exposes no
// create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnmpProfile {
  id: number;
  name: string;
  manufacturer: string | null;
  model_pattern: string | null;
  device_type: string | null;
  snmp_version: string | null;
  poll_interval_sec: number;
  is_default: number | boolean;
  status: string;
}

interface SnmpProfileResponse {
  data: SnmpProfile[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;
const STATUS_FILTER_OPTIONS = ['', 'active', 'inactive'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchSnmpProfiles(page: number, statusFilter: string): Promise<SnmpProfileResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/snmp-profiles', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load SNMP profiles');
  return res.data as unknown as SnmpProfileResponse;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#374151' },
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

function deviceTypeLabel(type: string | null): string {
  if (!type) return '—';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// SnmpProfileList component
// ---------------------------------------------------------------------------

export function SnmpProfileList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const profilesQ = useQuery({
    queryKey: ['snmp-profiles', page, statusFilter],
    queryFn: () => fetchSnmpProfiles(page, statusFilter),
  });

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  const profiles = profilesQ.data?.data ?? [];
  const meta = profilesQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📶 SNMP Profiles</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {profilesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : profilesQ.error ? (
          <p style={styles.msgError}>Failed to load SNMP profiles.</p>
        ) : profiles.length === 0 ? (
          <p style={styles.msg}>No SNMP profiles found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Manufacturer', 'Model Pattern', 'Device Type', 'Version', 'Poll', 'Default', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{p.name}</td>
                      <td style={styles.td}>{p.manufacturer ?? '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.model_pattern ?? '—'}</td>
                      <td style={styles.td}>{deviceTypeLabel(p.device_type)}</td>
                      <td style={{ ...styles.td, textTransform: 'uppercase' }}>{p.snmp_version ?? '—'}</td>
                      <td style={styles.td}>{p.poll_interval_sec}s</td>
                      <td style={styles.td}>{p.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
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
