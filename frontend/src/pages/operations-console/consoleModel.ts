// =============================================================================
// FireISP Operations Console — data model
// =============================================================================
// One view-model for the whole console. Two producers feed it:
//   • DEMO_MODEL  — the design's polished sample numbers, shown while the system
//     is empty (no real clients yet) so a fresh install looks alive.
//   • buildRealModel(...) — maps the live /dashboard/* + /alerts/events payloads
//     into the same shape once the first real client exists.
// resolveModel() picks between them on the demo↔real gate.
// =============================================================================

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type SiteStatus = 'ok' | 'warn' | 'crit';
export type DeviceStatus = 'online' | 'degraded' | 'offline';
export type EventLevel = 'danger' | 'warning' | 'success' | 'accent';

export interface KpiSegment { tone: 'danger' | 'warning' | 'accent'; w: number; }

export interface KpiModel {
  activeClients: { value: string; trend?: string; spark: number[] | null };
  mrr: { value: string; unit?: string; code?: string; trend?: string; spark: number[] | null };
  devicesOnline: { online: number; total: number };
  liveSessions: { value: string; note: string };
  openTickets: { value: string; sla?: string; mix: KpiSegment[] };
  overdue: { value: string; amount: string; note: string };
}

export interface SiteModel { code: string; util: number; status: SiteStatus; }

export interface DeviceModel {
  status: DeviceStatus;
  name: string;
  sub: string;
  ip: string;
  type: string;
  tp: string;
  spark: number[] | null;
  clients: string;
  uptime: string;
  cpu: number | null;
}

export interface EventModel {
  time: string;
  level: EventLevel;
  pre: string;
  strong: string;
  post: string;
}

export interface ConsoleModel {
  isDemo: boolean;
  kpis: KpiModel;
  sites: SiteModel[];
  devices: DeviceModel[];
  events: EventModel[];
}

// ---------------------------------------------------------------------------
// Live-endpoint payload shapes (mirrors src/pages/Dashboard.tsx)
// ---------------------------------------------------------------------------

export interface SummaryData {
  clients: { total: number; active: number };
  contracts: { total: number; active: number; suspended: number };
  revenue_30d: { outstanding: string; collected: string; total_invoiced: string };
  tickets: { total: number; open_count: number };
  devices: { total: number; monitored: number };
}

export interface MrrRow { currency: string; active_contracts: number; mrr: string; arpu: string; }

export interface DeviceHealthData {
  devices_by_type: Array<{ type: string; total: number; monitored: number; active: number }>;
  health_snapshots: Array<{
    snapshot_date: string;
    device_count: number;
    avg_uptime: number;
    avg_latency: number;
    avg_packet_loss: number;
  }>;
}

export interface OverdueInvoice {
  id: number;
  invoice_number: string;
  total: string;
  currency: string;
  due_date: string;
  client_id: number;
  first_name: string;
  last_name: string;
  days_overdue: number;
}

// alert_events row (ae.* + rule_name) — columns vary, so every field is optional.
export interface AlertEvent {
  id?: number;
  severity?: string | null;
  status?: string | null;
  message?: string | null;
  metric_value?: string | number | null;
  device_name?: string | null;
  device_id?: number | null;
  rule_name?: string | null;
  created_at?: string | null;
}

// ---------------------------------------------------------------------------
// Demo dataset — ported verbatim from the design's data.js
// ---------------------------------------------------------------------------

