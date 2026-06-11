// =============================================================================
// FireISP 5.0 — PON Port Management (§7.3)
// =============================================================================
// Tabbed page covering:
//   1. Port Utilization    — per-port ONU counts, optical power spread
//   2. ONUs per Port       — active/inactive list with state filter
//   3. Power Budget        — optical power budget calculator (pure calc)
//   4. ONU Migrations      — migration job list and creation
//
// Port shutdown (maintenance mode) and XGS-PON mode config are action
// buttons within the Utilization tab.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PonPortUtilization {
  port: {
    id: number;
    port_name: string;
    olt_name: string;
    onu_count: number;
    max_onus: number;
    tx_power_dbm: number | null;
    rx_power_dbm: number | null;
    bandwidth_up_bps: number | null;
    bandwidth_down_bps: number | null;
    maintenance_mode: number;
    maintenance_note: string | null;
    xgspon_mode: string;
    xgspon_mode_validated: number;
  };
  onu_state_counts: Array<{ onu_state: string; cnt: number }>;
  optical_summary: {
    avg_rx_dbm: number | null;
    min_rx_dbm: number | null;
    max_rx_dbm: number | null;
    avg_tx_dbm: number | null;
  } | null;
}

interface OnuListItem {
  id: number;
  name: string;
  serial_number: string | null;
  onu_state: string;
  onu_id: number | null;
  ranging_distance_m: number | null;
  wan_mode: string;
  last_status_at: string | null;
}

interface PowerBudgetResult {
  budget_db: number;
  splitter_loss_db: number;
  fiber_loss_db: number;
  total_loss_db: number;
  max_path_loss_db: number;
  margin_db: number;
  result: 'ok' | 'exceeded';
}

interface MigrationJob {
  id: number;
  status: string;
  onu_device_id: number;
  source_olt_port_id: number;
  target_olt_port_id: number;
  scheduled_at: string | null;
  created_at: string;
  onu_name?: string;
  source_port_name?: string;
  target_port_name?: string;
}

