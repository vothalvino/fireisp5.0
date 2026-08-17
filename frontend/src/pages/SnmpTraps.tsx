// =============================================================================
// FireISP 5.0 — SNMP trap log
// =============================================================================
// The list is deliberately metadata-only. Raw varbind values are fetched only
// after an explicit operator action and only when the active user has the
// dedicated snmp_traps.payload.view permission. Community strings are never
// returned or displayed.
// =============================================================================

import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { ErrorState, LoadingState } from '@/components/FetchStates';

interface SnmpTrapMetadata {
  id: number;
  organization_id: number | null;
  device_id: number | null;
  device_name: string | null;
  source_ip: string;
  trap_type: string;
  trap_oid: string | null;
  snmp_version: number;
  varbinds_truncated: boolean;
  varbinds_original_count: number;
  varbinds_truncation_reason: 'count_limit' | 'size_limit' | 'count_and_size_limit' | 'daily_byte_quota' | null;
  is_acknowledged: number | boolean;
  acknowledged_by: number | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  received_at: string;
}

interface SnmpVarbind {
  oid: string;
  type: number | string | null;
  value: string | null;
  truncated?: boolean;
}

interface SnmpTrapDetail extends SnmpTrapMetadata {
  varbinds: SnmpVarbind[] | null;
}

