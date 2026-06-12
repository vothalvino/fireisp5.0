// =============================================================================
// FireISP 5.0 — Topology Map Page (§13)
// =============================================================================
// Three-tab page:
//   Tab 1 — Network Topology: Leaflet map with device nodes, link polylines,
//            utilization coloring, layer selector, device search.
//   Tab 2 — Geographic Map: customer pins, service area polygons, fiber
//            route polylines, infrastructure pins.
//   Tab 3 — Dependency Analysis: device impact analysis, cascade chain,
//            dual-homed device list, dependency edge management.
// =============================================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceNode {
  id: number;
  name: string;
  type: string;
  role: string;
  status: string;
  ip_address: string | null;
  latitude: number | null;
  longitude: number | null;
  site_name: string | null;
}

interface LinkEdge {
  id: number;
  source: number;
  target: number;
  medium: string;
  status: string;
  bandwidth_mbps: number | null;
  utilization: number | null;
}

interface NetworkGraph {
  nodes: DeviceNode[];
  edges: LinkEdge[];
}

interface CustomerLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  status: string;
}

interface InfraPin {
  id: number;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  address: string | null;
}

interface FiberRoute {
  id: number;
  name: string;
  status: string;
  gis_path: unknown;
  segments: Array<{ id: number; coordinates: unknown; status: string }>;
}

interface ImpactAnalysis {
  device: DeviceNode | null;
  impacted: Array<DeviceNode & { dependency_type: string; is_redundant: boolean }>;
  edge_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Leaflet color for link utilization 0-100 */
function utilizationColor(pct: number | null): string {
  if (pct === null) return '#94a3b8';  // gray — no data
  if (pct < 50) return '#22c55e';      // green
  if (pct < 80) return '#f59e0b';      // amber
  return '#ef4444';                     // red
}

/** Device status color for circle markers */
function deviceColor(status: string): string {
  switch (status) {
    case 'active': return '#22c55e';
    case 'down': return '#ef4444';
    case 'maintenance': return '#f59e0b';
    default: return '#94a3b8';
  }
}

const DEFAULT_CENTER: [number, number] = [19.4326, -99.1332]; // Mexico City fallback
const DEFAULT_ZOOM = 5;

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.65rem',
  border: '1px solid var(--input-border)',
  borderRadius: 6,
  fontSize: '0.85rem',
  color: 'var(--text-secondary)',
  background: 'var(--input-bg)',
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Tab 1 — Network Topology
// ---------------------------------------------------------------------------

function NetworkTopologyTab() {
  const { t } = useTranslation();
  const [layer, setLayer] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data: graphData, isLoading } = useQuery({
    queryKey: ['topology-network', layer],
    queryFn: async () => {
      const q = layer ? { layer } : {};
      const res = await api.GET(
        '/v1/topology/map/network' as never,
        { params: { query: q } } as never,
      );
      return (res as { data: { data: NetworkGraph } }).data?.data as NetworkGraph;
    },
  });

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];

  // Filter nodes by search
  const filteredNodes = search
    ? nodes.filter(n =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      (n.ip_address ?? '').includes(search),
    )
    : nodes;

  // Build node position map for drawing edges
  const nodePos = new Map<number, [number, number]>();
  for (const n of nodes) {
    if (n.latitude != null && n.longitude != null) {
      nodePos.set(n.id, [n.latitude, n.longitude]);
    }
  }

  const firstGeo = nodes.find(n => n.latitude != null && n.longitude != null);
  const center: [number, number] = firstGeo
    ? [firstGeo.latitude!, firstGeo.longitude!]
    : DEFAULT_CENTER;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          placeholder={t('topologyMap.searchDevices')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...styles.input, flex: 1, minWidth: 180 }}
        />
        <select value={layer} onChange={e => setLayer(e.target.value)} style={selectStyle}>
          <option value="">{t('topologyMap.allLayers')}</option>
          <option value="l2">L2</option>
          <option value="l3">L3</option>
          <option value="physical">{t('topologyMap.physical')}</option>
        </select>
      </div>

      {isLoading && <p>{t('topologyMap.loading')}</p>}

      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: 500, borderRadius: 8 }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {edges.map(edge => {
          const posA = nodePos.get(edge.source);
          const posB = nodePos.get(edge.target);
          if (!posA || !posB) return null;
          return (
            <Polyline
              key={edge.id}
              positions={[posA, posB]}
              color={utilizationColor(edge.utilization)}
              weight={2}
            >
              <Tooltip>
                {edge.medium}
                {edge.bandwidth_mbps ? ` | ${edge.bandwidth_mbps} Mbps` : ` | ${t('topologyMap.unknownBw')}`}
                {edge.utilization !== null ? ` | ${edge.utilization}%` : ''}
              </Tooltip>
            </Polyline>
          );
        })}

        {filteredNodes
          .filter(n => n.latitude != null && n.longitude != null)
          .map(node => (
            <CircleMarker
              key={node.id}
              center={[node.latitude!, node.longitude!]}
              radius={6}
              color={deviceColor(node.status)}
              fillColor={deviceColor(node.status)}
              fillOpacity={0.8}
            >
              <Popup>
                <strong>{node.name}</strong><br />
                {node.type} / {node.role}<br />
                {node.ip_address && <>{node.ip_address}<br /></>}
                {t('topologyMap.status')}: {node.status}
              </Popup>
            </CircleMarker>
          ))}
      </MapContainer>

      <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', display: 'flex', gap: 16 }}>
        <span style={{ color: '#22c55e' }}>&#9632; {t('topologyMap.legendGreen')}</span>
        <span style={{ color: '#f59e0b' }}>&#9632; {t('topologyMap.legendAmber')}</span>
        <span style={{ color: '#ef4444' }}>&#9632; {t('topologyMap.legendRed')}</span>
        <span style={{ color: '#94a3b8' }}>&#9632; {t('topologyMap.legendGray')}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Geographic Map
