// =============================================================================
// FireISP 5.0 — PPPoE Diagnostics
// =============================================================================
// Tabbed diagnostics page at /pppoe-diagnostics. Combines:
//   - Auth Failure Classification (from radpostauth)
//   - PPPoE Event Log (from pppoe_event_logs)
//   - MAC Move Events (reuses existing table)
//   - MTU Configuration Advisories
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

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
  username: string | null;
  mtu: number;
  description: string;
}

interface MtuIssuesResponse {
  advisories: MtuAdvisory[];
}

interface MacMoveEvent {
  id: number;
  username: string;
  old_mac: string;
  new_mac: string;
  old_nas_id: number | null;
  new_nas_id: number | null;
  detected_at: string;
}

interface MacMoveEventsResponse {
  data: MacMoveEvent[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const TABS = ['auth_failures', 'event_log', 'mac_moves', 'mtu_issues'] as const;
type TabId = typeof TABS[number];

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAuthFailures(from: string, to: string, username: string): Promise<AuthFailuresResponse> {
  const query: Record<string, string> = {};
  if (from) query.from = from;
  if (to) query.to = to;
  if (username) query.username = username;
  const res = await api.GET('/pppoe/diagnostics/auth-failures', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load auth failures');
  return res.data as unknown as AuthFailuresResponse;
}

async function fetchPppoeEvents(page: number, username: string, stage: string, severity: string): Promise<EventsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (username) query.username = username;
  if (stage) query.stage = stage;
  if (severity) query.severity = severity;
  const res = await api.GET('/pppoe/events', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load events');
  return res.data as unknown as EventsResponse;
}

async function fetchMtuIssues(): Promise<MtuIssuesResponse> {
  const res = await api.GET('/pppoe/diagnostics/mtu-issues', { params: { query: {} as never } });
  if (res.error) throw new Error('Failed to load MTU issues');
  return res.data as unknown as MtuIssuesResponse;
}

async function fetchMacMoveEvents(page: number): Promise<MacMoveEventsResponse> {
  const res = await api.GET('/radius/mac-move-events', { params: { query: { page, limit: PAGE_SIZE } as never } });
  if (res.error) throw new Error('Failed to load MAC move events');
  return res.data as unknown as MacMoveEventsResponse;
}

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    info: { bg: '#dbeafe', color: '#1d4ed8' },
    warning: { bg: '#fef3c7', color: '#92400e' },
    error: { bg: '#fee2e2', color: '#991b1b' },
  };
  const c = map[severity] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason badge
// ---------------------------------------------------------------------------

function ReasonBadge({ reason }: { reason: string }) {
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
      {reason.replace(/_/g, ' ')}
    </span>
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

  const data = q.data;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.from_label', 'From')}</label>
          <input type="datetime-local" style={styles.filterSelect} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.to_label', 'To')}</label>
          <input type="datetime-local" style={styles.filterSelect} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>{t('pppoe_diagnostics.username_label', 'Username')}</label>
          <input style={styles.filterSelect} value={username} onChange={e => setUsername(e.target.value)} placeholder={t('pppoe_diagnostics.username_placeholder', 'Filter by username...')} />
        </div>
        <button style={styles.btnPrimary} onClick={() => setApplied({ from, to, username })}>Apply</button>
      </div>

      {data && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {Object.entries(data.counts).map(([reason, count]) => (
            <div key={reason} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 1rem', minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{count}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t(`pppoe_diagnostics.reasons.${reason}`, reason.replace(/_/g, ' '))}</div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.tableCard}>
        {q.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : q.error ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.auth_failures_error', 'Failed to load auth failures.')}</p>
        ) : !data || data.failures.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {data.failures.map((f, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{f.username}</td>
                    <td style={styles.td}>{new Date(f.authdate).toLocaleString()}</td>
                    <td style={styles.tdMono}>{f.nas_ip_address ?? '—'}</td>
                    <td style={styles.tdMono}>{f.calling_station_id ?? '—'}</td>
                    <td style={styles.td}><ReasonBadge reason={f.reason} /></td>
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

  const events = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <input style={styles.filterSelect} value={username} onChange={e => { setUsername(e.target.value); setPage(1); }} placeholder={t('pppoe_diagnostics.username_placeholder', 'Filter by username...')} />
        <select style={styles.filterSelect} value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}>
          <option value="">All stages</option>
          {PPPOE_STAGES.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={styles.filterSelect} value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }}>
          <option value="">All severities</option>
          {SEVERITIES.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {meta && <span style={{ ...styles.countBadge, marginLeft: 'auto' }}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {q.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : q.error ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.event_log_error', 'Failed to load events.')}</p>
        ) : events.length === 0 ? (
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
                {events.map(ev => (
                  <tr key={ev.id} style={styles.tr}>
                    <td style={styles.td}>{new Date(ev.logged_at).toLocaleString()}</td>
                    <td style={styles.tdMono}>{ev.stage}</td>
                    <td style={styles.td}><SeverityBadge severity={ev.severity} /></td>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{ev.username ?? '—'}</td>
                    <td style={styles.tdMono}>{ev.mac ?? '—'}</td>
                    <td style={styles.tdMono}>{ev.reason_code ?? '—'}</td>
                    <td style={{ ...styles.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}
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

  const events = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.tableCard}>
      {q.isLoading ? (
        <p style={styles.msg}>Loading...</p>
      ) : q.error ? (
        <p style={styles.msgError}>Failed to load MAC move events.</p>
      ) : events.length === 0 ? (
        <p style={styles.msg}>{t('mac_move_events.empty', 'No MAC move events found.')}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Username', 'Old MAC', 'New MAC', 'Old NAS ID', 'New NAS ID', 'Detected At'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{ev.username}</td>
                    <td style={styles.tdMono}>{ev.old_mac}</td>
                    <td style={styles.tdMono}>{ev.new_mac}</td>
                    <td style={styles.td}>{ev.old_nas_id ?? '—'}</td>
                    <td style={styles.td}>{ev.new_nas_id ?? '—'}</td>
                    <td style={styles.td}>{new Date(ev.detected_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
              <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
              <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
            </div>
          )}
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

  const advisories = q.data?.advisories ?? [];

  return (
    <div>
      <div style={{ padding: '0.6rem 1rem', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, marginBottom: '1rem', fontSize: '0.82rem', color: '#78350f' }}>
        {t('pppoe_diagnostics.mtu_heuristic_note', 'Note: LCP failure advisories are heuristic. A profile with non-1492 MTU and LCP errors may be unrelated to MTU configuration.')}
      </div>
      <div style={styles.tableCard}>
        {q.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : q.error ? (
          <p style={styles.msgError}>{t('pppoe_diagnostics.mtu_issues_error', 'Failed to load MTU advisories.')}</p>
        ) : advisories.length === 0 ? (
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
                {advisories.map((a, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>
                        {t(`pppoe_diagnostics.advisory_types.${a.type}`, a.type.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td style={styles.td}>{a.profile_name ? `${a.profile_name} (#${a.profile_id})` : '—'}</td>
                    <td style={styles.td}>{a.username ?? '—'}</td>
                    <td style={styles.tdNum}>{a.mtu}</td>
                    <td style={{ ...styles.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</td>
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

  const tabLabel: Record<TabId, string> = {
    auth_failures: t('pppoe_diagnostics.auth_failures_tab', 'Auth Failures'),
    event_log: t('pppoe_diagnostics.event_log_tab', 'Event Log'),
    mac_moves: t('pppoe_diagnostics.mac_moves_tab', 'MAC Moves'),
    mtu_issues: t('pppoe_diagnostics.mtu_issues_tab', 'MTU Advisories'),
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('pppoe_diagnostics.title', 'PPPoE Diagnostics')}</h1>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: '1.5rem' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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

      {activeTab === 'auth_failures' && <AuthFailuresTab />}
      {activeTab === 'event_log' && <EventLogTab />}
      {activeTab === 'mac_moves' && <MacMovesTab />}
      {activeTab === 'mtu_issues' && <MtuIssuesTab />}
    </div>
  );
}
