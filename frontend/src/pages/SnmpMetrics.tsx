// =============================================================================
// FireISP 5.0 — SNMP Metrics Charts
// =============================================================================
// Page at /snmp-metrics. Shows bandwidth, CPU, memory, signal, and latency
// time-series charts for any SNMP-enabled device.
//
// Features:
//   • Device selector dropdown
//   • Time range selector (24 h raw, 7 d hourly, 30 d daily)
//   • Interface selector (for per-interface bandwidth metrics)
//   • SVG line charts: Bandwidth ↓/↑, CPU, Memory, Signal, Latency
//   • Summary bar: latest CPU, memory, signal, latency values
//   • Manual refresh button
// =============================================================================

import { useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnmpDevice {
  id: number;
  name: string;
  ip_address: string | null;
  snmp_profile_id: number | null;
  status: string;
}

interface MetricRow {
  ts: string;
  interface_id: string | null;
  if_in_octets: number | null;
  if_out_octets: number | null;
  if_in_errors: number | null;
  if_out_errors: number | null;
  cpu_usage: number | null;
  memory_usage: number | null;
  signal_strength: number | null;
  latency_ms: number | null;
  min_latency_ms?: number | null;
  max_latency_ms?: number | null;
  min_cpu_usage?: number | null;
  max_cpu_usage?: number | null;
  sample_count?: number;
}

interface MetricsResponse {
  data: MetricRow[];
  meta: {
    device_id: number;
    resolution: string;
    lookback_hours: number;
    interfaces: string[];
  };
}

// ---------------------------------------------------------------------------
// Range options
// ---------------------------------------------------------------------------

interface RangeOption {
  label: string;
  resolution: 'raw' | '1hr' | '1day';
  hours: number;
}

const RANGE_OPTIONS: RangeOption[] = [
  { label: '24 h (raw)',  resolution: 'raw',  hours: 24 },
  { label: '7 d (hourly)', resolution: '1hr', hours: 168 },
  { label: '30 d (daily)', resolution: '1day', hours: 720 },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function apiFetch<T>(path: string): Promise<T> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtBytes(val: number | null): string {
  if (val == null) return '—';
  if (val < 1024) return `${val} B`;
  if (val < 1024 ** 2) return `${(val / 1024).toFixed(1)} KB`;
  if (val < 1024 ** 3) return `${(val / 1024 ** 2).toFixed(2)} MB`;
  return `${(val / 1024 ** 3).toFixed(3)} GB`;
}

function fmtPct(val: number | null): string {
  if (val == null) return '—';
  return `${Number(val).toFixed(1)} %`;
}

function fmtSignal(val: number | null): string {
  if (val == null) return '—';
  return `${val} dBm`;
}

function fmtLatency(val: number | null): string {
  if (val == null) return '—';
  return `${Number(val).toFixed(1)} ms`;
}

function fmtTimestamp(ts: string, resolution: string): string {
  const d = new Date(ts);
  if (resolution === '1day') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// SVG Line Chart component
// ---------------------------------------------------------------------------

interface Series {
  key: string;
  values: (number | null)[];
  color: string;
  label: string;
  formatValue?: (v: number | null) => string;
}

interface LineChartProps {
  title: string;
  timestamps: string[];
  series: Series[];
  resolution: string;
  height?: number;
  yUnit?: string;
}

function LineChart({ title, timestamps, series, resolution, height = 160, yUnit = '' }: LineChartProps) {
  const W = 700;
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 36, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Compute min/max across all series
  const allVals: number[] = [];
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && Number.isFinite(v)) allVals.push(v);
    }
  }

  if (allVals.length === 0) {
    return (
      <div style={cs.chartBox}>
        <div style={cs.chartTitle}>{title}</div>
        <div style={cs.chartEmpty}>No data in selected range</div>
      </div>
    );
  }

  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const valRange = maxVal - minVal || 1;

  const n = timestamps.length;

  function xPx(i: number) {
    return n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW;
  }

  function yPx(v: number) {
    return chartH - ((v - minVal) / valRange) * chartH;
  }

  function buildPath(values: (number | null)[]): string {
    let d = '';
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) continue;
      const x = xPx(i);
      const y = yPx(v);
      d += d === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return d;
  }

  // Y-axis ticks
  const tickCount = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(minVal + (valRange * i) / tickCount);
  }

  // X-axis labels — show ~5 evenly spaced
  const xLabelCount = Math.min(5, n);
  const xLabelIdxs: number[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    xLabelIdxs.push(Math.round((i / (xLabelCount - 1 || 1)) * (n - 1)));
  }

  // Format y-axis tick
  function fmtTick(v: number): string {
    if (yUnit === 'bytes') return fmtBytes(v).replace(' ', '');
    if (yUnit === 'pct') return `${v.toFixed(0)}%`;
    return v.toFixed(1);
  }

  return (
    <div style={cs.chartBox}>
      <div style={cs.chartTitle}>{title}</div>
      {/* Legend */}
      <div style={cs.legend}>
        {series.map(s => (
          <span key={s.key} style={cs.legendItem}>
            <span style={{ ...cs.legendDot, background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, display: 'block' }}
        aria-label={title}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Grid lines + Y ticks */}
          {yTicks.map((tick, i) => {
            const y = yPx(tick);
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={chartW} y2={y} stroke="#e8eaf0" strokeWidth={1} />
                <text x={-4} y={y + 4} textAnchor="end" fontSize={9} fill="#888">
                  {fmtTick(tick)}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {xLabelIdxs.map(idx => (
            <text
              key={idx}
              x={xPx(idx)}
              y={chartH + 14}
              textAnchor="middle"
              fontSize={9}
              fill="#888"
            >
              {fmtTimestamp(timestamps[idx], resolution)}
            </text>
          ))}

          {/* Series paths */}
          {series.map(s => {
            const d = buildPath(s.values);
            return d ? (
              <path
                key={s.key}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null;
          })}

          {/* Axes */}
          <line x1={0} y1={0} x2={0} y2={chartH} stroke="#ccc" strokeWidth={1} />
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="#ccc" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch Port row type (from /snmp-metrics/interfaces/:deviceId)
// ---------------------------------------------------------------------------

interface InterfaceRow {
  interface_id: string;
  if_in_octets_avg: number | null;
  if_out_octets_avg: number | null;
  if_in_octets_max: number | null;
  if_out_octets_max: number | null;
  if_in_errors_avg: number | null;
  if_out_errors_avg: number | null;
  if_in_discards_avg: number | null;
  if_out_discards_avg: number | null;
  avg_poe_power_mw: number | null;
  avg_if_oper_status: number | null;
  min_if_oper_status: number | null;
  avg_sfp_rx_power_dbm: number | null;
  avg_sfp_tx_power_dbm: number | null;
  period_start: string;
}

interface InterfacesResponse {
  data: InterfaceRow[];
  meta: { device_id: number; device_name: string; ip_address: string };
}

// ---------------------------------------------------------------------------
// Switch Ports Panel component
// ---------------------------------------------------------------------------

function operStatusLabel(status: number | null): string {
  switch (status) {
    case 1: return 'Up';
    case 2: return 'Down';
    case 3: return 'Testing';
    case 7: return 'LowerLayerDown';
    default: return status != null ? String(status) : '—';
  }
}

function operStatusColor(status: number | null): string {
  if (status === 1) return '#166534';   // green
  if (status === 2 || status === 7) return '#991b1b'; // red
  if (status === 3) return '#92400e';   // amber
  return '#6b7280'; // grey
}

function SwitchPortsPanel({ deviceId }: { deviceId: number }) {
  const { data, isLoading, error } = useQuery<InterfacesResponse>({
    queryKey: ['snmp-interfaces', deviceId],
    queryFn: () => apiFetch(`/snmp-metrics/interfaces/${deviceId}`),
    staleTime: 60_000,
    enabled: !!deviceId,
  });

  if (isLoading) return <div style={{ color: '#6b7280', fontSize: 13, padding: '8px 0' }}>Loading port status…</div>;
  if (error)     return <div style={{ color: '#dc2626', fontSize: 13, padding: '8px 0' }}>Failed to load port data.</div>;

  const rows = data?.data || [];
  if (rows.length === 0) return null;

  const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
  const thStyle: CSSProperties = { textAlign: 'left', padding: '6px 10px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#374151' };
  const tdStyle: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #f3f4f6', color: '#374151' };

  return (
    <div style={{ ...cs.chartBox, gridColumn: '1 / -1', padding: 16 }}>
      <div style={{ ...cs.chartTitle, marginBottom: 12 }}>Switch Port Status</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Port</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>In (avg)</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Out (avg)</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>In Errors</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Discards</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>PoE / RxPwr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const status = row.min_if_oper_status ?? row.avg_if_oper_status;
              return (
                <tr key={row.interface_id}>
                  <td style={tdStyle}>{row.interface_id}</td>
                  <td style={{ ...tdStyle }}>
                    <span style={{ color: operStatusColor(status ? Math.round(status) : null), fontWeight: 600 }}>
                      {operStatusLabel(status ? Math.round(status) : null)}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtBytes(row.if_in_octets_avg)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtBytes(row.if_out_octets_avg)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {row.if_in_errors_avg != null ? Number(row.if_in_errors_avg).toFixed(0) : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {row.if_in_discards_avg != null ? Number(row.if_in_discards_avg).toFixed(0) : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {row.avg_poe_power_mw != null
                      ? `${Number(row.avg_poe_power_mw).toFixed(0)} mW`
                      : row.avg_sfp_rx_power_dbm != null
                        ? `${Number(row.avg_sfp_rx_power_dbm).toFixed(2)} dBm`
                        : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SnmpMetrics() {
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [rangeIdx, setRangeIdx] = useState(1); // default: 7d hourly
  const [selectedIface, setSelectedIface] = useState<string>('');

  const range = RANGE_OPTIONS[rangeIdx];

  // Load SNMP-enabled devices
  const { data: devicesData, isLoading: devicesLoading } = useQuery<{ data: SnmpDevice[] }>({
    queryKey: ['snmp-devices'],
    queryFn: () => apiFetch('/snmp-metrics/devices'),
    staleTime: 60_000,
  });
  const devices = devicesData?.data || [];

  // Build metrics query params
  const metricsQK = ['snmp-metrics', selectedDevice, range.resolution, range.hours, selectedIface];

  const {
    data: metricsData,
    isFetching,
    refetch,
    error: metricsError,
  } = useQuery<MetricsResponse>({
    queryKey: metricsQK,
    queryFn: () => {
      const params = new URLSearchParams({
        device_id: String(selectedDevice),
        resolution: range.resolution,
        hours: String(range.hours),
        interface_id: selectedIface,
      });
      return apiFetch(`/snmp-metrics?${params}`);
    },
    enabled: selectedDevice != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = metricsData?.data || [];
  const interfaces = metricsData?.meta?.interfaces || [];

  // Build parallel arrays for charts
  const timestamps = useMemo(() => rows.map(r => r.ts), [rows]);

  const ifInOctets  = useMemo(() => rows.map(r => r.if_in_octets  != null ? Number(r.if_in_octets)  : null), [rows]);
  const ifOutOctets = useMemo(() => rows.map(r => r.if_out_octets != null ? Number(r.if_out_octets) : null), [rows]);
  const cpuUsage    = useMemo(() => rows.map(r => r.cpu_usage     != null ? Number(r.cpu_usage)     : null), [rows]);
  const memUsage    = useMemo(() => rows.map(r => r.memory_usage  != null ? Number(r.memory_usage)  : null), [rows]);
  const signal      = useMemo(() => rows.map(r => r.signal_strength != null ? Number(r.signal_strength) : null), [rows]);
  const latency     = useMemo(() => rows.map(r => r.latency_ms    != null ? Number(r.latency_ms)    : null), [rows]);

  // Latest non-null values for summary bar
  function latestVal(arr: (number | null)[]): number | null {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) return arr[i];
    }
    return null;
  }

  const latestCpu    = latestVal(cpuUsage);
  const latestMem    = latestVal(memUsage);
  const latestSignal = latestVal(signal);
  const latestLat    = latestVal(latency);

  // Determine which charts have data
  const hasBandwidth = ifInOctets.some(v => v != null) || ifOutOctets.some(v => v != null);
  const hasCpu       = cpuUsage.some(v => v != null);
  const hasMem       = memUsage.some(v => v != null);
  const hasSignal    = signal.some(v => v != null);
  const hasLatency   = latency.some(v => v != null);
  const hasAnyData   = rows.length > 0;

  return (
    <div style={cs.page}>
      {/* Header */}
      <div style={cs.header}>
        <h1 style={cs.title}>📶 SNMP Metrics</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching || !selectedDevice}
          style={cs.refreshBtn}
        >
          {isFetching ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Controls */}
      <div style={cs.controls}>
        {/* Device selector */}
        <div style={cs.controlGroup}>
          <label style={cs.controlLabel}>Device</label>
          <select
            value={selectedDevice ?? ''}
            onChange={e => {
              setSelectedDevice(e.target.value ? Number(e.target.value) : null);
              setSelectedIface('');
            }}
            style={cs.select}
          >
            <option value="">
              {devicesLoading ? 'Loading…' : devices.length === 0 ? 'No SNMP devices' : '— select device —'}
            </option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}{d.ip_address ? ` (${d.ip_address})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Time range */}
        <div style={cs.controlGroup}>
          <label style={cs.controlLabel}>Range</label>
          <div style={cs.rangeGroup}>
            {RANGE_OPTIONS.map((opt, i) => (
              <button
                key={opt.label}
                onClick={() => { setRangeIdx(i); setSelectedIface(''); }}
                style={i === rangeIdx ? cs.rangeActive : cs.rangeBtn}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interface selector — only show when there are per-interface metrics */}
        {interfaces.length > 0 && (
          <div style={cs.controlGroup}>
            <label style={cs.controlLabel}>Interface</label>
            <select
              value={selectedIface}
              onChange={e => setSelectedIface(e.target.value)}
              style={cs.select}
            >
              <option value="">All interfaces</option>
              {interfaces.map(iface => (
                <option key={iface} value={iface}>{iface}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Error */}
      {metricsError && (
        <div style={cs.errorBanner}>
          ⚠ {metricsError instanceof Error ? metricsError.message : 'Failed to load metrics'}
        </div>
      )}

      {/* Empty state */}
      {!selectedDevice && (
        <div style={cs.empty}>Select a device to view its SNMP metrics charts.</div>
      )}

      {selectedDevice && !isFetching && rows.length === 0 && !metricsError && (
        <div style={cs.empty}>
          No SNMP data found for the selected device and time range.<br />
          <span style={{ color: '#aaa', fontSize: '0.82rem' }}>
            Make sure the SNMP poller has run and the device is online.
          </span>
        </div>
      )}

      {/* Summary bar */}
      {hasAnyData && (
        <div style={cs.summaryBar}>
          <div style={cs.summaryCard}>
            <div style={{ ...cs.summaryValue, color: latestCpu != null && latestCpu > 90 ? '#c0392b' : 'var(--text-primary)' }}>
              {fmtPct(latestCpu)}
            </div>
            <div style={cs.summaryLabel}>CPU (latest)</div>
          </div>
          <div style={cs.summaryCard}>
            <div style={{ ...cs.summaryValue, color: latestMem != null && latestMem > 90 ? '#c0392b' : 'var(--text-primary)' }}>
              {fmtPct(latestMem)}
            </div>
            <div style={cs.summaryLabel}>Memory (latest)</div>
          </div>
          <div style={cs.summaryCard}>
            <div style={cs.summaryValue}>{fmtSignal(latestSignal)}</div>
            <div style={cs.summaryLabel}>Signal (latest)</div>
          </div>
          <div style={cs.summaryCard}>
            <div style={cs.summaryValue}>{fmtLatency(latestLat)}</div>
            <div style={cs.summaryLabel}>Latency (latest)</div>
          </div>
          <div style={cs.summaryCard}>
            <div style={cs.summaryValue}>{rows.length}</div>
            <div style={cs.summaryLabel}>Data points</div>
          </div>
        </div>
      )}

      {/* Charts */}
      {hasAnyData && (
        <div style={cs.chartsGrid}>
          {hasBandwidth && (
            <LineChart
              title="Bandwidth (bytes)"
              timestamps={timestamps}
              resolution={range.resolution}
              yUnit="bytes"
              series={[
                { key: 'in',  values: ifInOctets,  color: '#2980b9', label: '↓ In'  },
                { key: 'out', values: ifOutOctets, color: 'var(--accent)', label: '↑ Out' },
              ]}
            />
          )}

          {hasCpu && (
            <LineChart
              title="CPU Usage (%)"
              timestamps={timestamps}
              resolution={range.resolution}
              yUnit="pct"
              height={140}
              series={[
                { key: 'cpu', values: cpuUsage, color: '#8e44ad', label: 'CPU %' },
              ]}
            />
          )}

          {hasMem && (
            <LineChart
              title="Memory Usage (%)"
              timestamps={timestamps}
              resolution={range.resolution}
              yUnit="pct"
              height={140}
              series={[
                { key: 'mem', values: memUsage, color: '#27ae60', label: 'Memory %' },
              ]}
            />
          )}

          {hasSignal && (
            <LineChart
              title="Signal Strength (dBm)"
              timestamps={timestamps}
              resolution={range.resolution}
              yUnit=""
              height={140}
              series={[
                { key: 'sig', values: signal, color: '#f39c12', label: 'Signal dBm' },
              ]}
            />
          )}

          {hasLatency && (
            <LineChart
              title="Latency (ms)"
              timestamps={timestamps}
              resolution={range.resolution}
              yUnit=""
              height={140}
              series={[
                { key: 'lat', values: latency, color: '#16a085', label: 'Latency ms' },
              ]}
            />
          )}

          {/* Switch Ports Panel — shown when device has per-interface data */}
          {selectedDevice != null && interfaces.length > 0 && (
            <SwitchPortsPanel deviceId={selectedDevice} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cs: Record<string, CSSProperties> = {
  page: { padding: '1.5rem', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  title: { margin: 0, fontSize: '1.4rem' },
  refreshBtn: {
    padding: '6px 14px', background: 'var(--sidebar-bg)', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },

  controls: { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.25rem' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  controlLabel: { fontSize: '0.75rem', fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: {
    padding: '6px 10px', border: '1px solid var(--input-border)', borderRadius: 4,
    fontSize: '0.85rem', minWidth: 200, background: 'var(--input-bg)',
  },
  rangeGroup: { display: 'flex', gap: 4 },
  rangeBtn: {
    padding: '6px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-secondary)',
  },
  rangeActive: {
    padding: '6px 12px', background: 'var(--accent)', border: '1px solid var(--accent)',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', color: '#fff', fontWeight: 600,
  },

  errorBanner: {
    background: '#fdf0ed', border: '1px solid #e8b4a8', borderRadius: 6,
    padding: '0.75rem 1rem', color: '#c0392b', marginBottom: '1rem',
  },
  empty: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '3rem 2rem',
    textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic',
    boxShadow: '0 0 0 1px var(--border)', lineHeight: 1.8,
  },

  summaryBar: { display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  summaryCard: {
    flex: '1 1 120px', background: 'var(--bg-card)', borderRadius: 8,
    padding: '0.8rem 1rem', boxShadow: '0 0 0 1px var(--border)', minWidth: 100,
  },
  summaryValue: { fontSize: '1.4rem', fontWeight: 700 },
  summaryLabel: { fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 2 },

  chartsGrid: { display: 'flex', flexDirection: 'column', gap: '1rem' },

  chartBox: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '1rem 1.25rem',
    boxShadow: '0 0 0 1px var(--border)',
  },
  chartTitle: { fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.4rem', color: 'var(--text-primary)' },
  chartEmpty: { color: 'var(--text-faint)', fontStyle: 'italic', fontSize: '0.85rem', padding: '1rem 0' },
  legend: { display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-muted)' },
  legendDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
};
