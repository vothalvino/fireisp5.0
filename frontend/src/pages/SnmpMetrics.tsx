// =============================================================================
// FireISP 5.0 — SNMP Metrics
// =============================================================================
// Page at /snmp-metrics. Two-level UX:
//
//   Level 1 — Fleet glance (default, no ?device_id in the URL): a card grid
//   from GET /snmp-metrics/fleet showing every SNMP-enabled device's status,
//   CPU/memory, uptime, current in/out throughput rate, a CPU sparkline, and
//   poll-failure count at a glance. Click a card to drill in.
//
//   Level 2 — Device history (?device_id=... in the URL, deep-linkable):
//   the original time-series charts (bandwidth/CPU/memory/signal/latency),
//   upgraded with a URL-backed range/interface selector, a hover tooltip
//   with a crosshair, and a Throughput chart that plots actual bits/sec
//   rates (computed client-side from consecutive counter samples) instead
//   of raw monotonic counter positions.
//
// GET /snmp-metrics/top-talkers is intentionally NOT surfaced here — its
// total_bytes math sums averaged raw counters and is known-broken; see the
// PR description for this change.
// =============================================================================

import { useState, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';
import { Badge, Sparkline, type BadgeTone } from '@/components/ui';
import { seriesToRates, currentRate, fmtBps, type TrafficSample } from './snmpMetrics/rateTransform';
import { fmtUptimeTicks, fmtRelativeTime, fmtPct, fmtSignal, fmtLatency, normalizeCpuSpark } from './snmpMetrics/format';

// ---------------------------------------------------------------------------
// Local page-root CSS custom properties (chart series colors) — validated
// against the app's light/dark surfaces. Scoped to this page only, with a
// [data-theme="dark"] override, per the app's theming convention.
// ---------------------------------------------------------------------------

const VIZ_CSS = `
  .fi-snmp-metrics { --viz-in: #2a78d6; --viz-out: #eb6834; --viz-aqua: #1baf7a; }
  [data-theme="dark"] .fi-snmp-metrics { --viz-in: #3987e5; --viz-out: #d95926; --viz-aqua: #199e70; }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricRow {
  ts: string;
  interface_id: string | null;
  if_in_octets: number | string | null;
  if_out_octets: number | string | null;
  if_in_errors: number | string | null;
  if_out_errors: number | string | null;
  cpu_usage: number | string | null;
  memory_usage: number | string | null;
  signal_strength: number | string | null;
  latency_ms: number | string | null;
  uptime_ticks?: number | string | null;
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

interface FleetLatest {
  cpu_usage: number | string | null;
  memory_usage: number | string | null;
  uptime_ticks: number | string | null;
  polled_at: string | null;
}

interface FleetCpuSparkPoint {
  t: string;
  v: number | string | null;
}

export interface FleetDevice {
  id: number;
  name: string;
  ip_address?: string | null;
  type: string | null;
  status: string;
  site_id: number | null;
  consecutive_poll_failures: number;
  last_polled_at: string | null;
  last_poll_error: string | null;
  latest: FleetLatest | null;
  cpu_spark: FleetCpuSparkPoint[];
  traffic_samples: TrafficSample[];
}

interface FleetResponse {
  data: FleetDevice[];
}

// ---------------------------------------------------------------------------
// Range options
// ---------------------------------------------------------------------------

interface RangeOption {
  labelKey: string;
  resolution: 'raw' | '1hr' | '1day';
  hours: number;
}

const RANGE_OPTIONS: RangeOption[] = [
  { labelKey: 'snmpMetrics.history.rangeOptions.raw24h',   resolution: 'raw',  hours: 24 },
  { labelKey: 'snmpMetrics.history.rangeOptions.hourly7d', resolution: '1hr',  hours: 168 },
  { labelKey: 'snmpMetrics.history.rangeOptions.daily30d', resolution: '1day', hours: 720 },
];
const DEFAULT_RANGE_IDX = 1; // 7d hourly

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
    const message = (body as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtBytes(val: number | string | null): string {
  if (val == null) return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(3)} GB`;
}

