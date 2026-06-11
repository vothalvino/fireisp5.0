// =============================================================================
// FireISP 5.0 — CPE Diagnostics Page (§8.3)
// =============================================================================
// Tabbed page:
//   Tab 1: Diagnostics — select a CPE device, choose diag type, run and view results
//   Tab 2: Session Logs — CWMP session event log with event_type filter
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CpeDevice {
  id: number;
  serial_number: string;
  oui: string;
  manufacturer: string | null;
  model_name: string | null;
  status: string;
}

interface CpeDiagnostic {
  id: number;
  cpe_device_id: number;
  diag_type: string;
  status: string;
  target_host: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
}

interface CpeSessionLog {
  id: number;
  cpe_device_id: number | null;
  event_type: string;
  message_type: string | null;
  task_type: string | null;
  fault_code: string | null;
  fault_string: string | null;
  remote_ip: string | null;
  created_at: string;
}

interface ListResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

const tabStyle = (active: boolean) => ({
  padding: '8px 20px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  background: active ? '#2563eb' : '#f3f4f6',
  color: active ? '#fff' : '#374151',
  marginRight: 8,
});

const statusColor = (status: string): string => {
  switch (status) {
    case 'complete': return '#16a34a';
    case 'running': return '#2563eb';
    case 'pending': return '#9ca3af';
    case 'error': return '#dc2626';
    default: return '#9ca3af';
  }
};

const eventTypeColor = (eventType: string): string => {
  switch (eventType) {
    case 'fault':
    case 'auth_failure':
    case 'parse_error':
    case 'session_error': return '#dc2626';
    case 'inform': return '#16a34a';
    case 'task_dispatched':
    case 'task_response': return '#2563eb';
    default: return '#9ca3af';
  }
};

// ---------------------------------------------------------------------------
// DiagnosticsTab
// ---------------------------------------------------------------------------

function DiagnosticsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [diagType, setDiagType] = useState('ping');
  const [targetHost, setTargetHost] = useState('');
  const [diagPage, setDiagPage] = useState(1);
  const [runError, setRunError] = useState('');

  // Load device list for selection
  const { data: devicesData, isLoading: devicesLoading } = useQuery<ListResponse<CpeDevice>>({
    queryKey: ['cpe-devices-select'],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { limit: 200 } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDevice>;
    },
  });

  // Load diagnostics for selected device
  const { data: diagData, isLoading: diagLoading } = useQuery<ListResponse<CpeDiagnostic>>({
    queryKey: ['cpe-diagnostics', selectedDeviceId, diagPage],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}/diagnostics' as never, {
        params: { path: { id: selectedDeviceId }, query: { page: diagPage, limit: PAGE_SIZE } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load diagnostics');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDiagnostic>;
    },
  });

  const runMut = useMutation({
    mutationFn: async () => {
      if (!selectedDeviceId) throw new Error('Select a device first');
      const res = await api.POST('/cpe-management/devices/{id}/diagnostics' as never, {
        params: { path: { id: selectedDeviceId } } as never,
        body: { diag_type: diagType, target_host: targetHost || undefined } as never,
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to queue diagnostic');
      return (res as { data: unknown }).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cpe-diagnostics', selectedDeviceId] });
      setRunError('');
    },
    onError: (e: Error) => setRunError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (diagId: number) => {
      await api.DELETE('/cpe-management/devices/{id}/diagnostics/{diagId}' as never, {
        params: { path: { id: selectedDeviceId, diagId } } as never,
      } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-diagnostics', selectedDeviceId] }),
  });

  const devices = devicesData?.data ?? [];
  const diagnostics = diagData?.data ?? [];
  const total = diagData?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const diagTypes = ['ping', 'traceroute', 'wifi_snapshot', 'ethernet_status', 'wan_diagnostics'];

  return (
    <div>
      {/* Device selector + run form */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={styles.label}>{t('common.device') || 'Device'}</label>
            <select
              style={{ ...styles.input, minWidth: 220 }}
              value={selectedDeviceId ?? ''}
              onChange={e => { setSelectedDeviceId(e.target.value ? parseInt(e.target.value, 10) : null); setDiagPage(1); }}
            >
              <option value="">— {t('common.selectDevice') || 'Select device'} —</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.serial_number} {d.manufacturer ? `(${d.manufacturer})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>{t('cpeDiagnostics.diagType')}</label>
            <select style={styles.input} value={diagType} onChange={e => setDiagType(e.target.value)}>
              {diagTypes.map(dt => (
                <option key={dt} value={dt}>{t(`cpeDiagnostics.diagTypes.${dt}`)}</option>
              ))}
            </select>
          </div>
          {(diagType === 'ping' || diagType === 'traceroute') && (
            <div>
              <label style={styles.label}>{t('cpeDiagnostics.targetHost')}</label>
              <input
                style={styles.input}
                placeholder={t('cpeDiagnostics.targetHostHint')}
                value={targetHost}
                onChange={e => setTargetHost(e.target.value)}
              />
            </div>
          )}
          <button
            style={{ ...styles.primaryButton, alignSelf: 'flex-end' }}
            onClick={() => runMut.mutate()}
            disabled={!selectedDeviceId || runMut.isPending || devicesLoading}
          >
            {runMut.isPending ? t('cpeDiagnostics.running') : t('cpeDiagnostics.run')}
          </button>
        </div>
        {runError && <p style={styles.errorText}>{runError}</p>}
      </div>

      {/* Results table */}
      {selectedDeviceId ? (
        diagLoading ? <p style={{ color: '#6b7280' }}>{t('common.loading')}</p> : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('cpeDiagnostics.diagType')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.status')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.targetHost')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.result')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.completedAt')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.length === 0 ? (
                  <tr><td colSpan={6} style={styles.emptyCell}>{t('cpeDiagnostics.empty')}</td></tr>
                ) : diagnostics.map(diag => (
                  <tr key={diag.id}>
                    <td style={styles.td}>{t(`cpeDiagnostics.diagTypes.${diag.diag_type}`) || diag.diag_type}</td>
                    <td style={styles.td}>
                      <span style={{ color: statusColor(diag.status), fontWeight: 600 }}>{diag.status}</span>
                    </td>
                    <td style={styles.td}>{diag.target_host || '—'}</td>
                    <td style={styles.td}>
                      {diag.result ? (
                        <pre style={{ margin: 0, fontSize: 11, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {JSON.stringify(diag.result, null, 2).slice(0, 200)}
                        </pre>
                      ) : diag.error_message ? (
                        <span style={{ color: '#dc2626', fontSize: 12 }}>{diag.error_message}</span>
                      ) : '—'}
                    </td>
                    <td style={styles.td}>{diag.completed_at ? new Date(diag.completed_at).toLocaleString() : '—'}</td>
                    <td style={styles.td}>
                      <button
                        style={styles.dangerButton}
                        onClick={() => { if (window.confirm('Delete this diagnostic?')) deleteMut.mutate(diag.id); }}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageButton} disabled={diagPage === 1} onClick={() => setDiagPage(p => p - 1)}>
                  {t('common.previous') || 'Prev'}
                </button>
                <span style={{ color: '#6b7280' }}>{diagPage} / {totalPages}</span>
                <button style={styles.pageButton} disabled={diagPage >= totalPages} onClick={() => setDiagPage(p => p + 1)}>
                  {t('common.next') || 'Next'}
                </button>
              </div>
            )}
          </>
        )
      ) : (
        <p style={{ color: '#9ca3af' }}>{t('common.selectDevice') || 'Select a device to view diagnostics.'}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionLogsTab
// ---------------------------------------------------------------------------

function SessionLogsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [eventType, setEventType] = useState('');
  const [logPage, setLogPage] = useState(1);

  const { data: devicesData } = useQuery<ListResponse<CpeDevice>>({
    queryKey: ['cpe-devices-select'],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { limit: 200 } as never },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load devices');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeDevice>;
    },
  });

  const { data: logsData, isLoading: logsLoading } = useQuery<ListResponse<CpeSessionLog>>({
    queryKey: ['cpe-session-logs', selectedDeviceId, eventType, logPage],
    enabled: selectedDeviceId !== null,
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices/{id}/session-logs' as never, {
        params: {
          path: { id: selectedDeviceId },
          query: { page: logPage, limit: PAGE_SIZE, event_type: eventType || undefined } as never,
        },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to load session logs');
      return (res as { data: unknown }).data as unknown as ListResponse<CpeSessionLog>;
    },
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      if (!selectedDeviceId) return;
      await api.DELETE('/cpe-management/devices/{id}/session-logs' as never, {
        params: { path: { id: selectedDeviceId } } as never,
      } as never);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cpe-session-logs', selectedDeviceId] }),
  });

  const devices = devicesData?.data ?? [];
  const logs = logsData?.data ?? [];
  const total = logsData?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const eventTypes = ['inform', 'task_dispatched', 'task_response', 'fault', 'auth_failure', 'parse_error', 'session_error'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <label style={styles.label}>{t('common.device') || 'Device'}</label>
          <select
            style={{ ...styles.input, minWidth: 220 }}
            value={selectedDeviceId ?? ''}
            onChange={e => { setSelectedDeviceId(e.target.value ? parseInt(e.target.value, 10) : null); setLogPage(1); }}
          >
            <option value="">— {t('common.selectDevice') || 'Select device'} —</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.serial_number} {d.manufacturer ? `(${d.manufacturer})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={styles.label}>{t('cpeDiagnostics.sessionLogs.eventType')}</label>
          <select style={styles.input} value={eventType} onChange={e => { setEventType(e.target.value); setLogPage(1); }}>
            <option value="">{t('cpeDiagnostics.sessionLogs.allEvents')}</option>
            {eventTypes.map(et => (
              <option key={et} value={et}>{et}</option>
            ))}
          </select>
        </div>
        {selectedDeviceId && (
          <button
            style={{ ...styles.dangerButton, alignSelf: 'flex-end' }}
            onClick={() => { if (window.confirm(t('cpeDiagnostics.sessionLogs.clearConfirm'))) clearMut.mutate(); }}
          >
            {t('cpeDiagnostics.sessionLogs.clearLogs')}
          </button>
        )}
      </div>

      {selectedDeviceId ? (
        logsLoading ? <p style={{ color: '#6b7280' }}>{t('common.loading')}</p> : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.eventType')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.messageType')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.taskType')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.faultCode')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.remoteIp')}</th>
                  <th style={styles.th}>{t('cpeDiagnostics.sessionLogs.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={6} style={styles.emptyCell}>{t('cpeDiagnostics.sessionLogs.empty')}</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id}>
                    <td style={styles.td}>
                      <span style={{ color: eventTypeColor(log.event_type), fontWeight: 600, fontSize: 12 }}>
                        {log.event_type}
                      </span>
                    </td>
                    <td style={styles.td}>{log.message_type || '—'}</td>
                    <td style={styles.td}>{log.task_type || '—'}</td>
                    <td style={styles.td}>
                      {log.fault_code ? (
                        <span style={{ color: '#dc2626' }}>{log.fault_code}</span>
                      ) : '—'}
                    </td>
                    <td style={styles.td}>{log.remote_ip || '—'}</td>
                    <td style={styles.td}>{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageButton} disabled={logPage === 1} onClick={() => setLogPage(p => p - 1)}>
                  {t('common.previous') || 'Prev'}
                </button>
                <span style={{ color: '#6b7280' }}>{logPage} / {totalPages}</span>
                <button style={styles.pageButton} disabled={logPage >= totalPages} onClick={() => setLogPage(p => p + 1)}>
                  {t('common.next') || 'Next'}
                </button>
              </div>
            )}
          </>
        )
      ) : (
        <p style={{ color: '#9ca3af' }}>{t('common.selectDevice') || 'Select a device to view session logs.'}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CpeDiagnosticsPage
// ---------------------------------------------------------------------------

export function CpeDiagnosticsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'diagnostics' | 'sessionLogs'>('diagnostics');

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>{t('cpeDiagnostics.title')}</h1>
      <p style={styles.subtitle}>{t('cpeDiagnostics.subtitle')}</p>

      <div style={{ marginBottom: 20 }}>
        <button style={tabStyle(tab === 'diagnostics')} onClick={() => setTab('diagnostics')}>
          {t('cpeDiagnostics.tabs.diagnostics')}
        </button>
        <button style={tabStyle(tab === 'sessionLogs')} onClick={() => setTab('sessionLogs')}>
          {t('cpeDiagnostics.tabs.sessionLogs')}
        </button>
      </div>

      {tab === 'diagnostics' && <DiagnosticsTab />}
      {tab === 'sessionLogs' && <SessionLogsTab />}
    </div>
  );
}
