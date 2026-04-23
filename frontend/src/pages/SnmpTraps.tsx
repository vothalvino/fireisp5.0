// =============================================================================
// FireISP 5.0 — SNMP Trap Log Page
// =============================================================================
// Page at /snmp-traps (technician+). Shows unsolicited SNMP trap messages
// received from network devices.
//
// Features:
//   • Paginated trap log with device name, trap type, source IP, timestamp
//   • Filter by device ID, trap type, date range
//   • Per-row Acknowledge and Clear (delete) actions
//   • Row expansion to show full varbinds JSON
//   • Badge colouring by trap severity (linkDown/authFail = red, linkUp = green, etc.)
//   • Auto-refresh every 30 s
// =============================================================================

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnmpTrap {
  id: number;
  organization_id: number | null;
  device_id: number | null;
  device_name: string | null;
  source_ip: string;
  trap_type: string;
  trap_oid: string | null;
  varbinds: Array<{ oid: string; type: number; value: string | null }> | null;
  community: string | null;
  snmp_version: number;
  is_acknowledged: number;
  acknowledged_by: number | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  received_at: string;
}

interface TrapsResponse {
  data: SnmpTrap[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const TRAP_TYPE_COLORS: Record<string, string> = {
  linkDown:             '#e74c3c',
  authenticationFailure:'#e67e22',
  egpNeighborLoss:      '#c0392b',
  linkUp:               '#27ae60',
  coldStart:            '#2980b9',
  warmStart:            '#8e44ad',
  enterpriseSpecific:   '#7f8c8d',
  unknown:              '#bdc3c7',
};

function trapColor(trapType: string): string {
  return TRAP_TYPE_COLORS[trapType] || '#7f8c8d';
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiHeaders() {
  const token = tokenStore.get();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchTraps(
  page: number,
  limit: number,
  deviceId: string,
  trapType: string,
  from: string,
  to: string,
): Promise<TrapsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(deviceId  ? { device_id: deviceId }  : {}),
    ...(trapType  ? { trap_type: trapType }   : {}),
    ...(from      ? { from }                  : {}),
    ...(to        ? { to }                    : {}),
  });
  const res = await fetch(`/api/v1/snmp-traps?${params}`, { headers: apiHeaders() });
  if (!res.ok) throw new Error('Failed to load SNMP traps');
  return res.json();
}

async function acknowledgeTrap(id: number): Promise<void> {
  const res = await fetch(`/api/v1/snmp-traps/${id}/acknowledge`, {
    method: 'POST',
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to acknowledge trap');
}

async function clearTrap(id: number): Promise<void> {
  const res = await fetch(`/api/v1/snmp-traps/${id}/clear`, {
    method: 'POST',
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to clear trap');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SnmpTraps() {
  const queryClient = useQueryClient();

  const [page, setPage]         = useState(1);
  const [deviceId, setDeviceId] = useState('');
  const [trapType, setTrapType] = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const LIMIT = 50;

  // Auto-refresh every 30 s
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['snmp-traps', page, deviceId, trapType, from, to],
    queryFn: () => fetchTraps(page, LIMIT, deviceId, trapType, from, to),
    refetchInterval: 30_000,
  });

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [deviceId, trapType, from, to]);

  const ackMutation = useMutation({
    mutationFn: (id: number) => acknowledgeTrap(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snmp-traps'] }),
  });

  const clearMutation = useMutation({
    mutationFn: (id: number) => clearTrap(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snmp-traps'] }),
  });

  const traps      = data?.data ?? [];
  const meta       = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  function toggleExpand(id: number) {
    setExpanded(prev => (prev === id ? null : id));
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>🚨 SNMP Trap Log</h2>
        <button style={styles.refreshBtn} onClick={() => refetch()}>↻ Refresh</button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <input
          style={styles.filterInput}
          type="number"
          placeholder="Device ID"
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
        />
        <select
          style={styles.filterInput}
          value={trapType}
          onChange={e => setTrapType(e.target.value)}
        >
          <option value="">All trap types</option>
          <option value="coldStart">coldStart</option>
          <option value="warmStart">warmStart</option>
          <option value="linkDown">linkDown</option>
          <option value="linkUp">linkUp</option>
          <option value="authenticationFailure">authenticationFailure</option>
          <option value="egpNeighborLoss">egpNeighborLoss</option>
          <option value="enterpriseSpecific">enterpriseSpecific</option>
          <option value="unknown">unknown</option>
        </select>
        <input
          style={styles.filterInput}
          type="datetime-local"
          placeholder="From"
          value={from}
          onChange={e => setFrom(e.target.value)}
        />
        <input
          style={styles.filterInput}
          type="datetime-local"
          placeholder="To"
          value={to}
          onChange={e => setTo(e.target.value)}
        />
        <button
          style={styles.clearFiltersBtn}
          onClick={() => { setDeviceId(''); setTrapType(''); setFrom(''); setTo(''); }}
        >
          Clear
        </button>
      </div>

      {/* Summary bar */}
      {meta && (
        <div style={styles.summaryBar}>
          <span>Total: <strong>{meta.total}</strong></span>
          <span>Page {meta.page} / {meta.totalPages}</span>
        </div>
      )}

      {/* Status */}
      {isLoading && <p style={styles.status}>Loading…</p>}
      {error    && <p style={{ ...styles.status, color: '#e74c3c' }}>Error loading traps</p>}

      {/* Table */}
      {!isLoading && traps.length === 0 && (
        <p style={styles.status}>No SNMP traps found.</p>
      )}

      {traps.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Received</th>
                <th style={styles.th}>Trap Type</th>
                <th style={styles.th}>Device</th>
                <th style={styles.th}>Source IP</th>
                <th style={styles.th}>Community</th>
                <th style={styles.th}>v</th>
                <th style={styles.th}>Ack?</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {traps.map(trap => (
                <>
                  <tr
                    key={trap.id}
                    style={{
                      ...styles.tr,
                      opacity: trap.is_acknowledged ? 0.55 : 1,
                    }}
                    onClick={() => toggleExpand(trap.id)}
                  >
                    <td style={styles.td}>
                      {new Date(trap.received_at).toLocaleString()}
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: trapColor(trap.trap_type) }}>
                        {trap.trap_type}
                      </span>
                    </td>
                    <td style={styles.td}>{trap.device_name ?? '—'}</td>
                    <td style={styles.td}>{trap.source_ip}</td>
                    <td style={styles.td}>{trap.community ?? '—'}</td>
                    <td style={styles.td}>v{trap.snmp_version}</td>
                    <td style={styles.td}>
                      {trap.is_acknowledged ? (
                        <span style={{ color: '#27ae60' }}>✔ {trap.acknowledged_by_name ?? ''}</span>
                      ) : '—'}
                    </td>
                    <td style={styles.td} onClick={e => e.stopPropagation()}>
                      {!trap.is_acknowledged && (
                        <button
                          style={{ ...styles.actionBtn, background: '#27ae60' }}
                          onClick={() => ackMutation.mutate(trap.id)}
                          disabled={ackMutation.isPending}
                        >
                          Ack
                        </button>
                      )}
                      <button
                        style={{ ...styles.actionBtn, background: '#e74c3c', marginLeft: 4 }}
                        onClick={() => clearMutation.mutate(trap.id)}
                        disabled={clearMutation.isPending}
                      >
                        Clear
                      </button>
                    </td>
                  </tr>

                  {/* Expanded varbinds row */}
                  {expanded === trap.id && (
                    <tr key={`${trap.id}-expand`}>
                      <td colSpan={8} style={styles.expandTd}>
                        <div style={styles.expandContent}>
                          <div><strong>OID:</strong> {trap.trap_oid ?? '—'}</div>
                          <div style={{ marginTop: 6 }}><strong>Varbinds:</strong></div>
                          {(trap.varbinds && trap.varbinds.length > 0) ? (
                            <table style={styles.varbindTable}>
                              <thead>
                                <tr>
                                  <th style={styles.vbTh}>OID</th>
                                  <th style={styles.vbTh}>Type</th>
                                  <th style={styles.vbTh}>Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {trap.varbinds.map((vb, i) => (
                                  <tr key={i}>
                                    <td style={styles.vbTd}>{vb.oid}</td>
                                    <td style={styles.vbTd}>{vb.type}</td>
                                    <td style={styles.vbTd}>{vb.value ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <span>No varbinds</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            style={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ← Prev
          </button>
          <span style={{ color: '#aaa', margin: '0 8px' }}>
            {page} / {totalPages}
          </span>
          <button
            style={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container:    { padding: '1.5rem', color: '#eee' },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  title:        { margin: 0, fontSize: '1.3rem' },
  refreshBtn:   { background: '#333', border: '1px solid #555', color: '#ccc', padding: '5px 12px', borderRadius: 4, cursor: 'pointer' },
  filters:      { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' },
  filterInput:  { background: '#1e1e1e', border: '1px solid #444', color: '#eee', padding: '5px 8px', borderRadius: 4, fontSize: '0.85rem' },
  clearFiltersBtn: { background: '#444', border: 'none', color: '#ccc', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  summaryBar:   { display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', color: '#aaa', fontSize: '0.85rem' },
  status:       { color: '#aaa', textAlign: 'center' as const, padding: '2rem' },
  tableWrap:    { overflowX: 'auto' as const },
  table:        { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th:           { textAlign: 'left' as const, padding: '6px 10px', borderBottom: '1px solid #333', color: '#aaa', fontWeight: 600, whiteSpace: 'nowrap' as const },
  tr:           { borderBottom: '1px solid #222', cursor: 'pointer' },
  td:           { padding: '7px 10px', verticalAlign: 'middle' as const },
  badge:        { display: 'inline-block', padding: '2px 8px', borderRadius: 12, color: '#fff', fontSize: '0.75rem', fontWeight: 600 },
  actionBtn:    { border: 'none', color: '#fff', padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' },
  expandTd:     { background: '#161616', padding: '0.75rem 1rem' },
  expandContent:{ fontSize: '0.82rem', color: '#ccc' },
  varbindTable: { marginTop: 6, borderCollapse: 'collapse', width: '100%' },
  vbTh:         { textAlign: 'left' as const, padding: '3px 8px', border: '1px solid #333', color: '#aaa', fontSize: '0.78rem', background: '#222' },
  vbTd:         { padding: '3px 8px', border: '1px solid #2a2a2a', fontFamily: 'monospace', fontSize: '0.78rem' },
  pagination:   { display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' },
  pageBtn:      { background: '#333', border: '1px solid #555', color: '#ccc', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
};
