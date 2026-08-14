// =============================================================================
// FireISP 5.0 — PPPoE Diagnostics
// =============================================================================
// Tabbed diagnostics page at /pppoe-diagnostics. Combines:
//   - Auth Failure Classification (from radpostauth)
//   - PPPoE Event Log (from pppoe_event_logs)
//   - MAC Move Events (reuses existing table)
//   - MTU Configuration Advisories
// =============================================================================

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { styles } from './crudStyles';
import { LoadingState } from '@/components/FetchStates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthFailure {
  username: string;
  authdate: string;
  nas_ip_address: string | null;
  calling_station_id: string | null;
  reason: string;
  reply: string;
}

interface AuthFailureCount {
  bad_password: number;
  unknown_user: number;
  session_limit: number;
  no_pool: number;
  other: number;
}

interface AuthFailuresResponse {
  failures: AuthFailure[];
  counts: AuthFailureCount;
  total: number;
}

interface PppoeEventLog {
  id: number;
  username: string | null;
  mac: string | null;
  stage: string;
  severity: string;
  message: string;
  reason_code: string | null;
  logged_at: string;
}

interface EventsResponse {
  data: PppoeEventLog[];
  meta: { total: number; page: number; limit: number };
}

interface MtuAdvisory {
  type: string;
  profile_id: number | null;
  profile_name: string | null;
  username?: string | null;
  mtu: number;
  description: string;
}

interface MtuIssuesResponse {
  advisories: MtuAdvisory[];
}

interface MacMoveEvent {
  id: number;
  username: string;
  old_mac: string | null;
  new_mac: string | null;
  old_nas_id: number | null;
  new_nas_id: number | null;
  detected_at: string;
}

interface MacMoveEventsResponse {
  data: MacMoveEvent[];
  meta: { total: number; page: number; limit: number };
}

type ReadinessStatus = 'ready' | 'waiting' | 'not_configured' | 'error';
type ReadinessOverall = 'ready' | 'partial' | 'not_configured';

interface ReadinessSource {
  status: ReadinessStatus;
  lastReceivedAt: string | null;
  events24h: number;
  detail: string;
}

interface RouterEventsReadinessSource extends ReadinessSource {
  coveredNas: number;
  totalNas: number;
}