interface TrapsResponse {
  data: SnmpTrapMetadata[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface DetailState {
  id: number;
  loading: boolean;
  error: boolean;
  data: SnmpTrapDetail | null;
}

const LIMIT = 50;
type ApiSnmpTrapMetadata = components['schemas']['SnmpTrapMetadata'];
type ApiSnmpTrapDetail = components['schemas']['SnmpTrapDetail'];

const TRAP_TYPE_COLORS: Record<string, string> = {
  linkDown: '#dc2626',
  authenticationFailure: '#d97706',
  egpNeighborLoss: '#b91c1c',
  linkUp: '#16a34a',
  coldStart: '#2563eb',
  warmStart: '#7c3aed',
  enterpriseSpecific: '#64748b',
  unknown: '#6b7280',
};

function trapColor(trapType: string): string {
  return TRAP_TYPE_COLORS[trapType] || '#64748b';
}

function isAcknowledged(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toUtcDateTime(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeTrapMetadata(trap: ApiSnmpTrapMetadata): SnmpTrapMetadata {
  return {
    id: trap.id,
    organization_id: trap.organization_id ?? null,
    device_id: trap.device_id ?? null,
    device_name: trap.device_name ?? null,
    source_ip: trap.source_ip,
    trap_type: trap.trap_type,
    trap_oid: trap.trap_oid ?? null,
    snmp_version: trap.snmp_version ?? 0,
    varbinds_truncated: trap.varbinds_truncated ?? false,
    varbinds_original_count: trap.varbinds_original_count ?? 0,
    varbinds_truncation_reason: trap.varbinds_truncation_reason ?? null,
    is_acknowledged: trap.is_acknowledged ?? false,
    acknowledged_by: trap.acknowledged_by ?? null,
    acknowledged_by_name: trap.acknowledged_by_name ?? null,
    acknowledged_at: trap.acknowledged_at ?? null,
    received_at: trap.received_at ?? '',
  };
}

function normalizeTrapDetail(trap: ApiSnmpTrapDetail): SnmpTrapDetail {
  return {
    ...normalizeTrapMetadata(trap),
    varbinds: trap.varbinds.map(varbind => ({
      oid: varbind.oid,
      type: varbind.type,
      value: varbind.value,
      truncated: varbind.truncated,
    })),
  };
}

async function fetchTraps(
  page: number,
  deviceId: string,
  trapType: string,
  from: string,
  to: string,
): Promise<TrapsResponse> {
  const numericDeviceId = Number(deviceId);
  const query = {
    page,
    limit: LIMIT,
    ...(deviceId && Number.isInteger(numericDeviceId) && numericDeviceId > 0
      ? { device_id: numericDeviceId }
      : {}),
    ...(trapType ? { trap_type: trapType } : {}),
    ...(toUtcDateTime(from) ? { from: toUtcDateTime(from) } : {}),
    ...(toUtcDateTime(to) ? { to: toUtcDateTime(to) } : {}),
  };
  const response = await api.GET('/snmp-traps', { params: { query } });
  if (response.error || !response.data) throw new Error('Failed to load SNMP traps');
  const { data, meta } = response.data;
  return {
    data: data.map(normalizeTrapMetadata),
    meta: {
      ...meta,
      totalPages: Math.max(1, Math.ceil(meta.total / Math.max(1, meta.limit))),
    },
  };
}

async function fetchTrapDetail(id: number): Promise<SnmpTrapDetail> {
  const response = await api.GET('/snmp-traps/{id}', { params: { path: { id } } });
  if (response.error || !response.data) throw new Error('Failed to load SNMP trap detail');
  return normalizeTrapDetail(response.data.data);
}

async function acknowledgeTrap(id: number): Promise<void> {
  const response = await api.POST('/snmp-traps/{id}/acknowledge', { params: { path: { id } } });
  if (response.error) throw new Error('Failed to acknowledge trap');
}

async function clearTrap(id: number): Promise<void> {
  const response = await api.POST('/snmp-traps/{id}/clear', { params: { path: { id } } });
  if (response.error) throw new Error('Failed to clear trap');
}

export function SnmpTraps() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const hasPayloadPersona = user?.role === 'admin'
    || user?.role === 'super_admin'
    || user?.is_install_operator === true;
  const mayViewPayload = hasPayloadPersona
    && can(user, 'devices.view')
    && can(user, 'snmp_traps.payload.view');
  const mayAcknowledge = can(user, 'devices.update');
  const mayClear = can(user, 'devices.delete');

  const [page, setPage] = useState(1);
  const [deviceId, setDeviceId] = useState('');
  const [trapType, setTrapType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState<SnmpTrapMetadata | null>(null);
  const detailRequest = useRef(0);

  const trapsQuery = useQuery({
    queryKey: ['snmp-traps', page, deviceId, trapType, from, to],
    queryFn: () => fetchTraps(page, deviceId, trapType, from, to),
    refetchInterval: 30_000,
  });

  const traps = trapsQuery.data?.data ?? [];
  const meta = trapsQuery.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  function discardDetail() {
    detailRequest.current += 1;
    setExpandedId(null);
    setDetailState(null);
  }

  useEffect(() => {
    setPage(1);
    discardDetail();
  }, [deviceId, trapType, from, to]);

  useEffect(() => {
    discardDetail();
  }, [page]);

  useEffect(() => {
    if (!mayViewPayload) {
      // Invalidate an in-flight privileged request as soon as access changes.
      // Its response must not repopulate raw values in component memory.
      detailRequest.current += 1;
      setDetailState(null);
    }
  }, [mayViewPayload]);

  useEffect(() => () => {
    detailRequest.current += 1;
  }, []);

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeTrap,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snmp-traps'] }),
    onError: () => setFeedback(t('snmp_traps.ack_error')),
  });

  const clearMutation = useMutation({
    mutationFn: clearTrap,
    onSuccess: (_data, id) => {
      if (expandedId === id) discardDetail();
      setClearConfirm(null);
      queryClient.invalidateQueries({ queryKey: ['snmp-traps'] });
    },
    onError: () => setFeedback(t('snmp_traps.clear_error')),
  });

  async function loadDetail(trap: SnmpTrapMetadata) {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    setExpandedId(trap.id);
    setFeedback(null);

    if (!mayViewPayload) {
      setDetailState(null);
      return;
    }

    setDetailState({ id: trap.id, loading: true, error: false, data: null });
    try {
      const detail = await fetchTrapDetail(trap.id);
      if (detailRequest.current === requestId) {
        setDetailState({ id: trap.id, loading: false, error: false, data: detail });
      }
    } catch {
      if (detailRequest.current === requestId) {
        setDetailState({ id: trap.id, loading: false, error: true, data: null });
      }
    }
  }

  async function openDetail(trap: SnmpTrapMetadata) {
    if (expandedId === trap.id) {
      discardDetail();
      return;
    }

    await loadDetail(trap);
  }

  function clearFilters() {
    setDeviceId('');
    setTrapType('');
    setFrom('');
    setTo('');
  }

  return (
    <div style={pageStyles.container}>
      <div style={pageStyles.header}>
        <div>
          <h1 style={pageStyles.title}>{t('snmp_traps.title')}</h1>
          <p style={pageStyles.subtitle}>{t('snmp_traps.subtitle')}</p>
        </div>
        <button type="button" style={pageStyles.secondaryButton} onClick={() => trapsQuery.refetch()}>
          {t('snmp_traps.refresh')}
        </button>
      </div>

      {!mayViewPayload && (
        <div style={pageStyles.restrictedNotice} role="status">
          <strong>{t('snmp_traps.raw_restricted_title')}</strong>
          <span>{t('snmp_traps.raw_restricted_summary')}</span>
        </div>
      )}

      <div style={pageStyles.filters}>
        <label style={pageStyles.filterLabel}>
          {t('snmp_traps.device_id')}
          <input
            style={pageStyles.filterInput}
            type="number"
            min={1}
            value={deviceId}
            onChange={event => setDeviceId(event.target.value)}
            placeholder={t('snmp_traps.device_id_placeholder')}
          />
        </label>
        <label style={pageStyles.filterLabel}>
          {t('snmp_traps.trap_type')}
          <select style={pageStyles.filterInput} value={trapType} onChange={event => setTrapType(event.target.value)}>
            <option value="">{t('snmp_traps.all_types')}</option>
            {['coldStart', 'warmStart', 'linkDown', 'linkUp', 'authenticationFailure', 'egpNeighborLoss', 'enterpriseSpecific', 'unknown']
              .map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label style={pageStyles.filterLabel}>
          {t('snmp_traps.from')}
          <input style={pageStyles.filterInput} type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} />
        </label>
        <label style={pageStyles.filterLabel}>
          {t('snmp_traps.to')}
          <input style={pageStyles.filterInput} type="datetime-local" value={to} onChange={event => setTo(event.target.value)} />
        </label>
        <button type="button" style={{ ...pageStyles.secondaryButton, alignSelf: 'flex-end' }} onClick={clearFilters}>
          {t('snmp_traps.clear_filters')}
        </button>
      </div>

      {meta && (
        <div style={pageStyles.summaryBar}>
          <span>{t('snmp_traps.total', { count: meta.total })}</span>
          <span>{t('snmp_traps.page_of', { page: meta.page, total: meta.totalPages })}</span>
        </div>
      )}

      {feedback && <p role="alert" style={pageStyles.errorNotice}>{feedback}</p>}

      {trapsQuery.isLoading ? (
        <LoadingState message={t('snmp_traps.loading')} />
      ) : trapsQuery.isError ? (
        <ErrorState message={t('snmp_traps.load_error')} onRetry={() => trapsQuery.refetch()} />
      ) : traps.length === 0 ? (
        <p style={pageStyles.empty}>{t('snmp_traps.empty')}</p>
      ) : (
        <div style={pageStyles.tableWrap}>
          <table style={pageStyles.table}>
            <thead>
              <tr>
                <th style={pageStyles.th}>{t('snmp_traps.received')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.trap_type')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.device')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.source_ip')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.trap_oid')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.version')}</th>
                <th style={pageStyles.th}>{t('snmp_traps.acknowledged')}</th>
                <th style={pageStyles.th}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {traps.map(trap => {
                const acknowledged = isAcknowledged(trap.is_acknowledged);
                const expanded = expandedId === trap.id;
                return (
                  <Fragment key={trap.id}>
                    <tr style={{ ...pageStyles.tr, opacity: acknowledged ? 0.65 : 1 }}>
                      <td style={pageStyles.td}>{new Date(trap.received_at).toLocaleString()}</td>
                      <td style={pageStyles.td}>
                        <span style={{ ...pageStyles.badge, background: trapColor(trap.trap_type) }}>{trap.trap_type}</span>
                      </td>
                      <td style={pageStyles.td}>{trap.device_name ?? t('common.errorDash')}</td>
                      <td style={pageStyles.monoTd}>{trap.source_ip}</td>
                      <td style={pageStyles.monoTd}>{trap.trap_oid ?? t('common.errorDash')}</td>
                      <td style={pageStyles.td}>v{trap.snmp_version}</td>
                      <td style={pageStyles.td}>
                        {acknowledged
                          ? t('snmp_traps.acknowledged_by', { name: trap.acknowledged_by_name || t('snmp_traps.unknown_user') })
                          : t('snmp_traps.not_acknowledged')}
                      </td>
                      <td style={{ ...pageStyles.td, whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={pageStyles.actionButton}
                          onClick={() => openDetail(trap)}
                          aria-expanded={expanded}
                        >
                          {expanded ? t('snmp_traps.hide_details') : t('snmp_traps.view_details')}
                        </button>
                        {mayAcknowledge && !acknowledged && (
                          <button
                            type="button"
                            style={pageStyles.actionButton}
                            onClick={() => acknowledgeMutation.mutate(trap.id)}
                            disabled={acknowledgeMutation.isPending}
                          >
                            {t('snmp_traps.acknowledge')}
                          </button>
                        )}
                        {mayClear && (
                          <button
                            type="button"
                            style={{ ...pageStyles.actionButton, color: 'var(--danger)' }}
                            onClick={() => { clearMutation.reset(); setClearConfirm(trap); }}
                            disabled={clearMutation.isPending}
                          >
                            {t('snmp_traps.clear')}
                          </button>
                        )}
                      </td>
                    </tr>

                    {expanded && (
                      <tr>
                        <td colSpan={8} style={pageStyles.detailCell}>
                          <div style={pageStyles.detailContent}>
                            <h2 style={pageStyles.detailTitle}>{t('snmp_traps.raw_details')}</h2>
                            {!mayViewPayload ? (
                              <div style={pageStyles.restrictedDetail} role="status">
                                <strong>{t('snmp_traps.raw_restricted_title')}</strong>
                                <span>{t('snmp_traps.raw_restricted_detail')}</span>
                              </div>
                            ) : detailState?.id === trap.id && detailState.loading ? (
                              <LoadingState message={t('snmp_traps.details_loading')} />
                            ) : detailState?.id === trap.id && detailState.error ? (
                              <ErrorState message={t('snmp_traps.details_error')} onRetry={() => loadDetail(trap)} />
                            ) : detailState?.id === trap.id && detailState.data ? (
                              <>
                                {detailState.data.varbinds_truncated && (
                                  <div role="status" style={pageStyles.truncationNotice}>
                                    <strong>{t('snmp_traps.truncation_title')}</strong>
                                    <span>{t('snmp_traps.truncation_notice', {
                                      stored: Array.isArray(detailState.data.varbinds) ? detailState.data.varbinds.length : 0,
                                      original: detailState.data.varbinds_original_count,
                                    })}</span>
                                  </div>
                                )}
                                {Array.isArray(detailState.data.varbinds) && detailState.data.varbinds.length > 0 ? (
                                  <table style={pageStyles.varbindTable}>
                                  <thead>
                                    <tr>
                                      <th style={pageStyles.varbindTh}>{t('snmp_traps.varbind_oid')}</th>
                                      <th style={pageStyles.varbindTh}>{t('snmp_traps.varbind_type')}</th>
                                      <th style={pageStyles.varbindTh}>{t('snmp_traps.varbind_value')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailState.data.varbinds.map((varbind, index) => (
                                      <tr key={`${varbind.oid}-${index}`}>
                                        <td style={pageStyles.varbindTd}>{varbind.oid}</td>
                                        <td style={pageStyles.varbindTd}>{varbind.type}</td>
                                        <td style={pageStyles.varbindValue}>
                                          {varbind.value ?? t('common.errorDash')}
                                          {varbind.truncated && <span style={pageStyles.truncatedValue}> {t('snmp_traps.value_truncated')}</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  </table>
                                ) : (
                                  <p style={pageStyles.detailMessage}>{t('snmp_traps.no_varbinds')}</p>
                                )}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={pageStyles.pagination}>
          <button type="button" style={pageStyles.secondaryButton} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>
            {t('common.prev')}
          </button>
          <span>{t('snmp_traps.page_of', { page, total: totalPages })}</span>
          <button type="button" style={pageStyles.secondaryButton} disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {clearConfirm && (
        <div style={pageStyles.dialogBackdrop} onClick={() => setClearConfirm(null)}>
          <div style={pageStyles.dialogPanel} onClick={event => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="clear-snmp-trap-title">
            <h2 id="clear-snmp-trap-title" style={pageStyles.dialogTitle}>{t('snmp_traps.clear_confirm_title')}</h2>
            <p style={pageStyles.dialogText}>{t('snmp_traps.clear_confirm_message', { id: clearConfirm.id })}</p>
            <p style={pageStyles.dialogWarning}>{t('snmp_traps.clear_confirm_warning')}</p>
            {clearMutation.isError && <p role="alert" style={pageStyles.errorNotice}>{t('snmp_traps.clear_error')}</p>}
            <div style={pageStyles.dialogActions}>
              <button type="button" style={pageStyles.secondaryButton} onClick={() => setClearConfirm(null)} disabled={clearMutation.isPending}>{t('common.cancel')}</button>
              <button type="button" style={pageStyles.dangerButton} onClick={() => clearMutation.mutate(clearConfirm.id)} disabled={clearMutation.isPending}>
                {clearMutation.isPending ? t('common.deleting') : t('snmp_traps.clear_confirm_action')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyles: Record<string, CSSProperties> = {
  container: { padding: '1.5rem', color: 'var(--text-primary)', maxWidth: 1440 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 700 },
  subtitle: { margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.45 },
  secondaryButton: { background: 'var(--bg-card)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', padding: '0.45rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' },
  restrictedNotice: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0.75rem 0.9rem', marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.82rem' },
  filters: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem', marginBottom: '1rem', padding: '0.9rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' },
  filterLabel: { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600 },
  filterInput: { minWidth: 150, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '0.45rem 0.6rem', borderRadius: 5, fontSize: '0.82rem' },
  summaryBar: { display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' },
  errorNotice: { padding: '0.65rem 0.8rem', borderRadius: 6, color: 'var(--danger)', background: 'var(--danger-soft)', fontSize: '0.82rem' },
  empty: { padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: { textAlign: 'left', padding: '0.6rem 0.7rem', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.7rem', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  monoTd: { padding: '0.65rem 0.7rem', color: 'var(--text-secondary)', verticalAlign: 'middle', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, color: '#fff', fontSize: '0.72rem', fontWeight: 600 },
  actionButton: { background: 'transparent', border: 'none', color: 'var(--link)', padding: '3px 5px', marginRight: 3, borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 },
  detailCell: { padding: '0.8rem 1rem', background: 'var(--bg-secondary)' },
  detailContent: { color: 'var(--text-secondary)', fontSize: '0.82rem' },
  detailTitle: { margin: '0 0 0.6rem', color: 'var(--text-primary)', fontSize: '0.9rem' },
  restrictedDetail: { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-secondary)' },
  detailMessage: { margin: 0, color: 'var(--text-muted)' },
  truncationNotice: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0.6rem 0.7rem', marginBottom: '0.65rem', border: '1px solid var(--warning)', borderRadius: 6, background: 'var(--warning-soft)', color: 'var(--text-secondary)', fontSize: '0.78rem' },
  varbindTable: { width: '100%', borderCollapse: 'collapse' },
  varbindTh: { textAlign: 'left', padding: '0.35rem 0.5rem', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.75rem' },
  varbindTd: { padding: '0.35rem 0.5rem', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', verticalAlign: 'top' },
  varbindValue: { padding: '0.35rem 0.5rem', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', verticalAlign: 'top', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  truncatedValue: { color: 'var(--warning)', fontFamily: 'var(--font-sans)', fontWeight: 600 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.82rem' },
  dialogBackdrop: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0, 0, 0, 0.55)' },
  dialogPanel: { width: '100%', maxWidth: 430, padding: '1.25rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: '0 18px 45px rgba(0, 0, 0, 0.3)' },
  dialogTitle: { margin: '0 0 0.6rem', color: 'var(--text-primary)', fontSize: '1.05rem' },
  dialogText: { margin: '0 0 0.45rem', color: 'var(--text-secondary)', fontSize: '0.86rem' },
  dialogWarning: { margin: '0 0 1rem', color: 'var(--danger)', fontSize: '0.8rem', fontWeight: 600 },
  dialogActions: { display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1rem' },
  dangerButton: { background: 'var(--danger)', border: '1px solid var(--danger)', color: '#fff', padding: '0.45rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
};
