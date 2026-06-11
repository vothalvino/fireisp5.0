// =============================================================================
// FireISP 5.0 — Fiber Plant Management (§7.4)
// =============================================================================
// Tabbed page covering:
//   1. Fiber Routes     — CO → splitter → ONU path CRUD
//   2. ODF Frames       — ODF frame + port + cross-connect management
//   3. OTDR Tests       — test result records and fault locations
//   4. SFP Inventory    — SFP lifecycle tracking + DDM diagnostics view
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FiberRoute {
  id: number;
  name: string;
  route_type: string;
  status: string;
  total_length_m: number | null;
  fiber_count: number | null;
  installation_date: string | null;
  notes: string | null;
}

interface FiberRoutesResponse {
  data: FiberRoute[];
  meta: { total: number; page: number; limit: number };
}

interface FiberRouteBody {
  name: string;
  route_type?: string;
  status?: string;
  total_length_m?: number;
  fiber_count?: number;
  installation_date?: string;
  notes?: string;
}

interface OdfFrame {
  id: number;
  name: string;
  location_detail: string | null;
  total_ports: number;
  frame_type: string;
  status: string;
  ports?: OdfPort[];
}

interface OdfFramesResponse {
  data: OdfFrame[];
  meta: { total: number; page: number; limit: number };
}

interface OdfPort {
  id: number;
  odf_frame_id: number;
  port_number: number;
  connector_type: string;
  status: string;
  fiber_route_id: number | null;
}

interface OtdrTest {
  id: number;
  device_id: number | null;
  olt_port_id: number | null;
  test_date: string;
  wavelength_nm: number | null;
  fiber_length_m: number | null;
  fault_detected: boolean;
  fault_distance_m: number | null;
  fault_type: string | null;
  job_status: string;
  notes: string | null;
}

interface OtdrTestsResponse {
  data: OtdrTest[];
  meta: { total: number; page: number; limit: number };
}

interface OtdrTestBody {
  device_id?: number;
  olt_port_id?: number;
  test_date?: string;
  wavelength_nm?: number;
  fiber_length_m?: number;
  fault_detected?: boolean;
  fault_distance_m?: number;
  fault_type?: string;
  notes?: string;
}

interface SfpItem {
  id: number;
  device_id: number | null;
  inventory_item_id: number | null;
  sfp_port_name: string | null;
  form_factor: string;
  vendor_name: string | null;
  part_number: string | null;
  serial_number: string | null;
  wavelength_nm: number | null;
  max_distance_km: number | null;
  lifecycle_status: string;
  installed_at: string | null;
  device_name?: string;
}

interface SfpResponse {
  data: SfpItem[];
  meta: { total: number; page: number; limit: number };
}

interface SfpBody {
  device_id?: number;
  inventory_item_id?: number;
  sfp_port_name?: string;
  form_factor?: string;
  vendor_name?: string;
  part_number?: string;
  serial_number?: string;
  wavelength_nm?: number;
  max_distance_km?: number;
  lifecycle_status?: string;
  notes?: string;
}