interface ReadinessResponse {
  overall: ReadinessOverall;
  sources: {
    authentication: ReadinessSource;
    routerEvents: RouterEventsReadinessSource;
    accounting: ReadinessSource;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const TABS = ['auth_failures', 'event_log', 'mac_moves', 'mtu_issues'] as const;
type TabId = typeof TABS[number];

// ---------------------------------------------------------------------------
// Wire-shape validation
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return typeof value === 'number' || value === null;
}

function isAuthFailure(value: unknown): value is AuthFailure {
  return isRecord(value)
    && typeof value.username === 'string'
    && typeof value.authdate === 'string'
    && isStringOrNull(value.nas_ip_address)
    && isStringOrNull(value.calling_station_id)
    && typeof value.reason === 'string'
    && typeof value.reply === 'string';
}

function isAuthFailureCount(value: unknown): value is AuthFailureCount {
  return isRecord(value)
    && typeof value.bad_password === 'number'
    && typeof value.unknown_user === 'number'
    && typeof value.session_limit === 'number'
    && typeof value.no_pool === 'number'
    && typeof value.other === 'number';
}

function isAuthFailuresResponse(value: unknown): value is AuthFailuresResponse {
  return isRecord(value)
    && Array.isArray(value.failures)
    && value.failures.every(isAuthFailure)
    && isAuthFailureCount(value.counts)
    && typeof value.total === 'number';
}

function isPppoeEvent(value: unknown): value is PppoeEventLog {
  return isRecord(value)
    && typeof value.id === 'number'
    && isStringOrNull(value.username)
    && isStringOrNull(value.mac)
    && typeof value.stage === 'string'
    && typeof value.severity === 'string'
    && typeof value.message === 'string'
    && isStringOrNull(value.reason_code)
    && typeof value.logged_at === 'string';
}

function isPageMeta(value: unknown): value is EventsResponse['meta'] {
  return isRecord(value)
    && typeof value.total === 'number'
    && typeof value.page === 'number'
    && typeof value.limit === 'number';
}

function isEventsResponse(value: unknown): value is EventsResponse {
  return isRecord(value)
    && Array.isArray(value.data)
    && value.data.every(isPppoeEvent)
    && isPageMeta(value.meta);
}

function isMtuAdvisory(value: unknown): value is MtuAdvisory {
  return isRecord(value)
    && typeof value.type === 'string'
    && isNumberOrNull(value.profile_id)
    && isStringOrNull(value.profile_name)
    && (value.username === undefined || isStringOrNull(value.username))
    && typeof value.mtu === 'number'
    && typeof value.description === 'string';
}

function isMtuIssuesResponse(value: unknown): value is MtuIssuesResponse {
  return isRecord(value)
    && Array.isArray(value.advisories)
    && value.advisories.every(isMtuAdvisory);
}

function isMacMoveEvent(value: unknown): value is MacMoveEvent {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.username === 'string'
    && isStringOrNull(value.old_mac)
    && isStringOrNull(value.new_mac)
    && isNumberOrNull(value.old_nas_id)
    && isNumberOrNull(value.new_nas_id)
    && typeof value.detected_at === 'string';
}

function isMacMoveEventsResponse(value: unknown): value is MacMoveEventsResponse {
  return isRecord(value)
    && Array.isArray(value.data)
    && value.data.every(isMacMoveEvent)
    && isPageMeta(value.meta);
}

const READINESS_STATUSES = new Set<ReadinessStatus>(['ready', 'waiting', 'not_configured', 'error']);
const READINESS_OVERALLS = new Set<ReadinessOverall>(['ready', 'partial', 'not_configured']);

function isReadinessSource(value: unknown): value is ReadinessSource {
  return isRecord(value)
    && typeof value.status === 'string'
    && READINESS_STATUSES.has(value.status as ReadinessStatus)
    && isStringOrNull(value.lastReceivedAt)
    && typeof value.events24h === 'number'
    && typeof value.detail === 'string';
}

function isRouterEventsReadinessSource(value: unknown): value is RouterEventsReadinessSource {
  return isRecord(value)
    && isReadinessSource(value)
    && typeof value.coveredNas === 'number'
    && typeof value.totalNas === 'number';
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!isRecord(value) || typeof value.overall !== 'string'
    || !READINESS_OVERALLS.has(value.overall as ReadinessOverall)
    || !isRecord(value.sources)) return false;

  const { authentication, routerEvents, accounting } = value.sources;
  if (!isReadinessSource(authentication)
    || !isRouterEventsReadinessSource(routerEvents)
    || !isReadinessSource(accounting)) return false;

  const statuses = [authentication.status, routerEvents.status, accounting.status];
  const derivedOverall: ReadinessOverall = statuses.every(status => status === 'ready')
    ? 'ready'
    : statuses.every(status => status === 'not_configured')
      ? 'not_configured'
      : 'partial';

  return value.overall === derivedOverall;
}

