// =============================================================================
// FireISP Operations Console — presentational widgets
// =============================================================================
// Ported from the design's widgets.jsx. Composes the FireISP UI kit
// (Card / Table / Badge) + token-driven layout glue. The topbar/sidebar/icons
// from the design are omitted — the app shell (Layout.tsx) supplies them.
// =============================================================================

import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { Card, Table, Badge, Sparkline, type TableColumn, type TableRow } from '@/components/ui';
import { fmtBps } from '@/pages/snmpMetrics/rateTransform';
import {
  RANGES, CHART_W, CHART_H, CHART_PAD, type Range, type ChartModel,
  type KpiModel, type SiteModel, type DeviceModel, type EventModel, type DeviceStatus,
} from './consoleModel';

// Sparkline now lives in @/components/ui/Sparkline (shared across pages);
// re-exported here so any existing external import of it from this module
// keeps working.
export { Sparkline };

// ---------------------------------------------------------------------------
// Shared status maps
// ---------------------------------------------------------------------------

const STATUS: Record<DeviceStatus, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  online: { tone: 'success', label: 'Online' },
  degraded: { tone: 'warning', label: 'Degraded' },
  offline: { tone: 'danger', label: 'Offline' },
};

function cpuColor(v: number | null): string {
  return v == null ? 'var(--border-strong)' : v <= 50 ? 'var(--success)' : v <= 85 ? 'var(--warning)' : 'var(--danger)';
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

export function KpiRow({ kpis: k }: { kpis: KpiModel }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? '';

  // Clickable-tile affordance: navigates on click/Enter/Space.
  const linkProps = (to: string, label: string) => ({
    role: 'link' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: () => navigate(to),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate(to);
      }
    },
  });

  return (
    <div className="fi-kpi-grid">
      {/* active clients — admin only, jumps to the client list */}
      {role === 'admin' && (
        <div className="fi-kpi fi-kpi-link" {...linkProps('/clients', 'Active Clients — open client list')}>
          <div className="fi-kpi-top">
            <span className="fi-kpi-label">Active Clients</span>
            {k.activeClients.trend && <span className="fi-trend">▲ {k.activeClients.trend}</span>}
          </div>
          <div className="fi-kpi-num">{k.activeClients.value}</div>
          <Sparkline points={k.activeClients.spark} h={22} />
        </div>
      )}
      {/* MRR */}
      <div className="fi-kpi">
        <div className="fi-kpi-top">
          <span className="fi-kpi-label">MRR</span>
          {k.mrr.trend && <span className="fi-trend">▲ {k.mrr.trend}</span>}
        </div>
        <div className="fi-kpi-num">
          ${k.mrr.value}
          {k.mrr.unit && <span className="unit">{k.mrr.unit}</span>}
          {k.mrr.code && <span className="fi-kpi-label" style={{ alignSelf: 'flex-end', marginBottom: 2 }}>{k.mrr.code}</span>}
        </div>
        <Sparkline points={k.mrr.spark} h={22} />
      </div>
      {/* devices online — jumps to the device map */}
      <div className="fi-kpi fi-kpi-link" {...linkProps('/devices', 'Devices Online — open device map')}>
        <div className="fi-kpi-top">
          <span className="fi-kpi-label">Devices Online</span>
          <span className="fi-dot" style={{ background: 'var(--success)' }} />
        </div>
        <div className="fi-kpi-num">
          {k.devicesOnline.online.toLocaleString()}<span className="unit">/{k.devicesOnline.total.toLocaleString()}</span>
        </div>
        <div className="fi-bar">
          <i style={{ width: (k.devicesOnline.total ? (k.devicesOnline.online / k.devicesOnline.total) * 100 : 0).toFixed(1) + '%' }} />
        </div>
      </div>
      {/* live sessions */}
      <div className="fi-kpi">
        <div className="fi-kpi-top">
          <span className="fi-kpi-label">Live Sessions</span>
          <span className="fi-dot fi-live" style={{ background: 'var(--success)' }} />
        </div>
        <div className="fi-kpi-num">{k.liveSessions.value}</div>
        <span className="fi-kpi-label">{k.liveSessions.note}</span>
      </div>
      {/* open tickets — jumps to the ticket list pre-filtered to open */}
      <div className="fi-kpi fi-kpi-link" {...linkProps('/tickets?status=open', 'Open Tickets — open ticket list filtered to open')}>
        <div className="fi-kpi-top">
          <span className="fi-kpi-label">Open Tickets</span>
          {k.openTickets.sla && <span className="fi-kpi-label" style={{ color: 'var(--warning)' }}>{k.openTickets.sla}</span>}
        </div>
        <div className="fi-kpi-num">{k.openTickets.value}</div>
        <div className="fi-seg">
          {k.openTickets.mix.map((m, i) => (
            <i key={i} style={{ flex: m.w, background: m.tone === 'accent' ? 'var(--accent)' : `var(--${m.tone})` }} />
          ))}
        </div>
      </div>
      {/* overdue (emphasis) — admin/billing only, jumps to overdue invoices */}
      {(role === 'admin' || role === 'billing') && (
        <div className="fi-kpi accent fi-kpi-link" {...linkProps('/invoices?status=overdue', 'Overdue — open invoice list filtered to overdue')}>
          <div className="fi-kpi-top">
            <span className="fi-kpi-label" style={{ color: 'var(--warning)' }}>Overdue</span>
            <span className="fi-dot fi-live" style={{ background: 'var(--warning)' }} />
          </div>
          <div className="fi-kpi-num" style={{ color: 'var(--warning)' }}>
            {k.overdue.value}<span className="unit" style={{ color: 'var(--warning)' }}>${k.overdue.amount}</span>
          </div>
          <span className="fi-kpi-label" style={{ color: 'var(--warning)' }}>{k.overdue.note}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Throughput chart
// ---------------------------------------------------------------------------

// Tooltip time label for a chart bucket; the demo series has no timestamps.
function tipTime(ts: string | null, range: Range): string {
  if (!ts) return 'sample data';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return range === '7D'
    ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time
    : time;
}

export function ThroughputChart({
  range, onRange, chart, emptyMessage,
}: {
  range: Range;
  onRange: (r: Range) => void;
  chart?: ChartModel;
  emptyMessage?: string;
}) {
  // Point inspector: hover follows the cursor; click pins the tooltip in place
  // (click again or Escape releases it). Arrow keys step through buckets.
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => { setHover(null); setPinned(false); }, [range]);

  const pts = chart?.points ?? [];
  const hp = hover != null && hover < pts.length ? pts[hover] : null;

  // Map a pointer position to the nearest bucket index (buckets are uniformly
  // spaced across the padded viewBox width).
  function locate(e: { clientX: number; currentTarget: Element }): number | null {
    if (pts.length === 0) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const vx = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const i = Math.round(((vx - CHART_PAD) / (CHART_W - CHART_PAD * 2)) * (pts.length - 1));
    return Math.max(0, Math.min(pts.length - 1, i));
  }

  const legend = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {chart && (
        <div className="fi-legend">
          <span className="sw" style={{ background: 'var(--accent)' }} />Ingress
          <span className="sw" style={{ background: 'var(--text-dimmed)', marginLeft: 8 }} />Egress
        </div>
      )}
      <div className="fi-tabs">
        {RANGES.map((r) => (
          <button key={r} type="button" className={'fi-tab' + (r === range ? ' active' : '')} aria-pressed={r === range} onClick={() => onRange(r)}>{r}</button>
        ))}
      </div>
    </div>
  );

  if (!chart) {
    return (
      <Card title="Network Throughput" actions={legend} style={{ height: '100%' }}>
        <div className="fi-panel-empty" style={{ minHeight: 200 }}>{emptyMessage ?? 'No throughput data.'}</div>
      </Card>
    );
  }

  const pct = (v: number, span: number) => `${((v / span) * 100).toFixed(2)}%`;

  return (
    <Card title="Network Throughput" actions={legend} style={{ height: '100%' }}>
      <div
        className="fi-chart-hit"
        role="application"
        aria-label="Network throughput chart — hover or use arrow keys to inspect points, click to pin"
        tabIndex={0}
        onPointerMove={(e) => { if (!pinned) setHover(locate(e)); }}
        onPointerLeave={() => { if (!pinned) setHover(null); }}
        onClick={(e) => {
          const i = locate(e);
          if (i == null) return;
          setHover(i);
          setPinned(!pinned);
        }}
        onKeyDown={(e) => {
          if (pts.length === 0) return;
          if (e.key === 'Escape') { setPinned(false); setHover(null); return; }
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const delta = e.key === 'ArrowLeft' ? -1 : 1;
          setHover((h) => (h == null ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, h + delta))));
        }}
      >
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" style={{ width: '100%', height: 200, display: 'block' }}>
          <defs>
            <linearGradient id="fiIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="55" x2={CHART_W} y2="55" stroke="var(--border-subtle)" strokeWidth="1" />
          <line x1="0" y1="110" x2={CHART_W} y2="110" stroke="var(--border-subtle)" strokeWidth="1" />
          <line x1="0" y1="165" x2={CHART_W} y2="165" stroke="var(--border-subtle)" strokeWidth="1" />
          <path d={chart.outLine} fill="none" stroke="var(--text-dimmed)" strokeWidth="1.5" strokeOpacity="0.7" />
          <path d={chart.inArea} fill="url(#fiIn)" />
          <path key={'in' + range} className="fi-chart-line" style={{ '--len': 2000 } as CSSProperties} d={chart.inLine} fill="none" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        {/* Inspector overlay in HTML (not SVG) so the crosshair dots stay round
            under the stretched preserveAspectRatio="none" viewBox. */}
        {hp && (
          <>
            <div className="fi-chart-cursor" style={{ left: pct(hp.x, CHART_W) }} aria-hidden="true" />
            <span className="fi-chart-dot" style={{ left: pct(hp.x, CHART_W), top: pct(hp.yIn, CHART_H), background: 'var(--accent)' }} aria-hidden="true" />
            <span className="fi-chart-dot" style={{ left: pct(hp.x, CHART_W), top: pct(hp.yOut, CHART_H), background: 'var(--text-dimmed)' }} aria-hidden="true" />
            <div
              className={'fi-chart-tip' + (pinned ? ' pinned' : '') + (hp.x > CHART_W / 2 ? ' flip' : '')}
              style={{ left: pct(hp.x, CHART_W) }}
              role="status"
            >
              <div className="tt">{tipTime(hp.ts, range)}{pinned ? ' · pinned' : ''}</div>
              <div className="tr"><span className="sw" style={{ background: 'var(--accent)' }} />Ingress<b>{fmtBps(hp.in_bps)}</b></div>
              <div className="tr"><span className="sw" style={{ background: 'var(--text-dimmed)' }} />Egress<b>{fmtBps(hp.out_bps)}</b></div>
            </div>
          </>
        )}
      </div>
      <div className="fi-chart-stats">
        <div className="fi-stat"><span className="k">PEAK</span><span className="v">{chart.peak} <small>{chart.unit}</small></span></div>
        <div className="fi-stat"><span className="k">AVG</span><span className="v">{chart.avg} <small>{chart.unit}</small></span></div>
        <div className="fi-stat"><span className="k">95TH %ILE</span><span className="v">{chart.p95} <small>{chart.unit}</small></span></div>
        <div style={{ flex: 1 }} />
        <div className="fi-stat" style={{ alignItems: 'flex-end' }}><span className="k">95/5 COMMIT</span><span className="v" style={{ color: 'var(--accent)' }}>{chart.commit == null ? '—' : `${chart.commit}% used`}</span></div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

export function LiveEvents({ events }: { events: EventModel[] }) {
  const dot = (lvl: EventModel['level']) => (lvl === 'accent' ? 'var(--accent)' : `var(--${lvl})`);
  const actions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="fi-dot fi-live" style={{ background: 'var(--success)' }} />
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>last 5m</span>
    </div>
  );
  return (
    <Card title="Live Events" actions={actions} style={{ height: '100%' }}>
      {events.length === 0 ? (
        <div className="fi-events-empty">No recent events.</div>
      ) : (
        <div className="fi-events">
          {events.map((e, i) => (
            <div className="fi-event" key={i}>
              <span className="t">{e.time}</span>
              <span className="fi-dot fi-dot-sm d" style={{ background: dot(e.level) }} />
              <span className="m">{e.pre}<b>{e.strong}</b>{e.post}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sites strip
// ---------------------------------------------------------------------------

export function SitesStrip({ sites }: { sites: SiteModel[] }) {
  const counts = sites.reduce<Record<string, number>>((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
  const cls: Record<SiteModel['status'], string> = { ok: '', warn: ' warn', crit: ' crit' };
  const barColor: Record<SiteModel['status'], string> = { ok: 'var(--success)', warn: 'var(--warning)', crit: 'var(--danger)' };
  const valColor: Record<SiteModel['status'], string> = { ok: 'var(--text-secondary)', warn: 'var(--warning)', crit: 'var(--danger)' };
  const summary = `${sites.length} sites · ${counts.ok || 0} healthy · ${counts.warn || 0} warn · ${counts.crit || 0} critical`;
  return (
    <Card title="Sites & POPs" actions={<span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sites.length ? `${summary} · uplink util` : 'no POP telemetry'}</span>}>
      {sites.length === 0 ? (
        <div className="fi-panel-empty">No POP telemetry yet — utilization appears once sites report uplink stats.</div>
      ) : (
        <div className="fi-sites">
          {sites.map((s, i) => (
            // Key by index — derived site codes are not guaranteed unique.
            <div className={'fi-site' + cls[s.status]} key={i}>
              <div className="fi-site-top"><span className="fi-site-code">{s.code}</span><span className="fi-dot fi-dot-sm" style={{ background: barColor[s.status] }} /></div>
              <span className="fi-site-val" style={{ color: valColor[s.status] }}>{s.util}<small>%</small></span>
              <div className="fi-bar"><i style={{ width: s.util + '%', background: barColor[s.status] }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Device table
// ---------------------------------------------------------------------------

const DEVICE_FILTERS = ['All', 'Online', 'Degraded', 'Offline'] as const;
export type DeviceFilter = (typeof DEVICE_FILTERS)[number];

export function DeviceTable({
  devices, filter, onFilter, query,
}: {
  devices: DeviceModel[];
  filter: DeviceFilter;
  onFilter: (f: DeviceFilter) => void;
  query: string;
}) {
  let rows = devices;
  if (filter !== 'All') rows = rows.filter((d) => STATUS[d.status].label === filter);
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    rows = rows.filter((d) => (d.name + ' ' + d.sub + ' ' + d.ip + ' ' + d.type).toLowerCase().includes(q));
  }

  const columns: TableColumn[] = [
    { key: 'status', header: 'Status' },
    { key: 'device', header: 'Device' },
    { key: 'ip', header: 'Mgmt IP' },
    { key: 'type', header: 'Type' },
    { key: 'tp', header: 'Throughput' },
    { key: 'clients', header: 'Clients', align: 'right', numeric: true },
    { key: 'uptime', header: 'Uptime' },
    { key: 'cpu', header: 'CPU' },
  ];

  const dimmed = (offline: boolean): CSSProperties => ({ fontSize: 12, color: offline ? 'var(--text-dimmed)' : 'var(--text-secondary)' });

  const tableRows: TableRow[] = rows.map((d) => {
    const st = STATUS[d.status];
    const sparkStroke = d.status === 'degraded' ? 'var(--warning)' : 'var(--accent)';
    return {
      status: <Badge tone={st.tone}><span className="fi-dot fi-dot-sm" style={{ background: 'currentColor', marginRight: 6 }} />{st.label}</Badge>,
      device: <div className="fi-dev"><span className="n">{d.name}</span><span className="s">{d.sub}</span></div>,
      ip: <span className="mono" style={dimmed(d.status === 'offline')}>{d.ip}</span>,
      type: <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.type}</span>,
      tp: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 56, flex: 'none' }}><Sparkline points={d.spark} stroke={sparkStroke} vbW={70} vbH={20} h={16} /></span>
          <span className="mono" style={dimmed(d.status === 'offline')}>{d.tp}</span>
        </span>
      ),
      clients: <span className="mono">{d.clients}</span>,
      uptime: <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.uptime}</span>,
      cpu: d.cpu == null
        ? <span className="mono" style={{ fontSize: 12, color: 'var(--text-dimmed)' }}>—</span>
        : (
          <span className="fi-cpu">
            <span className="fi-bar"><i style={{ width: d.cpu + '%', background: cpuColor(d.cpu) }} /></span>
            <span className="mono" style={{ fontSize: 11, color: d.cpu > 50 ? cpuColor(d.cpu) : 'var(--text-secondary)' }}>{d.cpu}%</span>
          </span>
        ),
    };
  });

  const actions = (
    <div className="fi-chips">
      {DEVICE_FILTERS.map((f) => (
        <button key={f} type="button" className={'fi-chip' + (filter === f ? ' active' : '')} aria-pressed={filter === f} onClick={() => onFilter(f)}>
          {f}{f === 'All' ? ' ' + devices.length : ''}
        </button>
      ))}
    </div>
  );

  return (
    <Card title="Network Devices" actions={actions} padding={false}>
      <div className="fi-table-wrap">
        <div style={{ minWidth: 880 }}>
          <Table columns={columns} rows={tableRows} empty={devices.length === 0 ? 'No device telemetry yet.' : 'No devices match this filter.'} />
        </div>
      </div>
    </Card>
  );
}
