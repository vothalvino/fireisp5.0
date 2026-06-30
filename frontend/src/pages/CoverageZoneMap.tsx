// =============================================================================
// FireISP 5.0 — Coverage Zone Map Editor
// =============================================================================
// Interactive SVG polygon editor for drawing and editing coverage zone
// boundaries on a lat/lng coordinate canvas.
//
// Features:
//   • Service area selector (left panel)
//   • Zone list with status badge and tech-type chip (left panel)
//   • SVG canvas: panning, click-to-add-vertex, close-polygon
//   • Undo last vertex while drawing
//   • Zone create / edit modal (name, zone_type, color, speeds, status)
//   • Zone delete with confirmation dialog
// All data fetched from:
//   GET /api/v1/service-areas        — service area list
//   GET /api/v1/coverage-zones?service_area_id=N — zones for a service area
//   POST   /api/v1/coverage-zones    — create zone
//   PUT    /api/v1/coverage-zones/:id — update zone
//   DELETE /api/v1/coverage-zones/:id — delete zone
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceArea {
  id: number;
  name: string;
  status: string;
  color: string | null;
}

interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][]; // [[[lng, lat], ...]]
}

interface CoverageZone {
  id: number;
  service_area_id: number | null;
  name: string;
  description: string | null;
  zone_type: string;
  boundary: GeoJsonPolygon | null;
  max_download_mbps: number | null;
  max_upload_mbps: number | null;
  color: string | null;
  status: string;
}

interface ZoneFormData {
  service_area_id: number | null;
  name: string;
  description: string;
  zone_type: string;
  max_download_mbps: string;
  max_upload_mbps: string;
  color: string;
  status: string;
}

const DEFAULT_FORM: ZoneFormData = {
  service_area_id: null,
  name: '',
  description: '',
  zone_type: 'fiber',
  max_download_mbps: '',
  max_upload_mbps: '',
  color: '#3B82F6',
  status: 'planned',
};

// ---------------------------------------------------------------------------
// Coordinate projection helpers
// ---------------------------------------------------------------------------