interface SfpDiagnostics {
  inventory: SfpItem;
  diagnostics: {
    sfp_tx_power_dbm: number | null;
    sfp_rx_power_dbm: number | null;
    sfp_temperature_c: number | null;
    collected_at: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const ROUTE_TYPES = ['trunk', 'distribution', 'drop', 'feeder', 'other'];
const ROUTE_STATUSES = ['active', 'inactive', 'planned', 'decommissioned'];
const ODF_STATUSES = ['active', 'inactive', 'damaged', 'removed'];
const FAULT_TYPES = ['fiber_break', 'splice_loss', 'connector_loss', 'bend_loss', 'reflection', 'other'];
const FORM_FACTORS = ['sfp', 'sfp_plus', 'sfp28', 'qsfp', 'qsfp_plus', 'xfp', 'gbic', 'other'];
const LIFECYCLE_STATUSES = ['installed', 'spare', 'faulty', 'retired'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// Fiber Routes
async function fetchFiberRoutes(page: number): Promise<FiberRoutesResponse> {
  const res = await api.GET('/fiber-plant/fiber-routes' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load fiber routes');
  return (res as { data: unknown }).data as unknown as FiberRoutesResponse;
}

async function createFiberRoute(body: FiberRouteBody): Promise<void> {
  const res = await api.POST('/fiber-plant/fiber-routes' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create fiber route');
}

async function updateFiberRoute(id: number, body: Partial<FiberRouteBody>): Promise<void> {
  const res = await api.PATCH('/fiber-plant/fiber-routes/{id}' as never, {
    params: { path: { id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update fiber route');
}

async function deleteFiberRoute(id: number): Promise<void> {
  const res = await api.DELETE('/fiber-plant/fiber-routes/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete fiber route');
}

// ODF Frames
async function fetchOdfFrames(page: number): Promise<OdfFramesResponse> {
  const res = await api.GET('/fiber-plant/odf/frames' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ODF frames');
  return (res as { data: unknown }).data as unknown as OdfFramesResponse;
}

async function fetchOdfFrameWithPorts(id: number): Promise<OdfFrame> {
  const res = await api.GET('/fiber-plant/odf/frames/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ODF frame');
  return (res as { data: unknown }).data as unknown as OdfFrame;
}

async function createOdfFrame(body: { name: string; location_detail?: string; total_ports?: number; frame_type?: string }): Promise<void> {
  const res = await api.POST('/fiber-plant/odf/frames' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create ODF frame');
}

async function deleteOdfFrame(id: number): Promise<void> {
  const res = await api.DELETE('/fiber-plant/odf/frames/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete ODF frame');
}

// OTDR Tests
async function fetchOtdrTests(page: number): Promise<OtdrTestsResponse> {
  const res = await api.GET('/fiber-plant/otdr/tests' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load OTDR tests');
  return (res as { data: unknown }).data as unknown as OtdrTestsResponse;
}

async function createOtdrTest(body: OtdrTestBody): Promise<void> {
  const res = await api.POST('/fiber-plant/otdr/tests' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create OTDR test');
}

async function deleteOtdrTest(id: number): Promise<void> {
  const res = await api.DELETE('/fiber-plant/otdr/tests/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete OTDR test');
}

// SFP Inventory
async function fetchSfp(page: number): Promise<SfpResponse> {
  const res = await api.GET('/fiber-plant/sfp' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load SFP inventory');
  return (res as { data: unknown }).data as unknown as SfpResponse;
}

async function createSfp(body: SfpBody): Promise<void> {
  const res = await api.POST('/fiber-plant/sfp' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create SFP entry');
}

async function deleteSfp(id: number): Promise<void> {
  const res = await api.DELETE('/fiber-plant/sfp/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete SFP entry');
}

async function fetchSfpDiagnostics(id: number): Promise<SfpDiagnostics> {
  const res = await api.GET('/fiber-plant/sfp/{id}/diagnostics' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load SFP diagnostics');
  return (res as { data: unknown }).data as unknown as SfpDiagnostics;
}

// ---------------------------------------------------------------------------
// Tab button style helper
// ---------------------------------------------------------------------------

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--primary)' : 'var(--text-secondary)',
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FiberPlantManagementPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'fiberRoutes' | 'odf' | 'otdr' | 'sfp'>('fiberRoutes');

  // ============================== FIBER ROUTES ==============================

  const [frPage, setFrPage] = useState(1);
  const frQ = useQuery({
    queryKey: ['fiberPlant', 'fiberRoutes', frPage],
    queryFn: () => fetchFiberRoutes(frPage),
    enabled: tab === 'fiberRoutes',
  });
  const [showFrModal, setShowFrModal] = useState(false);
  const [editingFr, setEditingFr] = useState<FiberRoute | null>(null);
  const [frForm, setFrForm] = useState<Partial<FiberRouteBody>>({});
  const [frErr, setFrErr] = useState('');

  function openFrModal(fr?: FiberRoute) {
    setEditingFr(fr ?? null);
    setFrForm(fr
      ? { name: fr.name, route_type: fr.route_type, status: fr.status,
          total_length_m: fr.total_length_m ?? undefined,
          fiber_count: fr.fiber_count ?? undefined, notes: fr.notes ?? '' }
      : { route_type: 'drop', status: 'active' });
    setFrErr('');
    setShowFrModal(true);
  }

  const saveFrMut = useMutation({
    mutationFn: () => editingFr
      ? updateFiberRoute(editingFr.id, frForm)
      : createFiberRoute(frForm as FiberRouteBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiberPlant', 'fiberRoutes'] });
      setShowFrModal(false);
    },
    onError: (e: unknown) => setFrErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteFrMut = useMutation({
    mutationFn: deleteFiberRoute,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiberPlant', 'fiberRoutes'] }),
  });

  const frTotalPages = Math.ceil((frQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== ODF ==============================

  const [odfPage, setOdfPage] = useState(1);
  const odfQ = useQuery({
    queryKey: ['fiberPlant', 'odf', odfPage],
    queryFn: () => fetchOdfFrames(odfPage),
    enabled: tab === 'odf',
  });
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const frameDetailQ = useQuery({
    queryKey: ['fiberPlant', 'odfFrame', selectedFrameId],
    queryFn: () => fetchOdfFrameWithPorts(selectedFrameId as number),
    enabled: selectedFrameId !== null,
  });
  const [showOdfModal, setShowOdfModal] = useState(false);
  const [odfForm, setOdfForm] = useState({ name: '', location_detail: '', total_ports: '24', frame_type: 'standard' });
  const [odfErr, setOdfErr] = useState('');

  const createOdfMut = useMutation({
    mutationFn: createOdfFrame,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiberPlant', 'odf'] });
      setShowOdfModal(false);
    },
    onError: (e: unknown) => setOdfErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteOdfMut = useMutation({
    mutationFn: deleteOdfFrame,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiberPlant', 'odf'] });
      if (selectedFrameId) setSelectedFrameId(null);
    },
  });

  const odfTotalPages = Math.ceil((odfQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== OTDR TESTS ==============================

  const [otdrPage, setOtdrPage] = useState(1);
  const otdrQ = useQuery({
    queryKey: ['fiberPlant', 'otdr', otdrPage],
    queryFn: () => fetchOtdrTests(otdrPage),
    enabled: tab === 'otdr',
  });
  const [showOtdrModal, setShowOtdrModal] = useState(false);
  const [otdrForm, setOtdrForm] = useState<Partial<OtdrTestBody>>({ fault_detected: false });
  const [otdrErr, setOtdrErr] = useState('');

  const createOtdrMut = useMutation({
    mutationFn: createOtdrTest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiberPlant', 'otdr'] });
      setShowOtdrModal(false);
    },
    onError: (e: unknown) => setOtdrErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteOtdrMut = useMutation({
    mutationFn: deleteOtdrTest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiberPlant', 'otdr'] }),
  });

  const otdrTotalPages = Math.ceil((otdrQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ============================== SFP INVENTORY ==============================

  const [sfpPage, setSfpPage] = useState(1);
  const sfpQ = useQuery({
    queryKey: ['fiberPlant', 'sfp', sfpPage],
    queryFn: () => fetchSfp(sfpPage),
    enabled: tab === 'sfp',
  });
  const [showSfpModal, setShowSfpModal] = useState(false);
  const [sfpForm, setSfpForm] = useState<Partial<SfpBody>>({ form_factor: 'sfp_plus', lifecycle_status: 'spare' });
  const [sfpErr, setSfpErr] = useState('');
  const [diagSfpId, setDiagSfpId] = useState<number | null>(null);
  const diagQ = useQuery({
    queryKey: ['fiberPlant', 'sfpDiag', diagSfpId],
    queryFn: () => fetchSfpDiagnostics(diagSfpId as number),
    enabled: diagSfpId !== null,
  });

  const createSfpMut = useMutation({
    mutationFn: createSfp,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiberPlant', 'sfp'] });
      setShowSfpModal(false);
    },
    onError: (e: unknown) => setSfpErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteSfpMut = useMutation({
    mutationFn: deleteSfp,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiberPlant', 'sfp'] }),
  });

  const sfpTotalPages = Math.ceil((sfpQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('fiberPlantManagement.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {t('fiberPlantManagement.subtitle')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}>
        {(['fiberRoutes', 'odf', 'otdr', 'sfp'] as const).map(t2 => (
          <button key={t2} style={tabBtn(tab === t2)} onClick={() => setTab(t2)}>
            {t(`fiberPlantManagement.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: Fiber Routes */}
      {/* ================================================================ */}
      {tab === 'fiberRoutes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => openFrModal()}>
              + {t('fiberPlantManagement.fiberRoutes.new')}
            </button>
          </div>
          {frQ.isLoading && <p style={styles.msg}>{t('fiberPlantManagement.loading')}</p>}
          {frQ.isError && <p style={styles.msgError}>{t('fiberPlantManagement.fiberRoutes.loadError')}</p>}
          {frQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('fiberPlantManagement.fiberRoutes.name')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.fiberRoutes.type')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.fiberRoutes.status')}</th>
                      <th style={styles.thNum}>{t('fiberPlantManagement.fiberRoutes.length')}</th>
                      <th style={styles.thNum}>{t('fiberPlantManagement.fiberRoutes.fiberCount')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.fiberRoutes.installDate')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {frQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('fiberPlantManagement.fiberRoutes.noRoutes')}</td></tr>
                    )}
                    {frQ.data.data.map(fr => (
                      <tr key={fr.id} style={styles.tr}>
                        <td style={styles.tdNum}>{fr.id}</td>
                        <td style={styles.td}><strong>{fr.name}</strong></td>
                        <td style={styles.td}>{fr.route_type}</td>
                        <td style={styles.td}>
                          <span style={{ color: fr.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                            {fr.status}
                          </span>
                        </td>
                        <td style={styles.tdNum}>{fr.total_length_m !== null ? `${fr.total_length_m} m` : '—'}</td>
                        <td style={styles.tdNum}>{fr.fiber_count ?? '—'}</td>
                        <td style={styles.td}>{fmtDate(fr.installation_date)}</td>
                        <td style={styles.td}>
                          <button style={styles.actionBtn} onClick={() => openFrModal(fr)}>
                            {t('fiberPlantManagement.edit')}
                          </button>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('fiberPlantManagement.confirmDelete'))) {
                                deleteFrMut.mutate(fr.id);
                              }
                            }}
                          >
                            {t('fiberPlantManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setFrPage(p => Math.max(1, p - 1))} disabled={frPage <= 1}>
                  &laquo; {t('fiberPlantManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{frPage} / {frTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setFrPage(p => p + 1)} disabled={frPage >= frTotalPages}>
                  {t('fiberPlantManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: ODF Frames */}
      {/* ================================================================ */}
      {tab === 'odf' && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedFrameId ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
          {/* Left: frame list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
              <button style={styles.btnPrimary} onClick={() => { setOdfErr(''); setOdfForm({ name: '', location_detail: '', total_ports: '24', frame_type: 'standard' }); setShowOdfModal(true); }}>
                + {t('fiberPlantManagement.odf.newFrame')}
              </button>
            </div>
            {odfQ.isLoading && <p style={styles.msg}>{t('fiberPlantManagement.loading')}</p>}
            {odfQ.isError && <p style={styles.msgError}>{t('fiberPlantManagement.odf.loadError')}</p>}
            {odfQ.data && (
              <>
                <div style={styles.tableCard}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thNum}>ID</th>
                        <th style={styles.th}>{t('fiberPlantManagement.odf.name')}</th>
                        <th style={styles.th}>{t('fiberPlantManagement.odf.location')}</th>
                        <th style={styles.thNum}>{t('fiberPlantManagement.odf.totalPorts')}</th>
                        <th style={styles.th}>{t('fiberPlantManagement.odf.status')}</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {odfQ.data.data.length === 0 && (
                        <tr><td colSpan={6} style={styles.msg}>{t('fiberPlantManagement.odf.noFrames')}</td></tr>
                      )}
                      {odfQ.data.data.map(frame => (
                        <tr
                          key={frame.id}
                          style={{ ...styles.tr, background: selectedFrameId === frame.id ? 'var(--bg-hover)' : 'transparent', cursor: 'pointer' }}
                          onClick={() => setSelectedFrameId(selectedFrameId === frame.id ? null : frame.id)}
                        >
                          <td style={styles.tdNum}>{frame.id}</td>
                          <td style={styles.td}><strong>{frame.name}</strong></td>
                          <td style={styles.td}>{frame.location_detail ?? '—'}</td>
                          <td style={styles.tdNum}>{frame.total_ports}</td>
                          <td style={styles.td}>
                            <span style={{ color: frame.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.82rem' }}>
                              {frame.status}
                            </span>
                          </td>
                          <td style={styles.td} onClick={e => e.stopPropagation()}>
                            <button
                              style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                              onClick={() => {
                                if (window.confirm(t('fiberPlantManagement.confirmDelete'))) {
                                  deleteOdfMut.mutate(frame.id);
                                }
                              }}
                            >
                              {t('fiberPlantManagement.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={styles.pagination}>
                  <button style={styles.pageBtn} onClick={() => setOdfPage(p => Math.max(1, p - 1))} disabled={odfPage <= 1}>
                    &laquo;
                  </button>
                  <span style={styles.pageInfo}>{odfPage} / {odfTotalPages}</span>
                  <button style={styles.pageBtn} onClick={() => setOdfPage(p => p + 1)} disabled={odfPage >= odfTotalPages}>
                    &raquo;
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right: frame detail with ports */}
          {selectedFrameId && (
            <div>
              {frameDetailQ.isLoading && <p style={styles.msg}>{t('fiberPlantManagement.loading')}</p>}
              {frameDetailQ.data && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, fontWeight: 700 }}>{frameDetailQ.data.name}</h3>
                    <button style={styles.btnSecondary} onClick={() => setSelectedFrameId(null)}>
                      {t('fiberPlantManagement.close')}
                    </button>
                  </div>
                  <div style={styles.tableCard}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.thNum}>#</th>
                          <th style={styles.th}>{t('fiberPlantManagement.odf.connectorType')}</th>
                          <th style={styles.th}>{t('fiberPlantManagement.odf.portStatus')}</th>
                          <th style={styles.thNum}>{t('fiberPlantManagement.odf.fiberRoute')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!frameDetailQ.data.ports || frameDetailQ.data.ports.length === 0) && (
                          <tr><td colSpan={4} style={styles.msg}>{t('fiberPlantManagement.odf.noPorts')}</td></tr>
                        )}
                        {(frameDetailQ.data.ports ?? []).map(p => (
                          <tr key={p.id} style={styles.tr}>
                            <td style={styles.tdNum}>{p.port_number}</td>
                            <td style={styles.td}>{p.connector_type}</td>
                            <td style={styles.td}>
                              <span style={{ color: p.status === 'active' ? '#059669' : '#6b7280', fontWeight: 600, fontSize: '0.78rem' }}>
                                {p.status}
                              </span>
                            </td>
                            <td style={styles.tdNum}>{p.fiber_route_id ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: OTDR Tests */}
      {/* ================================================================ */}
      {tab === 'otdr' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => { setOtdrErr(''); setOtdrForm({ fault_detected: false }); setShowOtdrModal(true); }}>
              + {t('fiberPlantManagement.otdr.newTest')}
            </button>
          </div>
          {otdrQ.isLoading && <p style={styles.msg}>{t('fiberPlantManagement.loading')}</p>}
          {otdrQ.isError && <p style={styles.msgError}>{t('fiberPlantManagement.otdr.loadError')}</p>}
          {otdrQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('fiberPlantManagement.otdr.testDate')}</th>
                      <th style={styles.thNum}>{t('fiberPlantManagement.otdr.fiberLength')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.otdr.faultDetected')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.otdr.faultType')}</th>
                      <th style={styles.thNum}>{t('fiberPlantManagement.otdr.faultDistance')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.otdr.jobStatus')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {otdrQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('fiberPlantManagement.otdr.noTests')}</td></tr>
                    )}
                    {otdrQ.data.data.map(test => (
                      <tr key={test.id} style={styles.tr}>
                        <td style={styles.tdNum}>{test.id}</td>
                        <td style={styles.td}>{fmtDate(test.test_date)}</td>
                        <td style={styles.tdNum}>{test.fiber_length_m !== null ? `${test.fiber_length_m} m` : '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: test.fault_detected ? '#dc2626' : '#059669', fontWeight: 600, fontSize: '0.82rem' }}>
                            {test.fault_detected ? t('fiberPlantManagement.otdr.yes') : t('fiberPlantManagement.otdr.no')}
                          </span>
                        </td>
                        <td style={styles.td}>{test.fault_type ?? '—'}</td>
                        <td style={styles.tdNum}>{test.fault_distance_m !== null ? `${test.fault_distance_m} m` : '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: test.job_status === 'completed' ? '#059669' : test.job_status === 'failed' ? '#dc2626' : '#d97706', fontSize: '0.82rem' }}>
                            {test.job_status}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('fiberPlantManagement.confirmDelete'))) {
                                deleteOtdrMut.mutate(test.id);
                              }
                            }}
                          >
                            {t('fiberPlantManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setOtdrPage(p => Math.max(1, p - 1))} disabled={otdrPage <= 1}>
                  &laquo; {t('fiberPlantManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{otdrPage} / {otdrTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setOtdrPage(p => p + 1)} disabled={otdrPage >= otdrTotalPages}>
                  {t('fiberPlantManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: SFP Inventory */}
      {/* ================================================================ */}
      {tab === 'sfp' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => { setSfpErr(''); setSfpForm({ form_factor: 'sfp_plus', lifecycle_status: 'spare' }); setShowSfpModal(true); }}>
              + {t('fiberPlantManagement.sfp.new')}
            </button>
          </div>
          {sfpQ.isLoading && <p style={styles.msg}>{t('fiberPlantManagement.loading')}</p>}
          {sfpQ.isError && <p style={styles.msgError}>{t('fiberPlantManagement.sfp.loadError')}</p>}
          {sfpQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('fiberPlantManagement.sfp.vendor')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.sfp.partNumber')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.sfp.formFactor')}</th>
                      <th style={styles.thNum}>{t('fiberPlantManagement.sfp.wavelength')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.sfp.lifecycle')}</th>
                      <th style={styles.th}>{t('fiberPlantManagement.sfp.device')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sfpQ.data.data.length === 0 && (
                      <tr><td colSpan={8} style={styles.msg}>{t('fiberPlantManagement.sfp.noItems')}</td></tr>
                    )}
                    {sfpQ.data.data.map(sfp => (
                      <tr key={sfp.id} style={styles.tr}>
                        <td style={styles.tdNum}>{sfp.id}</td>
                        <td style={styles.td}>{sfp.vendor_name ?? '—'}</td>
                        <td style={styles.tdMono}>{sfp.part_number ?? '—'}</td>
                        <td style={styles.td}>{sfp.form_factor}</td>
                        <td style={styles.tdNum}>{sfp.wavelength_nm !== null ? `${sfp.wavelength_nm} nm` : '—'}</td>
                        <td style={styles.td}>
                          <span style={{
                            color: sfp.lifecycle_status === 'installed' ? '#059669'
                              : sfp.lifecycle_status === 'faulty' ? '#dc2626'
                                : sfp.lifecycle_status === 'retired' ? '#6b7280'
                                  : '#d97706',
                            fontWeight: 600, fontSize: '0.82rem',
                          }}>
                            {sfp.lifecycle_status}
                          </span>
                        </td>
                        <td style={styles.td}>{sfp.device_name ?? (sfp.device_id ? `#${sfp.device_id}` : '—')}</td>
                        <td style={styles.td}>
                          {sfp.lifecycle_status === 'installed' && (
                            <button
                              style={styles.actionBtn}
                              onClick={() => setDiagSfpId(diagSfpId === sfp.id ? null : sfp.id)}
                            >
                              {t('fiberPlantManagement.sfp.diagnostics')}
                            </button>
                          )}
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('fiberPlantManagement.confirmDelete'))) {
                                deleteSfpMut.mutate(sfp.id);
                              }
                            }}
                          >
                            {t('fiberPlantManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setSfpPage(p => Math.max(1, p - 1))} disabled={sfpPage <= 1}>
                  &laquo; {t('fiberPlantManagement.prev')}
                </button>
                <span style={styles.pageInfo}>{sfpPage} / {sfpTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setSfpPage(p => p + 1)} disabled={sfpPage >= sfpTotalPages}>
                  {t('fiberPlantManagement.next')} &raquo;
                </button>
              </div>

              {/* SFP Diagnostics panel */}
              {diagSfpId && diagQ.data && (
                <div style={{ marginTop: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                    {t('fiberPlantManagement.sfp.diagnosticsTitle')} — {diagQ.data.inventory.vendor_name ?? ''} {diagQ.data.inventory.part_number ?? `#${diagSfpId}`}
                  </h3>
                  {diagQ.data.diagnostics ? (
                    <table style={styles.table}>
                      <tbody>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('fiberPlantManagement.sfp.txPower')}</td>
                          <td style={styles.tdMono}>{diagQ.data.diagnostics.sfp_tx_power_dbm !== null ? `${diagQ.data.diagnostics.sfp_tx_power_dbm} dBm` : '—'}</td>
                        </tr>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('fiberPlantManagement.sfp.rxPower')}</td>
                          <td style={styles.tdMono}>{diagQ.data.diagnostics.sfp_rx_power_dbm !== null ? `${diagQ.data.diagnostics.sfp_rx_power_dbm} dBm` : '—'}</td>
                        </tr>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('fiberPlantManagement.sfp.temperature')}</td>
                          <td style={styles.tdMono}>{diagQ.data.diagnostics.sfp_temperature_c !== null ? `${diagQ.data.diagnostics.sfp_temperature_c} °C` : '—'}</td>
                        </tr>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('fiberPlantManagement.sfp.collectedAt')}</td>
                          <td style={styles.td}>{new Date(diagQ.data.diagnostics.collected_at).toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p style={styles.msg}>{t('fiberPlantManagement.sfp.noDiagnostics')}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Fiber Route Modal */}
      {showFrModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {editingFr ? t('fiberPlantManagement.fiberRoutes.edit') : t('fiberPlantManagement.fiberRoutes.new')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowFrModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.fiberRoutes.name')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  value={frForm.name ?? ''}
                  onChange={e => setFrForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.fiberRoutes.type')}
                <select
                  style={modalStyles.select}
                  value={frForm.route_type ?? 'drop'}
                  onChange={e => setFrForm(f => ({ ...f, route_type: e.target.value }))}
                >
                  {ROUTE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.fiberRoutes.status')}
                <select
                  style={modalStyles.select}
                  value={frForm.status ?? 'active'}
                  onChange={e => setFrForm(f => ({ ...f, status: e.target.value }))}
                >
                  {ROUTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.fiberRoutes.length')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={0}
                  value={frForm.total_length_m ?? ''}
                  onChange={e => setFrForm(f => ({ ...f, total_length_m: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.fiberRoutes.fiberCount')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={frForm.fiber_count ?? ''}
                  onChange={e => setFrForm(f => ({ ...f, fiber_count: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.notes')}
                <input
                  style={modalStyles.input}
                  value={frForm.notes ?? ''}
                  onChange={e => setFrForm(f => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {frErr && <p style={modalStyles.error}>{frErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowFrModal(false)}>
                {t('fiberPlantManagement.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={saveFrMut.isPending} onClick={() => saveFrMut.mutate()}>
                {t('fiberPlantManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ODF Frame Modal */}
      {showOdfModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('fiberPlantManagement.odf.newFrame')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowOdfModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.odf.name')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  value={odfForm.name}
                  onChange={e => setOdfForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.odf.location')}
                <input
                  style={modalStyles.input}
                  value={odfForm.location_detail}
                  onChange={e => setOdfForm(f => ({ ...f, location_detail: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.odf.totalPorts')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={odfForm.total_ports}
                  onChange={e => setOdfForm(f => ({ ...f, total_ports: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.odf.frameType')}
                <select
                  style={modalStyles.select}
                  value={odfForm.frame_type}
                  onChange={e => setOdfForm(f => ({ ...f, frame_type: e.target.value }))}
                >
                  {ODF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            {odfErr && <p style={modalStyles.error}>{odfErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowOdfModal(false)}>
                {t('fiberPlantManagement.cancel')}
              </button>
              <button
                style={styles.btnPrimary}
                disabled={createOdfMut.isPending}
                onClick={() => createOdfMut.mutate({
                  name: odfForm.name,
                  location_detail: odfForm.location_detail || undefined,
                  total_ports: Number(odfForm.total_ports) || undefined,
                  frame_type: odfForm.frame_type || undefined,
                })}
              >
                {t('fiberPlantManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTDR Test Modal */}
      {showOtdrModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('fiberPlantManagement.otdr.newTest')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowOtdrModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.otdr.fiberLength')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={0}
                  value={otdrForm.fiber_length_m ?? ''}
                  onChange={e => setOtdrForm(f => ({ ...f, fiber_length_m: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.otdr.wavelength')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="1310"
                  value={otdrForm.wavelength_nm ?? ''}
                  onChange={e => setOtdrForm(f => ({ ...f, wavelength_nm: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={otdrForm.fault_detected ?? false}
                  onChange={e => setOtdrForm(f => ({ ...f, fault_detected: e.target.checked }))}
                />
                {t('fiberPlantManagement.otdr.faultDetected')}
              </label>
              {otdrForm.fault_detected && (
                <>
                  <label style={modalStyles.label}>
                    {t('fiberPlantManagement.otdr.faultType')}
                    <select
                      style={modalStyles.select}
                      value={otdrForm.fault_type ?? ''}
                      onChange={e => setOtdrForm(f => ({ ...f, fault_type: e.target.value || undefined }))}
                    >
                      <option value="">—</option>
                      {FAULT_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                    </select>
                  </label>
                  <label style={modalStyles.label}>
                    {t('fiberPlantManagement.otdr.faultDistance')}
                    <input
                      style={modalStyles.input}
                      type="number"
                      min={0}
                      value={otdrForm.fault_distance_m ?? ''}
                      onChange={e => setOtdrForm(f => ({ ...f, fault_distance_m: e.target.value ? Number(e.target.value) : undefined }))}
                    />
                  </label>
                </>
              )}
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.notes')}
                <input
                  style={modalStyles.input}
                  value={otdrForm.notes ?? ''}
                  onChange={e => setOtdrForm(f => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {otdrErr && <p style={modalStyles.error}>{otdrErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowOtdrModal(false)}>
                {t('fiberPlantManagement.cancel')}
              </button>
              <button
                style={styles.btnPrimary}
                disabled={createOtdrMut.isPending}
                onClick={() => createOtdrMut.mutate(otdrForm)}
              >
                {t('fiberPlantManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SFP Modal */}
      {showSfpModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('fiberPlantManagement.sfp.new')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowSfpModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.formFactor')}
                <select
                  style={modalStyles.select}
                  value={sfpForm.form_factor ?? 'sfp_plus'}
                  onChange={e => setSfpForm(f => ({ ...f, form_factor: e.target.value }))}
                >
                  {FORM_FACTORS.map(ff => <option key={ff} value={ff}>{ff}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.vendor')}
                <input
                  style={modalStyles.input}
                  value={sfpForm.vendor_name ?? ''}
                  onChange={e => setSfpForm(f => ({ ...f, vendor_name: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.partNumber')}
                <input
                  style={modalStyles.input}
                  value={sfpForm.part_number ?? ''}
                  onChange={e => setSfpForm(f => ({ ...f, part_number: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.serialNumber')}
                <input
                  style={modalStyles.input}
                  value={sfpForm.serial_number ?? ''}
                  onChange={e => setSfpForm(f => ({ ...f, serial_number: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.wavelength')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="1310"
                  value={sfpForm.wavelength_nm ?? ''}
                  onChange={e => setSfpForm(f => ({ ...f, wavelength_nm: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.lifecycle')}
                <select
                  style={modalStyles.select}
                  value={sfpForm.lifecycle_status ?? 'spare'}
                  onChange={e => setSfpForm(f => ({ ...f, lifecycle_status: e.target.value }))}
                >
                  {LIFECYCLE_STATUSES.map(ls => <option key={ls} value={ls}>{ls}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('fiberPlantManagement.sfp.deviceId')}
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={sfpForm.device_id ?? ''}
                  onChange={e => setSfpForm(f => ({ ...f, device_id: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
            </div>
            {sfpErr && <p style={modalStyles.error}>{sfpErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowSfpModal(false)}>
                {t('fiberPlantManagement.cancel')}
              </button>
              <button
                style={styles.btnPrimary}
                disabled={createSfpMut.isPending}
                onClick={() => createSfpMut.mutate(sfpForm)}
              >
                {t('fiberPlantManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