interface MigrationsResponse {
  data: MigrationJob[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const SPLITTER_RATIOS = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128'];
const XGS_PON_MODES = ['gpon', 'xgspon_2_5g', 'xgspon_10g', 'auto', 'none'];
const ONU_STATES = [
  'online', 'offline', 'los', 'dying_gasp', 'power_off',
  'loc', 'unconfigured', 'unknown',
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchUtilization(portId: number): Promise<PonPortUtilization> {
  const res = await api.GET('/olt-management/ports/{portId}/utilization' as never, {
    params: { path: { portId } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load utilization');
  return (res as { data: unknown }).data as unknown as PonPortUtilization;
}

async function fetchOnus(portId: number, state: string): Promise<OnuListItem[]> {
  const query: Record<string, string | number> = {};
  if (state) query.state = state;
  const res = await api.GET('/olt-management/ports/{portId}/onus' as never, {
    params: { path: { portId }, query: query as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load ONUs');
  return (res as { data: unknown }).data as unknown as OnuListItem[];
}

async function calcPowerBudget(body: {
  olt_tx_power_dbm: number;
  splitter_ratio: string;
  fiber_length_m: number;
  attenuation_per_km_db?: number;
  connector_margin_db?: number;
}): Promise<PowerBudgetResult> {
  const res = await api.POST('/olt-management/power-budget' as never, {
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Calculation failed');
  return (res as { data: unknown }).data as unknown as PowerBudgetResult;
}

async function setPortMaintenance(portId: number, enable: boolean, note: string): Promise<void> {
  const res = await api.POST('/olt-management/ports/{portId}/shutdown' as never, {
    params: { path: { portId } },
    body: { enable, note } as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to set maintenance mode');
}

async function configureXgsPonMode(portId: number, mode: string): Promise<void> {
  const res = await api.POST('/olt-management/ports/{portId}/xgspon-mode' as never, {
    params: { path: { portId } },
    body: { mode } as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to configure mode');
}

async function fetchMigrations(page: number): Promise<MigrationsResponse> {
  const res = await api.GET('/olt-management/onu-migrations' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load migrations');
  return (res as { data: unknown }).data as unknown as MigrationsResponse;
}

async function createMigration(body: {
  onu_device_id: number;
  source_olt_port_id: number;
  target_olt_port_id: number;
}): Promise<void> {
  const res = await api.POST('/olt-management/onu-migrations' as never, {
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create migration');
}

async function cancelMigration(jobId: number): Promise<void> {
  const res = await api.POST('/olt-management/onu-migrations/{jobId}/cancel' as never, {
    params: { path: { jobId } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to cancel migration');
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

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '1rem',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PonPortManagementPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'utilization' | 'onus' | 'powerBudget' | 'migrations'>('utilization');
  const [portId, setPortId] = useState('');
  const portIdNum = portId ? Number(portId) : 0;

  // -- Utilization
  const utilizationQ = useQuery({
    queryKey: ['ponPort', 'utilization', portIdNum],
    queryFn: () => fetchUtilization(portIdNum),
    enabled: portIdNum > 0,
  });

  // -- ONUs per port
  const [onuStateFilter, setOnuStateFilter] = useState('');
  const onusQ = useQuery({
    queryKey: ['ponPort', 'onus', portIdNum, onuStateFilter],
    queryFn: () => fetchOnus(portIdNum, onuStateFilter),
    enabled: portIdNum > 0 && tab === 'onus',
  });

  // -- Power budget
  const [pbForm, setPbForm] = useState({
    olt_tx_power_dbm: '3.0',
    splitter_ratio: '1:32',
    fiber_length_m: '5000',
    attenuation_per_km_db: '0.35',
    connector_margin_db: '2.0',
  });
  const [pbResult, setPbResult] = useState<PowerBudgetResult | null>(null);
  const [pbErr, setPbErr] = useState('');
  const calcMut = useMutation({
    mutationFn: calcPowerBudget,
    onSuccess: (data) => { setPbResult(data); setPbErr(''); },
    onError: (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? 'Calculation failed';
      setPbErr(msg);
    },
  });

  // -- Maintenance mode modal
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [maintEnable, setMaintEnable] = useState(true);
  const [maintNote, setMaintNote] = useState('');
  const maintMut = useMutation({
    mutationFn: ({ enable, note }: { enable: boolean; note: string }) =>
      setPortMaintenance(portIdNum, enable, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ponPort', 'utilization', portIdNum] });
      setShowMaintModal(false);
    },
  });

  // -- XGS-PON mode modal
  const [showModeModal, setShowModeModal] = useState(false);
  const [selectedMode, setSelectedMode] = useState('none');
  const modeMut = useMutation({
    mutationFn: (mode: string) => configureXgsPonMode(portIdNum, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ponPort', 'utilization', portIdNum] });
      setShowModeModal(false);
    },
  });

  // -- ONU migrations
  const [migPage, setMigPage] = useState(1);
  const migrationsQ = useQuery({
    queryKey: ['ponPort', 'migrations', migPage],
    queryFn: () => fetchMigrations(migPage),
    enabled: tab === 'migrations',
  });
  const [showMigModal, setShowMigModal] = useState(false);
  const [migForm, setMigForm] = useState({
    onu_device_id: '',
    source_olt_port_id: '',
    target_olt_port_id: '',
  });
  const [migErr, setMigErr] = useState('');
  const createMigMut = useMutation({
    mutationFn: createMigration,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ponPort', 'migrations'] });
      setShowMigModal(false);
      setMigForm({ onu_device_id: '', source_olt_port_id: '', target_olt_port_id: '' });
      setMigErr('');
    },
    onError: (e: unknown) => {
      setMigErr((e as { message?: string })?.message ?? 'Failed');
    },
  });
  const cancelMigMut = useMutation({
    mutationFn: cancelMigration,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ponPort', 'migrations'] }),
  });

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const util = utilizationQ.data;
  const migTotalPages = Math.ceil((migrationsQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('ponPortManagement.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {t('ponPortManagement.subtitle')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}>
        {(['utilization', 'onus', 'powerBudget', 'migrations'] as const).map(t2 => (
          <button key={t2} style={tabBtn(tab === t2)} onClick={() => setTab(t2)}>
            {t(`ponPortManagement.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {/* Port ID selector (shared by utilization + onus) */}
      {(tab === 'utilization' || tab === 'onus') && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('ponPortManagement.utilization.portSelector')}:
          </label>
          <input
            type="number"
            min={1}
            placeholder={t('ponPortManagement.utilization.portId')}
            value={portId}
            onChange={e => setPortId(e.target.value)}
            style={{ ...modalStyles.input, width: '120px' }}
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Utilization */}
      {/* ================================================================ */}
      {tab === 'utilization' && (
        <div>
          {!portIdNum && (
            <p style={styles.msg}>{t('ponPortManagement.utilization.enterPortHint')}</p>
          )}
          {portIdNum > 0 && utilizationQ.isLoading && (
            <p style={styles.msg}>{t('ponPortManagement.loading')}</p>
          )}
          {utilizationQ.isError && (
            <p style={styles.msgError}>{t('ponPortManagement.utilization.loadError')}</p>
          )}
          {util && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Port info card */}
              <div style={card}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                  {util.port.port_name} &mdash; {util.port.olt_name}
                </h3>
                <table style={styles.table}>
                  <tbody>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{t('ponPortManagement.utilization.onuCount')}</td>
                      <td style={styles.tdNum}><strong>{util.port.onu_count}</strong> / {util.port.max_onus}</td>
                    </tr>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{t('ponPortManagement.utilization.txPower')}</td>
                      <td style={styles.tdMono}>{util.port.tx_power_dbm !== null ? `${util.port.tx_power_dbm} dBm` : '—'}</td>
                    </tr>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{t('ponPortManagement.utilization.rxPower')}</td>
                      <td style={styles.tdMono}>{util.port.rx_power_dbm !== null ? `${util.port.rx_power_dbm} dBm` : '—'}</td>
                    </tr>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{t('ponPortManagement.utilization.maintenance')}</td>
                      <td style={styles.td}>
                        <span style={{ color: util.port.maintenance_mode ? '#d97706' : '#059669', fontWeight: 600 }}>
                          {util.port.maintenance_mode
                            ? t('ponPortManagement.utilization.maintenanceModeOn')
                            : t('ponPortManagement.utilization.maintenanceModeOff')}
                        </span>
                        {util.port.maintenance_note && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.5rem' }}>
                            ({util.port.maintenance_note})
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{t('ponPortManagement.utilization.xgsPonMode')}</td>
                      <td style={styles.tdMono}>{util.port.xgspon_mode}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    style={util.port.maintenance_mode ? styles.btnPrimary : styles.btnDanger}
                    onClick={() => {
                      setMaintEnable(!util.port.maintenance_mode);
                      setMaintNote('');
                      setShowMaintModal(true);
                    }}
                  >
                    {util.port.maintenance_mode
                      ? t('ponPortManagement.utilization.clearMaintenance')
                      : t('ponPortManagement.utilization.enableMaintenance')}
                  </button>
                  <button
                    style={styles.btnSecondary}
                    onClick={() => { setSelectedMode(util.port.xgspon_mode); setShowModeModal(true); }}
                  >
                    {t('ponPortManagement.utilization.configureMode')}
                  </button>
                </div>
              </div>

              {/* ONU state breakdown + optical summary */}
              <div style={card}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                  {t('ponPortManagement.utilization.onuBreakdown')}
                </h3>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('ponPortManagement.onus.state')}</th>
                      <th style={styles.thNum}>{t('ponPortManagement.utilization.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {util.onu_state_counts.map(r => (
                      <tr key={r.onu_state} style={styles.tr}>
                        <td style={styles.td}>{r.onu_state}</td>
                        <td style={styles.tdNum}><strong>{r.cnt}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {util.optical_summary && (
                  <>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>
                      {t('ponPortManagement.utilization.opticalSummary')}
                    </h4>
                    <table style={styles.table}>
                      <tbody>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('ponPortManagement.utilization.avgRxDbm')}</td>
                          <td style={styles.tdNum}>{util.optical_summary.avg_rx_dbm?.toFixed(2) ?? '—'}</td>
                        </tr>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('ponPortManagement.utilization.minRxDbm')}</td>
                          <td style={styles.tdNum}>{util.optical_summary.min_rx_dbm?.toFixed(2) ?? '—'}</td>
                        </tr>
                        <tr style={styles.tr}>
                          <td style={styles.td}>{t('ponPortManagement.utilization.maxRxDbm')}</td>
                          <td style={styles.tdNum}>{util.optical_summary.max_rx_dbm?.toFixed(2) ?? '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: ONUs per Port */}
      {/* ================================================================ */}
      {tab === 'onus' && (
        <div>
          {!portIdNum && (
            <p style={styles.msg}>{t('ponPortManagement.onus.enterPortHint')}</p>
          )}
          {portIdNum > 0 && (
            <>
              <div style={styles.filterRow}>
                <span style={styles.filterLabel}>{t('ponPortManagement.onus.filterState')}:</span>
                <select
                  value={onuStateFilter}
                  onChange={e => setOnuStateFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="">{t('ponPortManagement.onus.allStates')}</option>
                  {ONU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {onusQ.isLoading && <p style={styles.msg}>{t('ponPortManagement.loading')}</p>}
              {onusQ.isError && <p style={styles.msgError}>{t('ponPortManagement.onus.loadError')}</p>}
              {onusQ.data && (
                <div style={styles.tableCard}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>{t('ponPortManagement.onus.name')}</th>
                        <th style={styles.th}>{t('ponPortManagement.onus.serialNumber')}</th>
                        <th style={styles.th}>{t('ponPortManagement.onus.state')}</th>
                        <th style={styles.thNum}>{t('ponPortManagement.onus.onuId')}</th>
                        <th style={styles.thNum}>{t('ponPortManagement.onus.distance')}</th>
                        <th style={styles.th}>{t('ponPortManagement.onus.wanMode')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onusQ.data.length === 0 && (
                        <tr>
                          <td colSpan={6} style={styles.msg}>{t('ponPortManagement.onus.noOnus')}</td>
                        </tr>
                      )}
                      {onusQ.data.map(onu => (
                        <tr key={onu.id} style={styles.tr}>
                          <td style={styles.td}>{onu.name}</td>
                          <td style={styles.tdMono}>{onu.serial_number ?? '—'}</td>
                          <td style={styles.td}>
                            <span style={{
                              color: onu.onu_state === 'online' ? '#059669'
                                : onu.onu_state === 'offline' ? '#6b7280'
                                  : '#d97706',
                              fontWeight: 600,
                              fontSize: '0.82rem',
                            }}>
                              {onu.onu_state}
                            </span>
                          </td>
                          <td style={styles.tdNum}>{onu.onu_id ?? '—'}</td>
                          <td style={styles.tdNum}>{onu.ranging_distance_m !== null ? `${onu.ranging_distance_m} m` : '—'}</td>
                          <td style={styles.td}>{onu.wan_mode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Power Budget Calculator */}
      {/* ================================================================ */}
      {tab === 'powerBudget' && (
        <div style={{ maxWidth: 640 }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 0 }}>
            {t('ponPortManagement.powerBudget.description')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <label style={modalStyles.label}>
              {t('ponPortManagement.powerBudget.oltTxPower')} <RequiredMark />
              <input
                style={modalStyles.input}
                type="number"
                step="0.1"
                value={pbForm.olt_tx_power_dbm}
                onChange={e => setPbForm(f => ({ ...f, olt_tx_power_dbm: e.target.value }))}
              />
            </label>
            <label style={modalStyles.label}>
              {t('ponPortManagement.powerBudget.splitterRatio')} <RequiredMark />
              <select
                style={modalStyles.select}
                value={pbForm.splitter_ratio}
                onChange={e => setPbForm(f => ({ ...f, splitter_ratio: e.target.value }))}
              >
                {SPLITTER_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={modalStyles.label}>
              {t('ponPortManagement.powerBudget.fiberLength')} <RequiredMark />
              <input
                style={modalStyles.input}
                type="number"
                min={0}
                value={pbForm.fiber_length_m}
                onChange={e => setPbForm(f => ({ ...f, fiber_length_m: e.target.value }))}
              />
            </label>
            <label style={modalStyles.label}>
              {t('ponPortManagement.powerBudget.attenuationPerKm')}
              <input
                style={modalStyles.input}
                type="number"
                step="0.01"
                value={pbForm.attenuation_per_km_db}
                onChange={e => setPbForm(f => ({ ...f, attenuation_per_km_db: e.target.value }))}
              />
            </label>
            <label style={modalStyles.label}>
              {t('ponPortManagement.powerBudget.connectorMargin')}
              <input
                style={modalStyles.input}
                type="number"
                step="0.1"
                value={pbForm.connector_margin_db}
                onChange={e => setPbForm(f => ({ ...f, connector_margin_db: e.target.value }))}
              />
            </label>
          </div>
          <button
            style={styles.btnPrimary}
            disabled={calcMut.isPending}
            onClick={() => calcMut.mutate({
              olt_tx_power_dbm: parseFloat(pbForm.olt_tx_power_dbm),
              splitter_ratio: pbForm.splitter_ratio,
              fiber_length_m: parseFloat(pbForm.fiber_length_m),
              attenuation_per_km_db: parseFloat(pbForm.attenuation_per_km_db),
              connector_margin_db: parseFloat(pbForm.connector_margin_db),
            })}
          >
            {t('ponPortManagement.powerBudget.calculate')}
          </button>
          {pbErr && <p style={modalStyles.error}>{pbErr}</p>}
          {pbResult && (
            <div style={{ ...card, marginTop: '1.5rem', borderLeft: `4px solid ${pbResult.result === 'ok' ? '#059669' : '#dc2626'}` }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {t('ponPortManagement.powerBudget.results')}
                <span style={{
                  color: pbResult.result === 'ok' ? '#059669' : '#dc2626',
                  fontSize: '0.82rem',
                  background: pbResult.result === 'ok' ? '#d1fae5' : '#fee2e2',
                  padding: '2px 10px',
                  borderRadius: 12,
                  fontWeight: 600,
                }}>
                  {pbResult.result === 'ok'
                    ? t('ponPortManagement.powerBudget.ok')
                    : t('ponPortManagement.powerBudget.exceeded')}
                </span>
              </h3>
              <table style={styles.table}>
                <tbody>
                  <tr style={styles.tr}>
                    <td style={styles.td}>{t('ponPortManagement.powerBudget.splitterLoss')}</td>
                    <td style={styles.tdNum}>{pbResult.splitter_loss_db} dB</td>
                  </tr>
                  <tr style={styles.tr}>
                    <td style={styles.td}>{t('ponPortManagement.powerBudget.fiberLoss')}</td>
                    <td style={styles.tdNum}>{pbResult.fiber_loss_db} dB</td>
                  </tr>
                  <tr style={styles.tr}>
                    <td style={styles.td}><strong>{t('ponPortManagement.powerBudget.totalLoss')}</strong></td>
                    <td style={styles.tdNum}><strong>{pbResult.total_loss_db} dB</strong></td>
                  </tr>
                  <tr style={styles.tr}>
                    <td style={styles.td}>{t('ponPortManagement.powerBudget.maxPathLoss')}</td>
                    <td style={styles.tdNum}>{pbResult.max_path_loss_db} dB</td>
                  </tr>
                  <tr style={styles.tr}>
                    <td style={styles.td}><strong>{t('ponPortManagement.powerBudget.margin')}</strong></td>
                    <td style={{ ...styles.tdNum, color: pbResult.margin_db >= 0 ? '#059669' : '#dc2626', fontWeight: 700 }}>
                      {pbResult.margin_db} dB
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: ONU Migrations */}
      {/* ================================================================ */}
      {tab === 'migrations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => { setShowMigModal(true); setMigErr(''); }}>
              + {t('ponPortManagement.migrations.newMigration')}
            </button>
          </div>
          {migrationsQ.isLoading && <p style={styles.msg}>{t('ponPortManagement.loading')}</p>}
          {migrationsQ.isError && <p style={styles.msgError}>{t('ponPortManagement.migrations.loadError')}</p>}
          {migrationsQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('ponPortManagement.migrations.status')}</th>
                      <th style={styles.th}>{t('ponPortManagement.migrations.onuDevice')}</th>
                      <th style={styles.th}>{t('ponPortManagement.migrations.sourcePort')}</th>
                      <th style={styles.th}>{t('ponPortManagement.migrations.targetPort')}</th>
                      <th style={styles.th}>{t('ponPortManagement.migrations.scheduledAt')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrationsQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('ponPortManagement.migrations.noJobs')}</td></tr>
                    )}
                    {migrationsQ.data.data.map(job => (
                      <tr key={job.id} style={styles.tr}>
                        <td style={styles.tdNum}>{job.id}</td>
                        <td style={styles.td}>
                          <span style={{
                            color: job.status === 'completed' ? '#059669'
                              : job.status === 'failed' ? '#dc2626'
                                : job.status === 'cancelled' ? '#6b7280'
                                  : '#d97706',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                          }}>
                            {job.status}
                          </span>
                        </td>
                        <td style={styles.td}>{job.onu_name ?? `#${job.onu_device_id}`}</td>
                        <td style={styles.tdMono}>{job.source_port_name ?? String(job.source_olt_port_id)}</td>
                        <td style={styles.tdMono}>{job.target_port_name ?? String(job.target_olt_port_id)}</td>
                        <td style={styles.td}>
                          {job.scheduled_at
                            ? new Date(job.scheduled_at).toLocaleString()
                            : t('ponPortManagement.migrations.immediate')}
                        </td>
                        <td style={styles.td}>
                          {['pending', 'queued'].includes(job.status) && (
                            <button
                              style={styles.actionBtn}
                              onClick={() => {
                                if (window.confirm(t('ponPortManagement.migrations.confirmCancel'))) {
                                  cancelMigMut.mutate(job.id);
                                }
                              }}
                            >
                              {t('ponPortManagement.migrations.cancelJob')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button
                  style={styles.pageBtn}
                  onClick={() => setMigPage(p => Math.max(1, p - 1))}
                  disabled={migPage <= 1}
                >
                  &laquo; {t('ponPortManagement.prev')}
                </button>
                <span style={styles.pageInfo}>
                  {migPage} / {migTotalPages}
                </span>
                <button
                  style={styles.pageBtn}
                  onClick={() => setMigPage(p => p + 1)}
                  disabled={migPage >= migTotalPages}
                >
                  {t('ponPortManagement.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Maintenance Mode Modal */}
      {showMaintModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>
                {maintEnable
                  ? t('ponPortManagement.utilization.enableMaintenance')
                  : t('ponPortManagement.utilization.clearMaintenance')}
              </h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowMaintModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {maintEnable && (
                <label style={modalStyles.label}>
                  {t('ponPortManagement.utilization.maintenanceNote')}
                  <input
                    style={modalStyles.input}
                    value={maintNote}
                    onChange={e => setMaintNote(e.target.value)}
                    placeholder={t('ponPortManagement.utilization.maintenanceNoteHint')}
                  />
                </label>
              )}
            </div>
            {maintMut.isError && (
              <p style={modalStyles.error}>
                {(maintMut.error as { message?: string })?.message ?? 'Failed'}
              </p>
            )}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowMaintModal(false)}>
                {t('ponPortManagement.cancel')}
              </button>
              <button
                style={maintEnable ? styles.btnDanger : styles.btnPrimary}
                disabled={maintMut.isPending}
                onClick={() => maintMut.mutate({ enable: maintEnable, note: maintNote })}
              >
                {t('ponPortManagement.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* XGS-PON Mode Modal */}
      {showModeModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('ponPortManagement.utilization.configureMode')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowModeModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('ponPortManagement.utilization.xgsPonMode')}
                <select
                  style={modalStyles.select}
                  value={selectedMode}
                  onChange={e => setSelectedMode(e.target.value)}
                >
                  {XGS_PON_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            {modeMut.isError && (
              <p style={modalStyles.error}>
                {(modeMut.error as { message?: string })?.message ?? 'Failed'}
              </p>
            )}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowModeModal(false)}>
                {t('ponPortManagement.cancel')}
              </button>
              <button
                style={styles.btnPrimary}
                disabled={modeMut.isPending}
                onClick={() => modeMut.mutate(selectedMode)}
              >
                {t('ponPortManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Migration Modal */}
      {showMigModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('ponPortManagement.migrations.createTitle')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowMigModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('ponPortManagement.migrations.onuDevice')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={migForm.onu_device_id}
                  onChange={e => setMigForm(f => ({ ...f, onu_device_id: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('ponPortManagement.migrations.sourcePort')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={migForm.source_olt_port_id}
                  onChange={e => setMigForm(f => ({ ...f, source_olt_port_id: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('ponPortManagement.migrations.targetPort')} <RequiredMark />
                <input
                  style={modalStyles.input}
                  type="number"
                  min={1}
                  value={migForm.target_olt_port_id}
                  onChange={e => setMigForm(f => ({ ...f, target_olt_port_id: e.target.value }))}
                />
              </label>
            </div>
            {migErr && <p style={modalStyles.error}>{migErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowMigModal(false)}>
                {t('ponPortManagement.cancel')}
              </button>
              <button
                style={styles.btnPrimary}
                disabled={createMigMut.isPending}
                onClick={() => createMigMut.mutate({
                  onu_device_id: Number(migForm.onu_device_id),
                  source_olt_port_id: Number(migForm.source_olt_port_id),
                  target_olt_port_id: Number(migForm.target_olt_port_id),
                })}
              >
                {t('ponPortManagement.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
