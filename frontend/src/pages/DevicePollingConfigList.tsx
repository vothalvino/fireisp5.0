// =============================================================================
// FireISP 5.0 — Device Polling Config Management (§6.4)
// =============================================================================
// Page at /device-polling-configs. Lists per-device polling overrides with
// paginated table, create modal, and delete confirmation.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DevicePollingConfig {
  id: number;
  device_id: number | null;
  device_type: string | null;
  poll_interval_sec: number;
  bulk_get_enabled: number;
  timeout_ms: number;
  retries: number;
  adaptive_polling_enabled: number;
  adaptive_min_interval_sec: number;
  is_enabled: number;
}

interface DevicePollingConfigsResponse {
  data: DevicePollingConfig[];
  meta: { total: number; page: number; limit: number };
}

interface DevicePollingConfigBody {
  device_id?: number | null;
  device_type?: string | null;
  poller_node_id?: number | null;
  poll_interval_sec?: number;
  bulk_get_enabled?: boolean;
  timeout_ms?: number;
  retries?: number;
  adaptive_polling_enabled?: boolean;
  adaptive_min_interval_sec?: number;
  is_enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchConfigs(page: number): Promise<DevicePollingConfigsResponse> {
  const res = await api.GET('/device-polling-configs' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load polling configs');
  return (res as { data: unknown }).data as unknown as DevicePollingConfigsResponse;
}

async function createConfig(body: DevicePollingConfigBody): Promise<void> {
  const res = await api.POST('/device-polling-configs' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create polling config');
}

async function deleteConfig(id: number): Promise<void> {
  const res = await api.DELETE('/device-polling-configs/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete polling config');
}

// ---------------------------------------------------------------------------
// Create form modal
// ---------------------------------------------------------------------------

interface ConfigFormProps {
  onSave: (body: DevicePollingConfigBody) => void;
  onClose: () => void;
  saving: boolean;
}

function ConfigForm({ onSave, onClose, saving }: ConfigFormProps) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [pollInterval, setPollInterval] = useState('300');
  const [bulkGet, setBulkGet] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState('5000');
  const [retries, setRetries] = useState('1');
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false);
  const [adaptiveMin, setAdaptiveMin] = useState('60');
  const [isEnabled, setIsEnabled] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: DevicePollingConfigBody = {
      poll_interval_sec: parseInt(pollInterval, 10) || 300,
      bulk_get_enabled: bulkGet,
      timeout_ms: parseInt(timeoutMs, 10) || 5000,
      retries: parseInt(retries, 10),
      adaptive_polling_enabled: adaptiveEnabled,
      adaptive_min_interval_sec: parseInt(adaptiveMin, 10) || 60,
      is_enabled: isEnabled,
    };
    if (deviceId) body.device_id = parseInt(deviceId, 10);
    if (deviceType) body.device_type = deviceType;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };
  const chk: React.CSSProperties = { marginRight: 8 };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{t('device_polling_configs.new', 'New Polling Config')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.device_id', 'Device ID')}</label>
              <input style={inp} type="number" min={1} value={deviceId} onChange={e => setDeviceId(e.target.value)} placeholder="Leave blank for type-based" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.device_type', 'Device Type')}</label>
              <input style={inp} value={deviceType} onChange={e => setDeviceType(e.target.value)} placeholder="e.g. router" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.poll_interval_sec', 'Poll Interval (sec)')}<RequiredMark /></label>
              <input style={inp} type="number" min={10} max={86400} value={pollInterval} onChange={e => setPollInterval(e.target.value)} required />
            </div>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.timeout_ms', 'Timeout (ms)')}</label>
              <input style={inp} type="number" min={100} max={60000} value={timeoutMs} onChange={e => setTimeoutMs(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.retries', 'Retries')}</label>
              <input style={inp} type="number" min={0} max={10} value={retries} onChange={e => setRetries(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('device_polling_configs.adaptive_min_interval_sec', 'Adaptive Min (sec)')}</label>
              <input style={inp} type="number" min={10} max={3600} value={adaptiveMin} onChange={e => setAdaptiveMin(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" style={chk} checked={bulkGet} onChange={e => setBulkGet(e.target.checked)} />
              {t('device_polling_configs.bulk_get_enabled', 'Bulk GET')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" style={chk} checked={adaptiveEnabled} onChange={e => setAdaptiveEnabled(e.target.checked)} />
              {t('device_polling_configs.adaptive_polling_enabled', 'Adaptive Polling')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" style={chk} checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
              {t('device_polling_configs.is_enabled', 'Enabled')}
            </label>
          </div>

          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function DevicePollingConfigList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const configsQ = useQuery({
    queryKey: ['device-polling-configs', page],
    queryFn: () => fetchConfigs(page),
  });

  const configs = configsQ.data?.data ?? [];
  const meta = configsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-polling-configs'] });
      setShowForm(false);
      showMsg('ok', t('device_polling_configs.create_success', 'Polling config created.'));
    },
    onError: () => showMsg('err', t('device_polling_configs.create_error', 'Failed to create polling config.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-polling-configs'] });
      setDeleteConfirm(null);
      showMsg('ok', t('device_polling_configs.delete_success', 'Polling config deleted.'));
    },
    onError: () => showMsg('err', t('device_polling_configs.delete_error', 'Failed to delete polling config.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('device_polling_configs.title', 'Device Polling Configs')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('device_polling_configs.new', 'New Polling Config')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {configsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : configsQ.error ? (
          <p style={styles.msgError}>{t('device_polling_configs.error', 'Failed to load polling configs.')}</p>
        ) : configs.length === 0 ? (
          <p style={styles.msg}>{t('device_polling_configs.empty', 'No polling configs found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('device_polling_configs.device_id', 'Device')}</th>
                  <th style={styles.th}>{t('device_polling_configs.device_type', 'Type')}</th>
                  <th style={styles.th}>{t('device_polling_configs.poll_interval_sec', 'Interval (s)')}</th>
                  <th style={styles.th}>{t('device_polling_configs.bulk_get_enabled', 'Bulk GET')}</th>
                  <th style={styles.th}>{t('device_polling_configs.adaptive_polling_enabled', 'Adaptive')}</th>
                  <th style={styles.th}>{t('device_polling_configs.is_enabled', 'Enabled')}</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {configs.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>{c.device_id ?? '—'}</td>
                    <td style={styles.td}>{c.device_type ?? '—'}</td>
                    <td style={styles.td}>{c.poll_interval_sec}s</td>
                    <td style={styles.td}>{c.bulk_get_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>{c.adaptive_polling_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>{c.is_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(c.id)}>Delete</button>
                    </td>
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

      {showForm && (
        <ConfigForm
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('device_polling_configs.delete_confirm', 'Delete this polling config?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