// ---------------------------------------------------------------------------

function GeographicMapTab() {
  const { t } = useTranslation();

  const { data: customers } = useQuery({
    queryKey: ['topology-customers'],
    queryFn: async () => {
      const res = await api.GET('/v1/topology/map/customers' as never, {} as never);
      return (res as { data: { data: CustomerLocation[] } }).data?.data ?? [];
    },
  });

  const { data: infraData } = useQuery({
    queryKey: ['topology-infrastructure-pins'],
    queryFn: async () => {
      const res = await api.GET('/v1/topology/map/infrastructure' as never, {} as never);
      return (res as { data: { data: { infrastructure: InfraPin[]; sites: InfraPin[] } } }).data?.data;
    },
  });

  const { data: fiberData } = useQuery({
    queryKey: ['topology-fiber-routes'],
    queryFn: async () => {
      const res = await api.GET('/v1/topology/map/fiber-routes' as never, {} as never);
      return (res as { data: { data: FiberRoute[] } }).data?.data ?? [];
    },
  });

  const infraPins: InfraPin[] = [
    ...(infraData?.infrastructure ?? []),
    ...(infraData?.sites ?? []),
  ];

  const firstCustomer = (customers ?? []).find(c => c.latitude && c.longitude);
  const firstInfra = infraPins.find(p => p.latitude && p.longitude);
  const center: [number, number] =
    firstCustomer
      ? [firstCustomer.latitude, firstCustomer.longitude]
      : firstInfra
        ? [firstInfra.latitude, firstInfra.longitude]
        : DEFAULT_CENTER;

  return (
    <div>
      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: 520, borderRadius: 8 }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {(customers ?? []).map(c => (
          <CircleMarker
            key={`c-${c.id}`}
            center={[c.latitude, c.longitude]}
            radius={4}
            color="#3b82f6"
            fillColor="#3b82f6"
            fillOpacity={0.7}
          >
            <Popup>
              <strong>{c.name}</strong><br />
              {c.address && <>{c.address}<br /></>}
              {t('topologyMap.status')}: {c.status}
            </Popup>
          </CircleMarker>
        ))}

        {infraPins.map((pin, idx) => (
          <CircleMarker
            key={`i-${pin.id}-${idx}`}
            center={[pin.latitude, pin.longitude]}
            radius={7}
            color="#8b5cf6"
            fillColor="#8b5cf6"
            fillOpacity={0.8}
          >
            <Popup>
              <strong>{pin.name}</strong><br />
              {t('topologyMap.type')}: {pin.type}
              {pin.address && <><br />{pin.address}</>}
            </Popup>
          </CircleMarker>
        ))}

        {(fiberData ?? []).flatMap(route =>
          route.segments
            .filter(seg => seg.coordinates != null)
            .map(seg => {
              let coords: [number, number][] = [];
              try {
                const raw = typeof seg.coordinates === 'string'
                  ? JSON.parse(seg.coordinates)
                  : seg.coordinates;
                if (Array.isArray(raw)) {
                  coords = (raw as Array<[number, number]>).map(([lng, lat]) => [lat, lng]);
                }
              } catch {
                // skip
              }
              return coords.length > 1 ? (
                <Polyline key={`fr-${seg.id}`} positions={coords} color="#f97316" weight={2}>
                  <Tooltip>{route.name}</Tooltip>
                </Polyline>
              ) : null;
            }),
        )}
      </MapContainer>

      <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', display: 'flex', gap: 16 }}>
        <span style={{ color: '#3b82f6' }}>&#9632; {t('topologyMap.customers')}</span>
        <span style={{ color: '#8b5cf6' }}>&#9632; {t('topologyMap.infrastructure')}</span>
        <span style={{ color: '#f97316' }}>&#9632; {t('topologyMap.fiberRoutes')}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Dependency Analysis
// ---------------------------------------------------------------------------

function DependencyTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [analysisType, setAnalysisType] = useState<'impact' | 'cascade'>('impact');
  const [analysisResult, setAnalysisResult] = useState<ImpactAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [newEdge, setNewEdge] = useState({ parent_device_id: '', child_device_id: '', dependency_type: 'network' });
  const [edgeMsg, setEdgeMsg] = useState('');

  const { data: dualHomed } = useQuery({
    queryKey: ['topology-dual-homed'],
    queryFn: async () => {
      const res = await api.GET('/v1/topology/map/dual-homed' as never, {} as never);
      return (res as { data: { data: Array<DeviceNode & { upstream_link_count?: number }> } }).data?.data ?? [];
    },
  });

  async function runAnalysis() {
    if (!deviceId) return;
    setAnalysisLoading(true);
    try {
      const endpoint = analysisType === 'impact'
        ? `/v1/topology/map/impact/${deviceId}`
        : `/v1/topology/map/cascade/${deviceId}`;
      const res = await api.GET(endpoint as never, {} as never);
      setAnalysisResult((res as { data: { data: ImpactAnalysis } }).data?.data ?? null);
    } catch {
      setAnalysisResult(null);
    } finally {
      setAnalysisLoading(false);
    }
  }

  const createEdgeMut = useMutation({
    mutationFn: async (body: typeof newEdge) => {
      return api.POST('/v1/topology/dependencies' as never, {
        body: {
          parent_device_id: Number(body.parent_device_id),
          child_device_id: Number(body.child_device_id),
          dependency_type: body.dependency_type,
        },
      } as never);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['topology-dual-homed'] });
      setEdgeMsg(t('topologyMap.edgeCreated'));
      setNewEdge({ parent_device_id: '', child_device_id: '', dependency_type: 'network' });
    },
    onError: () => { setEdgeMsg(t('topologyMap.edgeError')); },
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('topologyMap.impactAnalysis')}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            placeholder={t('topologyMap.deviceIdPlaceholder')}
            value={deviceId}
            onChange={e => setDeviceId(e.target.value)}
            style={{ ...styles.input, flex: 1 }}
          />
          <select
            value={analysisType}
            onChange={e => setAnalysisType(e.target.value as 'impact' | 'cascade')}
            style={selectStyle}
          >
            <option value="impact">{t('topologyMap.impact')}</option>
            <option value="cascade">{t('topologyMap.cascade')}</option>
          </select>
          <button
            onClick={() => { void runAnalysis(); }}
            disabled={!deviceId || analysisLoading}
            style={styles.primaryButton}
          >
            {analysisLoading ? t('topologyMap.analyzing') : t('topologyMap.analyze')}
          </button>
        </div>

        {analysisResult && (
          <div>
            {analysisResult.device && (
              <p style={{ margin: '4px 0', fontWeight: 600 }}>
                {t('topologyMap.device')}: {analysisResult.device.name}
              </p>
            )}
            <p style={{ margin: '4px 0', color: '#64748b', fontSize: 13 }}>
              {analysisType === 'impact'
                ? t('topologyMap.impactedCount', { count: analysisResult.edge_count })
                : t('topologyMap.chainLength', { count: analysisResult.impacted?.length ?? 0 })}
            </p>
            {(analysisResult.impacted ?? []).length > 0 && (
              <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 13 }}>
                {(analysisResult.impacted ?? []).slice(0, 10).map(d => (
                  <li key={d.id} style={{ color: d.status === 'active' ? '#22c55e' : '#ef4444' }}>
                    {d.name} ({d.type})
                    {d.is_redundant && <span style={{ color: '#f59e0b' }}> &#9889;</span>}
                  </li>
                ))}
                {(analysisResult.impacted ?? []).length > 10 && (
                  <li>+{(analysisResult.impacted ?? []).length - 10} {t('topologyMap.more')}</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{t('topologyMap.addDependency')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            placeholder={t('topologyMap.parentDeviceId')}
            value={newEdge.parent_device_id}
            onChange={e => setNewEdge(p => ({ ...p, parent_device_id: e.target.value }))}
            style={styles.input}
          />
          <input
            placeholder={t('topologyMap.childDeviceId')}
            value={newEdge.child_device_id}
            onChange={e => setNewEdge(p => ({ ...p, child_device_id: e.target.value }))}
            style={styles.input}
          />
          <select
            value={newEdge.dependency_type}
            onChange={e => setNewEdge(p => ({ ...p, dependency_type: e.target.value }))}
            style={selectStyle}
          >
            <option value="network">{t('topologyMap.depNetwork')}</option>
            <option value="power">{t('topologyMap.depPower')}</option>
            <option value="management">{t('topologyMap.depManagement')}</option>
            <option value="other">{t('topologyMap.depOther')}</option>
          </select>
          <button
            onClick={() => createEdgeMut.mutate(newEdge)}
            disabled={!newEdge.parent_device_id || !newEdge.child_device_id || createEdgeMut.isPending}
            style={styles.primaryButton}
          >
            {createEdgeMut.isPending ? t('topologyMap.saving') : t('topologyMap.addEdge')}
          </button>
          {edgeMsg && <p style={{ fontSize: 13, color: '#22c55e' }}>{edgeMsg}</p>}
        </div>

        <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>{t('topologyMap.dualHomed')}</h3>
        {(dualHomed ?? []).length === 0
          ? <p style={{ color: '#64748b', fontSize: 13 }}>{t('topologyMap.noDualHomed')}</p>
          : (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
              {(dualHomed ?? []).map(d => (
                <li key={d.id}>
                  {d.name} ({d.type}) — {t('topologyMap.uplinks')}: {d.upstream_link_count ?? 2}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------

type Tab = 'network' | 'geographic' | 'dependency';

export function TopologyMapPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('network');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'network', label: t('topologyMap.tabNetwork') },
    { id: 'geographic', label: t('topologyMap.tabGeographic') },
    { id: 'dependency', label: t('topologyMap.tabDependency') },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>{t('topologyMap.title')}</h1>

      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 16 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#3b82f6' : '#64748b',
              cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'network' && <NetworkTopologyTab />}
      {activeTab === 'geographic' && <GeographicMapTab />}
      {activeTab === 'dependency' && <DependencyTab />}
    </div>
  );
}
