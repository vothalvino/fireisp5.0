// =============================================================================
// FireISP 5.0 — Speed Test Viewer
// =============================================================================
// Read-only analytics page at /speed-tests. Lists recorded speed-test results
// (download/upload throughput, latency, jitter, packet loss) with their source
// and the client/contract/device under test. Measurements are written by the
// client portal, technicians and automated probes, so this is a read/analytics
// view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpeedTest {
  id: number;
  client_id: number | null;
  contract_id: number | null;
  device_id: number | null;
  test_source: string;
  server_location: string | null;
  download_mbps: number | string;
  upload_mbps: number | string;
  latency_ms: number | string | null;
  jitter_ms: number | string | null;
  packet_loss_pct: number | string | null;
  tested_at: string | null;
}

interface SpeedTestResponse {
  data: SpeedTest[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;
const SOURCE_FILTER_OPTIONS = ['', 'client_portal', 'technician', 'automated_probe', 'external'];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchSpeedTests(page: number, sourceFilter: string): Promise<SpeedTestResponse> {
  const query: Record<string, string | number> = { page, limit: DEFAULT_PAGE_SIZE };
  if (sourceFilter) query.test_source = sourceFilter;
  const res = await api.GET('/speed-tests', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load speed tests');
  return res.data as unknown as SpeedTestResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number | string | null, suffix: string): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n} ${suffix}`;
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// SpeedTestList component
// ---------------------------------------------------------------------------

export function SpeedTestList() {
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState('');

  const testsQ = useQuery({
    queryKey: ['speed-tests', page, sourceFilter],
    queryFn: () => fetchSpeedTests(page, sourceFilter),
  });

  function handleFilterChange(value: string) {
    setSourceFilter(value);
    setPage(1);
  }

  const tests = testsQ.data?.data ?? [];
  const meta = testsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>⚡ Speed Tests</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Source:</label>
        <select
          style={styles.filterSelect}
          value={sourceFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {SOURCE_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? sourceLabel(s) : 'All'}</option>
          ))}
        </select>
        {sourceFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      <div style={styles.tableCard}>
        {testsQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : testsQ.error ? (
          <p style={styles.msgError}>Failed to load speed tests.</p>
        ) : tests.length === 0 ? (
          <p style={styles.msg}>No speed tests found{sourceFilter ? ` from "${sourceLabel(sourceFilter)}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Client', 'Contract', 'Source', 'Download', 'Upload', 'Latency', 'Jitter', 'Loss', 'Tested'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tests.map(t => (
                    <tr key={t.id} style={styles.tr}>
                      <td style={styles.td}>#{t.id}</td>
                      <td style={styles.td}>{t.client_id != null ? `#${t.client_id}` : '—'}</td>
                      <td style={styles.td}>{t.contract_id != null ? `#${t.contract_id}` : '—'}</td>
                      <td style={styles.td}>{sourceLabel(t.test_source)}</td>
                      <td style={styles.td}>{fmtNum(t.download_mbps, 'Mbps')}</td>
                      <td style={styles.td}>{fmtNum(t.upload_mbps, 'Mbps')}</td>
                      <td style={styles.td}>{fmtNum(t.latency_ms, 'ms')}</td>
                      <td style={styles.td}>{fmtNum(t.jitter_ms, 'ms')}</td>
                      <td style={styles.td}>{fmtNum(t.packet_loss_pct, '%')}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{t.tested_at ? fmtDate(t.tested_at) : '—'}</td>
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
