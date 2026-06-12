// =============================================================================
// FireISP 5.0 — Wireless Metrics (§9)
// =============================================================================
// Tabbed page covering:
//   1. Signal Distribution — SVG bar chart of signal strength histogram per AP
//   2. Link Planning       — haversine/FSPL/Fresnel calculator + saved calcs CRUD
//   3. Spectrum Scans      — scan job log with modal to create new scan requests
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, fmtDate } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Device {
  id: number;
  name: string;
  device_type: string;
}

interface DevicesResponse {
  data: Device[];
  meta: { total: number; page: number; limit: number };
}

interface Site {
  id: number;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface SitesResponse {
  data: Site[];
  meta: { total: number; page: number; limit: number };
}

interface SignalBucket {
  range: string;
  min_dbm: number;
  max_dbm: number;
  count: number;
}

interface SignalDistributionResponse {
  device_id: number;
  hours: number;
  total_clients: number;
  avg_signal_dbm: number | null;
  buckets: SignalBucket[];
}

interface LinkCalcInput {
  lat_a: number;
  lon_a: number;
  lat_b: number;
  lon_b: number;
  frequency_mhz: number;
  tx_power_dbm: number;
  antenna_gain_a_dbi: number;
  antenna_gain_b_dbi: number;
  cable_loss_db: number;
}

interface LinkCalcResult {
  distance_km: number;
  fspl_db: number;
  fresnel_radius_m: number;
  fresnel_clearance_m: number;
  link_budget_db: number;
}

interface SavedLinkCalc {
  id: number;
  name: string;
  frequency_mhz: number | null;
  distance_km: number | null;
  link_budget_db: number | null;
  created_at: string;
}

interface SavedLinkCalcsResponse {
  data: SavedLinkCalc[];
  meta: { total: number; page: number; limit: number };
}

interface SpectrumScan {
  id: number;
  device_id: number | null;
  device_name?: string;
  scan_type: string;
  frequency_start_mhz: number | null;
  frequency_end_mhz: number | null;
  channel_width_mhz: number | null;
  peak_interference_dbm: number | null;
  recommended_channel: number | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface SpectrumScansResponse {
  data: SpectrumScan[];
  meta: { total: number; page: number; limit: number };
}

interface SpectrumScanBody {
  device_id?: number;
  scan_type?: string;
  frequency_start_mhz?: number;
  frequency_end_mhz?: number;
  channel_width_mhz?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const SCAN_TYPES = ['scheduled', 'manual'];
const SIGNAL_BUCKETS = [
  { label: '[-100,−90)', min: -100, max: -90 },
  { label: '[−90,−80)', min: -90, max: -80 },
  { label: '[−80,−70)', min: -80, max: -70 },
  { label: '[−70,−60)', min: -70, max: -60 },
  { label: '[−60,−50)', min: -60, max: -50 },
  { label: '[−50,0)', min: -50, max: 0 },
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchDevices(): Promise<DevicesResponse> {
  const res = await api.GET('/devices' as never, {
    params: { query: { limit: 200 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
  return (res as { data: unknown }).data as unknown as DevicesResponse;
}

async function fetchSites(): Promise<SitesResponse> {
  const res = await api.GET('/sites' as never, {
    params: { query: { limit: 200 } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load sites');
  return (res as { data: unknown }).data as unknown as SitesResponse;
}

async function fetchSignalDistribution(deviceId: number, hours: number): Promise<SignalDistributionResponse> {
  const res = await api.GET('/wireless/clients/signal-distribution' as never, {
    params: { query: { device_id: deviceId, hours } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load signal distribution');
  return (res as { data: unknown }).data as unknown as SignalDistributionResponse;
}

async function calculateLinkBudget(input: LinkCalcInput): Promise<LinkCalcResult> {
  const res = await api.POST('/wireless/link-planning/calculate' as never, { body: input as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to calculate link budget');
  return (res as { data: unknown }).data as unknown as LinkCalcResult;
}

async function fetchSavedCalcs(page: number): Promise<SavedLinkCalcsResponse> {
  const res = await api.GET('/wireless/link-planning' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load saved calculations');
  return (res as { data: unknown }).data as unknown as SavedLinkCalcsResponse;
}

async function saveCalc(body: LinkCalcInput & { name: string }): Promise<void> {
  const res = await api.POST('/wireless/link-planning' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to save calculation');
}

async function deleteSavedCalc(id: number): Promise<void> {
  const res = await api.DELETE('/wireless/link-planning/{id}' as never, {
    params: { path: { id } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete calculation');
}

async function fetchSpectrumScans(page: number): Promise<SpectrumScansResponse> {
  const res = await api.GET('/wireless/spectrum-scans' as never, {
    params: { query: { page, limit: PAGE_SIZE } as never },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load spectrum scans');
  return (res as { data: unknown }).data as unknown as SpectrumScansResponse;
}

async function createSpectrumScan(body: SpectrumScanBody): Promise<void> {
  const res = await api.POST('/wireless/spectrum-scans' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create spectrum scan');
}

// ---------------------------------------------------------------------------
// Helpers
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

function scanStatusColor(status: string): string {
  switch (status) {
    case 'pending': return '#6b7280';
    case 'queued': return '#2563eb';
    case 'in_progress': return '#d97706';
    case 'completed': return '#059669';
    case 'failed': return '#dc2626';
    case 'cancelled': return '#6b7280';
    default: return '#6b7280';
  }
}

// ---------------------------------------------------------------------------
// SVG Bar Chart Component
// ---------------------------------------------------------------------------

interface BarChartProps {
  buckets: SignalBucket[];
  width?: number;
  height?: number;
}

function SignalBarChart({ buckets, width = 560, height = 220 }: BarChartProps) {
  const { t } = useTranslation();
  const padLeft = 48;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 48;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const barCount = SIGNAL_BUCKETS.length;
  const barGap = 6;
  const barW = (chartW - barGap * (barCount - 1)) / barCount;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  const bucketMap = new Map<string, number>(buckets.map(b => [b.range, b.count]));
  const yTicks = [0, Math.round(maxCount * 0.25), Math.round(maxCount * 0.5), Math.round(maxCount * 0.75), maxCount];

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={t('wirelessMetrics.signalDistribution.chartTitle')}
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {/* Y gridlines and labels */}
      {yTicks.map((tick, i) => {
        const y = padTop + chartH - (tick / maxCount) * chartH;
        return (
          <g key={i}>
            <line
              x1={padLeft}
              x2={padLeft + chartW}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3,3"
              strokeWidth={1}
            />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {tick}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {SIGNAL_BUCKETS.map((bucket, i) => {
        const count = bucketMap.get(bucket.label) ?? 0;
        const barH = maxCount > 0 ? (count / maxCount) * chartH : 0;
        const x = padLeft + i * (barW + barGap);
        const y = padTop + chartH - barH;
        return (
          <g key={bucket.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="#2563eb"
              opacity={0.82}
              rx={2}
            />
            {count > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-secondary)"
              >
                {count}
              </text>
            )}
            {/* X label */}
            <text
              x={x + barW / 2}
              y={padTop + chartH + 16}
              textAnchor="middle"
              fontSize={9}
              fill="var(--text-muted)"
            >
              {bucket.label}
            </text>
          </g>
        );
      })}

      {/* Axes */}
      <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + chartH} stroke="var(--border)" strokeWidth={1} />
      <line x1={padLeft} y1={padTop + chartH} x2={padLeft + chartW} y2={padTop + chartH} stroke="var(--border)" strokeWidth={1} />

      {/* Y axis title */}
      <text
        x={10}
        y={padTop + chartH / 2}
        textAnchor="middle"
        fontSize={9}
        fill="var(--text-muted)"
        transform={`rotate(-90, 10, ${padTop + chartH / 2})`}
      >
        {t('wirelessMetrics.signalDistribution.clientCount')}
      </text>

      {/* X axis title */}
      <text
        x={padLeft + chartW / 2}
        y={height - 2}
        textAnchor="middle"
        fontSize={9}
        fill="var(--text-muted)"
      >
        {t('wirelessMetrics.signalDistribution.signalStrength')}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WirelessMetricsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<'signalDistribution' | 'linkPlanning' | 'spectrumScans'>('signalDistribution');

  // Shared lookups
  const devicesQ = useQuery({ queryKey: ['devices', 'all'], queryFn: fetchDevices, staleTime: 120_000 });
  const sitesQ = useQuery({ queryKey: ['sites', 'all'], queryFn: fetchSites, staleTime: 120_000 });
  const deviceOptions = devicesQ.data?.data ?? [];
  const siteOptions = sitesQ.data?.data ?? [];

  // ============================== SIGNAL DISTRIBUTION ==============================

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('');
  const [hours, setHours] = useState(24);

  const signalQ = useQuery({
    queryKey: ['wireless', 'signalDist', selectedDeviceId, hours],
    queryFn: () => fetchSignalDistribution(selectedDeviceId as number, hours),
    enabled: tab === 'signalDistribution' && selectedDeviceId !== '',
  });

  // ============================== LINK PLANNING ==============================

  const [latA, setLatA] = useState('');
  const [lonA, setLonA] = useState('');
  const [latB, setLatB] = useState('');
  const [lonB, setLonB] = useState('');
  const [siteAId, setSiteAId] = useState<number | ''>('');
  const [siteBId, setSiteBId] = useState<number | ''>('');
  const [lpFreq, setLpFreq] = useState('');
  const [lpTxPower, setLpTxPower] = useState('');
  const [lpGainA, setLpGainA] = useState('');
  const [lpGainB, setLpGainB] = useState('');
  const [lpCableLoss, setLpCableLoss] = useState('');
  const [calcResult, setCalcResult] = useState<LinkCalcResult | null>(null);
  const [calcErr, setCalcErr] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveErr, setSaveErr] = useState('');

  const [savedPage, setSavedPage] = useState(1);
  const savedQ = useQuery({
    queryKey: ['wireless', 'linkCalcs', savedPage],
    queryFn: () => fetchSavedCalcs(savedPage),
    enabled: tab === 'linkPlanning',
  });
  const savedTotalPages = Math.ceil((savedQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  function applySelectedSite(which: 'A' | 'B', siteId: number | '') {
    if (siteId === '') return;
    const site = siteOptions.find(s => s.id === siteId);
    if (!site) return;
    if (which === 'A') {
      setSiteAId(siteId);
      if (site.latitude != null) setLatA(String(site.latitude));
      if (site.longitude != null) setLonA(String(site.longitude));
    } else {
      setSiteBId(siteId);
      if (site.latitude != null) setLatB(String(site.latitude));
      if (site.longitude != null) setLonB(String(site.longitude));
    }
  }

  const calcMut = useMutation({
    mutationFn: () => calculateLinkBudget({
      lat_a: Number(latA),
      lon_a: Number(lonA),
      lat_b: Number(latB),
      lon_b: Number(lonB),
      frequency_mhz: Number(lpFreq),
      tx_power_dbm: Number(lpTxPower),
      antenna_gain_a_dbi: Number(lpGainA),
      antenna_gain_b_dbi: Number(lpGainB),
      cable_loss_db: Number(lpCableLoss),
    }),
    onSuccess: (result) => {
      setCalcResult(result);
      setCalcErr('');
    },
    onError: (e: unknown) => setCalcErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const saveMut = useMutation({
    mutationFn: () => saveCalc({
      name: saveName,
      lat_a: Number(latA),
      lon_a: Number(lonA),
      lat_b: Number(latB),
      lon_b: Number(lonB),
      frequency_mhz: Number(lpFreq),
      tx_power_dbm: Number(lpTxPower),
      antenna_gain_a_dbi: Number(lpGainA),
      antenna_gain_b_dbi: Number(lpGainB),
      cable_loss_db: Number(lpCableLoss),
    }),
    onSuccess: () => {
      setSaveErr('');
      setSaveName('');
      qc.invalidateQueries({ queryKey: ['wireless', 'linkCalcs'] });
    },
    onError: (e: unknown) => setSaveErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const deleteSavedMut = useMutation({
    mutationFn: deleteSavedCalc,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wireless', 'linkCalcs'] }),
  });

  // ============================== SPECTRUM SCANS ==============================

  const [scanPage, setScanPage] = useState(1);
  const scanQ = useQuery({
    queryKey: ['wireless', 'spectrumScans', scanPage],
    queryFn: () => fetchSpectrumScans(scanPage),
    enabled: tab === 'spectrumScans',
  });
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanForm, setScanForm] = useState<Partial<SpectrumScanBody>>({ scan_type: 'manual' });
  const [scanErr, setScanErr] = useState('');

  const createScanMut = useMutation({
    mutationFn: () => createSpectrumScan(scanForm as SpectrumScanBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wireless', 'spectrumScans'] });
      setShowScanModal(false);
    },
    onError: (e: unknown) => setScanErr((e as { message?: string })?.message ?? 'Failed'),
  });

  const scanTotalPages = Math.ceil((scanQ.data?.meta.total ?? 0) / PAGE_SIZE) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      {/* Page header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('wirelessMetrics.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            {t('wirelessMetrics.subtitle')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', display: 'flex', gap: '0.25rem' }}>
        {(['signalDistribution', 'linkPlanning', 'spectrumScans'] as const).map(t2 => (
          <button key={t2} style={tabBtn(tab === t2)} onClick={() => setTab(t2)}>
            {t(`wirelessMetrics.tabs.${t2}`)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB: Signal Distribution */}
      {/* ================================================================ */}
      {tab === 'signalDistribution' && (
        <div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div>
              <label style={{ ...styles.filterLabel, marginRight: 6 }}>
                {t('wirelessMetrics.signalDistribution.device')}
              </label>
              <select
                style={styles.filterSelect}
                value={selectedDeviceId}
                onChange={e => setSelectedDeviceId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">{t('wirelessMetrics.signalDistribution.selectDevice')}</option>
                {deviceOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ ...styles.filterLabel, marginRight: 6 }}>
                {t('wirelessMetrics.signalDistribution.timeRange')}
              </label>
              <select
                style={styles.filterSelect}
                value={hours}
                onChange={e => setHours(Number(e.target.value))}
              >
                <option value={24}>{t('wirelessMetrics.signalDistribution.hours24')}</option>
                <option value={168}>{t('wirelessMetrics.signalDistribution.days7')}</option>
                <option value={720}>{t('wirelessMetrics.signalDistribution.days30')}</option>
              </select>
            </div>
          </div>

          {signalQ.isLoading && <p style={styles.msg}>{t('wirelessMetrics.loading')}</p>}
          {signalQ.isError && <p style={styles.msgError}>{t('wirelessMetrics.signalDistribution.loadError')}</p>}

          {selectedDeviceId === '' && !signalQ.data && (
            <p style={styles.msg}>{t('wirelessMetrics.signalDistribution.selectDevice')}</p>
          )}

          {signalQ.data && signalQ.data.buckets.length === 0 && (
            <p style={styles.msg}>{t('wirelessMetrics.signalDistribution.noData')}</p>
          )}

          {signalQ.data && signalQ.data.buckets.length > 0 && (
            <div>
              {/* Summary stats */}
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {[
                  { label: t('wirelessMetrics.signalDistribution.totalClients'), value: String(signalQ.data.total_clients) },
                  { label: t('wirelessMetrics.signalDistribution.avgSignal'), value: signalQ.data.avg_signal_dbm !== null ? `${signalQ.data.avg_signal_dbm.toFixed(1)} dBm` : '—' },
                ].map(stat => (
                  <div
                    key={stat.label}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1.25rem', minWidth: 140 }}
                  >
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                  {t('wirelessMetrics.signalDistribution.chartTitle')}
                </div>
                <SignalBarChart buckets={signalQ.data.buckets} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Link Planning */}
      {/* ================================================================ */}
      {tab === 'linkPlanning' && (
        <div>
          {/* Calculator form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            {/* Site A */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>{t('wirelessMetrics.linkPlanning.siteA')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.selectSite')}
                  <select
                    style={modalStyles.select}
                    value={siteAId}
                    onChange={e => applySelectedSite('A', e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">—</option>
                    {siteOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.lat')} <RequiredMark />
                  <input
                    style={modalStyles.input}
                    type="number"
                    step="any"
                    placeholder="19.4326"
                    value={latA}
                    onChange={e => setLatA(e.target.value)}
                  />
                </label>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.lon')} <RequiredMark />
                  <input
                    style={modalStyles.input}
                    type="number"
                    step="any"
                    placeholder="-99.1332"
                    value={lonA}
                    onChange={e => setLonA(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* Site B */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>{t('wirelessMetrics.linkPlanning.siteB')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.selectSite')}
                  <select
                    style={modalStyles.select}
                    value={siteBId}
                    onChange={e => applySelectedSite('B', e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">—</option>
                    {siteOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.lat')} <RequiredMark />
                  <input
                    style={modalStyles.input}
                    type="number"
                    step="any"
                    placeholder="19.5000"
                    value={latB}
                    onChange={e => setLatB(e.target.value)}
                  />
                </label>
                <label style={modalStyles.label}>
                  {t('wirelessMetrics.linkPlanning.lon')} <RequiredMark />
                  <input
                    style={modalStyles.input}
                    type="number"
                    step="any"
                    placeholder="-99.2000"
                    value={lonB}
                    onChange={e => setLonB(e.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* RF parameters */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.linkPlanning.frequency')} <RequiredMark />
                <input style={modalStyles.input} type="number" placeholder="5800" value={lpFreq} onChange={e => setLpFreq(e.target.value)} />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.linkPlanning.txPower')}
                <input style={modalStyles.input} type="number" placeholder="23" value={lpTxPower} onChange={e => setLpTxPower(e.target.value)} />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.linkPlanning.antennaGainA')}
                <input style={modalStyles.input} type="number" placeholder="24" value={lpGainA} onChange={e => setLpGainA(e.target.value)} />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.linkPlanning.antennaGainB')}
                <input style={modalStyles.input} type="number" placeholder="24" value={lpGainB} onChange={e => setLpGainB(e.target.value)} />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.linkPlanning.cableLoss')}
                <input style={modalStyles.input} type="number" placeholder="1" value={lpCableLoss} onChange={e => setLpCableLoss(e.target.value)} />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <button
              style={styles.btnPrimary}
              disabled={calcMut.isPending || !latA || !lonA || !latB || !lonB || !lpFreq}
              onClick={() => calcMut.mutate()}
            >
              {calcMut.isPending ? t('wirelessMetrics.linkPlanning.calculating') : t('wirelessMetrics.linkPlanning.calculate')}
            </button>
          </div>

          {calcErr && <p style={modalStyles.error}>{calcErr}</p>}

          {/* Results card */}
          {calcResult && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>{t('wirelessMetrics.linkPlanning.results')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {[
                  { label: t('wirelessMetrics.linkPlanning.distance'), value: `${calcResult.distance_km.toFixed(3)} km` },
                  { label: t('wirelessMetrics.linkPlanning.fspl'), value: `${calcResult.fspl_db.toFixed(1)} dB` },
                  { label: t('wirelessMetrics.linkPlanning.fresnelRadius'), value: `${calcResult.fresnel_radius_m.toFixed(1)} m` },
                  { label: t('wirelessMetrics.linkPlanning.fresnelClearance'), value: `${calcResult.fresnel_clearance_m.toFixed(1)} m` },
                  { label: t('wirelessMetrics.linkPlanning.linkBudget'), value: `${calcResult.link_budget_db.toFixed(1)} dB` },
                ].map(item => (
                  <div key={item.label} style={{ borderLeft: '3px solid var(--accent, #2563eb)', paddingLeft: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Save */}
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  {t('wirelessMetrics.linkPlanning.saveName')}
                  <input
                    style={modalStyles.input}
                    value={saveName}
                    placeholder={t('wirelessMetrics.linkPlanning.saveName')}
                    onChange={e => setSaveName(e.target.value)}
                  />
                </label>
                <button
                  style={styles.btnSecondary}
                  disabled={saveMut.isPending || !saveName}
                  onClick={() => saveMut.mutate()}
                >
                  {saveMut.isPending ? t('wirelessMetrics.linkPlanning.saving') : t('wirelessMetrics.linkPlanning.saveCalc')}
                </button>
              </div>
              {saveErr && <p style={modalStyles.error}>{saveErr}</p>}
            </div>
          )}

          {/* Saved calculations table */}
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.75rem' }}>{t('wirelessMetrics.linkPlanning.savedCalcs')}</h3>
          {savedQ.isLoading && <p style={styles.msg}>{t('wirelessMetrics.loading')}</p>}
          {savedQ.isError && <p style={styles.msgError}>{t('wirelessMetrics.linkPlanning.loadError')}</p>}
          {savedQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessMetrics.linkPlanning.calcName')}</th>
                      <th style={styles.thNum}>{t('wirelessMetrics.linkPlanning.calcFrequency')}</th>
                      <th style={styles.thNum}>{t('wirelessMetrics.linkPlanning.calcDistance')}</th>
                      <th style={styles.thNum}>{t('wirelessMetrics.linkPlanning.linkBudget')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.linkPlanning.calcCreated')}</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedQ.data.data.length === 0 && (
                      <tr><td colSpan={7} style={styles.msg}>{t('wirelessMetrics.linkPlanning.noSaved')}</td></tr>
                    )}
                    {savedQ.data.data.map(calc => (
                      <tr key={calc.id} style={styles.tr}>
                        <td style={styles.tdNum}>{calc.id}</td>
                        <td style={styles.td}><strong>{calc.name}</strong></td>
                        <td style={styles.tdNum}>{calc.frequency_mhz ?? '—'}</td>
                        <td style={styles.tdNum}>{calc.distance_km !== null ? `${calc.distance_km.toFixed(3)}` : '—'}</td>
                        <td style={styles.tdNum}>{calc.link_budget_db !== null ? `${calc.link_budget_db.toFixed(1)}` : '—'}</td>
                        <td style={styles.td}>{fmtDate(calc.created_at)}</td>
                        <td style={styles.td}>
                          <button
                            style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                            onClick={() => {
                              if (window.confirm(t('wirelessMetrics.confirmDelete'))) {
                                deleteSavedMut.mutate(calc.id);
                              }
                            }}
                          >
                            {t('wirelessMetrics.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setSavedPage(p => Math.max(1, p - 1))} disabled={savedPage <= 1}>
                  &laquo; {t('wirelessMetrics.prev')}
                </button>
                <span style={styles.pageInfo}>{savedPage} / {savedTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setSavedPage(p => p + 1)} disabled={savedPage >= savedTotalPages}>
                  {t('wirelessMetrics.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: Spectrum Scans */}
      {/* ================================================================ */}
      {tab === 'spectrumScans' && (
        <div>
          {/* Info banner */}
          <div style={{ background: 'var(--info-soft, #eff6ff)', border: '1px solid var(--info-border, #bfdbfe)', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--info-text, #1e40af)', fontSize: '0.85rem' }}>
            {t('wirelessMetrics.spectrumScans.infoBanner')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button style={styles.btnPrimary} onClick={() => { setScanErr(''); setScanForm({ scan_type: 'manual' }); setShowScanModal(true); }}>
              + {t('wirelessMetrics.spectrumScans.new')}
            </button>
          </div>
          {scanQ.isLoading && <p style={styles.msg}>{t('wirelessMetrics.loading')}</p>}
          {scanQ.isError && <p style={styles.msgError}>{t('wirelessMetrics.spectrumScans.loadError')}</p>}
          {scanQ.data && (
            <>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thNum}>ID</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.device')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.scanType')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.freqRange')}</th>
                      <th style={styles.thNum}>{t('wirelessMetrics.spectrumScans.peakInterference')}</th>
                      <th style={styles.thNum}>{t('wirelessMetrics.spectrumScans.recommendedChannel')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.status')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.started')}</th>
                      <th style={styles.th}>{t('wirelessMetrics.spectrumScans.completed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanQ.data.data.length === 0 && (
                      <tr><td colSpan={9} style={styles.msg}>{t('wirelessMetrics.spectrumScans.noItems')}</td></tr>
                    )}
                    {scanQ.data.data.map(scan => (
                      <tr key={scan.id} style={styles.tr}>
                        <td style={styles.tdNum}>{scan.id}</td>
                        <td style={styles.td}>{scan.device_name ?? (scan.device_id ? `#${scan.device_id}` : '—')}</td>
                        <td style={styles.tdMono}>{scan.scan_type}</td>
                        <td style={styles.tdMono}>
                          {scan.frequency_start_mhz !== null && scan.frequency_end_mhz !== null
                            ? `${scan.frequency_start_mhz}–${scan.frequency_end_mhz} MHz`
                            : '—'}
                        </td>
                        <td style={styles.tdNum}>{scan.peak_interference_dbm !== null ? `${scan.peak_interference_dbm}` : '—'}</td>
                        <td style={styles.tdNum}>{scan.recommended_channel ?? '—'}</td>
                        <td style={styles.td}>
                          <span style={{ color: scanStatusColor(scan.status), fontWeight: 600, fontSize: '0.82rem' }}>
                            {scan.status}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(scan.started_at)}</td>
                        <td style={styles.td}>{fmtDate(scan.completed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setScanPage(p => Math.max(1, p - 1))} disabled={scanPage <= 1}>
                  &laquo; {t('wirelessMetrics.prev')}
                </button>
                <span style={styles.pageInfo}>{scanPage} / {scanTotalPages}</span>
                <button style={styles.pageBtn} onClick={() => setScanPage(p => p + 1)} disabled={scanPage >= scanTotalPages}>
                  {t('wirelessMetrics.next')} &raquo;
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* MODALS */}
      {/* ================================================================ */}

      {/* New Spectrum Scan Modal */}
      {showScanModal && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h2 style={modalStyles.title}>{t('wirelessMetrics.spectrumScans.new')}</h2>
              <button style={modalStyles.closeBtn} onClick={() => setShowScanModal(false)}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.device')} <RequiredMark />
                <select
                  style={modalStyles.select}
                  value={scanForm.device_id ?? ''}
                  onChange={e => setScanForm(f => ({ ...f, device_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {deviceOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.scanType')}
                <select
                  style={modalStyles.select}
                  value={scanForm.scan_type ?? 'manual'}
                  onChange={e => setScanForm(f => ({ ...f, scan_type: e.target.value }))}
                >
                  {SCAN_TYPES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.freqStart')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="5170"
                  value={scanForm.frequency_start_mhz ?? ''}
                  onChange={e => setScanForm(f => ({ ...f, frequency_start_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.freqEnd')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="5875"
                  value={scanForm.frequency_end_mhz ?? ''}
                  onChange={e => setScanForm(f => ({ ...f, frequency_end_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.channelWidth')}
                <input
                  style={modalStyles.input}
                  type="number"
                  placeholder="20"
                  value={scanForm.channel_width_mhz ?? ''}
                  onChange={e => setScanForm(f => ({ ...f, channel_width_mhz: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('wirelessMetrics.spectrumScans.notes')}
                <input
                  style={modalStyles.input}
                  value={scanForm.notes ?? ''}
                  onChange={e => setScanForm(f => ({ ...f, notes: e.target.value || undefined }))}
                />
              </label>
            </div>
            {scanErr && <p style={modalStyles.error}>{scanErr}</p>}
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setShowScanModal(false)}>
                {t('wirelessMetrics.cancel')}
              </button>
              <button style={styles.btnPrimary} disabled={createScanMut.isPending} onClick={() => createScanMut.mutate()}>
                {t('wirelessMetrics.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