interface ViewPort {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const DEFAULT_VIEWPORT: ViewPort = {
  minLng: -100,
  minLat: 15,
  maxLng: -86,
  maxLat: 23,
};

function lngLatToSvg(
  lng: number,
  lat: number,
  vp: ViewPort,
  svgW: number,
  svgH: number,
): [number, number] {
  const x = ((lng - vp.minLng) / (vp.maxLng - vp.minLng)) * svgW;
  // Invert Y axis: higher latitudes = lower Y in SVG
  const y = ((vp.maxLat - lat) / (vp.maxLat - vp.minLat)) * svgH;
  return [x, y];
}

function svgToLngLat(
  x: number,
  y: number,
  vp: ViewPort,
  svgW: number,
  svgH: number,
): [number, number] {
  const lng = (x / svgW) * (vp.maxLng - vp.minLng) + vp.minLng;
  const lat = vp.maxLat - (y / svgH) * (vp.maxLat - vp.minLat);
  return [parseFloat(lng.toFixed(6)), parseFloat(lat.toFixed(6))];
}

function boundaryToSvgPoints(
  boundary: GeoJsonPolygon | null,
  vp: ViewPort,
  svgW: number,
  svgH: number,
): [number, number][] {
  if (!boundary?.coordinates?.[0]) return [];
  return boundary.coordinates[0].map(([lng, lat]) =>
    lngLatToSvg(lng, lat, vp, svgW, svgH),
  );
}

/** Compute a viewport that fits all zone boundaries with 10% padding. */
function fitViewport(zones: CoverageZone[]): ViewPort {
  const lngs: number[] = [];
  const lats: number[] = [];

  for (const z of zones) {
    if (z.boundary?.coordinates?.[0]) {
      for (const [lng, lat] of z.boundary.coordinates[0]) {
        lngs.push(lng);
        lats.push(lat);
      }
    }
  }

  if (lngs.length === 0) return DEFAULT_VIEWPORT;

  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const padLng = Math.max((maxLng - minLng) * 0.1, 0.01);
  const padLat = Math.max((maxLat - minLat) * 0.1, 0.01);

  return {
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchServiceAreas(): Promise<ServiceArea[]> {
  const data = await apiFetch<{ data: ServiceArea[] }>('/service-areas?limit=200');
  return data.data;
}

async function fetchZones(serviceAreaId: number): Promise<CoverageZone[]> {
  const data = await apiFetch<{ data: CoverageZone[] }>(
    `/coverage-zones?service_area_id=${serviceAreaId}`,
  );
  return data.data;
}

// ---------------------------------------------------------------------------
// Status / type display helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  planned:            { bg: 'var(--accent-soft)', text: 'var(--accent)' },
  under_construction: { bg: '#fef9c3', text: '#854d0e' },
  active:             { bg: '#d1fae5', text: '#065f46' },
  degraded:           { bg: '#fee2e2', text: '#991b1b' },
  retired:            { bg: '#f3f4f6', text: '#6b7280' },
};

const ZONE_TYPE_ICONS: Record<string, string> = {
  fiber:          '💡',
  fixed_wireless: '📡',
  dsl:            '🔌',
  cable:          '🔗',
  satellite:      '🛰️',
  lte:            '📶',
  '5g':           '🔵',
  other:          '🖧',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.text,
      padding: '1px 7px', borderRadius: 10,
      fontSize: '0.68rem', fontWeight: 600, textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Zone modal (create / edit)
// ---------------------------------------------------------------------------

interface ZoneModalProps {
  mode: 'create' | 'edit';
  initial: ZoneFormData;
  serviceAreas: ServiceArea[];
  drawingBoundary: GeoJsonPolygon | null;
  onDrawingClear: () => void;
  onSave: (data: ZoneFormData) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function ZoneModal({
  mode, initial, serviceAreas, drawingBoundary,
  onDrawingClear, onSave, onCancel, saving, error,
}: ZoneModalProps) {
  const [form, setForm] = useState<ZoneFormData>(initial);

  function field(key: keyof ZoneFormData, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
          {mode === 'create' ? '➕ New Coverage Zone' : '✏️ Edit Coverage Zone'}
        </h3>

        {error && (
          <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>
            {error}
          </p>
        )}

        <div style={fieldGrid}>
          <label style={label}>Name *</label>
          <input style={input} value={form.name} onChange={e => field('name', e.target.value)} />

          <label style={label}>Service Area</label>
          <select style={input} value={form.service_area_id ?? ''} onChange={e => field('service_area_id', e.target.value)}>
            <option value="">— None —</option>
            {serviceAreas.map(sa => (
              <option key={sa.id} value={sa.id}>{sa.name}</option>
            ))}
          </select>

          <label style={label}>Zone Type</label>
          <select style={input} value={form.zone_type} onChange={e => field('zone_type', e.target.value)}>
            {['fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other'].map(t => (
              <option key={t} value={t}>{ZONE_TYPE_ICONS[t]} {t.replace(/_/g, ' ')}</option>
            ))}
          </select>

          <label style={label}>Status</label>
          <select style={input} value={form.status} onChange={e => field('status', e.target.value)}>
            {['planned', 'under_construction', 'active', 'degraded', 'retired'].map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>

          <label style={label}>Max Download (Mbps)</label>
          <input style={input} type="number" min="0" value={form.max_download_mbps}
            onChange={e => field('max_download_mbps', e.target.value)} />

          <label style={label}>Max Upload (Mbps)</label>
          <input style={input} type="number" min="0" value={form.max_upload_mbps}
            onChange={e => field('max_upload_mbps', e.target.value)} />

          <label style={label}>Color</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="color" value={form.color} onChange={e => field('color', e.target.value)}
              style={{ width: 36, height: 28, padding: 1, borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer' }} />
            <input style={{ ...input, flex: 1 }} value={form.color} onChange={e => field('color', e.target.value)} />
          </div>

          <label style={label}>Description</label>
          <textarea style={{ ...input, resize: 'vertical', height: 56 }} value={form.description}
            onChange={e => field('description', e.target.value)} />

          <label style={label}>Boundary</label>
          <div>
            {drawingBoundary ? (
              <div style={{ fontSize: '0.8rem', color: '#059669', display: 'flex', gap: 8, alignItems: 'center' }}>
                ✅ Polygon drawn ({drawingBoundary.coordinates[0].length - 1} vertices)
                <button style={btnDanger} onClick={onDrawingClear}>Clear</button>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>
                Close this modal and draw a polygon on the map.
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button style={btnSecondary} onClick={onCancel} disabled={saving}>Cancel</button>
          <button style={btnPrimary} onClick={() => onSave(form)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG Map Canvas
// ---------------------------------------------------------------------------

interface MapCanvasProps {
  zones: CoverageZone[];
  selectedZoneId: number | null;
  drawingMode: boolean;
  draftVertices: [number, number][]; // SVG coords
  viewport: ViewPort;
  svgW: number;
  svgH: number;
  onCanvasClick: (x: number, y: number) => void;
  onZoneClick: (id: number) => void;
}

function MapCanvas({
  zones, selectedZoneId, drawingMode, draftVertices,
  viewport, svgW, svgH, onCanvasClick, onZoneClick,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!drawingMode) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * svgW;
    const y = ((e.clientY - rect.top) / rect.height) * svgH;
    onCanvasClick(x, y);
  }

  // Lat/lng grid lines
  const gridLines: React.ReactNode[] = [];
  const lngStep = Math.ceil((viewport.maxLng - viewport.minLng) / 5 * 10) / 10;
  const latStep = Math.ceil((viewport.maxLat - viewport.minLat) / 5 * 10) / 10;

  for (let lng = Math.ceil(viewport.minLng / lngStep) * lngStep; lng <= viewport.maxLng; lng += lngStep) {
    const [x] = lngLatToSvg(lng, viewport.minLat, viewport, svgW, svgH);
    gridLines.push(
      <line key={`vg${lng}`} x1={x} y1={0} x2={x} y2={svgH}
        stroke="#e5e7eb" strokeWidth={0.5} />,
    );
  }
  for (let lat = Math.ceil(viewport.minLat / latStep) * latStep; lat <= viewport.maxLat; lat += latStep) {
    const [, y] = lngLatToSvg(viewport.minLng, lat, viewport, svgW, svgH);
    gridLines.push(
      <line key={`hg${lat}`} x1={0} y1={y} x2={svgW} y2={y}
        stroke="#e5e7eb" strokeWidth={0.5} />,
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{
        width: '100%',
        height: '100%',
        background: '#f0f4ff',
        borderRadius: 8,
        cursor: drawingMode ? 'crosshair' : 'default',
        display: 'block',
      }}
      onClick={handleClick}
    >
      {/* Grid */}
      {gridLines}

      {/* Existing zones */}
      {zones.map(zone => {
        const pts = boundaryToSvgPoints(zone.boundary, viewport, svgW, svgH);
        if (pts.length < 2) return null;
        const pointsStr = pts.map(([x, y]) => `${x},${y}`).join(' ');
        const zoneColor = zone.color ?? '#3B82F6';
        const isSelected = zone.id === selectedZoneId;
        return (
          <g key={zone.id} onClick={e => { e.stopPropagation(); onZoneClick(zone.id); }}>
            <polygon
              points={pointsStr}
              fill={zoneColor + '33'} // 20% opacity
              stroke={zoneColor}
              strokeWidth={isSelected ? 2.5 : 1.5}
              style={{ cursor: 'pointer' }}
            />
            {/* Zone label — centroid approximation */}
            {(() => {
              const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
              const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
              return (
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fontWeight={isSelected ? 700 : 500}
                  fill={zoneColor}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {zone.name}
                </text>
              );
            })()}
          </g>
        );
      })}

      {/* Draft polygon being drawn */}
      {draftVertices.length > 0 && (
        <g>
          {/* Edges so far */}
          {draftVertices.length > 1 && (
            <polyline
              points={draftVertices.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3"
            />
          )}
          {/* Close-line preview */}
          {draftVertices.length > 2 && (
            <line
              x1={draftVertices[draftVertices.length - 1][0]}
              y1={draftVertices[draftVertices.length - 1][1]}
              x2={draftVertices[0][0]}
              y2={draftVertices[0][1]}
              stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 4" opacity={0.5}
            />
          )}
          {/* Vertex dots */}
          {draftVertices.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={4}
              fill={i === 0 ? '#10b981' : '#f59e0b'} stroke="#fff" strokeWidth={1.5} />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function CoverageZoneMap() {
  const qc = useQueryClient();

  // Service area selection
  const [selectedSaId, setSelectedSaId] = useState<number | null>(null);

  // Selected zone in list
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);

  // Drawing mode
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftVerticesSvg, setDraftVerticesSvg] = useState<[number, number][]>([]);
  const [draftBoundary, setDraftBoundary] = useState<GeoJsonPolygon | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState<CoverageZone | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CoverageZone | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Canvas viewport
  const SVG_W = 800;
  const SVG_H = 500;
  const zonesQuery = useQuery({
    queryKey: ['coverage-zones', selectedSaId],
    queryFn: () => (selectedSaId ? fetchZones(selectedSaId) : Promise.resolve([])),
    enabled: selectedSaId !== null,
  });
  const zones: CoverageZone[] = zonesQuery.data ?? [];

  const [viewport, setViewport] = useState<ViewPort>(DEFAULT_VIEWPORT);
  useEffect(() => {
    if (zones.length > 0) setViewport(fitViewport(zones));
  }, [zones]);

  const serviceAreasQuery = useQuery({ queryKey: ['service-areas'], queryFn: fetchServiceAreas });
  const serviceAreas: ServiceArea[] = serviceAreasQuery.data ?? [];

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await authedFetch(`${API}/coverage-zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coverage-zones', selectedSaId] });
      setCreateModalOpen(false);
      setDraftBoundary(null);
      setModalError(null);
    },
    onError: (err: Error) => setModalError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: object }) => {
      const res = await authedFetch(`${API}/coverage-zones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coverage-zones', selectedSaId] });
      setEditModalOpen(null);
      setDraftBoundary(null);
      setModalError(null);
    },
    onError: (err: Error) => setModalError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authedFetch(`${API}/coverage-zones/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coverage-zones', selectedSaId] });
      setDeleteTarget(null);
      if (selectedZoneId === deleteTarget?.id) setSelectedZoneId(null);
    },
  });

  // ---- Drawing ----

  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (!drawingMode) return;
    setDraftVerticesSvg(prev => [...prev, [x, y]]);
  }, [drawingMode]);

  function undoLastVertex() {
    setDraftVerticesSvg(prev => prev.slice(0, -1));
  }

  function completePolygon() {
    if (draftVerticesSvg.length < 3) return;
    // Convert SVG coords → lng/lat
    const lngLats = draftVerticesSvg.map(([x, y]) =>
      svgToLngLat(x, y, viewport, SVG_W, SVG_H),
    );
    // Close the ring
    lngLats.push(lngLats[0]);
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [lngLats],
    };
    setDraftBoundary(polygon);
    setDrawingMode(false);
    setDraftVerticesSvg([]);
  }

  function clearDrawing() {
    setDraftVerticesSvg([]);
    setDraftBoundary(null);
    setDrawingMode(false);
  }

  // ---- Save handlers ----

  function buildPayload(form: ZoneFormData, boundary: GeoJsonPolygon | null, zoneId?: number) {
    const payload: Record<string, unknown> = {
      name: form.name,
      zone_type: form.zone_type,
      status: form.status,
      color: form.color || null,
      description: form.description || null,
      max_download_mbps: form.max_download_mbps ? Number(form.max_download_mbps) : null,
      max_upload_mbps: form.max_upload_mbps ? Number(form.max_upload_mbps) : null,
    };
    if (form.service_area_id) payload.service_area_id = Number(form.service_area_id);
    if (boundary) payload.boundary = boundary;
    if (!zoneId && selectedSaId) payload.service_area_id = selectedSaId;
    return payload;
  }

  function handleCreate(form: ZoneFormData) {
    const payload = buildPayload(form, draftBoundary);
    if (!payload.boundary) {
      setModalError('Please draw a polygon on the map before saving.');
      return;
    }
    createMutation.mutate(payload);
  }

  function handleUpdate(form: ZoneFormData) {
    if (!editModalOpen) return;
    const payload = buildPayload(form, draftBoundary, editModalOpen.id);
    updateMutation.mutate({ id: editModalOpen.id, payload });
  }

  function openEditModal(zone: CoverageZone) {
    setEditModalOpen(zone);
    setDraftBoundary(zone.boundary);
    setModalError(null);
  }

  // ---- Render ----

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 2rem)', padding: '1rem', gap: '1rem', maxWidth: 1400 }}>
      {/* ---- Left Panel ---- */}
      <div style={{
        width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12,
        overflowY: 'auto',
      }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem' }}>🗺️ Coverage Zone Editor</h1>

        {/* Service area selector */}
        <div>
          <label style={{ fontSize: '0.78rem', color: '#555', fontWeight: 600 }}>Service Area</label>
          {serviceAreasQuery.isLoading ? (
            <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#888' }}>Loading…</p>
          ) : (
            <select
              style={filterSelect}
              value={selectedSaId ?? ''}
              onChange={e => {
                setSelectedSaId(e.target.value ? Number(e.target.value) : null);
                setSelectedZoneId(null);
              }}
            >
              <option value="">— Select a service area —</option>
              {serviceAreas.map(sa => (
                <option key={sa.id} value={sa.id}>{sa.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Zone list */}
        {selectedSaId && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>
                Zones ({zones.length})
              </span>
              <button style={btnPrimary} onClick={() => { setCreateModalOpen(true); setModalError(null); setDraftBoundary(null); }}>
                + New Zone
              </button>
            </div>

            {zonesQuery.isLoading && <p style={{ fontSize: '0.8rem', color: '#888' }}>Loading zones…</p>}
            {zonesQuery.error && <p style={{ fontSize: '0.8rem', color: '#e00' }}>Failed to load zones.</p>}

            {zones.map(zone => (
              <div
                key={zone.id}
                style={{
                  border: `2px solid ${selectedZoneId === zone.id ? zone.color ?? '#3B82F6' : '#e5e7eb'}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: selectedZoneId === zone.id ? '#f0f4ff' : '#fff',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedZoneId(id => id === zone.id ? null : zone.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', flex: 1 }}>
                    {ZONE_TYPE_ICONS[zone.zone_type] ?? '🖧'}&nbsp;{zone.name}
                  </div>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: zone.color ?? '#3B82F6', flexShrink: 0 }} />
                </div>
                <div style={{ marginTop: 4 }}>
                  <StatusBadge status={zone.status} />
                </div>
                {(zone.max_download_mbps || zone.max_upload_mbps) && (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                    ↓ {zone.max_download_mbps ?? '?'} Mbps &nbsp;↑ {zone.max_upload_mbps ?? '?'} Mbps
                  </div>
                )}
                {selectedZoneId === zone.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button style={btnSmSecondary} onClick={e => { e.stopPropagation(); openEditModal(zone); }}>Edit</button>
                    <button style={btnSmDanger} onClick={e => { e.stopPropagation(); setDeleteTarget(zone); }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {!selectedSaId && (
          <p style={{ fontSize: '0.82rem', color: '#9ca3af', fontStyle: 'italic' }}>
            Select a service area to view and edit its coverage zones.
          </p>
        )}
      </div>

      {/* ---- Right Panel — Map Canvas ---- */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!drawingMode ? (
            <button
              style={btnPrimary}
              onClick={() => { setDrawingMode(true); setDraftVerticesSvg([]); }}
              disabled={!selectedSaId}
            >
              ✏️ Draw Polygon
            </button>
          ) : (
            <>
              <button
                style={btnPrimary}
                onClick={completePolygon}
                disabled={draftVerticesSvg.length < 3}
              >
                ✅ Complete Polygon ({draftVerticesSvg.length} pts)
              </button>
              <button style={btnSecondary} onClick={undoLastVertex} disabled={draftVerticesSvg.length === 0}>
                ↩ Undo
              </button>
              <button style={btnDanger} onClick={clearDrawing}>
                ✕ Cancel Drawing
              </button>
            </>
          )}
          {draftBoundary && !drawingMode && (
            <span style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>
              ✅ Polygon ready — open a zone modal to save it
            </span>
          )}
          {drawingMode && (
            <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600 }}>
              Click on the map to add vertices. First vertex (green) closes the polygon.
            </span>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', minHeight: 400 }}>
          {!selectedSaId ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
              Select a service area to display its coverage zones
            </div>
          ) : (
            <MapCanvas
              zones={zones}
              selectedZoneId={selectedZoneId}
              drawingMode={drawingMode}
              draftVertices={draftVerticesSvg}
              viewport={viewport}
              svgW={SVG_W}
              svgH={SVG_H}
              onCanvasClick={handleCanvasClick}
              onZoneClick={id => setSelectedZoneId(prev => prev === id ? null : id)}
            />
          )}
        </div>

        {/* Coordinate info bar */}
        {selectedSaId && (
          <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
            Viewport: {viewport.minLat.toFixed(4)}°–{viewport.maxLat.toFixed(4)}°N,{' '}
            {viewport.minLng.toFixed(4)}°–{viewport.maxLng.toFixed(4)}°W &nbsp;|&nbsp;
            {zones.length} zone{zones.length !== 1 ? 's' : ''} loaded
          </div>
        )}
      </div>

      {/* ---- Create Modal ---- */}
      {createModalOpen && (
        <ZoneModal
          mode="create"
          initial={{ ...DEFAULT_FORM, service_area_id: selectedSaId }}
          serviceAreas={serviceAreas}
          drawingBoundary={draftBoundary}
          onDrawingClear={() => setDraftBoundary(null)}
          onSave={handleCreate}
          onCancel={() => { setCreateModalOpen(false); setModalError(null); }}
          saving={createMutation.isPending}
          error={modalError}
        />
      )}

      {/* ---- Edit Modal ---- */}
      {editModalOpen && (
        <ZoneModal
          mode="edit"
          initial={{
            service_area_id: editModalOpen.service_area_id,
            name: editModalOpen.name,
            description: editModalOpen.description ?? '',
            zone_type: editModalOpen.zone_type,
            max_download_mbps: editModalOpen.max_download_mbps?.toString() ?? '',
            max_upload_mbps: editModalOpen.max_upload_mbps?.toString() ?? '',
            color: editModalOpen.color ?? '#3B82F6',
            status: editModalOpen.status,
          }}
          serviceAreas={serviceAreas}
          drawingBoundary={draftBoundary}
          onDrawingClear={() => setDraftBoundary(editModalOpen.boundary)}
          onSave={handleUpdate}
          onCancel={() => { setEditModalOpen(null); setDraftBoundary(null); setModalError(null); }}
          saving={updateMutation.isPending}
          error={modalError}
        />
      )}

      {/* ---- Delete Confirmation ---- */}
      {deleteTarget && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 360 }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>🗑️ Delete Zone</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem' }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action can be undone from the API.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button style={btnDanger} onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const filterSelect: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4,
  padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db',
  fontSize: '0.85rem', background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
};

const btnSecondary: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1px solid #d1d5db',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem',
};

const btnDanger: React.CSSProperties = {
  background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem',
};

const btnSmSecondary: React.CSSProperties = {
  ...btnSecondary, padding: '3px 8px', fontSize: '0.75rem',
};

const btnSmDanger: React.CSSProperties = {
  ...btnDanger, padding: '3px 8px', fontSize: '0.75rem',
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const modal: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '1.5rem',
  maxWidth: 480, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,.2)',
  maxHeight: '90vh', overflowY: 'auto',
};

const fieldGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.5rem 0.75rem',
  alignItems: 'center',
};

const label: React.CSSProperties = {
  fontSize: '0.78rem', color: '#555', fontWeight: 600,
};

const input: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 5, border: '1px solid #d1d5db',
  fontSize: '0.82rem', background: '#fff', width: '100%', boxSizing: 'border-box',
};
