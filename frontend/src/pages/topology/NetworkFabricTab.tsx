// =============================================================================
// FireISP 5.0 — Network Fabric tab (§13.1)
// =============================================================================
// A schematic, tier-laid-out view of the network fabric (core → distribution →
// access) with live status colouring, animated healthy-link traffic flow, an
// outage halo on down nodes, a right-rail incident list, and a selected-node
// inspector with real actions (Reboot / Work Order / Maintenance).
//
// Data: GET /topology/map/fabric. All colours come from the app's design
// tokens (var(--success|warning|danger|accent|…)), so it tracks light/dark and
// the orange/green accent option. Animations live in the bundled fabric.css
// (NEVER an injected <style> — the CSP blocks those; see index.css --viz-*).
// =============================================================================

import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import './fabric.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeMetrics {
  cpu_usage: number | string | null;
  memory_usage: number | string | null;
  uptime_ticks: number | string | null;
  temperature_c: number | string | null;
  rx_power_dbm: number | string | null;
  firmware: string | null;
  clients: number | null;
}

interface FabricNode {
  id: number;
  name: string;
  type: string | null;
  role: string | null;
  status: string;
  site_id: number | null;
  site_name: string | null;
  tier: number;
  metrics: NodeMetrics;
}

interface FabricEdge {
  id: number;
  source: number;
  target: number;
  status: string;
  utilization: number | null;
  bandwidth_mbps: number | null;
}

interface Incident {
  id: number;
  device_id: number | null;
  site_id: number | null;
  title: string;
  detail: string | null;
  severity: 'critical' | 'major' | 'minor';
  started_at: string;
}

interface FabricData {
  nodes: FabricNode[];
  edges: FabricEdge[];
  incidents: Incident[];
}

// ---------------------------------------------------------------------------
// Status → token colour
// ---------------------------------------------------------------------------

function nodeColor(status: string): string {
  switch (status) {
    case 'online': return 'var(--success)';
    case 'maintenance': return 'var(--warning)';
    case 'offline': return 'var(--danger)';
    default: return 'var(--text-dimmed)';
  }
}

/** Traffic-flow colour + whether the link animates, from link health. */
function edgeFlow(edge: FabricEdge): { color: string; animate: boolean } {
  if (edge.status === 'down') return { color: 'var(--danger)', animate: false };
  if (edge.status === 'maintenance') return { color: 'var(--warning)', animate: true };
  // Active: warn when heavily utilised, otherwise healthy.
  if (edge.utilization != null && edge.utilization >= 80) return { color: 'var(--warning)', animate: true };
  return { color: 'var(--success)', animate: true };
}