export const DEMO_MODEL: ConsoleModel = {
  isDemo: true,
  kpis: {
    activeClients: { value: '12,847', trend: '+1.2%', spark: [18, 16, 17, 14, 15, 11, 12, 9, 10, 7, 8, 5] },
    mrr: { value: '4.28', unit: 'M', code: 'MXN', trend: '+3.4%', spark: [17, 16, 15, 15, 13, 12, 12, 10, 9, 9, 6, 5] },
    devicesOnline: { online: 1284, total: 1310 },
    liveSessions: { value: '11,920', note: 'RADIUS · 93% of base' },
    openTickets: { value: '38', sla: '2 SLA', mix: [{ tone: 'danger', w: 2 }, { tone: 'warning', w: 3 }, { tone: 'accent', w: 4 }] },
    overdue: { value: '214', amount: '182K', note: 'invoices > 30d' },
  },
  sites: [
    { code: 'NTE', util: 62, status: 'ok' },
    { code: 'CEN', util: 48, status: 'ok' },
    { code: 'SUR', util: 71, status: 'ok' },
    { code: 'PON', util: 83, status: 'warn' },
    { code: 'ORI', util: 39, status: 'ok' },
    { code: 'VAL', util: 55, status: 'ok' },
    { code: 'BAJ', util: 91, status: 'crit' },
    { code: 'SIE', util: 44, status: 'ok' },
  ],
  devices: [
    { status: 'online', name: 'bras-01', sub: 'RouterOS · BNG', ip: '10.0.0.1', type: 'Router', tp: '184.2', spark: [15, 12, 14, 9, 11, 7, 6], clients: '8,420', uptime: '312d 4h', cpu: 28 },
    { status: 'online', name: 'core-rtr-02', sub: 'RouterOS · Core', ip: '10.0.0.2', type: 'Router', tp: '171.8', spark: [12, 14, 10, 13, 9, 11, 8], clients: '7,980', uptime: '287d 1h', cpu: 31 },
    { status: 'degraded', name: 'olt-norte-03', sub: 'GPON · OLT', ip: '10.0.4.9', type: 'OLT', tp: '42.6', spark: [14, 10, 13, 7, 12, 6, 9], clients: '3,110', uptime: '96d 22h', cpu: 67 },
    { status: 'online', name: 'agg-sw-09', sub: 'L3 · Aggregation', ip: '10.0.8.2', type: 'Switch', tp: '88.1', spark: [13, 11, 12, 8, 10, 9, 7], clients: '12,640', uptime: '154d 9h', cpu: 44 },
    { status: 'offline', name: 'ptmp-valle-2', sub: '60GHz · PTMP', ip: '10.0.6.4', type: 'PTMP', tp: '0.0', spark: null, clients: '—', uptime: '—', cpu: null },
  ],
  events: [
    { time: '14:31:58', level: 'danger', pre: 'Outage opened · ', strong: 'PoP-Norte', post: ' · 142 clients' },
    { time: '14:30:12', level: 'warning', pre: 'SNMP linkDown · ', strong: 'olt-norte-03', post: ' PON 3/1' },
    { time: '14:28:43', level: 'success', pre: 'RADIUS sync ok · ', strong: '1,310', post: ' accounts' },
    { time: '14:26:09', level: 'accent', pre: 'CFDI batch queued · ', strong: '1,204', post: ' stamps' },
    { time: '14:24:51', level: 'danger', pre: 'Payment failed · ', strong: '#8841', post: ' retry 2/3' },
    { time: '14:22:18', level: 'success', pre: 'Client activated · ', strong: 'SO-2291', post: '' },
    { time: '14:20:02', level: 'accent', pre: 'Plan upgraded · ', strong: 'SO-2274', post: ' → 500/500' },
  ],
};

// ---------------------------------------------------------------------------
// Seeded throughput-chart generator — ported verbatim from data.js.
// No time-series endpoint exists yet, so the chart is a stable synthetic sample
// in both modes (deterministic per range; not random).
// ---------------------------------------------------------------------------

export const RANGES = ['1H', '6H', '24H', '7D'] as const;
export type Range = (typeof RANGES)[number];

export interface ChartModel {
  inLine: string; inArea: string; outLine: string; outArea: string;
  peak: string; avg: string; p95: string;
  /** 95/5 commit utilization; null when unknown (real mode has no commit config). */
  commit: number | null;
}

export interface ThroughputPoint { ts: string; in_bps: number; out_bps: number; }
export interface ThroughputSeries {
  range?: string;
  points: ThroughputPoint[];
  peak_gbps: number;
  avg_gbps: number;
  p95_gbps: number;
  has_data: boolean;
}