function fmtTimestamp(ts: string, resolution: string): string {
  const d = new Date(ts);
  if (resolution === '1day') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Accessible clickable-card affordance (matches the KPI-tile idiom used in
// the operations console: role="link", keyboard-activatable, aria-label).
// ---------------------------------------------------------------------------

function linkableProps(onActivate: () => void, label: string) {
  return {
    role: 'link' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// SVG Line Chart component — with hover crosshair + tooltip
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
  yUnit?: 'bytes' | 'pct' | 'bps' | '';
  emptyLabel: string;
}

function LineChart({ title, timestamps, series, resolution, height = 160, yUnit = '', emptyLabel }: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 700;
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 36, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const allVals: number[] = [];
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && Number.isFinite(v)) allVals.push(v);
    }
  }

  const n = timestamps.length;

  if (allVals.length === 0) {
    return (
      <div style={cs.chartBox}>
        <div style={cs.chartTitle}>{title}</div>
        <div style={cs.chartEmpty}>{emptyLabel}</div>
      </div>
    );
  }

  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals);
  const valRange = maxVal - minVal || 1;

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

  const tickCount = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(minVal + (valRange * i) / tickCount);
  }

  const xLabelCount = Math.min(5, n);
  const xLabelIdxs: number[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    xLabelIdxs.push(Math.round((i / (xLabelCount - 1 || 1)) * (n - 1)));
  }

  function fmtTick(v: number): string {
    if (yUnit === 'bytes') return fmtBytes(v).replace(' ', '');
    if (yUnit === 'pct') return `${v.toFixed(0)}%`;
    if (yUnit === 'bps') return fmtBps(v);
    return v.toFixed(1);
  }

  function handleMouseMove(e: ReactMouseEvent<SVGRectElement>) {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = n <= 1 ? 0 : Math.round(relX * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  }
  function handleMouseLeave() {
    setHoverIdx(null);
  }

  const hoverLeftPct = hoverIdx != null ? ((PAD.left + xPx(hoverIdx)) / W) * 100 : null;

  return (
    <div style={{ ...cs.chartBox, position: 'relative' }}>
      <div style={cs.chartTitle}>{title}</div>
      {series.length > 1 && (
        <div style={cs.legend}>
          {series.map(s => (
            <span key={s.key} style={cs.legendItem}>
              <span style={{ ...cs.legendDot, background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, display: 'block' }}
        aria-label={title}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {yTicks.map((tick, i) => {
            const y = yPx(tick);
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={chartW} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={-4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">
                  {fmtTick(tick)}
                </text>
              </g>
            );
          })}

          {xLabelIdxs.map(idx => (
            <text
              key={idx}
              x={xPx(idx)}
              y={chartH + 14}
              textAnchor="middle"
              fontSize={9}
              fill="var(--text-muted)"
            >
              {fmtTimestamp(timestamps[idx], resolution)}
            </text>
          ))}

          {series.map(s => {
            const d = buildPath(s.values);
            return d ? (
              <path
                key={s.key}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null;
          })}

          {hoverIdx != null && (
            <>
              <line x1={xPx(hoverIdx)} y1={0} x2={xPx(hoverIdx)} y2={chartH} stroke="var(--border-strong)" strokeWidth={1} />
              {series.map(s => {
                const v = s.values[hoverIdx];
                if (v == null) return null;
                return <circle key={s.key} cx={xPx(hoverIdx)} cy={yPx(v)} r={3} fill={s.color} />;
              })}
            </>
          )}

          <line x1={0} y1={0} x2={0} y2={chartH} stroke="var(--border)" strokeWidth={1} />
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="var(--border)" strokeWidth={1} />

          {/* Transparent hit rect (drawn last so it captures the pointer) for the crosshair/tooltip */}
          <rect
            data-testid="snmp-chart-hit-rect"
            x={0}
            y={0}
            width={chartW}
            height={chartH}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </g>
      </svg>
      {hoverIdx != null && hoverLeftPct != null && (
        <div
          style={{
            ...cs.tooltip,
            left: `${Math.min(92, Math.max(8, hoverLeftPct))}%`,
          }}
        >
          <div style={cs.tooltipTime}>{fmtTimestamp(timestamps[hoverIdx], resolution)}</div>
          {series.map(s => {
            const v = s.values[hoverIdx];
            return (
              <div key={s.key} style={cs.tooltipRow}>
                <span style={{ ...cs.legendDot, background: s.color }} />
                <span>{s.label}: {v == null ? '—' : (s.formatValue ? s.formatValue(v) : String(v))}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch Port row type (from /snmp-metrics/interfaces/:deviceId)
// ---------------------------------------------------------------------------

interface InterfaceRow {
  interface_id: string;
  if_in_octets_avg: number | string | null;
  if_out_octets_avg: number | string | null;
  if_in_errors_avg: number | string | null;
  if_in_discards_avg: number | string | null;
  avg_poe_power_mw: number | string | null;
  avg_if_oper_status: number | string | null;
  min_if_oper_status: number | string | null;
  avg_sfp_rx_power_dbm: number | string | null;
  period_start: string;
}

interface InterfacesResponse {
  data: InterfaceRow[];
  meta: { device_id: number; device_name: string; ip_address: string };
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function operStatusLabel(status: number | null, t: TFn): string {
  switch (status) {
    case 1: return t('snmpMetrics.history.switchPorts.statusUp');
    case 2: return t('snmpMetrics.history.switchPorts.statusDown');
    case 3: return t('snmpMetrics.history.switchPorts.statusTesting');
    case 7: return t('snmpMetrics.history.switchPorts.statusLowerLayerDown');
    default: return status != null ? String(status) : '—';
  }
}

function operStatusTone(status: number | null): BadgeTone {
  if (status === 1) return 'success';
  if (status === 2 || status === 7) return 'danger';
  if (status === 3) return 'warning';
  return 'neutral';
}

function SwitchPortsPanel({ deviceId }: { deviceId: number }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery<InterfacesResponse>({
    queryKey: ['snmp-interfaces', deviceId],
    queryFn: () => apiFetch(`/snmp-metrics/interfaces/${deviceId}`),
    staleTime: 60_000,
    enabled: !!deviceId,
  });

  if (isLoading) return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>{t('snmpMetrics.history.switchPorts.loading')}</div>;
  if (error)     return <div style={{ color: 'var(--danger)', fontSize: 13, padding: '8px 0' }}>{t('snmpMetrics.history.switchPorts.error')}</div>;

  const rows = data?.data || [];
  if (rows.length === 0) return null;

  const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
  const thStyle: CSSProperties = { textAlign: 'left', padding: '6px 10px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-secondary)' };
  const tdStyle: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' };

  return (
    <div style={{ ...cs.chartBox, gridColumn: '1 / -1', padding: 16 }}>
      <div style={{ ...cs.chartTitle, marginBottom: 12 }}>{t('snmpMetrics.history.switchPorts.title')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{t('snmpMetrics.history.switchPorts.port')}</th>
              <th style={thStyle}>{t('snmpMetrics.history.switchPorts.status')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('snmpMetrics.history.switchPorts.inAvg')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('snmpMetrics.history.switchPorts.outAvg')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('snmpMetrics.history.switchPorts.inErrors')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('snmpMetrics.history.switchPorts.discards')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('snmpMetrics.history.switchPorts.poeRx')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const statusRaw = row.min_if_oper_status ?? row.avg_if_oper_status;
              const status = statusRaw != null ? Math.round(Number(statusRaw)) : null;
              return (
                <tr key={row.interface_id}>
                  <td style={tdStyle}>{row.interface_id}</td>
                  <td style={tdStyle}>
                    <Badge tone={operStatusTone(status)}>{operStatusLabel(status, t)}</Badge>
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
// Not-found panel (shared: malformed device_id AND legitimate cross-org 404)
// ---------------------------------------------------------------------------

function NotFoundPanel({ onBack, t }: { onBack: () => void; t: TFn }) {
  return (
    <div className="fi-snmp-metrics" style={cs.page}>
      <style>{VIZ_CSS}</style>
      <BackLink onBack={onBack} t={t} />
      <div style={cs.notFoundBox}>
        <div style={cs.notFoundTitle}>{t('snmpMetrics.history.notFound.title')}</div>
        <div style={{ color: 'var(--text-muted)' }}>{t('snmpMetrics.history.notFound.message')}</div>
      </div>
    </div>
  );
}

function BackLink({ onBack, t }: { onBack: () => void; t: TFn }) {
  return (
    <button type="button" onClick={onBack} style={cs.backLink}>
      {t('snmpMetrics.history.backToFleet')}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Fleet card
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, BadgeTone> = { online: 'success', offline: 'danger', maintenance: 'warning' };

function FleetCard({ device, onSelect, t }: { device: FleetDevice; onSelect: (id: number) => void; t: TFn }) {
  const tone = STATUS_TONE[device.status] ?? 'neutral';
  const statusLabel = t(`snmpMetrics.fleet.status.${device.status}`, { defaultValue: device.status });
  const hasData = device.latest != null;
  const cpu = device.latest?.cpu_usage != null ? Number(device.latest.cpu_usage) : null;
  const mem = device.latest?.memory_usage != null ? Number(device.latest.memory_usage) : null;
  const uptime = fmtUptimeTicks(device.latest?.uptime_ticks ?? null);
  const { inBps, outBps } = currentRate(device.traffic_samples);
  const lastPolled = fmtRelativeTime(device.last_polled_at, t);
  // normalizeCpuSpark maps the raw 0-100 CPU% samples into Sparkline's
  // viewBox coordinate space — Sparkline plots values verbatim as y, so an
  // un-normalized percentage clips off the bottom of the vbH=24 viewBox
  // above ~24% (busiest devices would render a flat/empty line).
  const sparkPoints = normalizeCpuSpark(device.cpu_spark.map(p => p.v), 24);

  const activate = () => onSelect(device.id);
  const linkProps = linkableProps(activate, t('snmpMetrics.fleet.viewHistory', { name: device.name }));

  return (
    <div style={cs.fleetCard} {...linkProps}>
      <div style={cs.fleetCardHeader}>
        <span style={cs.fleetCardName}>{device.name}</span>
        <Badge tone={tone}>{statusLabel}</Badge>
      </div>

      {!hasData ? (
        <div style={cs.fleetCardNoData}>{t('snmpMetrics.fleet.noDataYet')}</div>
      ) : (
        <>
          <MetricBar
            label={t('snmpMetrics.fleet.cpu')}
            value={cpu}
            display={fmtPct(cpu)}
            color="var(--viz-in)"
          />
          <MetricBar
            label={t('snmpMetrics.fleet.memory')}
            value={mem}
            display={fmtPct(mem)}
            color="var(--viz-aqua)"
          />

          <div style={cs.fleetSparkRow}>
            <Sparkline points={sparkPoints.length > 0 ? sparkPoints : null} stroke="var(--viz-in)" vbW={100} vbH={24} h={24} />
          </div>

          <div style={cs.fleetRateRow}>
            <span>{t('snmpMetrics.fleet.inRate')}: {fmtBps(inBps)}</span>
            <span>{t('snmpMetrics.fleet.outRate')}: {fmtBps(outBps)}</span>
          </div>

          <div style={cs.fleetFooterRow}>
            <span>{t('snmpMetrics.fleet.uptime')}: {uptime}</span>
            <span>{t('snmpMetrics.fleet.lastPolled')}: {lastPolled}</span>
          </div>
        </>
      )}

      {device.consecutive_poll_failures > 0 && (
        <div style={cs.fleetPollFailures} title={device.last_poll_error ?? undefined}>
          {t('snmpMetrics.fleet.pollFailures', { count: device.consecutive_poll_failures })}
        </div>
      )}
    </div>
  );
}

function MetricBar({ label, value, display, color }: { label: string; value: number | null; display: string; color: string }) {
  const critical = value != null && value > 90;
  return (
    <>
      <div style={cs.fleetMetricRow}>
        <span style={cs.fleetMetricLabel}>{label}</span>
        <span style={{ ...cs.fleetMetricValue, color: critical ? 'var(--danger)' : undefined }}>{display}</span>
      </div>
      <div style={cs.miniBarTrack}>
        <div style={{ ...cs.miniBarFill, width: `${Math.min(100, Math.max(0, value ?? 0))}%`, background: critical ? 'var(--danger)' : color }} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Level 1 — Fleet glance
// ---------------------------------------------------------------------------

function FleetGlance({
  devices, isLoading, isFetching, error, onRefresh, onSelect, t,
}: {
  devices: FleetDevice[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRefresh: () => void;
  onSelect: (id: number) => void;
  t: TFn;
}) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(d => `${d.name} ${d.ip_address ?? ''}`.toLowerCase().includes(q));
  }, [devices, filter]);

  return (
    <div className="fi-snmp-metrics" style={cs.page}>
      <style>{VIZ_CSS}</style>
      <div style={cs.header}>
        <h1 style={cs.title}>📶 {t('snmpMetrics.title')}</h1>
        <button onClick={onRefresh} disabled={isFetching} style={cs.refreshBtn}>
          {isFetching ? t('snmpMetrics.refreshing') : t('snmpMetrics.refresh')}
        </button>
      </div>

      {!isLoading && !error && devices.length > 0 && (
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('snmpMetrics.fleet.filterPlaceholder')}
          style={cs.filterInput}
          aria-label={t('snmpMetrics.fleet.filterPlaceholder')}
        />
      )}

      {isLoading ? (
        <div style={cs.empty}>{t('snmpMetrics.fleet.loading')}</div>
      ) : error ? (
        <div style={cs.errorBanner}>⚠ {t('snmpMetrics.fleet.error')}</div>
      ) : devices.length === 0 ? (
        <div style={cs.empty}>{t('snmpMetrics.fleet.noDevices')}</div>
      ) : filtered.length === 0 ? (
        <div style={cs.empty}>{t('snmpMetrics.fleet.noMatch')}</div>
      ) : (
        <div style={cs.fleetGrid}>
          {filtered.map(d => <FleetCard key={d.id} device={d} onSelect={onSelect} t={t} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 2 — Device history
// ---------------------------------------------------------------------------

function DeviceHistoryView({
  deviceId, rangeIdx, onSetRange, interfaceId, onSetInterface, onBack, fleetDevice, onRefreshFleet, t,
}: {
  deviceId: number;
  rangeIdx: number;
  onSetRange: (idx: number) => void;
  interfaceId: string;
  onSetInterface: (iface: string) => void;
  onBack: () => void;
  fleetDevice: FleetDevice | null;
  onRefreshFleet: () => void;
  t: TFn;
}) {
  const range = RANGE_OPTIONS[rangeIdx];

  const metricsQK = ['snmp-metrics', deviceId, range.resolution, range.hours, interfaceId];
  const {
    data: metricsData,
    isFetching,
    refetch,
    error: metricsError,
  } = useQuery<MetricsResponse>({
    queryKey: metricsQK,
    queryFn: () => {
      const params = new URLSearchParams({
        device_id: String(deviceId),
        resolution: range.resolution,
        hours: String(range.hours),
        interface_id: interfaceId,
      });
      return apiFetch(`/snmp-metrics?${params}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const notFound = metricsError instanceof ApiError && metricsError.status === 404;

  const rows = metricsData?.data || [];
  const interfaces = metricsData?.meta?.interfaces || [];

  const timestamps = useMemo(() => rows.map(r => r.ts), [rows]);
  const ifInOctets  = useMemo(() => rows.map(r => r.if_in_octets), [rows]);
  const ifOutOctets = useMemo(() => rows.map(r => r.if_out_octets), [rows]);
  const inRates  = useMemo(() => seriesToRates(timestamps, ifInOctets), [timestamps, ifInOctets]);
  const outRates = useMemo(() => seriesToRates(timestamps, ifOutOctets), [timestamps, ifOutOctets]);
  const cpuUsage = useMemo(() => rows.map(r => r.cpu_usage     != null ? Number(r.cpu_usage)     : null), [rows]);
  const memUsage = useMemo(() => rows.map(r => r.memory_usage  != null ? Number(r.memory_usage)  : null), [rows]);
  const signal   = useMemo(() => rows.map(r => r.signal_strength != null ? Number(r.signal_strength) : null), [rows]);
  const latency  = useMemo(() => rows.map(r => r.latency_ms    != null ? Number(r.latency_ms)    : null), [rows]);

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

  // uptime_ticks only exists on the raw-resolution rows; rollups don't carry
  // it, so fall back to the fleet card's device-level latest reading.
  const rawUptimeTicks = range.resolution === 'raw'
    ? latestVal(rows.map(r => r.uptime_ticks != null ? Number(r.uptime_ticks) : null))
    : null;
  const uptimeTicks = rawUptimeTicks ?? fleetDevice?.latest?.uptime_ticks ?? null;

  const hasThroughput = inRates.some(v => v != null) || outRates.some(v => v != null);
  const hasCpu        = cpuUsage.some(v => v != null);
  const hasMem        = memUsage.some(v => v != null);
  const hasSignal     = signal.some(v => v != null);
  const hasLatency    = latency.some(v => v != null);
  const hasAnyData    = rows.length > 0;

  const deviceName = fleetDevice?.name ?? t('snmpMetrics.history.deviceFallback', { id: deviceId });

  function handleRefresh() {
    refetch();
    onRefreshFleet();
  }

  // All hooks above are called unconditionally on every render; branching to
  // the not-found panel only here (after every hook has run) keeps hook
  // call order stable across renders.
  if (notFound) {
    return <NotFoundPanel onBack={onBack} t={t} />;
  }

  return (
    <div className="fi-snmp-metrics" style={cs.page}>
      <style>{VIZ_CSS}</style>
      <div style={cs.header}>
        <div>
          <BackLink onBack={onBack} t={t} />
          <h1 style={cs.title}>📶 {deviceName}</h1>
        </div>
        <button onClick={handleRefresh} disabled={isFetching} style={cs.refreshBtn}>
          {isFetching ? t('snmpMetrics.refreshing') : t('snmpMetrics.refresh')}
        </button>
      </div>

      <div style={cs.controls}>
        <div style={cs.controlGroup}>
          <label style={cs.controlLabel}>{t('snmpMetrics.history.range')}</label>
          <div style={cs.rangeGroup}>
            {RANGE_OPTIONS.map((opt, i) => (
              <button
                key={opt.resolution}
                onClick={() => onSetRange(i)}
                style={i === rangeIdx ? cs.rangeActive : cs.rangeBtn}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {interfaces.length > 0 && (
          <div style={cs.controlGroup}>
            <label style={cs.controlLabel}>{t('snmpMetrics.history.interface')}</label>
            <select
              value={interfaceId}
              onChange={e => onSetInterface(e.target.value)}
              style={cs.select}
            >
              <option value="">{t('snmpMetrics.history.allInterfaces')}</option>
              {interfaces.map(iface => (
                <option key={iface} value={iface}>{iface}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {metricsError && (
        <div style={cs.errorBanner}>
          ⚠ {metricsError instanceof Error ? metricsError.message : t('snmpMetrics.history.error')}
        </div>
      )}

      {!isFetching && rows.length === 0 && !metricsError && (
        <div style={cs.empty}>
          {t('snmpMetrics.history.noData.title')}<br />
          <span style={{ color: 'var(--text-faint)', fontSize: '0.82rem' }}>
            {t('snmpMetrics.history.noData.hint')}
          </span>
        </div>
      )}

      <div style={{ opacity: isFetching && hasAnyData ? 0.55 : 1, transition: 'opacity 150ms' }}>
        {hasAnyData && (
          <>
            <div style={cs.summaryBar}>
              <SummaryTile label={t('snmpMetrics.history.summary.cpu')} value={fmtPct(latestCpu)} danger={latestCpu != null && latestCpu > 90} />
              <SummaryTile label={t('snmpMetrics.history.summary.memory')} value={fmtPct(latestMem)} danger={latestMem != null && latestMem > 90} />
              <SummaryTile label={t('snmpMetrics.history.summary.signal')} value={fmtSignal(latestSignal)} />
              <SummaryTile label={t('snmpMetrics.history.summary.latency')} value={fmtLatency(latestLat)} />
              {uptimeTicks != null && (
                <SummaryTile label={t('snmpMetrics.history.summary.uptime')} value={fmtUptimeTicks(uptimeTicks)} />
              )}
              {fleetDevice?.last_polled_at && (
                <SummaryTile label={t('snmpMetrics.history.summary.lastPoll')} value={fmtRelativeTime(fleetDevice.last_polled_at, t)} />
              )}
              <SummaryTile label={t('snmpMetrics.history.summary.dataPoints')} value={String(rows.length)} />
            </div>

            <div style={cs.chartsGrid}>
              {hasThroughput && (
                <LineChart
                  title={t('snmpMetrics.history.charts.throughput')}
                  timestamps={timestamps}
                  resolution={range.resolution}
                  yUnit="bps"
                  emptyLabel={t('snmpMetrics.history.charts.noData')}
                  series={[
                    { key: 'in',  values: inRates,  color: 'var(--viz-in)',  label: t('snmpMetrics.history.legend.in'),  formatValue: fmtBps },
                    { key: 'out', values: outRates, color: 'var(--viz-out)', label: t('snmpMetrics.history.legend.out'), formatValue: fmtBps },
                  ]}
                />
              )}

              {hasCpu && (
                <LineChart
                  title={t('snmpMetrics.history.charts.cpu')}
                  timestamps={timestamps}
                  resolution={range.resolution}
                  yUnit="pct"
                  height={140}
                  emptyLabel={t('snmpMetrics.history.charts.noData')}
                  series={[{ key: 'cpu', values: cpuUsage, color: 'var(--viz-in)', label: t('snmpMetrics.history.charts.cpu'), formatValue: fmtPct }]}
                />
              )}

              {hasMem && (
                <LineChart
                  title={t('snmpMetrics.history.charts.memory')}
                  timestamps={timestamps}
                  resolution={range.resolution}
                  yUnit="pct"
                  height={140}
                  emptyLabel={t('snmpMetrics.history.charts.noData')}
                  series={[{ key: 'mem', values: memUsage, color: 'var(--viz-aqua)', label: t('snmpMetrics.history.charts.memory'), formatValue: fmtPct }]}
                />
              )}

              {hasSignal && (
                <LineChart
                  title={t('snmpMetrics.history.charts.signal')}
                  timestamps={timestamps}
                  resolution={range.resolution}
                  height={140}
                  emptyLabel={t('snmpMetrics.history.charts.noData')}
                  series={[{ key: 'sig', values: signal, color: '#f39c12', label: t('snmpMetrics.history.charts.signal'), formatValue: fmtSignal }]}
                />
              )}

              {hasLatency && (
                <LineChart
                  title={t('snmpMetrics.history.charts.latency')}
                  timestamps={timestamps}
                  resolution={range.resolution}
                  height={140}
                  emptyLabel={t('snmpMetrics.history.charts.noData')}
                  series={[{ key: 'lat', values: latency, color: '#16a085', label: t('snmpMetrics.history.charts.latency'), formatValue: fmtLatency }]}
                />
              )}

              {interfaces.length > 0 && (
                <SwitchPortsPanel deviceId={deviceId} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={cs.summaryCard}>
      <div style={{ ...cs.summaryValue, color: danger ? 'var(--danger)' : 'var(--text-primary)' }}>{value}</div>
      <div style={cs.summaryLabel}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — URL-state orchestration
// ---------------------------------------------------------------------------

export function SnmpMetrics() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const deviceIdParam = searchParams.get('device_id');
  const hasDeviceIdParam = deviceIdParam != null && deviceIdParam.trim() !== '';
  const parsedDeviceId = hasDeviceIdParam ? Number(deviceIdParam) : null;
  const deviceIdInvalid = hasDeviceIdParam && (!Number.isInteger(parsedDeviceId) || (parsedDeviceId as number) <= 0);
  const deviceId = hasDeviceIdParam && !deviceIdInvalid ? (parsedDeviceId as number) : null;

  const rangeParam = searchParams.get('range');
  const foundRangeIdx = RANGE_OPTIONS.findIndex(r => r.resolution === rangeParam);
  const rangeIdx = foundRangeIdx >= 0 ? foundRangeIdx : DEFAULT_RANGE_IDX;

  const interfaceId = searchParams.get('interface') ?? '';

  const fleetQuery = useQuery<FleetResponse>({
    queryKey: ['snmp-fleet'],
    queryFn: () => apiFetch('/snmp-metrics/fleet'),
    staleTime: 30_000,
  });
  const fleetDevices = fleetQuery.data?.data ?? [];

  function selectDevice(id: number) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('device_id', String(id));
      next.delete('interface');
      return next;
    });
  }
  function goToFleet() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('device_id');
      next.delete('interface');
      return next;
    });
  }
  function setRange(idx: number) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('range', RANGE_OPTIONS[idx].resolution);
      next.delete('interface');
      return next;
    });
  }
  function setInterfaceId(iface: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (iface) next.set('interface', iface);
      else next.delete('interface');
      return next;
    });
  }

  if (deviceIdInvalid) {
    return <NotFoundPanel onBack={goToFleet} t={t} />;
  }

  if (deviceId != null) {
    const fleetDevice = fleetDevices.find(d => d.id === deviceId) ?? null;
    return (
      <DeviceHistoryView
        deviceId={deviceId}
        rangeIdx={rangeIdx}
        onSetRange={setRange}
        interfaceId={interfaceId}
        onSetInterface={setInterfaceId}
        onBack={goToFleet}
        fleetDevice={fleetDevice}
        onRefreshFleet={() => fleetQuery.refetch()}
        t={t}
      />
    );
  }

  return (
    <FleetGlance
      devices={fleetDevices}
      isLoading={fleetQuery.isLoading}
      isFetching={fleetQuery.isFetching}
      error={fleetQuery.error}
      onRefresh={() => fleetQuery.refetch()}
      onSelect={selectDevice}
      t={t}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cs: Record<string, CSSProperties> = {
  page: { padding: '1.5rem', fontFamily: 'var(--font-sans)', fontSize: '0.9rem' },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  title: { margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)' },
  refreshBtn: {
    padding: '6px 14px', background: 'var(--sidebar-bg)', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  backLink: {
    display: 'inline-block', marginBottom: 4, padding: 0, border: 'none', background: 'none',
    color: 'var(--link)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
  },

  filterInput: {
    padding: '8px 12px', border: '1px solid var(--input-border)', borderRadius: 4,
    fontSize: '0.85rem', background: 'var(--input-bg)', color: 'var(--text-primary)',
    width: '100%', maxWidth: 360, marginBottom: '1rem', display: 'block',
  },

  controls: { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.25rem' },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  controlLabel: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: {
    padding: '6px 10px', border: '1px solid var(--input-border)', borderRadius: 4,
    fontSize: '0.85rem', minWidth: 200, background: 'var(--input-bg)', color: 'var(--text-primary)',
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
    background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 6,
    padding: '0.75rem 1rem', color: 'var(--danger)', marginBottom: '1rem',
  },
  empty: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '3rem 2rem',
    textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic',
    boxShadow: '0 0 0 1px var(--border)', lineHeight: 1.8,
  },
  notFoundBox: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '3rem 2rem',
    textAlign: 'center', boxShadow: '0 0 0 1px var(--border)', lineHeight: 1.8,
  },
  notFoundTitle: { fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 },

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
  legendDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0, display: 'inline-block' },

  tooltip: {
    position: 'absolute', top: 8, transform: 'translateX(-50%)',
    background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 6,
    padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-secondary)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2,
  },
  tooltipTime: { fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 },
  tooltipRow: { display: 'flex', alignItems: 'center', gap: 6 },

  fleetGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem',
  },
  fleetCard: {
    background: 'var(--bg-card)', borderRadius: 8, padding: '1rem',
    boxShadow: '0 0 0 1px var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
  },
  fleetCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  fleetCardName: { fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' },
  fleetCardNoData: { color: 'var(--text-faint)', fontStyle: 'italic', fontSize: '0.82rem', padding: '0.5rem 0' },
  fleetMetricRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)' },
  fleetMetricLabel: { color: 'var(--text-muted)' },
  fleetMetricValue: { fontWeight: 600 },
  miniBarTrack: { height: 4, background: 'var(--bg-subtle)', borderRadius: 2, overflow: 'hidden' },
  miniBarFill: { height: '100%', borderRadius: 2 },
  fleetSparkRow: { margin: '2px 0' },
  fleetRateRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' },
  fleetFooterRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)' },
  fleetPollFailures: {
    marginTop: 4, fontSize: '0.72rem', color: 'var(--danger)', fontWeight: 600,
  },
};