function unwrapData<T>(body: unknown, validator: (value: unknown) => value is T, endpoint: string): T {
  if (!isRecord(body) || !validator(body.data)) {
    throw new Error(`Unexpected response from ${endpoint}`);
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAuthFailures(from: string, to: string, username: string): Promise<AuthFailuresResponse> {
  const query: NonNullable<operations['getPppoeAuthFailures']['parameters']['query']> = {};
  if (from) query.from = from;
  if (to) query.to = to;
  if (username) query.username = username;
  const res = await api.GET('/pppoe/diagnostics/auth-failures', { params: { query } });
  if (res.error) throw new Error('Failed to load auth failures');
  return unwrapData(res.data, isAuthFailuresResponse, 'PPPoE auth failures');
}

async function fetchPppoeEvents(page: number, username: string, stage: string, severity: string): Promise<EventsResponse> {
  const query: NonNullable<operations['listPppoeEvents']['parameters']['query']> = { page, limit: PAGE_SIZE };
  if (username) query.username = username;
  if (stage) query.stage = stage as NonNullable<typeof query.stage>;
  if (severity) query.severity = severity as NonNullable<typeof query.severity>;
  const res = await api.GET('/pppoe/events', { params: { query } });
  if (res.error) throw new Error('Failed to load events');
  if (!isEventsResponse(res.data)) throw new Error('Unexpected response from PPPoE events');
  return res.data;
}

async function fetchMtuIssues(): Promise<MtuIssuesResponse> {
  const res = await api.GET('/pppoe/diagnostics/mtu-issues');
  if (res.error) throw new Error('Failed to load MTU issues');
  return unwrapData(res.data, isMtuIssuesResponse, 'PPPoE MTU advisories');
}

async function fetchMacMoveEvents(page: number): Promise<MacMoveEventsResponse> {
  const res = await api.GET('/radius/mac-move-events', { params: { query: { page, limit: PAGE_SIZE } } });
  if (res.error) throw new Error('Failed to load MAC move events');
  if (!isMacMoveEventsResponse(res.data)) throw new Error('Unexpected response from MAC move events');
  return res.data;
}

async function fetchReadiness(): Promise<ReadinessResponse> {
  const res = await api.GET('/pppoe/diagnostics/readiness');
  if (res.error) throw new Error('Failed to load diagnostics readiness');
  return unwrapData(res.data, isReadinessResponse, 'PPPoE diagnostics readiness');
}

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const map: Record<string, { bg: string; color: string }> = {
    info: { bg: '#dbeafe', color: '#1d4ed8' },
    warning: { bg: '#fef3c7', color: '#92400e' },
    error: { bg: '#fee2e2', color: '#991b1b' },
  };
  const c = map[severity] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {t(`pppoe_diagnostics.severities.${severity}`, severity)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason badge
// ---------------------------------------------------------------------------

function ReasonBadge({ reason }: { reason: string }) {
  const { t } = useTranslation();
  const map: Record<string, { bg: string; color: string }> = {
    bad_password: { bg: '#fee2e2', color: '#991b1b' },
    unknown_user: { bg: '#fef3c7', color: '#92400e' },
    session_limit: { bg: '#ede9fe', color: '#6d28d9' },
    no_pool: { bg: '#ffedd5', color: '#9a3412' },
    other: { bg: '#f3f4f6', color: '#374151' },
  };
  const c = map[reason] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>
      {t(`pppoe_diagnostics.reasons.${reason}`, reason.replace(/_/g, ' '))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Readiness banner
// ---------------------------------------------------------------------------

const READINESS_STATUS_COLORS: Record<ReadinessStatus, { bg: string; color: string; border: string }> = {
  ready: { bg: '#ecfdf5', color: '#065f46', border: '#6ee7b7' },
  waiting: { bg: '#fffbeb', color: '#92400e', border: '#fcd34d' },
  not_configured: { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
  error: { bg: '#fef2f2', color: '#991b1b', border: '#fca5a5' },
};

function ReadinessStatusBadge({ status }: { status: ReadinessStatus }) {
  const { t } = useTranslation();
  const colors = READINESS_STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 7px',
      borderRadius: 999,
      border: `1px solid ${colors.border}`,
      background: colors.bg,
      color: colors.color,
      fontSize: '0.7rem',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {t(`pppoe_diagnostics.readiness.statuses.${status}`, status.replace(/_/g, ' '))}
    </span>
  );
}

function ReadinessBanner() {
  const { t } = useTranslation();
  const [showReadyDetails, setShowReadyDetails] = useState(false);
  const q = useQuery({
    queryKey: ['pppoe-diagnostics-readiness'],
    queryFn: fetchReadiness,
    refetchInterval: 60_000,
  });

  const formatLastReceived = (value: string | null) => {
    if (!value) return t('pppoe_diagnostics.readiness.never_received', 'Never');
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? t('pppoe_diagnostics.readiness.unknown_time', 'Unknown')
      : parsed.toLocaleString();
  };

  if (q.isPending) {
    return (
      <section
        aria-label={t('pppoe_diagnostics.readiness.label', 'Diagnostics readiness')}
        style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}
      >
        {t('pppoe_diagnostics.readiness.loading', 'Checking diagnostic data sources…')}
      </section>
    );
  }

  if (q.isError) {
    return (
      <section
        role="alert"
        aria-label={t('pppoe_diagnostics.readiness.label', 'Diagnostics readiness')}
        style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: '0.75rem 0.9rem', marginBottom: '1rem', color: '#78350f' }}
      >
        <strong style={{ display: 'block', fontSize: '0.86rem' }}>{t('pppoe_diagnostics.readiness.load_error_title', 'Readiness unavailable')}</strong>
        <span style={{ fontSize: '0.8rem' }}>{t('pppoe_diagnostics.readiness.load_error_summary', 'Data-source health could not be checked. Empty results may be incomplete.')}</span>
      </section>
    );
  }

  const readiness = q.data;
  const isReady = readiness.overall === 'ready';
  const showSourceCards = !isReady || showReadyDetails;
  const overallStyles = isReady
    ? { border: '#6ee7b7', bg: '#ecfdf5', color: '#065f46' }
    : readiness.overall === 'not_configured'
      ? { border: '#d1d5db', bg: '#f9fafb', color: '#374151' }
      : { border: '#fcd34d', bg: '#fffbeb', color: '#78350f' };
  const overallTitle = t(
    `pppoe_diagnostics.readiness.overall.${readiness.overall}_title`,
    readiness.overall === 'ready'
      ? 'Diagnostics ready'
      : readiness.overall === 'partial'
        ? 'Diagnostics partially ready'
        : 'Diagnostics not configured',
  );
  const overallSummary = t(
    `pppoe_diagnostics.readiness.overall.${readiness.overall}_summary`,
    readiness.overall === 'ready'
      ? 'All telemetry sources are reporting. Empty results mean no matching issues were observed.'
      : readiness.overall === 'partial'
        ? 'One or more telemetry feeds are missing, waiting, or failing. Empty results may be incomplete.'
        : 'Telemetry is not connected. Empty results do not mean the network is healthy.',
  );
  const sourceRows: Array<{
    key: 'authentication' | 'router_events' | 'accounting';
    source: ReadinessSource | RouterEventsReadinessSource;
  }> = [
    { key: 'authentication', source: readiness.sources.authentication },
    { key: 'router_events', source: readiness.sources.routerEvents },
    { key: 'accounting', source: readiness.sources.accounting },
  ];

  return (
    <section
      role="status"
      aria-label={t('pppoe_diagnostics.readiness.label', 'Diagnostics readiness')}
      style={{ border: `1px solid ${overallStyles.border}`, background: overallStyles.bg, borderRadius: 8, padding: isReady ? '0.55rem 0.75rem' : '0.8rem 0.9rem', marginBottom: '1rem', color: overallStyles.color }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.86rem', whiteSpace: 'nowrap' }}>{overallTitle}</strong>
        <span style={{ fontSize: '0.78rem', flex: '1 1 280px' }}>{overallSummary}</span>
        {isReady && (
          <button
            type="button"
            aria-expanded={showReadyDetails}
            onClick={() => setShowReadyDetails(value => !value)}
            style={{ border: '1px solid #6ee7b7', background: 'rgba(255,255,255,0.55)', color: '#065f46', borderRadius: 6, padding: '0.25rem 0.55rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}
          >
            {showReadyDetails
              ? t('pppoe_diagnostics.readiness.hide_details', 'Hide source details')
              : t('pppoe_diagnostics.readiness.show_details', 'Show source details')}
          </button>
        )}
      </div>

      {isReady && !showReadyDetails && (
        <div style={{ display: 'flex', gap: '0.35rem 0.9rem', flexWrap: 'wrap', marginTop: '0.35rem', fontSize: '0.72rem', color: '#047857' }}>
          {sourceRows.map(({ key, source }) => (
            <span key={key}>
              {t(`pppoe_diagnostics.readiness.sources.${key}`, key.replace(/_/g, ' '))}: {formatLastReceived(source.lastReceivedAt)}
            </span>
          ))}
          <span>
            {t('pppoe_diagnostics.readiness.coverage_value', '{{covered}} / {{total}} NAS configured for polling', {
              covered: readiness.sources.routerEvents.coveredNas,
              total: readiness.sources.routerEvents.totalNas,
            })}
          </span>
        </div>
      )}

      {showSourceCards && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '0.6rem', marginTop: '0.7rem' }}>
          {sourceRows.map(({ key, source }) => (
            <div key={key} style={{ border: '1px solid rgba(107,114,128,0.25)', background: 'rgba(255,255,255,0.58)', borderRadius: 7, padding: '0.6rem 0.7rem', color: '#374151' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.45rem' }}>
                <strong style={{ fontSize: '0.79rem' }}>{t(`pppoe_diagnostics.readiness.sources.${key}`, key.replace(/_/g, ' '))}</strong>
                <ReadinessStatusBadge status={source.status} />
              </div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.2rem 0.45rem', fontSize: '0.72rem' }}>
                <dt style={{ color: '#6b7280' }}>{t('pppoe_diagnostics.readiness.last_received', 'Last received')}</dt>
                <dd style={{ margin: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>{formatLastReceived(source.lastReceivedAt)}</dd>
                <dt style={{ color: '#6b7280' }}>{t('pppoe_diagnostics.readiness.events_24h', 'Events (24h)')}</dt>
                <dd style={{ margin: 0, textAlign: 'right' }}>{source.events24h}</dd>
                {key === 'router_events' && (
                  <>
                    <dt style={{ color: '#6b7280' }}>{t('pppoe_diagnostics.readiness.nas_coverage', 'NAS configured for polling')}</dt>
                    <dd style={{ margin: 0, textAlign: 'right' }}>
                      {t('pppoe_diagnostics.readiness.coverage_short', '{{covered}} / {{total}}', {
                        covered: (source as RouterEventsReadinessSource).coveredNas,
                        total: (source as RouterEventsReadinessSource).totalNas,
                      })}
                    </dd>
                  </>
                )}
              </dl>
              {source.detail && <p style={{ margin: '0.45rem 0 0', fontSize: '0.72rem', lineHeight: 1.35, color: '#4b5563' }}>{source.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Pagination({ page, totalPages, previous, next }: {
  page: number;
  totalPages: number;
  previous: () => void;
  next: () => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <div style={styles.pagination}>
      <button style={styles.pageBtn} disabled={page <= 1} onClick={previous}>
        &larr; {t('pppoe_diagnostics.previous', 'Previous')}
      </button>
      <span style={styles.pageInfo}>{t('pppoe_diagnostics.page_of', 'Page {{page}} of {{totalPages}}', { page, totalPages })}</span>
      <button style={styles.pageBtn} disabled={page >= totalPages} onClick={next}>
        {t('pppoe_diagnostics.next', 'Next')} &rarr;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Auth Failures
// ---------------------------------------------------------------------------

function AuthFailuresTab() {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [username, setUsername] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '', username: '' });

  const q = useQuery({
    queryKey: ['pppoe-auth-failures', applied],
    queryFn: () => fetchAuthFailures(applied.from, applied.to, applied.username),
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="pppoe-auth-from" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.from_label', 'From')}</label>
          <input id="pppoe-auth-from" type="datetime-local" style={styles.filterSelect} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pppoe-auth-to" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.to_label', 'To')}</label>
          <input id="pppoe-auth-to" type="datetime-local" style={styles.filterSelect} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pppoe-auth-username" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.username_label', 'Username')}</label>
          <input id="pppoe-auth-username" style={styles.filterSelect} value={username} onChange={e => setUsername(e.target.value)} placeholder={t('pppoe_diagnostics.username_placeholder', 'Filter by username...')} />
        </div>
        <button type="button" style={styles.btnPrimary} onClick={() => setApplied({ from, to, username })}>
          {t('pppoe_diagnostics.apply', 'Apply')}
        </button>
      </div>

      {q.isSuccess && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {Object.entries(q.data.counts).map(([reason, count]) => (
            <div key={reason} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 1rem', minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{count}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t(`pppoe_diagnostics.reasons.${reason}`, reason.replace(/_/g, ' '))}</div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.tableCard}>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.auth_failures_error', 'Failed to load auth failures.')}</p>
        ) : q.data.failures.length === 0 ? (
          <p style={styles.msg}>{t('pppoe_diagnostics.auth_failures_empty', 'No authentication failures found in the selected window.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('pppoe_diagnostics.username_column', 'Username')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.authdate_column', 'Auth Date')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.nas_ip_column', 'NAS IP')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.mac_column', 'MAC')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.reason_column', 'Reason')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.reply_column', 'Raw RADIUS reply')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.failures.map((f, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{f.username}</td>
                    <td style={styles.td}>{new Date(f.authdate).toLocaleString()}</td>
                    <td style={styles.tdMono}>{f.nas_ip_address ?? '—'}</td>
                    <td style={styles.tdMono}>{f.calling_station_id ?? '—'}</td>
                    <td style={styles.td}><ReasonBadge reason={f.reason} /></td>
                    <td style={{ ...styles.tdMono, minWidth: 190, maxWidth: 420, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f.reply}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Event Log
// ---------------------------------------------------------------------------

const PPPOE_STAGES = ['', 'PADI', 'PADO', 'PADR', 'PADS', 'PADT', 'LCP', 'IPCP', 'IPV6CP', 'AUTH', 'OTHER'];
const SEVERITIES = ['', 'info', 'warning', 'error'];

function EventLogTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [stage, setStage] = useState('');
  const [severity, setSeverity] = useState('');

  const q = useQuery({
    queryKey: ['pppoe-events', page, username, stage, severity],
    queryFn: () => fetchPppoeEvents(page, username, stage, severity),
  });

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="pppoe-events-username" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.username_label', 'Username')}</label>
          <input id="pppoe-events-username" style={styles.filterSelect} value={username} onChange={e => { setUsername(e.target.value); setPage(1); }} placeholder={t('pppoe_diagnostics.username_placeholder', 'Filter by username...')} />
        </div>
        <div>
          <label htmlFor="pppoe-events-stage" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.stage_column', 'Stage')}</label>
          <select id="pppoe-events-stage" style={styles.filterSelect} value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}>
            <option value="">{t('pppoe_diagnostics.all_stages', 'All stages')}</option>
            {PPPOE_STAGES.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pppoe-events-severity" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.severity_column', 'Severity')}</label>
          <select id="pppoe-events-severity" style={styles.filterSelect} value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }}>
            <option value="">{t('pppoe_diagnostics.all_severities', 'All severities')}</option>
            {SEVERITIES.filter(s => s).map(s => <option key={s} value={s}>{t(`pppoe_diagnostics.severities.${s}`, s)}</option>)}
          </select>
        </div>
        {q.isSuccess && (
          <span style={{ ...styles.countBadge, marginLeft: 'auto' }}>
            {t('pppoe_diagnostics.total_count', '{{count}} total', { count: q.data.meta.total })}
          </span>
        )}
      </div>

      <div style={styles.tableCard}>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.event_log_error', 'Failed to load events.')}</p>
        ) : q.data.data.length === 0 ? (
          <p style={styles.msg}>{t('pppoe_diagnostics.event_log_empty', 'No events found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('pppoe_diagnostics.logged_at_column', 'Logged At')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.stage_column', 'Stage')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.severity_column', 'Severity')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.username_column', 'Username')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.mac_column', 'MAC')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.reason_code_column', 'Reason Code')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.message_column', 'Message')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map(ev => (
                  <tr key={ev.id} style={styles.tr}>
                    <td style={styles.td}>{new Date(ev.logged_at).toLocaleString()}</td>
                    <td style={styles.tdMono}>{ev.stage}</td>
                    <td style={styles.td}><SeverityBadge severity={ev.severity} /></td>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{ev.username ?? '—'}</td>
                    <td style={styles.tdMono}>{ev.mac ?? '—'}</td>
                    <td style={styles.tdMono}>{ev.reason_code ?? '—'}</td>
                    <td style={{ ...styles.td, minWidth: 260, maxWidth: 520, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{ev.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        previous={() => setPage(p => p - 1)}
        next={() => setPage(p => p + 1)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: MAC Moves
// ---------------------------------------------------------------------------

function MacMovesTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['mac-move-events-diag', page],
    queryFn: () => fetchMacMoveEvents(page),
  });

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / PAGE_SIZE)) : 1;

  return (
    <div style={styles.tableCard}>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <p style={styles.msgError}>{t('pppoe_diagnostics.mac_moves_error', 'Failed to load MAC move events.')}</p>
      ) : q.data.data.length === 0 ? (
        <p style={styles.msg}>{t('mac_move_events.empty', 'No MAC move events found.')}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('pppoe_diagnostics.username_column', 'Username')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.old_mac_column', 'Old MAC')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.new_mac_column', 'New MAC')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.old_nas_id_column', 'Old NAS ID')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.new_nas_id_column', 'New NAS ID')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.detected_at_column', 'Detected At')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map(ev => (
                  <tr key={ev.id} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{ev.username}</td>
                    <td style={styles.tdMono}>{ev.old_mac ?? '—'}</td>
                    <td style={styles.tdMono}>{ev.new_mac ?? '—'}</td>
                    <td style={styles.td}>{ev.old_nas_id ?? '—'}</td>
                    <td style={styles.td}>{ev.new_nas_id ?? '—'}</td>
                    <td style={styles.td}>{new Date(ev.detected_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            previous={() => setPage(p => p - 1)}
            next={() => setPage(p => p + 1)}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: MTU Issues
// ---------------------------------------------------------------------------

function MtuIssuesTab() {
  const { t } = useTranslation();

  const q = useQuery({
    queryKey: ['pppoe-mtu-issues'],
    queryFn: fetchMtuIssues,
  });

  return (
    <div>
      <div style={{ padding: '0.6rem 1rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, marginBottom: '1rem', fontSize: '0.82rem', color: '#78350f' }}>
        {t('pppoe_diagnostics.mtu_heuristic_note', 'Note: LCP failure advisories are heuristic. A profile with non-1492 MTU and LCP errors may be unrelated to MTU configuration.')}
      </div>
      <div style={styles.tableCard}>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.mtu_issues_error', 'Failed to load MTU advisories.')}</p>
        ) : q.data.advisories.length === 0 ? (
          <p style={styles.msg}>{t('pppoe_diagnostics.mtu_issues_empty', 'No MTU advisories.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('pppoe_diagnostics.advisory_type_column', 'Advisory')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.profile_column', 'Profile')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.username_column', 'Username')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.mtu_column', 'MTU')}</th>
                  <th style={styles.th}>{t('pppoe_diagnostics.description_column', 'Description')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.advisories.map((a, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>
                        {t(`pppoe_diagnostics.advisory_types.${a.type}`, a.type.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td style={styles.td}>{a.profile_name ? `${a.profile_name} (#${a.profile_id})` : '—'}</td>
                    <td style={styles.td}>{a.username ?? '—'}</td>
                    <td style={styles.tdNum}>{a.mtu}</td>
                    <td style={{ ...styles.td, minWidth: 260, maxWidth: 520, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{a.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function PppoeDiagnostics() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('auth_failures');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabLabel: Record<TabId, string> = {
    auth_failures: t('pppoe_diagnostics.auth_failures_tab', 'Auth Failures'),
    event_log: t('pppoe_diagnostics.event_log_tab', 'Event Log'),
    mac_moves: t('pppoe_diagnostics.mac_moves_tab', 'MAC Moves'),
    mtu_issues: t('pppoe_diagnostics.mtu_issues_tab', 'MTU Advisories'),
  };

  const tabId = (tab: TabId) => `pppoe-diagnostics-tab-${tab}`;
  const panelId = (tab: TabId) => `pppoe-diagnostics-panel-${tab}`;

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveTab(TABS[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>{t('pppoe_diagnostics.title', 'PPPoE Diagnostics')}</h1>
          <p style={{ margin: '0.35rem 0 0', maxWidth: 840, color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.5 }}>
            {t('pppoe_diagnostics.description', 'Correlate RADIUS authentication and accounting with RouterOS PPPoE events to find rejected logins, negotiation failures, MAC moves, and MTU risks.')}
          </p>
        </div>
      </div>

      <ReadinessBanner />

      <div role="tablist" aria-orientation="horizontal" aria-label={t('pppoe_diagnostics.tabs_label', 'Diagnostic views')} style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {TABS.map((tab, index) => (
          <button
            key={tab}
            id={tabId(tab)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={panelId(tab)}
            tabIndex={activeTab === tab ? 0 : -1}
            ref={element => { tabRefs.current[index] = element; }}
            onClick={() => setActiveTab(tab)}
            onKeyDown={event => handleTabKeyDown(event, index)}
            style={{
              padding: '0.6rem 1.25rem',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {tabLabel[tab]}
          </button>
        ))}
      </div>

      {TABS.map(tab => (
        <div
          key={tab}
          id={panelId(tab)}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          hidden={activeTab !== tab}
          tabIndex={activeTab === tab ? 0 : -1}
        >
          {activeTab === tab && tab === 'auth_failures' && <AuthFailuresTab />}
          {activeTab === tab && tab === 'event_log' && <EventLogTab />}
          {activeTab === tab && tab === 'mac_moves' && <MacMovesTab />}
          {activeTab === tab && tab === 'mtu_issues' && <MtuIssuesTab />}
        </div>
      ))}
    </div>
  );
}