// Chart geometry (matches the design's 820×220 viewBox). Shared by the demo
// generator and the real-series builder so both render identically.
const CHART_W = 820, CHART_H = 220, CHART_PAD = 12;
function chartPaths(inV: number[], outV: number[]) {
  const n = inV.length;
  const x = (i: number) => CHART_PAD + (n <= 1 ? 0 : (i / (n - 1)) * (CHART_W - CHART_PAD * 2));
  const y = (v: number) => CHART_H - CHART_PAD - v * (CHART_H - CHART_PAD * 2);
  const line = (vals: number[]) => vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = (vals: number[]) =>
    'M' + x(0).toFixed(1) + ' ' + (CHART_H - CHART_PAD) + ' ' +
    vals.map((v, i) => 'L' + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ') +
    ' L' + x(Math.max(0, n - 1)).toFixed(1) + ' ' + (CHART_H - CHART_PAD) + ' Z';
  return { inLine: line(inV), inArea: area(inV), outLine: line(outV), outArea: area(outV) };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildChart(seed: number, range: Range): ChartModel {
  const cfg = ({
    '1H': { n: 60, amp: 0.14, s: 1 },
    '6H': { n: 72, amp: 0.24, s: 2 },
    '24H': { n: 96, amp: 0.48, s: 3 },
    '7D': { n: 84, amp: 0.7, s: 4 },
  } as Record<Range, { n: number; amp: number; s: number }>)[range];
  const r = rng(seed * 131 + cfg.s * 17);
  const n = cfg.n;
  const inV: number[] = [], outV: number[] = [];
  let li = 0.55, lo = 0.3;
  for (let i = 0; i < n; i++) {
    const day = Math.sin((i / n) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
    li = Math.max(0.22, Math.min(0.96, li * 0.82 + (0.45 + day * 0.4) * 0.18 + (r() - 0.5) * cfg.amp));
    lo = Math.max(0.12, Math.min(0.72, lo * 0.82 + (0.24 + day * 0.26) * 0.18 + (r() - 0.5) * cfg.amp * 0.8));
    inV.push(li);
    outV.push(Math.min(lo, li - 0.04));
  }
  const g = (v: number) => (v * 1000).toFixed(1);
  const sorted = inV.slice().sort((a, b) => a - b);
  return {
    ...chartPaths(inV, outV),
    peak: g(Math.max(...inV)),
    avg: g(inV.reduce((a, b) => a + b, 0) / n),
    p95: g(sorted[Math.floor(n * 0.95)]),
    commit: 68,
  };
}

// Build a chart from a REAL throughput series (bps points → normalized paths +
// Gbps stats). No 95/5 commit config exists, so commit is null.
export function buildChartFromSeries(series: ThroughputSeries): ChartModel {
  const points = series.points ?? [];
  const inBps = points.map((p) => p.in_bps);
  const outBps = points.map((p) => p.out_bps);
  const scale = Math.max(1, ...inBps, ...outBps);
  // Leave a little headroom (×0.94) and lift zero off the baseline (+0.02).
  const norm = (v: number) => Math.max(0, Math.min(1, v / scale)) * 0.94 + 0.02;
  return {
    ...chartPaths(inBps.map(norm), outBps.map(norm)),
    peak: series.peak_gbps.toFixed(2),
    avg: series.avg_gbps.toFixed(2),
    p95: series.p95_gbps.toFixed(2),
    commit: null,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function compact(n: number): { value: string; unit?: string } {
  if (n >= 1e6) return { value: (n / 1e6).toFixed(2), unit: 'M' };
  if (n >= 1e3) return { value: (n / 1e3).toFixed(1), unit: 'K' };
  return { value: String(Math.round(n)) };
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// Sum invoice totals for a single currency (the org's), so multi-currency
// overdue lists never add unlike units into one figure.
function sumCurrency(rows: OverdueInvoice[], currency: string): number {
  const ccy = currency.toUpperCase();
  return rows.reduce((s, inv) => (
    (inv.currency || 'MXN').toUpperCase() === ccy ? s + parseFloat(inv.total || '0') : s
  ), 0);
}

function severityToLevel(sev?: string | null, status?: string | null): EventLevel {
  const s = (sev ?? '').toLowerCase();
  if ((status ?? '').toLowerCase() === 'resolved') return 'success';
  if (s === 'critical' || s === 'high') return 'danger';
  if (s === 'medium' || s === 'warning' || s === 'warn') return 'warning';
  if (s === 'low' || s === 'info') return 'accent';
  return 'accent';
}

function hhmmss(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// GET /dashboard/live-sessions
export interface SessionsData { value: string; note: string; }

// GET /dashboard/sites-utilization (one row per active site)
export interface SiteRow {
  id: number;
  name: string;
  city?: string | null;
  site_type?: string | null;
  device_count: number;
  devices_online: number;
}

// GET /dashboard/network-devices (one row per device)
export interface DeviceRow {
  id: number;
  name: string;
  status: string;               // 'online' | 'offline' | 'maintenance'
  ip_address: string | null;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  role: string | null;          // access | distribution | backhaul | core
  last_poll_error: string | null;
  cpu: number | null;
  clients: number;
  tp_bps?: number | null;       // current in+out bit-rate (from SNMP octet deltas)
  spark?: number[] | null;      // per-bucket total bit-rate series
  uptime_ticks?: number | null; // SNMP sysUpTime (hundredths of a second)
}

// ---------------------------------------------------------------------------
// Real → view-model mapping
// ---------------------------------------------------------------------------

export interface RealInputs {
  summary?: SummaryData;
  mrr?: MrrRow[];
  health?: DeviceHealthData;
  overdue?: OverdueInvoice[];
  events?: AlertEvent[];
  sessions?: SessionsData;
  sitesData?: SiteRow[];
  devicesData?: DeviceRow[];
  /** ISO 4217 currency of the active organization (from useOrgCurrency). */
  orgCurrency?: string;
}

// Short site code derived from the name (sites have no code column). Multi-word
// names use word initials (so "POP Norte" / "POP Sur" → PN / PS, not both "POP").
function siteCode(name: string): string {
  const words = (name || '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return ((words[0] || '').slice(0, 3) || '???').toUpperCase();
}

// Per-site health → SiteModel. util = % of the site's devices online; status is
// health-based so a fully-up POP shows a green full bar and a partly-down one
// shows warn/crit.
export function mapSite(r: SiteRow): SiteModel {
  const total = r.device_count || 0;
  const online = r.devices_online || 0;
  const util = total > 0 ? Math.round((online / total) * 100) : 0;
  let status: SiteStatus = 'ok';
  if (total > 0 && online < total) status = (online / total) >= 0.5 ? 'warn' : 'crit';
  return { code: siteCode(r.name), util, status };
}

const DEVICE_TYPE_LABEL: Record<string, string> = {
  router: 'Router', switch: 'Switch', olt: 'OLT', onu: 'ONU', ptp: 'PTP',
  ptmp_ap: 'PTMP', outdoor_cpe: 'CPE', indoor_cpe: 'CPE', other: 'Other',
};

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Compact bit-rate label for the device table (e.g. "184.2M", "1.20G"); '—' when
// there is no throughput sample yet. Sub-Mbps values use one decimal of Kbps so a
// tiny non-zero rate reads "0.5K", never a misleading "0K"/"1K".
function formatRate(bps: number | null | undefined): string {
  if (!bps || bps <= 0) return '—';
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + 'G';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + 'M';
  return (bps / 1e3).toFixed(1) + 'K';
}

// Format SNMP sysUpTime (TimeTicks = hundredths of a second) as "312d 4h".
function formatUptime(ticks: number | null | undefined): string {
  if (ticks === null || ticks === undefined || ticks < 0) return '—';
  const sec = Math.floor(ticks / 100);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Normalize a raw bps series to the Sparkline's y-coordinate space (SVG y grows
// downward, so peak throughput → small y ≈ top). null when there is no data.
function sparkFromSeries(series: number[] | null | undefined): number[] | null {
  if (!Array.isArray(series) || series.length === 0) return null;
  const max = Math.max(...series);
  if (max <= 0) return null;
  const VB = 20, PAD = 2;
  return series.map((v) => VB - PAD - (Math.max(0, v) / max) * (VB - PAD * 2));
}

// One device row → DeviceModel. The DB enum has no 'degraded'; it's derived from
// maintenance / a recent poll error. Throughput, sparkline, and uptime have no
// clean per-device source yet, so they render as placeholders.
export function mapDevice(r: DeviceRow): DeviceModel {
  let status: DeviceStatus = 'online';
  if (r.status === 'offline') status = 'offline';
  else if (r.status === 'maintenance' || (r.status === 'online' && r.last_poll_error)) status = 'degraded';

  // Prefer the network role (Core/Access/…); otherwise the display type label
  // (matches the Type column — never a raw "Ptmp_ap"-style enum).
  const kindLabel = r.role
    ? titleCase(r.role)
    : (r.type ? (DEVICE_TYPE_LABEL[r.type] || r.type) : '');
  const subParts = [r.manufacturer, kindLabel].filter(Boolean);
  return {
    status,
    name: r.name,
    sub: subParts.join(' · ') || '—',
    ip: r.ip_address || '—',
    type: (r.type && DEVICE_TYPE_LABEL[r.type]) || r.type || '—',
    tp: formatRate(r.tp_bps),
    spark: sparkFromSeries(r.spark),
    clients: r.clients > 0 ? r.clients.toLocaleString('en-US') : '0',
    uptime: formatUptime(r.uptime_ticks),
    cpu: r.cpu,
  };
}

export function buildRealModel(inp: RealInputs): ConsoleModel {
  const summary = inp.summary;
  const mrrRows = inp.mrr ?? [];
  const overdue = inp.overdue ?? [];
  const health = inp.health;

  // MRR: /dashboard/mrr returns one row per currency (GROUP BY currency). Show
  // the organization's own currency — never a cross-currency sum — so the KPI
  // always matches the org's configured currency.
  const orgCurrency = (inp.orgCurrency || 'MXN').toUpperCase();
  const orgMrrRow = mrrRows.find((r) => (r.currency || '').toUpperCase() === orgCurrency);
  const mrrC = compact(orgMrrRow ? parseFloat(orgMrrRow.mrr || '0') : 0);

  // "Devices online" has no true reachability count in the summary; monitored
  // (SNMP-enabled) is the closest available signal until an up/down count lands.
  const devTotal = summary?.devices.total ?? health?.devices_by_type.reduce((s, d) => s + d.total, 0) ?? 0;
  const devOnline = summary?.devices.monitored ?? health?.devices_by_type.reduce((s, d) => s + d.active, 0) ?? 0;

  // Overdue: /dashboard/overdue is server-capped at 100 rows (ORDER BY age DESC
  // LIMIT 100). Show "100+" when saturated rather than a silently-truncated exact
  // count, and sum the $ amount within a single (dominant) currency only.
  const overdueCapped = overdue.length >= 100;
  const overdueTotal = sumCurrency(overdue, orgCurrency);
  const overdueAmt = compact(overdueTotal);

  const openTickets = summary?.tickets.open_count ?? 0;

  const kpis: KpiModel = {
    activeClients: { value: fmtInt(summary?.clients.active ?? 0), spark: null },
    mrr: { value: mrrC.value, unit: mrrC.unit, code: orgCurrency, spark: null },
    devicesOnline: { online: devOnline, total: devTotal },
    liveSessions: inp.sessions ?? { value: '—', note: 'RADIUS' },
    openTickets: {
      value: fmtInt(openTickets),
      mix: openTickets > 0 ? [{ tone: 'accent', w: 1 }] : [],
    },
    overdue: {
      value: overdueCapped ? '100+' : fmtInt(overdue.length),
      amount: overdueTotal > 0 ? (overdueAmt.value + (overdueAmt.unit ?? '')) : '0',
      note: overdueCapped ? 'past due · top 100' : 'past due',
    },
  };

  const evs = Array.isArray(inp.events) ? inp.events : [];
  const events: EventModel[] = evs.slice(0, 12).map((e) => ({
    time: hhmmss(e.created_at),
    level: severityToLevel(e.severity, e.status),
    pre: (e.rule_name || e.message || 'Alert') + ' · ',
    strong: e.device_name || (e.device_id != null ? `dev#${e.device_id}` : ''),
    post: e.status ? ` · ${e.status}` : '',
  }));

  return {
    isDemo: false,
    kpis,
    sites: (inp.sitesData ?? []).map(mapSite),
    devices: (inp.devicesData ?? []).map(mapDevice),
    events,
  };
}

// ---------------------------------------------------------------------------
// Resolver — the demo↔real gate. Real once the first client exists.
// ---------------------------------------------------------------------------

export function hasRealData(summary?: SummaryData): boolean {
  return !!summary && summary.clients.total > 0;
}

export function resolveModel(inp: RealInputs): ConsoleModel {
  if (hasRealData(inp.summary)) return buildRealModel(inp);
  // Demo: keep the design's sample figures, but label MRR with the org's own
  // currency so the currency is consistent even before real data exists.
  const orgCurrency = (inp.orgCurrency || 'MXN').toUpperCase();
  if (orgCurrency === DEMO_MODEL.kpis.mrr.code) return DEMO_MODEL;
  return { ...DEMO_MODEL, kpis: { ...DEMO_MODEL.kpis, mrr: { ...DEMO_MODEL.kpis.mrr, code: orgCurrency } } };
}