const severityColor: Record<Incident['severity'], string> = {
  critical: 'var(--danger)',
  major: 'var(--danger)',
  minor: 'var(--warning)',
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtUptime(ticks: number | string | null): string {
  if (ticks == null) return '—';
  const secs = Number(ticks) / 100; // sysUpTime is in 1/100s
  if (!Number.isFinite(secs)) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((secs % 3600) / 60)}m`;
}

function fmtElapsed(fromIso: string, nowMs: number): string {
  const start = new Date(fromIso).getTime();
  let s = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Layout — tier columns, evenly spread rows
// ---------------------------------------------------------------------------

const VB_W = 900;
const PAD_X = 90;
const PAD_Y = 48;

function useLayout(nodes: FabricNode[]) {
  return useMemo(() => {
    const tiers = [...new Set(nodes.map(n => n.tier))].sort((a, b) => a - b);
    const byTier = new Map<number, FabricNode[]>();
    for (const t of tiers) byTier.set(t, []);
    for (const n of nodes) byTier.get(n.tier)!.push(n);
    for (const list of byTier.values()) list.sort((a, b) => a.name.localeCompare(b.name));

    const maxRows = Math.max(1, ...[...byTier.values()].map(l => l.length));
    const vbH = Math.max(360, PAD_Y * 2 + maxRows * 62);
    const colGap = tiers.length > 1 ? (VB_W - PAD_X * 2) / (tiers.length - 1) : 0;

    const pos = new Map<number, { x: number; y: number }>();
    tiers.forEach((t, ti) => {
      const list = byTier.get(t)!;
      const x = tiers.length > 1 ? PAD_X + ti * colGap : VB_W / 2;
      const usableH = vbH - PAD_Y * 2;
      list.forEach((n, i) => {
        const y = list.length > 1
          ? PAD_Y + (i / (list.length - 1)) * usableH
          : vbH / 2;
        pos.set(n.id, { x, y });
      });
    });
    return { pos, vbH, tiers };
  }, [nodes]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkFabricTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['topology-fabric'],
    queryFn: async () => {
      const res = await api.GET('/topology/map/fabric' as never, {} as never);
      return (res as { data: { data: FabricData } }).data?.data as FabricData;
    },
    refetchInterval: 30_000,
  });

  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const edges = data?.edges ?? [];
  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const { pos, vbH } = useLayout(nodes);

  // Device ids with an active incident → outage halo.
  const incidentDeviceIds = useMemo(
    () => new Set(incidents.map(i => i.device_id).filter((id): id is number => id != null)),
    [incidents],
  );

  // Default-select the most severe unhealthy node once data loads.
  useEffect(() => {
    if (selectedId != null || nodes.length === 0) return;
    const firstIncidentDev = incidents.find(i => i.device_id != null)?.device_id;
    const offline = nodes.find(n => n.status === 'offline');
    setSelectedId(firstIncidentDev ?? offline?.id ?? nodes[0].id);
  }, [nodes, incidents, selectedId]);

  // One interval drives every elapsed timer.
  useEffect(() => {
    const h = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);

  const selected = nodes.find(n => n.id === selectedId) ?? null;

  async function doReboot() {
    if (!selected) return;
    if (!window.confirm(t('topologyMap.fabric.confirmReboot', { name: selected.name }))) return;
    setActionBusy(true); setActionMsg(null);
    try {
      await api.POST(`/devices/${selected.id}/reboot` as never, {} as never);
      setActionMsg(t('topologyMap.fabric.rebootIssued'));
    } catch (err) {
      const status = (err as { status?: number }).status;
      setActionMsg(status === 422 ? t('topologyMap.fabric.rebootUnsupported') : t('topologyMap.fabric.actionError'));
    } finally { setActionBusy(false); }
  }

  async function toggleMaintenance() {
    if (!selected) return;
    const next = selected.status === 'maintenance' ? 'online' : 'maintenance';
    setActionBusy(true); setActionMsg(null);
    try {
      await api.PUT(`/devices/${selected.id}` as never, { body: { status: next } } as never);
      setActionMsg(t('topologyMap.fabric.maintenanceSet', { status: next }));
      void qc.invalidateQueries({ queryKey: ['topology-fabric'] });
    } catch {
      setActionMsg(t('topologyMap.fabric.actionError'));
    } finally { setActionBusy(false); }
  }

  if (isLoading) return <p>{t('topologyMap.loading')}</p>;
  if (nodes.length === 0) return <p style={{ color: 'var(--text-muted)' }}>{t('topologyMap.fabric.empty')}</p>;

  return (
    <div style={cs.wrap}>
      {/* Map canvas */}
      <div style={cs.canvas}>
        <div style={cs.canvasOverlay}>
          <span style={cs.eyebrow}>{t('topologyMap.fabric.eyebrow')}</span>
          <span style={cs.summary}>
            {t('topologyMap.fabric.summary', {
              nodes: nodes.length,
              outages: incidents.length,
            })}
          </span>
        </div>

        <svg viewBox={`0 0 ${VB_W} ${vbH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* Links: underlay + flow overlay */}
          {edges.map(edge => {
            const a = pos.get(edge.source); const b = pos.get(edge.target);
            if (!a || !b) return null;
            const { color, animate } = edgeFlow(edge);
            // Vary flow speed by edge id so parallel flows don't sync.
            const dur = 0.7 + (edge.id % 7) * 0.1;
            return (
              <g key={edge.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth={2.4} />
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={color} strokeWidth={2}
                  className={animate ? 'fi-fabric-flow' : undefined}
                  strokeDasharray={animate ? undefined : '2 6'}
                  opacity={animate ? 1 : 0.5}
                  style={animate ? { animationDuration: `${dur}s` } : undefined}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const p = pos.get(node.id); if (!p) return null;
            const color = nodeColor(node.status);
            const isSel = node.id === selectedId;
            const hasIncident = incidentDeviceIds.has(node.id);
            const isPop = node.site_id != null;
            return (
              <g
                key={node.id}
                className="fi-fabric-node"
                transform={`translate(${p.x},${p.y})`}
                onClick={() => setSelectedId(node.id)}
                role="button"
                tabIndex={0}
                aria-label={node.name}
              >
                {hasIncident && (
                  <circle r={11} fill="none" stroke="var(--danger)" strokeWidth={2} className="fi-fabric-halo" />
                )}
                {isSel && (
                  <circle r={17} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 4" />
                )}
                {isPop
                  ? <circle r={9} fill="var(--bg-card)" stroke={color} strokeWidth={2.4} />
                  : <rect x={-13} y={-13} width={26} height={26} rx={6} fill="var(--bg-card)" stroke={color} strokeWidth={1.8} />}
                <text
                  className="fi-fabric-node-label"
                  y={26} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize={9.5}
                  fill={node.status === 'online' ? 'var(--text-secondary)' : color}
                >
                  {node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name}
                </text>
                {node.metrics.clients != null && (
                  <text y={37} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--text-dimmed)">
                    {t('topologyMap.fabric.clientsShort', { count: node.metrics.clients })}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div style={cs.legend}>
          <LegendDot color="var(--success)" label={t('topologyMap.fabric.legendOnline')} />
          <LegendDot color="var(--warning)" label={t('topologyMap.fabric.legendDegraded')} />
          <LegendDot color="var(--danger)" label={t('topologyMap.fabric.legendOffline')} />
        </div>
      </div>

      {/* Right rail */}
      <div style={cs.rail}>
        <div>
          <span style={cs.railLabel}>
            {t('topologyMap.fabric.incidentsLabel', { count: incidents.length })}
          </span>
          {incidents.length === 0
            ? <p style={cs.railEmpty}>{t('topologyMap.fabric.noIncidents')}</p>
            : incidents.map(inc => (
              <div key={inc.id} style={{ ...cs.incidentCard, borderColor: severityColor[inc.severity] }}>
                <div style={cs.incidentHead}>
                  <span style={{ ...cs.dot, background: severityColor[inc.severity] }} className={inc.severity !== 'minor' ? 'fi-fabric-pulse' : undefined} />
                  <span style={{ ...cs.incidentTitle, color: severityColor[inc.severity] }}>{inc.title}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ ...cs.mono, color: severityColor[inc.severity] }}>{fmtElapsed(inc.started_at, nowMs)}</span>
                </div>
                {inc.detail && <span style={cs.incidentDetail}>{inc.detail}</span>}
              </div>
            ))}
        </div>

        {selected && (
          <div>
            <span style={cs.railLabel}>{t('topologyMap.fabric.selectedLabel')}</span>
            <div style={{ ...cs.inspector, borderColor: 'var(--accent)' }}>
              <div style={cs.inspectorHead}>
                <span style={{ ...cs.statusTile, borderColor: nodeColor(selected.status) }}>
                  <span style={{ ...cs.dot, background: nodeColor(selected.status) }} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={cs.inspectorName}>{selected.name}</span>
                  <span style={cs.inspectorSub}>
                    {(selected.type ?? '—')}{selected.site_name ? ` · ${selected.site_name}` : ''}
                  </span>
                </div>
              </div>

              <div style={cs.metricsGrid}>
                <Metric label={t('topologyMap.fabric.metrics.cpu')} value={num(selected.metrics.cpu_usage)} unit="%" />
                <Metric label={t('topologyMap.fabric.metrics.memory')} value={num(selected.metrics.memory_usage)} unit="%" />
                <Metric label={t('topologyMap.fabric.metrics.clients')} value={selected.metrics.clients} />
                <Metric label={t('topologyMap.fabric.metrics.rxPower')} value={num(selected.metrics.rx_power_dbm)} unit="dBm" warn={v => v < -25} />
                <Metric label={t('topologyMap.fabric.metrics.temp')} value={num(selected.metrics.temperature_c)} unit="°C" warn={v => v > 55} />
                <TextMetric label={t('topologyMap.fabric.metrics.uptime')} value={fmtUptime(selected.metrics.uptime_ticks)} />
                <TextMetric label={t('topologyMap.fabric.metrics.firmware')} value={selected.metrics.firmware ?? '—'} />
              </div>

              <div style={cs.actions}>
                <button onClick={() => { void doReboot(); }} disabled={actionBusy} style={{ ...cs.actionBtn, ...cs.actionPrimary }}>
                  {t('topologyMap.fabric.actions.reboot')}
                </button>
                <button onClick={() => navigate('/work-orders')} style={{ ...cs.actionBtn, ...cs.actionNeutral }}>
                  {t('topologyMap.fabric.actions.workOrder')}
                </button>
                <button onClick={() => { void toggleMaintenance(); }} disabled={actionBusy} style={{ ...cs.actionBtn, ...cs.actionNeutral }}>
                  {selected.status === 'maintenance'
                    ? t('topologyMap.fabric.actions.unmaintenance')
                    : t('topologyMap.fabric.actions.maintenance')}
                </button>
              </div>
              {actionMsg && <p style={cs.actionMsg}>{actionMsg}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{label}
    </span>
  );
}

function Metric({ label, value, unit, warn }: { label: string; value: number | null; unit?: string; warn?: (v: number) => boolean }) {
  const isWarn = value != null && warn ? warn(value) : false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={cs.metricLabel}>{label}</span>
      <span style={{ ...cs.metricValue, color: isWarn ? 'var(--warning)' : 'var(--text-primary)' }}>
        {value == null ? '—' : value}{value != null && unit ? <span style={cs.metricUnit}> {unit}</span> : null}
      </span>
    </div>
  );
}

function TextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={cs.metricLabel}>{label}</span>
      <span style={cs.metricValue}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (tokens only)
// ---------------------------------------------------------------------------

const cs: Record<string, CSSProperties> = {
  wrap: { display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' },
  canvas: {
    flex: '1 1 560px', position: 'relative', minWidth: 320,
    background: 'var(--bg-body)', border: '1px solid var(--border)', borderRadius: 8,
    backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)', backgroundSize: '24px 24px',
    overflow: 'hidden',
  },
  canvasOverlay: { position: 'absolute', top: 12, left: 14, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 2, pointerEvents: 'none' },
  eyebrow: { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', color: 'var(--text-dimmed)' },
  summary: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  legend: { position: 'absolute', bottom: 12, left: 14, display: 'flex', gap: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px' },
  rail: { width: 336, flex: '0 0 336px', display: 'flex', flexDirection: 'column', gap: 16 },
  railLabel: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--text-dimmed)', marginBottom: 9, textTransform: 'uppercase' },
  railEmpty: { color: 'var(--text-muted)', fontSize: 13, margin: 0 },
  incidentCard: { background: 'var(--bg-card)', border: '1px solid', borderRadius: 9, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 9 },
  incidentHead: { display: 'flex', alignItems: 'center', gap: 8 },
  incidentTitle: { fontSize: 12, fontWeight: 600 },
  incidentDetail: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 },
  dot: { width: 7, height: 7, borderRadius: '50%', flex: 'none' },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 11 },
  inspector: { background: 'var(--bg-card)', border: '1px solid', borderRadius: 9, padding: 13, display: 'flex', flexDirection: 'column', gap: 12 },
  inspectorHead: { display: 'flex', alignItems: 'center', gap: 9 },
  statusTile: { width: 26, height: 26, borderRadius: 6, border: '1px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  inspectorName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  inspectorSub: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dimmed)' },
  metricsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 10px' },
  metricLabel: { fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dimmed)', letterSpacing: '.05em', textTransform: 'uppercase' },
  metricValue: { fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' },
  metricUnit: { fontSize: 9, color: 'var(--text-dimmed)' },
  actions: { display: 'flex', gap: 6 },
  actionBtn: { flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, borderRadius: 7, padding: '7px 0', cursor: 'pointer', border: '1px solid' },
  actionPrimary: { color: 'var(--accent-fg)', background: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 600 },
  actionNeutral: { color: 'var(--text-secondary)', background: 'var(--bg-subtle)', borderColor: 'var(--border-strong)' },
  actionMsg: { fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' },
};
