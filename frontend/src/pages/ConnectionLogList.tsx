// =============================================================================
// FireISP 5.0 — Subscriber sessions and case-bound IP attribution
// =============================================================================

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, authedFetch } from '@/api/client';
import type { operations } from '@/api/schema';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { EmptyState, ErrorState, LoadingState } from '@/components/FetchStates';
import { Pagination } from '@/components/Pagination';
import { styles } from './crudStyles';

type JsonRecord = Record<string, unknown>;
type Tab = 'sessions' | 'attribution';
type FilterState = Record<string, string>;
type SessionExportValidation = 'datesRequired' | 'invalidDates' | 'dateOrder' | 'windowTooLong';
type AttributionValidation = 'caseRequired' | 'ipv4Invalid' | 'portInvalid' | 'protocolRequired' | 'timestampRequired';
type AttributionExportFailure = 'error' | 'checksumInvalid' | 'checksumMismatch' | 'verificationUnavailable';
type SessionApiQuery = NonNullable<operations['listConnectionLogs']['parameters']['query']>;

interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PageResult<T> {
  data: T[];
  meta: PageMeta;
}

interface SessionRow {
  id: string;
  clientId: string | null;
  clientName: string | null;
  contractId: string | null;
  username: string | null;
  assignedIpv4: string | null;
  assignedIpv6: string | null;
  state: 'active' | 'interim' | 'ended' | 'unknown';
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  nasId: string | null;
  nasName: string | null;
  nasIp: string | null;
  nasPort: string | null;
  mac: string | null;
  radiusSessionId: string | null;
  bytesIn: number | null;
  bytesOut: number | null;
  terminateCause: string | null;
}

type AttributionStatus = 'unique' | 'unavailable' | 'ambiguous' | 'incomplete' | 'unknown';

interface AttributionEvidence {
  id: string;
  clientId: string | null;
  clientName: string | null;
  contractId: string | null;
  username: string | null;
  radiusSessionId: string | null;
  privateIp: string | null;
  privatePortStart: number | null;
  privatePortEnd: number | null;
  publicIpv4: string | null;
  publicPortStart: number | null;
  publicPortEnd: number | null;
  protocol: string | null;
  validFrom: string | null;
  validTo: string | null;
  mappingKind: string | null;
  natPool: string | null;
  natRealm: string | null;
  exporterNasId: string | null;
  exporterNasName: string | null;
  exporterId: string | null;
  exporterIp: string | null;
  lookupObservedAt: string | null;
  deviceRecordedAt: string | null;
  receivedAt: string | null;
  integrityHash: string | null;
  attributionMethod: string | null;
}

interface AttributionResult {
  status: AttributionStatus;
  match: AttributionEvidence | null;
  candidateCount: number | null;
  reasons: string[];
  caseId: string | null;
}

interface LoggerReadiness {
  ready: boolean;
  status: 'ready' | 'waiting' | 'notConfigured' | 'unknown';
  lastReceivedAt: string | null;
  records24h: number | null;
  source: string | null;
  coveredSources: number | null;
  totalSources: number | null;
  coverageStatus: string | null;
  clockStatus: string | null;
  maxClockOffsetMs: number | null;
  lossStatus: string | null;
  sequenceGaps24h: number | null;
  lostRecords24h: number | null;
  incompleteMetadata24h: number | null;
}

interface Readiness {
  sessions: LoggerReadiness;
  attribution: LoggerReadiness;
  sessionRetentionMonths: number | null;
  attributionRetentionMonths: number | null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_SESSION_EXPORT_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const MONO: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: '0.75rem',
};
const CARD: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  padding: '1rem',
};
const TERMINATE_CAUSE_KEYS: Record<string, string> = {
  'user-request': 'userRequest',
  'lost-carrier': 'lostCarrier',
  'lost-service': 'lostService',
  'idle-timeout': 'idleTimeout',
  'session-timeout': 'sessionTimeout',
  'admin-reset': 'adminReset',
  'admin-reboot': 'adminReboot',
  'port-error': 'portError',
  'nas-error': 'nasError',
  'nas-request': 'nasRequest',
  'nas-reboot': 'nasReboot',
  'port-unneeded': 'portUnneeded',
  'port-preempted': 'portPreempted',
  'port-suspended': 'portSuspended',
  'service-unavailable': 'serviceUnavailable',
  callback: 'callback',
  'user-error': 'userError',
  'host-request': 'hostRequest',
  'supplicant-restart': 'supplicantRestart',
  'reauthentication-failure': 'reauthenticationFailure',
  'port-reinitialized': 'portReinitialized',
  'port-administratively-disabled': 'portAdministrativelyDisabled',
};

const EMPTY_SESSION_FILTERS: FilterState = {
  date_from: '',
  date_to: '',
  client_id: '',
  contract_id: '',
  username: '',
  ip_address: '',
  nas: '',
  session_id: '',
  mac: '',
  state: '',
};

const EMPTY_ATTRIBUTION_LOOKUP: FilterState = {
  attribution_mode: 'cgnat',
  gov_data_request_id: '',
  public_ipv4: '',
  public_port: '',
  protocol: '',
  observed_at: '',
};

function localDateTimeSeconds(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function attributionPrefill(raw: unknown): FilterState {
  const state = object(raw);
  const prefill = object(first(state, 'ipAttribution', 'attributionLookup'));
  const hasPrefill = Object.keys(prefill).length > 0;
  const port = stringValue(first(prefill, 'public_port', 'publicPort')) ?? '';
  return {
    ...EMPTY_ATTRIBUTION_LOOKUP,
    attribution_mode: hasPrefill && !port ? 'direct' : 'cgnat',
    gov_data_request_id: stringValue(first(prefill, 'gov_data_request_id', 'caseId')) ?? '',
    public_ipv4: stringValue(first(prefill, 'public_ipv4', 'publicIpv4', 'ip_address')) ?? '',
    public_port: port,
    protocol: (stringValue(prefill.protocol) ?? '').toLowerCase(),
    observed_at: localDateTimeSeconds(first(prefill, 'observed_at', 'observedAt')),
  };
}

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function first(row: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function normalizeState(row: JsonRecord, endedAt: string | null): SessionRow['state'] {
  const raw = (stringValue(first(row, 'state', 'status', 'event_type', 'event')) ?? '').toLowerCase();
  if (endedAt || ['stop', 'stopped', 'ended', 'closed', 'terminated'].includes(raw)) return 'ended';
  if (['interim', 'interim-update', 'interim_update', 'updated'].includes(raw)) return 'interim';
  if (['start', 'started', 'active', 'online', 'open'].includes(raw)) return 'active';
  return 'unknown';
}

function normalizeSession(raw: unknown, index: number): SessionRow {
  const row = object(raw);
  const client = object(row.client);
  const contract = object(row.contract);
  const nas = object(first(row, 'nas', 'network_access_server'));
  const eventType = (stringValue(first(row, 'event_type', 'event')) ?? '').toLowerCase();
  const eventAt = stringValue(first(row, 'event_at', 'recorded_at'));
  let startedAt = stringValue(first(
    row,
    'started_at', 'start_at', 'session_started_at', 'session_start', 'acct_start_time',
  )) ?? (['start', 'started'].includes(eventType) ? eventAt : null);
  const endedAt = stringValue(first(
    row,
    'ended_at', 'end_at', 'session_ended_at', 'session_end', 'acct_stop_time',
  )) ?? (['stop', 'stopped', 'ended'].includes(eventType) ? eventAt : null);
  const rawDurationMs = numberValue(first(row, 'duration_ms'));
  const durationSeconds = numberValue(first(row, 'duration_seconds', 'session_duration', 'acct_session_time', 'duration'))
    ?? (rawDurationMs === null ? null : rawDurationMs / 1000);
  // Legacy RADIUS event rows carry the observation time plus cumulative
  // session duration. Derive the start instant when the API has not yet
  // supplied its normalized started_at alias; never derive an end for a live
  // interim event.
  if (!startedAt && eventAt && durationSeconds !== null) {
    const observed = new Date(eventAt).getTime();
    if (Number.isFinite(observed)) startedAt = new Date(observed - durationSeconds * 1000).toISOString();
  }

  return {
    id: stringValue(first(row, 'id', 'connection_log_id')) ?? `row-${index}`,
    clientId: stringValue(first(row, 'client_id')) ?? stringValue(client.id),
    clientName: stringValue(first(row, 'client_name', 'subscriber_name')) ?? stringValue(first(client, 'name', 'full_name')),
    contractId: stringValue(first(row, 'contract_id')) ?? stringValue(contract.id),
    username: stringValue(first(row, 'username', 'user_name', 'radius_username')),
    assignedIpv4: stringValue(first(row, 'assigned_ipv4', 'assigned_ip', 'framed_ip', 'framed_ip_address', 'ip_address')),
    assignedIpv6: stringValue(first(row, 'assigned_ipv6', 'framed_ipv6_prefix', 'delegated_ipv6_prefix', 'ipv6_address')),
    state: normalizeState(row, endedAt),
    startedAt,
    endedAt,
    durationSeconds,
    nasId: stringValue(first(row, 'nas_id')) ?? stringValue(nas.id),
    nasName: stringValue(first(row, 'nas_name', 'shortname')) ?? stringValue(first(nas, 'name', 'shortname')),
    nasIp: stringValue(first(row, 'nas_ip', 'nas_ip_address')) ?? stringValue(first(nas, 'ip_address', 'ip')),
    nasPort: stringValue(first(row, 'nas_port', 'nas_port_id', 'nas_port_type')),
    mac: stringValue(first(row, 'mac', 'mac_address', 'calling_station_id')),
    radiusSessionId: stringValue(first(row, 'radius_session_id', 'session_id', 'acct_session_id')),
    bytesIn: numberValue(first(row, 'bytes_in', 'input_octets', 'acct_input_octets', 'download_bytes')),
    bytesOut: numberValue(first(row, 'bytes_out', 'output_octets', 'acct_output_octets', 'upload_bytes')),
    terminateCause: stringValue(first(row, 'terminate_cause', 'acct_terminate_cause', 'termination_reason')),
  };
}

function normalizeAttributionEvidence(raw: unknown): AttributionEvidence {
  const row = object(raw);
  const mapping = object(first(row, 'mapping', 'binding', 'attribution'));
  const client = object(first(row, 'client', 'subscriber_account', 'subscriber'));
  const contract = object(row.contract);
  const session = object(first(row, 'session', 'access_session', 'radius_session'));
  const nas = object(first(row, 'nas', 'exporter_nas', 'gateway'));
  const publicPort = numberValue(first(row, 'public_port', 'translated_source_port', 'nat_port'));
  const privatePort = numberValue(first(row, 'private_port', 'source_port'));
  return {
    id: stringValue(first(row, 'id', 'binding_id', 'connection_log_id', 'event_key')) ?? '—',
    clientId: stringValue(first(row, 'client_id')) ?? stringValue(client.id),
    clientName: stringValue(first(row, 'client_name', 'subscriber_name', 'account_label'))
      ?? stringValue(first(client, 'name', 'full_name', 'label')),
    contractId: stringValue(first(row, 'contract_id')) ?? stringValue(contract.id),
    username: stringValue(first(row, 'username', 'radius_username'))
      ?? stringValue(first(session, 'username', 'radius_username')),
    radiusSessionId: stringValue(first(row, 'radius_session_id', 'session_id', 'acct_session_id'))
      ?? stringValue(first(session, 'id', 'radius_session_id', 'acct_session_id')),
    privateIp: stringValue(first(row, 'private_ipv4', 'private_ip', 'source_ip', 'inside_ip'))
      ?? stringValue(first(mapping, 'private_ipv4', 'private_ip', 'source_ip', 'inside_ip')),
    privatePortStart: numberValue(first(row, 'private_port_start', 'source_port_start'))
      ?? numberValue(first(mapping, 'private_port_start', 'source_port_start'))
      ?? privatePort,
    privatePortEnd: numberValue(first(row, 'private_port_end', 'source_port_end'))
      ?? numberValue(first(mapping, 'private_port_end', 'source_port_end'))
      ?? privatePort,
    publicIpv4: stringValue(first(row, 'public_ipv4', 'public_ip', 'translated_source_ip', 'nat_ip'))
      ?? stringValue(first(mapping, 'public_ipv4', 'public_ip', 'translated_source_ip', 'nat_ip')),
    publicPortStart: numberValue(first(row, 'public_port_start', 'translated_port_start', 'nat_port_start'))
      ?? numberValue(first(mapping, 'public_port_start', 'translated_port_start', 'nat_port_start'))
      ?? publicPort,
    publicPortEnd: numberValue(first(row, 'public_port_end', 'translated_port_end', 'nat_port_end'))
      ?? numberValue(first(mapping, 'public_port_end', 'translated_port_end', 'nat_port_end'))
      ?? publicPort,
    protocol: stringValue(first(row, 'protocol', 'transport_protocol'))
      ?? stringValue(first(mapping, 'protocol', 'transport_protocol')),
    validFrom: stringValue(first(row, 'valid_from', 'assigned_at', 'allocated_at', 'started_at', 'start_at'))
      ?? stringValue(first(mapping, 'valid_from', 'assigned_at', 'allocated_at', 'started_at', 'start_at')),
    validTo: stringValue(first(row, 'valid_to', 'released_at', 'ended_at', 'end_at'))
      ?? stringValue(first(mapping, 'valid_to', 'released_at', 'ended_at', 'end_at')),
    mappingKind: stringValue(first(row, 'mapping_kind', 'allocation_type', 'binding_type'))
      ?? stringValue(first(mapping, 'mapping_kind', 'allocation_type', 'binding_type')),
    natPool: stringValue(first(row, 'nat_pool', 'pool_name', 'pool_id', 'nat_pool_id'))
      ?? stringValue(first(mapping, 'nat_pool', 'pool_name', 'pool_id', 'nat_pool_id')),
    natRealm: stringValue(first(row, 'nat_realm', 'realm', 'nat_instance'))
      ?? stringValue(first(mapping, 'nat_realm', 'realm', 'nat_instance')),
    exporterNasId: stringValue(first(row, 'exporter_nas_id', 'nas_id', 'gateway_nas_id')) ?? stringValue(nas.id),
    exporterNasName: stringValue(first(row, 'nas_name', 'exporter_nas_name', 'gateway_name'))
      ?? stringValue(first(nas, 'name', 'shortname')),
    exporterId: stringValue(first(row, 'exporter_id', 'observation_domain_id', 'source_id')),
    exporterIp: stringValue(first(row, 'exporter_ip', 'nas_ip', 'gateway_ip'))
      ?? stringValue(first(nas, 'ip', 'ip_address')),
    lookupObservedAt: stringValue(first(row, 'observed_at', 'lookup_at')),
    deviceRecordedAt: stringValue(first(row, 'allocation_device_recorded_at', 'device_recorded_at', 'event_at')),
    receivedAt: stringValue(first(
      row,
      'allocation_received_at', 'assignment_evidence_received_at',
      'accounting_received_at', 'last_accounting_received_at',
      'received_at', 'ingested_at', 'collector_received_at',
    )),
    integrityHash: stringValue(first(row, 'integrity_hash', 'row_hash', 'evidence_hash')),
    attributionMethod: stringValue(first(row, 'attribution_method', 'attributionMethod', 'method')),
  };
}

function normalizeAttributionStatus(value: unknown): AttributionStatus {
  const status = (stringValue(value) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (['unique', 'matched', 'exact_match', 'found'].includes(status)) return 'unique';
  if (['unavailable', 'not_found', 'no_match', 'missing'].includes(status)) return 'unavailable';
  if (['ambiguous', 'multiple', 'multiple_matches'].includes(status)) return 'ambiguous';
  if (['incomplete', 'insufficient', 'coverage_gap', 'evidence_gap', 'degraded'].includes(status)) return 'incomplete';
  return 'unknown';
}

function hasCompleteAttributionEvidence(match: AttributionEvidence): boolean {
  const commonEvidence = Boolean(
    match.id !== '—'
    && match.clientId
    && match.contractId
    && match.username
    && match.radiusSessionId
    && match.publicIpv4
    && match.validFrom
    && match.lookupObservedAt
    && match.receivedAt
    && match.integrityHash,
  );
  if (!commonEvidence) return false;
  if (['direct_public_assignment', 'direct_public'].includes(match.attributionMethod ?? '')) return true;
  if (!['cgnat_binding', 'cgnat_mapping', 'cgnat'].includes(match.attributionMethod ?? '')) return false;
  return Boolean(
    match.privateIp
    && match.publicPortStart !== null
    && match.publicPortEnd !== null
    && match.protocol
    && match.exporterId,
  );
}

function normalizeAttributionResult(raw: unknown): AttributionResult {
  const root = object(raw);
  const data = object(root.data ?? root);
  const rawCandidates = first(data, 'matches', 'candidates');
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  const directMatch = first(data, 'match', 'binding', 'attribution', 'evidence');
  const candidateCount = numberValue(first(data, 'candidate_count', 'match_count', 'matches_count'))
    ?? (Array.isArray(rawCandidates) ? candidates.length : null);
  let status = normalizeAttributionStatus(first(data, 'status', 'result'));
  const reason = (stringValue(data.reason) ?? '').toLowerCase();
  if (status === 'unavailable' && (reason.includes('incomplete') || reason.includes('evidence_gap'))) {
    status = 'incomplete';
  }
  const selected = directMatch ?? (candidates.length === 1 ? candidates[0] : null);

  // The UI independently enforces cardinality. It must never display one
  // candidate as authoritative when the server reports or returns several.
  if ((candidateCount ?? candidates.length) > 1 || candidates.length > 1) status = 'ambiguous';
  if (status === 'unique' && (!selected || candidateCount !== 1)) status = 'incomplete';

  const rawReasons = first(data, 'reasons', 'gaps', 'caveats');
  const reasons = Array.isArray(rawReasons)
    ? rawReasons.map(stringValue).filter((value): value is string => Boolean(value))
    : (reason ? [reason] : []);
  const legalCase = object(first(data, 'government_request', 'legal_request', 'case'));
  const query = object(data.query);
  const match = status === 'unique' && selected ? normalizeAttributionEvidence(selected) : null;
  if (match && !match.attributionMethod) {
    match.attributionMethod = stringValue(first(data, 'attribution_method', 'attributionMethod', 'method'));
  }
  if (match && !match.lookupObservedAt) {
    match.lookupObservedAt = stringValue(first(query, 'observed_at', 'timestamp'));
  }
  if (match && !hasCompleteAttributionEvidence(match)) status = 'incomplete';
  return {
    status,
    match: status === 'unique' ? match : null,
    candidateCount,
    reasons,
    caseId: stringValue(first(data, 'gov_data_request_id', 'government_request_id', 'case_id'))
      ?? stringValue(legalCase.id),
  };
}

function pageMeta(raw: unknown, fallbackPage: number, fallbackLimit: number, rowCount: number): PageMeta {
  const meta = object(raw);
  const total = numberValue(first(meta, 'total', 'count')) ?? rowCount;
  const page = numberValue(meta.page) ?? fallbackPage;
  const limit = numberValue(first(meta, 'limit', 'page_size', 'pageSize')) ?? fallbackLimit;
  const totalPages = numberValue(first(meta, 'total_pages', 'totalPages'))
    ?? Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return { total, page, limit, totalPages };
}

function apiFilterValue(key: string, value: string): string {
  const clean = value.trim();
  if (key !== 'date_from' && key !== 'date_to') return clean;
  // datetime-local deliberately has no zone. Resolve it in the operator's
  // browser and send an unambiguous UTC instant to the API.
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? clean : date.toISOString();
}

function queryString(filters: FilterState, page?: number, limit?: number): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    const clean = apiFilterValue(key, value);
    if (!clean) return;
    params.set(key, clean);
  });
  if (page !== undefined) params.set('page', String(page));
  if (limit !== undefined) params.set('limit', String(limit));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function validateSessionExport(filters: FilterState): SessionExportValidation | null {
  if (!filters.date_from.trim() || !filters.date_to.trim()) return 'datesRequired';
  const from = new Date(filters.date_from).getTime();
  const to = new Date(filters.date_to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'invalidDates';
  if (to < from) return 'dateOrder';
  if (to - from > MAX_SESSION_EXPORT_WINDOW_MS) return 'windowTooLong';
  return null;
}

function validateAttributionLookup(values: FilterState): AttributionValidation | null {
  const caseId = Number(values.gov_data_request_id);
  if (!Number.isSafeInteger(caseId) || caseId <= 0) return 'caseRequired';
  const octets = values.public_ipv4.trim().split('.');
  if (
    octets.length !== 4
    || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
  ) return 'ipv4Invalid';
  if (values.attribution_mode !== 'direct') {
    const port = Number(values.public_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'portInvalid';
    if (!['tcp', 'udp'].includes(values.protocol)) return 'protocolRequired';
  }
  if (!values.observed_at.trim() || !Number.isFinite(new Date(values.observed_at).getTime())) return 'timestampRequired';
  return null;
}

function numericFilter(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function sessionApiQuery(filters: FilterState, page: number, limit: number): SessionApiQuery {
  const query: SessionApiQuery = { page, limit };
  const clientId = numericFilter(filters.client_id);
  const contractId = numericFilter(filters.contract_id);
  if (clientId !== undefined) query.client_id = clientId;
  if (contractId !== undefined) query.contract_id = contractId;
  if (filters.username.trim()) query.username = filters.username.trim();
  if (filters.ip_address.trim()) query.ip_address = filters.ip_address.trim();
  if (filters.nas.trim()) query.nas = filters.nas.trim();
  if (filters.session_id.trim()) query.session_id = filters.session_id.trim();
  if (filters.mac.trim()) query.mac = filters.mac.trim();
  if (['active', 'interim', 'ended'].includes(filters.state)) {
    query.state = filters.state as NonNullable<SessionApiQuery['state']>;
  }
  if (filters.date_from.trim()) query.date_from = apiFilterValue('date_from', filters.date_from);
  if (filters.date_to.trim()) query.date_to = apiFilterValue('date_to', filters.date_to);
  return query;
}

async function fetchSessions(
  filters: FilterState,
  page: number,
  limit: number,
): Promise<PageResult<SessionRow>> {
  const { data, error } = await api.GET('/connection-logs', {
    params: { query: sessionApiQuery(filters, page, limit) },
  });
  if (error || !data) throw new Error('Unable to load subscriber sessions');
  const rows = data.data ?? [];
  return {
    data: rows.map(normalizeSession),
    meta: pageMeta(data.meta, page, limit, rows.length),
  };
}

class AttributionLookupError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

class AttributionExportError extends Error {
  constructor(public readonly code: AttributionExportFailure) {
    super(code);
  }
}

function attributionRequestPayload(values: FilterState): JsonRecord {
  return {
    gov_data_request_id: Number(values.gov_data_request_id),
    public_ipv4: values.public_ipv4.trim(),
    observed_at: new Date(values.observed_at).toISOString(),
    ...(values.attribution_mode === 'direct' ? {} : {
      public_port: Number(values.public_port),
      protocol: values.protocol,
    }),
  };
}

async function lookupAttribution(values: FilterState): Promise<AttributionResult> {
  const response = await authedFetch('/api/v1/connection-logs/ip-attribution/lookup', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(attributionRequestPayload(values)),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A proxy HTML error is deliberately collapsed to a localized generic
    // error; raw server text must not leak into this restricted workflow.
  }
  if (!response.ok) {
    const error = object(body);
    const nestedError = object(error.error);
    const serverCode = stringValue(first(error, 'code', 'error_code'))
      ?? stringValue(nestedError.code)
      ?? `HTTP_${response.status}`;
    const serverMessage = (stringValue(nestedError.message) ?? '').toLowerCase();
    let safeCode = serverCode;
    if (response.status === 429) safeCode = 'HTTP_429';
    else if (serverCode === 'NOT_FOUND') safeCode = 'CASE_NOT_FOUND';
    else if (serverCode === 'FORBIDDEN' && serverMessage.includes('tuple and exact time')) safeCode = 'CASE_SCOPE_MISMATCH';
    else if (serverCode === 'FORBIDDEN' && serverMessage.includes('approved processing')) safeCode = 'CASE_NOT_PROCESSING';
    else if (serverCode === 'FORBIDDEN') safeCode = 'HTTP_403';
    throw new AttributionLookupError(
      safeCode,
    );
  }
  return normalizeAttributionResult(body);
}

function safeAttributionFilename(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition?.match(/filename="([^"]+)"/i)?.[1];
  let candidate = fallback;
  try {
    candidate = encoded ? decodeURIComponent(encoded) : quoted || fallback;
  } catch {
    candidate = fallback;
  }
  const safe = candidate.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.toLowerCase().endsWith('.csv') ? safe : fallback;
}

async function downloadAttributionCsv(values: FilterState): Promise<string | null> {
  const response = await authedFetch('/api/v1/connection-logs/ip-attribution/export', {
    method: 'POST',
    headers: { Accept: 'text/csv', 'Content-Type': 'application/json' },
    body: JSON.stringify(attributionRequestPayload(values)),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const caseId = Number(values.gov_data_request_id);
  const fallback = `ip-attribution-case-${caseId}.csv`;
  const filename = safeAttributionFilename(response.headers.get('Content-Disposition'), fallback);
  const checksumHeader = response.headers.get('X-Evidence-SHA256');
  if (!checksumHeader || !/^[a-f0-9]{64}$/i.test(checksumHeader)) {
    throw new AttributionExportError('checksumInvalid');
  }
  const checksum = checksumHeader.toLowerCase();
  const blob = await response.blob();
  if (!globalThis.crypto?.subtle || typeof blob.arrayBuffer !== 'function') {
    throw new AttributionExportError('verificationUnavailable');
  }
  let actualChecksum: string;
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    actualChecksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new AttributionExportError('verificationUnavailable');
  }
  if (actualChecksum !== checksum) throw new AttributionExportError('checksumMismatch');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return checksum;
}

function normalizeLogger(raw: unknown): LoggerReadiness {
  const logger = object(raw);
  const clock = object(first(logger, 'clock', 'clock_sync', 'time_sync'));
  const loss = object(first(logger, 'loss', 'delivery', 'sequence_health'));
  const configured = booleanValue(first(logger, 'configured', 'enabled'));
  const explicitReady = booleanValue(logger.ready);
  const healthy = booleanValue(logger.healthy);
  const receiving = booleanValue(logger.receiving);
  const rawStatus = (stringValue(logger.status) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const notConfiguredStatuses = ['not_configured', 'disabled', 'unconfigured'];
  const attentionStatuses = [
    'waiting', 'waiting_for_traffic', 'stale', 'degraded', 'attention',
    'incomplete', 'configuration_incomplete', 'partial', 'unhealthy',
  ];
  const readyStatuses = ['ready', 'healthy', 'receiving', 'active'];
  let status: LoggerReadiness['status'] = 'unknown';
  // Fail closed on explicit negative health. A collector may still be receiving
  // records while lifecycle completeness, coverage, or another health check is
  // failing; receiving alone must never turn that state green.
  if (configured === false || notConfiguredStatuses.includes(rawStatus)) status = 'notConfigured';
  else if (explicitReady === false || healthy === false || attentionStatuses.includes(rawStatus)) status = 'waiting';
  else if (explicitReady === true || healthy === true || readyStatuses.includes(rawStatus) || receiving === true) status = 'ready';
  else if (configured === true || receiving === false) status = 'waiting';

  const exporters = first(logger, 'exporters', 'sources', 'collectors');
  return {
    ready: status === 'ready',
    status,
    lastReceivedAt: stringValue(first(logger, 'last_received_at', 'last_event_at', 'latest_event_at', 'last_ingested_at')),
    records24h: numberValue(first(
      logger,
      'records_24h', 'records_last_24h', 'lifecycle_evidence_24h', 'events_24h', 'bindings_24h', 'count_24h',
    )),
    source: stringValue(first(logger, 'source', 'mode', 'collector', 'source_type')),
    coveredSources: numberValue(first(logger, 'complete_exporters', 'active_exporters', 'covered_sources', 'covered_nas'))
      ?? (Array.isArray(exporters) ? exporters.length : null),
    totalSources: numberValue(first(logger, 'expected_exporters', 'exporter_count', 'configured_exporters', 'total_sources')),
    coverageStatus: stringValue(first(logger, 'coverage_status', 'coverage')),
    clockStatus: stringValue(first(logger, 'clock_status', 'clock_sync_status', 'time_sync_status'))
      ?? stringValue(first(clock, 'status', 'state')),
    maxClockOffsetMs: numberValue(first(logger, 'max_clock_offset_ms', 'clock_offset_ms'))
      ?? numberValue(first(clock, 'max_offset_ms', 'offset_ms')),
    lossStatus: stringValue(first(logger, 'loss_status', 'delivery_status', 'sequence_status'))
      ?? stringValue(first(loss, 'status', 'state')),
    sequenceGaps24h: numberValue(first(logger, 'sequence_gap_events_24h', 'sequence_gaps_24h', 'gaps_24h'))
      ?? numberValue(first(loss, 'sequence_gaps_24h', 'gaps_24h')),
    lostRecords24h: numberValue(first(logger, 'reported_lost_records_24h', 'lost_records_24h', 'estimated_lost_24h'))
      ?? numberValue(first(loss, 'lost_records_24h', 'estimated_lost_24h')),
    incompleteMetadata24h: numberValue(first(logger, 'incomplete_metadata_24h', 'incomplete_24h')),
  };
}

function normalizeReadiness(raw: unknown): Readiness {
  const body = object(raw);
  const data = object(body.data ?? body);
  const sessions = normalizeLogger(first(data, 'session_logger', 'sessions', 'session_logging', 'accounting'));
  const attribution = normalizeLogger(first(
    data,
    'cgnat_attribution', 'cgnat_logger', 'attribution_logger', 'nat_mapping_logger',
  ));
  // The endpoint has a fixed source per logger even when it intentionally
  // omits a human-readable `source` property from the wire contract.
  sessions.source ??= 'radius';
  attribution.source ??= 'cgnat';
  const retention = object(data.retention);
  const legacyRetention = numberValue(first(data, 'retention_months', 'configured_retention_months'));
  return {
    sessions,
    attribution,
    sessionRetentionMonths: numberValue(first(data, 'session_retention_months'))
      ?? numberValue(first(retention, 'session_months', 'sessions_months'))
      ?? legacyRetention,
    attributionRetentionMonths: numberValue(first(data, 'cgnat_retention_months', 'attribution_retention_months'))
      ?? numberValue(first(retention, 'cgnat_months', 'attribution_months', 'mapping_months'))
      ?? legacyRetention,
  };
}

async function fetchReadiness(): Promise<Readiness> {
  const { data, error } = await api.GET('/connection-logs/readiness');
  if (error || !data) throw new Error('Unable to load connection-logging readiness');
  return normalizeReadiness(data);
}

function localeFor(language: string): string {
  if (language.toLowerCase().startsWith('es')) return 'es-MX';
  if (language.toLowerCase().startsWith('pt')) return 'pt-BR';
  return 'en-US';
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function formatCount(value: number | null, locale: string): string {
  return value === null ? '—' : new Intl.NumberFormat(locale).format(value);
}

function formatBytes(value: number | null, locale: string): string {
  if (value === null || value < 0) return '—';
  if (value < 1024) return `${new Intl.NumberFormat(locale).format(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let number = value / 1024;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(number)} ${units[index]}`;
}

function formatDuration(secondsValue: number | null, t: TFunction): string {
  if (secondsValue === null || secondsValue < 0) return '—';
  const seconds = Math.round(secondsValue);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (days > 0) return t('connection_logs.duration.daysHours', { days, hours });
  if (hours > 0) return t('connection_logs.duration.hoursMinutes', { hours, minutes });
  if (minutes > 0) return t('connection_logs.duration.minutesSeconds', { minutes, seconds: remainingSeconds });
  return t('connection_logs.duration.seconds', { seconds: remainingSeconds });
}

function endpoint(ip: string | null, port: number | null): string {
  if (!ip) return '—';
  if (port === null) return ip;
  return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

function portRangeEndpoint(ip: string | null, start: number | null, end: number | null): string {
  if (!ip) return '—';
  if (start === null) return ip;
  if (end === null || end === start) return endpoint(ip, start);
  const renderedIp = ip.includes(':') ? `[${ip}]` : ip;
  return `${renderedIp}:${start}–${end}`;
}

function localizedSource(source: string, t: TFunction): string {
  const normalized = source.toLowerCase();
  if (normalized.includes('radius')) return t('connection_logs.readiness.sourceRadius');
  if (normalized.includes('cgnat') || normalized.includes('nat') || normalized.includes('attribution')) {
    return t('connection_logs.readiness.sourceAttribution');
  }
  return source;
}

function localizedHealth(status: string | null, t: TFunction): string {
  if (!status) return t('connection_logs.readiness.health.unknown');
  const normalized = status.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    complete: 'complete',
    full: 'complete',
    partial: 'partial',
    incomplete: 'partial',
    configuration_incomplete: 'partial',
    waiting_for_traffic: 'partial',
    missing: 'missing',
    none: 'missing',
    not_configured: 'missing',
    synchronized: 'synchronized',
    synced: 'synchronized',
    reported: 'reported',
    healthy: 'healthy',
    ok: 'healthy',
    clear: 'healthy',
    degraded: 'degraded',
    drift: 'degraded',
    gaps: 'degraded',
    unresolved: 'degraded',
    unknown: 'unknown',
    unreported: 'unknown',
  };
  const key = aliases[normalized] ?? 'unknown';
  return t(`connection_logs.readiness.health.${key}`);
}

function localizedTerminateCause(cause: string | null, t: TFunction): string {
  if (!cause) return '—';
  const normalized = cause.trim().toLowerCase().replace(/[_\s]+/g, '-');
  const key = TERMINATE_CAUSE_KEYS[normalized];
  return key ? t(`connection_logs.terminateCauses.${key}`) : cause;
}

function Field({ id, label, value, onChange, type = 'text', required = false, min, max, step, children }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  children?: ReactNode;
}) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 4, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children ?? (
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...styles.input, background: 'var(--input-bg)', minWidth: 0 }}
        />
      )}
    </label>
  );
}

function StatusBadge({ status, t }: { status: LoggerReadiness['status'] | SessionRow['state']; t: TFunction }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    ready: { bg: '#dcfce7', fg: '#166534' },
    active: { bg: '#dcfce7', fg: '#166534' },
    interim: { bg: '#dbeafe', fg: '#1d4ed8' },
    ended: { bg: '#f3f4f6', fg: '#4b5563' },
    waiting: { bg: '#fef3c7', fg: '#92400e' },
    notConfigured: { bg: '#f3f4f6', fg: '#4b5563' },
    unknown: { bg: '#f3f4f6', fg: '#4b5563' },
  };
  const color = colors[status] ?? colors.unknown;
  const key = ['active', 'interim', 'ended'].includes(status)
    ? `connection_logs.states.${status}`
    : `connection_logs.readiness.status.${status}`;
  return (
    <span style={{ background: color.bg, color: color.fg, borderRadius: 999, padding: '2px 8px', fontSize: '0.74rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {t(key)}
    </span>
  );
}

function ReadinessCard({
  title,
  logger,
  guidance,
  locale,
  t,
  showAttributionHealth = false,
}: {
  title: string;
  logger: LoggerReadiness;
  guidance: string;
  locale: string;
  t: TFunction;
  showAttributionHealth?: boolean;
}) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{title}</h3>
        <StatusBadge status={logger.status} t={t} />
      </div>
      <dl style={{ margin: '0.75rem 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.3rem 0.75rem', fontSize: '0.78rem' }}>
        <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.lastReceived')}</dt>
        <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{formatDate(logger.lastReceivedAt, locale)}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.records24h')}</dt>
        <dd style={{ margin: 0, color: 'var(--text-secondary)', ...MONO }}>{formatCount(logger.records24h, locale)}</dd>
        {logger.source && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.source')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{localizedSource(logger.source, t)}</dd>
          </>
        )}
        {(logger.coveredSources !== null || logger.totalSources !== null) && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.coverage')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)', ...MONO }}>
              {t('connection_logs.readiness.coverageValue', {
                covered: logger.coveredSources ?? 0,
                total: logger.totalSources ?? '—',
              })}
            </dd>
          </>
        )}
        {showAttributionHealth && (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.coverageStatus')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{localizedHealth(logger.coverageStatus, t)}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.clockStatus')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {localizedHealth(logger.clockStatus, t)}
              {logger.maxClockOffsetMs !== null
                ? ` · ${t('connection_logs.readiness.clockOffset', { milliseconds: logger.maxClockOffsetMs })}`
                : ''}
            </dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.lossStatus')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{localizedHealth(logger.lossStatus, t)}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.sequenceGaps24h')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)', ...MONO }}>{formatCount(logger.sequenceGaps24h, locale)}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.lostRecords24h')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)', ...MONO }}>{formatCount(logger.lostRecords24h, locale)}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.incompleteMetadata24h')}</dt>
            <dd style={{ margin: 0, color: 'var(--text-secondary)', ...MONO }}>{formatCount(logger.incompleteMetadata24h, locale)}</dd>
          </>
        )}
      </dl>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.45, margin: 0 }}>{guidance}</p>
    </div>
  );
}

function ReadinessPanel({ readiness, error, loading, canViewAttribution, locale, t, retry }: {
  readiness?: Readiness;
  error: boolean;
  loading: boolean;
  canViewAttribution: boolean;
  locale: string;
  t: TFunction;
  retry: () => void;
}) {
  const sessionGuidance = readiness?.sessions.status === 'ready'
    ? t('connection_logs.readiness.sessionsReceiving')
    : t('connection_logs.readiness.sessionsGuidance');
  const attributionGuidance = readiness?.attribution.status === 'ready'
    ? t('connection_logs.readiness.attributionReceiving')
    : t('connection_logs.readiness.attributionGuidance');

  return (
    <section aria-labelledby="connection-readiness-title" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 id="connection-readiness-title" style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontSize: '1.05rem' }}>
          {t('connection_logs.readiness.title')}
        </h2>
      </div>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 0.75rem', fontSize: '0.83rem' }}>
        {t('connection_logs.readiness.subtitle')}
      </p>
      {loading ? <LoadingState /> : error ? (
        <ErrorState message={t('connection_logs.readiness.error')} onRetry={retry} />
      ) : readiness ? (
        <div style={GRID}>
          <ReadinessCard
            title={t('connection_logs.readiness.sessionsTitle')}
            logger={readiness.sessions}
            guidance={sessionGuidance}
            locale={locale}
            t={t}
          />
          {canViewAttribution ? (
            <ReadinessCard
              title={t('connection_logs.readiness.attributionTitle')}
              logger={readiness.attribution}
              guidance={attributionGuidance}
              locale={locale}
              t={t}
              showAttributionHealth
            />
          ) : (
            <div style={CARD}>
              <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                {t('connection_logs.readiness.attributionTitle')}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.45, margin: 0 }}>
                {t('connection_logs.readiness.attributionRestricted')}
              </p>
            </div>
          )}
          <div style={CARD}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
              {t('connection_logs.readiness.retentionTitle')}
            </h3>
            <dl style={{ margin: '0 0 8px', display: 'grid', gridTemplateColumns: '1fr max-content', gap: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
              <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.sessionRetention')}</dt>
              <dd style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 700, ...MONO }}>
                {readiness.sessionRetentionMonths === null
                  ? '—'
                  : t('connection_logs.readiness.retentionValue', { months: readiness.sessionRetentionMonths })}
              </dd>
              {canViewAttribution && (
                <>
                  <dt style={{ color: 'var(--text-muted)' }}>{t('connection_logs.readiness.attributionRetention')}</dt>
                  <dd style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 700, ...MONO }}>
                    {readiness.attributionRetentionMonths === null
                      ? '—'
                      : t('connection_logs.readiness.retentionValue', { months: readiness.attributionRetentionMonths })}
                  </dd>
                </>
              )}
            </dl>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.45, margin: 0 }}>
              {t('connection_logs.readiness.retentionGuidance')}
            </p>
            {readiness.sessionRetentionMonths !== null && readiness.sessionRetentionMonths < 24 && (
              <p
                role="alert"
                style={{
                  color: 'var(--warning, #a15c00)',
                  background: 'color-mix(in srgb, var(--warning, #a15c00) 10%, transparent)',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  lineHeight: 1.45,
                  margin: '0.65rem 0 0',
                  padding: '0.55rem 0.65rem',
                }}
              >
                {t('connection_logs.readiness.sessionRetentionBelowBaseline', {
                  months: readiness.sessionRetentionMonths,
                })}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SessionFilterPanel({
  values,
  onChange,
  onApply,
  onClear,
  t,
}: {
  values: FilterState;
  onChange: (key: string, value: string) => void;
  onApply: (event: FormEvent) => void;
  onClear: () => void;
  t: TFunction;
}) {
  const prefix = 'session-filter';
  return (
    <form onSubmit={onApply} style={{ ...CARD, marginBottom: '1rem' }} aria-label={t('connection_logs.filters.sessionsLabel')}>
      <div style={GRID}>
        <Field id={`${prefix}-from`} label={t('connection_logs.filters.dateFrom')} type="datetime-local" value={values.date_from} onChange={(v) => onChange('date_from', v)} />
        <Field id={`${prefix}-to`} label={t('connection_logs.filters.dateTo')} type="datetime-local" value={values.date_to} onChange={(v) => onChange('date_to', v)} />
        <Field id={`${prefix}-client`} label={t('connection_logs.filters.clientId')} type="number" value={values.client_id} onChange={(v) => onChange('client_id', v)} />
        <Field id={`${prefix}-contract`} label={t('connection_logs.filters.contractId')} type="number" value={values.contract_id} onChange={(v) => onChange('contract_id', v)} />
        <Field id={`${prefix}-username`} label={t('connection_logs.filters.username')} value={values.username} onChange={(v) => onChange('username', v)} />
        <Field id={`${prefix}-ip`} label={t('connection_logs.filters.assignedIp')} value={values.ip_address} onChange={(v) => onChange('ip_address', v)} />
        <Field id={`${prefix}-nas`} label={t('connection_logs.filters.nas')} value={values.nas} onChange={(v) => onChange('nas', v)} />
        <Field id={`${prefix}-session`} label={t('connection_logs.filters.sessionId')} value={values.session_id} onChange={(v) => onChange('session_id', v)} />
        <Field id={`${prefix}-mac`} label={t('connection_logs.filters.mac')} value={values.mac} onChange={(v) => onChange('mac', v)} />
        <Field id={`${prefix}-state`} label={t('connection_logs.filters.state')} value={values.state} onChange={(v) => onChange('state', v)}>
          <select id={`${prefix}-state`} value={values.state} onChange={(e) => onChange('state', e.target.value)} style={styles.filterSelect}>
            <option value="">{t('connection_logs.filters.allStates')}</option>
            <option value="active">{t('connection_logs.states.active')}</option>
            <option value="interim">{t('connection_logs.states.interim')}</option>
            <option value="ended">{t('connection_logs.states.ended')}</option>
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <button type="submit" style={styles.btnPrimary}>{t('connection_logs.filters.apply')}</button>
        <button type="button" style={styles.btnSecondary} onClick={onClear}>{t('connection_logs.filters.clear')}</button>
      </div>
    </form>
  );
}

function EntityLink({ path, children }: { path: string; children: ReactNode }) {
  return <Link to={path} style={{ color: 'var(--link)', fontWeight: 600, textDecoration: 'none' }}>{children}</Link>;
}

function SessionTable({ rows, locale, t }: { rows: SessionRow[]; locale: string; t: TFunction }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            {[
              'client', 'contract', 'username', 'ipv4', 'ipv6', 'state', 'started', 'ended', 'duration', 'nas',
              'nasIp', 'nasPort', 'mac', 'sessionId', 'download', 'upload', 'terminateCause',
            ].map((column) => <th key={column} style={styles.th}>{t(`connection_logs.columns.${column}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={styles.tr}>
              <td style={styles.td}>
                {row.clientId
                  ? <EntityLink path={`/clients/${row.clientId}`}>{row.clientName ?? `#${row.clientId}`}</EntityLink>
                  : '—'}
              </td>
              <td style={styles.td}>{row.contractId ? <EntityLink path={`/contracts/${row.contractId}`}>#{row.contractId}</EntityLink> : '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.username ?? '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.assignedIpv4 ?? '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.assignedIpv6 ?? '—'}</td>
              <td style={styles.td}><StatusBadge status={row.state} t={t} /></td>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDate(row.startedAt, locale)}</td>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDate(row.endedAt, locale)}</td>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDuration(row.durationSeconds, t)}</td>
              <td style={styles.td}>
                {row.nasId
                  ? <EntityLink path={`/nas/${row.nasId}`}>{row.nasName ?? `#${row.nasId}`}</EntityLink>
                  : row.nasName ?? '—'}
              </td>
              <td style={{ ...styles.td, ...MONO }}>{row.nasIp ?? '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.nasPort ?? '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.mac ?? '—'}</td>
              <td style={{ ...styles.td, ...MONO }}>{row.radiusSessionId ?? '—'}</td>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatBytes(row.bytesIn, locale)}</td>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatBytes(row.bytesOut, locale)}</td>
              <td style={styles.td}>{localizedTerminateCause(row.terminateCause, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttributionLookupForm({ values, loading, error, onChange, onSubmit, onClear, t }: {
  values: FilterState;
  loading: boolean;
  error: string | null;
  onChange: (key: string, value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClear: () => void;
  t: TFunction;
}) {
  return (
    <form onSubmit={onSubmit} style={{ ...CARD, marginBottom: '1rem' }} aria-label={t('connection_logs.attribution.formLabel')} noValidate>
      <div style={GRID}>
        <Field
          id="attribution-mode"
          label={t('connection_logs.attribution.mode')}
          required
          value={values.attribution_mode}
          onChange={(value) => onChange('attribution_mode', value)}
        >
          <select
            id="attribution-mode"
            required
            value={values.attribution_mode}
            onChange={(event) => onChange('attribution_mode', event.target.value)}
            style={styles.filterSelect}
          >
            <option value="cgnat">{t('connection_logs.attribution.modeCgnat')}</option>
            <option value="direct">{t('connection_logs.attribution.modeDirect')}</option>
          </select>
        </Field>
        <Field
          id="attribution-case"
          label={t('connection_logs.attribution.caseId')}
          type="number"
          min={1}
          required
          value={values.gov_data_request_id}
          onChange={(value) => onChange('gov_data_request_id', value)}
        />
        <Field
          id="attribution-public-ipv4"
          label={t('connection_logs.attribution.publicIpv4')}
          required
          value={values.public_ipv4}
          onChange={(value) => onChange('public_ipv4', value)}
        />
        {values.attribution_mode !== 'direct' && (
          <>
            <Field
              id="attribution-public-port"
              label={t('connection_logs.attribution.publicPort')}
              type="number"
              min={1}
              max={65535}
              step={1}
              required
              value={values.public_port}
              onChange={(value) => onChange('public_port', value)}
            />
            <Field
              id="attribution-protocol"
              label={t('connection_logs.attribution.protocol')}
              required
              value={values.protocol}
              onChange={(value) => onChange('protocol', value)}
            >
              <select
                id="attribution-protocol"
                required
                value={values.protocol}
                onChange={(event) => onChange('protocol', event.target.value)}
                style={styles.filterSelect}
              >
                <option value="">{t('connection_logs.attribution.selectProtocol')}</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </Field>
          </>
        )}
        <Field
          id="attribution-observed-at"
          label={t('connection_logs.attribution.exactTimestamp')}
          type="datetime-local"
          step={1}
          required
          value={values.observed_at}
          onChange={(value) => onChange('observed_at', value)}
        />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.7rem 0 0', lineHeight: 1.45 }}>
        {t('connection_logs.attribution.timezoneHelp', {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || t('connection_logs.attribution.localTimezone'),
        })}
      </p>
      {error && <p role="alert" style={styles.errorText}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <button type="submit" style={styles.btnPrimary} disabled={loading}>
          {loading ? t('connection_logs.attribution.searching') : t('connection_logs.attribution.search')}
        </button>
        <button type="button" style={styles.btnSecondary} disabled={loading} onClick={onClear}>
          {t('connection_logs.attribution.clear')}
        </button>
      </div>
    </form>
  );
}

function EvidenceItem({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt style={{ color: 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: '3px 0 0', color: 'var(--text-primary)', fontSize: '0.85rem', ...(mono ? MONO : {}) }}>{children}</dd>
    </div>
  );
}

function AttributionResultPanel({ result, locale, t }: { result: AttributionResult; locale: string; t: TFunction }) {
  const match = result.match;
  const directAssignment = match?.attributionMethod === 'direct_public_assignment'
    || match?.attributionMethod === 'direct_public';
  const colors: Record<AttributionStatus, { border: string; background: string }> = {
    unique: { border: '#16a34a', background: 'var(--success-soft, #f0fdf4)' },
    unavailable: { border: '#6b7280', background: 'var(--bg-subtle, #f9fafb)' },
    ambiguous: { border: '#d97706', background: 'var(--warning-soft, #fffbeb)' },
    incomplete: { border: '#d97706', background: 'var(--warning-soft, #fffbeb)' },
    unknown: { border: '#dc2626', background: 'var(--danger-soft, #fef2f2)' },
  };
  const color = colors[result.status];
  return (
    <section
      aria-live="polite"
      aria-labelledby="attribution-result-title"
      style={{ ...CARD, borderColor: color.border, background: color.background, marginBottom: '1rem' }}
    >
      <h3 id="attribution-result-title" style={{ color: 'var(--text-primary)', fontSize: '1rem', margin: 0 }}>
        {t(`connection_logs.attribution.results.${result.status}.title`)}
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.83rem', lineHeight: 1.5, margin: '6px 0 0' }}>
        {t(`connection_logs.attribution.results.${result.status}.help`, {
          count: result.candidateCount ?? 0,
        })}
      </p>
      {result.caseId && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '6px 0 0' }}>
          {t('connection_logs.attribution.resultCase', { id: result.caseId })}
        </p>
      )}
      {result.status === 'unique' && match && (
        <>
          <dl style={{ ...GRID, margin: '1rem 0 0' }}>
            <EvidenceItem label={t('connection_logs.attribution.evidence.subscriberAccount')}>
              {match.clientId
                ? <EntityLink path={`/clients/${match.clientId}`}>{match.clientName ? `${match.clientName} · #${match.clientId}` : `#${match.clientId}`}</EntityLink>
                : '—'}
            </EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.serviceRecord')}>
              {match.contractId ? <EntityLink path={`/contracts/${match.contractId}`}>#{match.contractId}</EntityLink> : '—'}
            </EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.accessUsername')} mono>{match.username ?? '—'}</EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.accessSession')} mono>{match.radiusSessionId ?? '—'}</EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.attributionMethod')}>
              {match.attributionMethod
                ? t(`connection_logs.attribution.methods.${match.attributionMethod}`, {
                  defaultValue: t('connection_logs.attribution.methods.unknown'),
                })
                : t('connection_logs.attribution.methods.unknown')}
            </EvidenceItem>
            <EvidenceItem label={t(directAssignment
              ? 'connection_logs.attribution.evidence.publicAssignment'
              : 'connection_logs.attribution.evidence.publicMapping')} mono>
              {directAssignment
                ? match.publicIpv4 ?? '—'
                : portRangeEndpoint(match.publicIpv4, match.publicPortStart, match.publicPortEnd)}
            </EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.allocationWindow')}>
              {t('connection_logs.attribution.evidence.windowValue', {
                from: formatDate(match.validFrom, locale),
                to: match.validTo
                  ? formatDate(match.validTo, locale)
                  : t('connection_logs.attribution.evidence.activeOpen'),
              })}
            </EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.lookupInstant')}>{formatDate(match.lookupObservedAt, locale)}</EvidenceItem>
            {!directAssignment && (
              <>
                <EvidenceItem label={t('connection_logs.attribution.evidence.privateTuple')} mono>
                  {portRangeEndpoint(match.privateIp, match.privatePortStart, match.privatePortEnd)}
                </EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.protocol')} mono>{match.protocol?.toUpperCase() ?? '—'}</EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.mappingKind')}>{match.mappingKind ?? '—'}</EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.poolRealm')} mono>
                  {[match.natPool, match.natRealm].filter(Boolean).join(' · ') || '—'}
                </EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.gateway')}>
                  {match.exporterNasId
                    ? <EntityLink path={`/nas/${match.exporterNasId}`}>{match.exporterNasName ?? `#${match.exporterNasId}`}</EntityLink>
                    : match.exporterNasName ?? '—'}
                </EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.exporter')} mono>
                  {[match.exporterId, match.exporterIp].filter(Boolean).join(' · ') || '—'}
                </EvidenceItem>
                <EvidenceItem label={t('connection_logs.attribution.evidence.deviceRecordedAt')}>{formatDate(match.deviceRecordedAt, locale)}</EvidenceItem>
              </>
            )}
            <EvidenceItem label={t('connection_logs.attribution.evidence.receivedAt')}>{formatDate(match.receivedAt, locale)}</EvidenceItem>
            <EvidenceItem label={t(directAssignment
              ? 'connection_logs.attribution.evidence.connectionLogId'
              : 'connection_logs.attribution.evidence.bindingId')} mono>{match.id}</EvidenceItem>
            <EvidenceItem label={t('connection_logs.attribution.evidence.integrityHash')} mono>{match.integrityHash ?? '—'}</EvidenceItem>
          </dl>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5, margin: '1rem 0 0', fontWeight: 600 }}>
            {t('connection_logs.attribution.notPersonProof')}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5, margin: '0.4rem 0 0' }}>
            {t('connection_logs.attribution.planScope')}
          </p>
        </>
      )}
    </section>
  );
}

async function downloadCsv(path: string, filters: FilterState, filename: string): Promise<void> {
  const response = await authedFetch(`/api/v1${path}${queryString(filters)}`, {
    headers: { Accept: 'text/csv' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ConnectionLogList() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);
  const canViewSessions = can(user, 'connection_logs.view');
  const canViewAttributionEvidence = can(user, 'ip_attribution.view');
  const canViewGovernmentRequests = can(user, 'gov_data_requests.view');
  const canUseAttribution = canViewAttributionEvidence && canViewGovernmentRequests;
  const canExportSessions = canViewSessions && can(user, 'connection_logs.export');
  const canExportAttribution = canUseAttribution
    && can(user, 'ip_attribution.export');
  const attributionInitial = attributionPrefill(location.state);
  const hasAttributionPrefill = Boolean(attributionInitial.gov_data_request_id);
  const availableTabs = useMemo<Tab[]>(() => [
    ...(canViewSessions ? ['sessions' as const] : []),
    ...(canUseAttribution ? ['attribution' as const] : []),
  ], [canUseAttribution, canViewSessions]);

  const [tab, setTab] = useState<Tab>(() => {
    if ((hasAttributionPrefill || !canViewSessions) && canUseAttribution) return 'attribution';
    return 'sessions';
  });
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionLimit, setSessionLimit] = useState(DEFAULT_PAGE_SIZE);
  const [sessionDraft, setSessionDraft] = useState<FilterState>({ ...EMPTY_SESSION_FILTERS });
  const [sessionFilters, setSessionFilters] = useState<FilterState>({ ...EMPTY_SESSION_FILTERS });
  const [attributionDraft, setAttributionDraft] = useState<FilterState>(() => ({ ...attributionInitial }));
  const [attributionResult, setAttributionResult] = useState<AttributionResult | null>(null);
  const [attributionQuery, setAttributionQuery] = useState<FilterState | null>(null);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [attributionError, setAttributionError] = useState<string | null>(null);
  const [exportingAttribution, setExportingAttribution] = useState(false);
  const [attributionExportError, setAttributionExportError] = useState<AttributionExportFailure | null>(null);
  const [attributionExportChecksum, setAttributionExportChecksum] = useState<string | null>(null);
  const [exportingSessions, setExportingSessions] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [sessionExportValidation, setSessionExportValidation] = useState<SessionExportValidation | null>(null);

  const sessionQueryKey = useMemo(() => JSON.stringify(sessionFilters), [sessionFilters]);

  const sessionsQ = useQuery({
    queryKey: ['connection-logs', 'sessions', sessionPage, sessionLimit, sessionQueryKey],
    queryFn: () => fetchSessions(sessionFilters, sessionPage, sessionLimit),
    enabled: canViewSessions,
  });
  const readinessQ = useQuery({
    queryKey: ['connection-logs', 'readiness'],
    queryFn: fetchReadiness,
    enabled: canViewSessions,
  });

  useEffect(() => {
    if (!availableTabs.includes(tab) && availableTabs[0]) setTab(availableTabs[0]);
    if (tab !== 'attribution' || !canUseAttribution) {
      setAttributionDraft({ ...EMPTY_ATTRIBUTION_LOOKUP });
      setAttributionResult(null);
      setAttributionQuery(null);
      setAttributionError(null);
      setAttributionExportError(null);
      setAttributionExportChecksum(null);
    }
  }, [availableTabs, canUseAttribution, tab]);

  function updateSessionDraft(key: string, value: string) {
    setSessionDraft((current) => ({ ...current, [key]: value }));
  }

  function applySessionFilters(event: FormEvent) {
    event.preventDefault();
    setSessionFilters({ ...sessionDraft });
    setSessionExportValidation(null);
    setSessionPage(1);
  }

  function clearSessionFilters() {
    setSessionDraft({ ...EMPTY_SESSION_FILTERS });
    setSessionFilters({ ...EMPTY_SESSION_FILTERS });
    setSessionExportValidation(null);
    setSessionPage(1);
  }

  async function exportSessions() {
    setExportError(false);
    const validation = validateSessionExport(sessionFilters);
    setSessionExportValidation(validation);
    if (validation) return;
    setExportingSessions(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadCsv('/connection-logs/export', sessionFilters, `subscriber-sessions-${date}.csv`);
    } catch {
      setExportError(true);
    } finally {
      setExportingSessions(false);
    }
  }

  function attributionServerError(error: unknown): string {
    const code = error instanceof AttributionLookupError ? error.code.toUpperCase() : '';
    if (code.includes('CASE_NOT_FOUND')) return t('connection_logs.attribution.errors.caseNotFound');
    if (code.includes('CASE_TYPE') || code.includes('WRONG_TYPE')) return t('connection_logs.attribution.errors.caseType');
    if (code.includes('CASE_STATUS') || code.includes('NOT_PROCESSING')) return t('connection_logs.attribution.errors.caseStatus');
    if (code.includes('CASE_INCOMPLETE') || code.includes('CASE_NOT_VALIDATED')) return t('connection_logs.attribution.errors.caseIncomplete');
    if (code.includes('SCOPE_MISMATCH') || code.includes('NOT_AUTHORIZED')) return t('connection_logs.attribution.errors.scopeMismatch');
    if (code.includes('PERMISSION') || code === 'HTTP_403') return t('connection_logs.attribution.errors.permission');
    if (code === 'HTTP_429') return t('connection_logs.attribution.errors.rateLimited');
    return t('connection_logs.attribution.errors.server');
  }

  async function submitAttributionLookup(event: FormEvent) {
    event.preventDefault();
    const validation = validateAttributionLookup(attributionDraft);
    if (validation) {
      setAttributionResult(null);
      setAttributionQuery(null);
      setAttributionError(t(`connection_logs.attribution.validation.${validation}`));
      setAttributionExportError(null);
      setAttributionExportChecksum(null);
      return;
    }
    setAttributionLoading(true);
    setAttributionError(null);
    setAttributionResult(null);
    setAttributionQuery(null);
    setAttributionExportError(null);
    setAttributionExportChecksum(null);
    const submitted = { ...attributionDraft };
    try {
      setAttributionResult(await lookupAttribution(submitted));
      setAttributionQuery(submitted);
    } catch (error) {
      setAttributionError(attributionServerError(error));
    } finally {
      setAttributionLoading(false);
    }
  }

  function clearAttributionLookup() {
    setAttributionDraft({ ...EMPTY_ATTRIBUTION_LOOKUP });
    setAttributionResult(null);
    setAttributionQuery(null);
    setAttributionError(null);
    setAttributionExportError(null);
    setAttributionExportChecksum(null);
  }

  async function exportAttribution() {
    if (!canExportAttribution || !attributionQuery) return;
    setExportingAttribution(true);
    setAttributionExportError(null);
    setAttributionExportChecksum(null);
    try {
      setAttributionExportChecksum(await downloadAttributionCsv(attributionQuery));
    } catch (error) {
      setAttributionExportError(error instanceof AttributionExportError ? error.code : 'error');
    } finally {
      setExportingAttribution(false);
    }
  }

  function activateTab(next: Tab) {
    if (!availableTabs.includes(next)) return;
    setTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (availableTabs.length === 0) return;
    if (event.key === 'Home') activateTab(availableTabs[0]);
    else if (event.key === 'End') activateTab(availableTabs[availableTabs.length - 1]);
    else {
      const index = Math.max(0, availableTabs.indexOf(tab));
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      activateTab(availableTabs[(index + delta + availableTabs.length) % availableTabs.length]);
    }
  }

  return (
    <div style={{ ...styles.page, maxWidth: 1600 }}>
      <header style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={styles.pageTitle}>{t('connection_logs.title')}</h1>
          {tab === 'sessions' && sessionsQ.data?.meta && (
            <span style={styles.countBadge}>{t('connection_logs.total', { count: sessionsQ.data.meta.total })}</span>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>{t('connection_logs.subtitle')}</p>
      </header>

      {canViewSessions && (
        <ReadinessPanel
          readiness={readinessQ.data}
          loading={readinessQ.isLoading}
          error={readinessQ.isError}
          canViewAttribution={canViewAttributionEvidence}
          locale={locale}
          t={t}
          retry={() => { void readinessQ.refetch(); }}
        />
      )}

      {availableTabs.length > 0 ? (
        <div role="tablist" aria-label={t('connection_logs.tabs.label')} style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        {canViewSessions && (
          <button
            type="button"
            role="tab"
            id="sessions-tab"
            aria-controls="sessions-panel"
            aria-selected={tab === 'sessions'}
            tabIndex={tab === 'sessions' ? 0 : -1}
            onClick={() => setTab('sessions')}
            onKeyDown={handleTabKeyDown}
            style={{ ...styles.btnSecondary, borderRadius: '6px 6px 0 0', borderBottomColor: tab === 'sessions' ? 'var(--accent)' : 'transparent', color: tab === 'sessions' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            {t('connection_logs.tabs.sessions')}
          </button>
        )}
        {canUseAttribution && (
          <button
            type="button"
            role="tab"
            id="attribution-tab"
            aria-controls="attribution-panel"
            aria-selected={tab === 'attribution'}
            tabIndex={tab === 'attribution' ? 0 : -1}
            onClick={() => setTab('attribution')}
            onKeyDown={handleTabKeyDown}
            style={{ ...styles.btnSecondary, borderRadius: '6px 6px 0 0', borderBottomColor: tab === 'attribution' ? 'var(--accent)' : 'transparent', color: tab === 'attribution' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            {t('connection_logs.tabs.attribution')}
          </button>
        )}
        </div>
      ) : (
        <p role="alert" style={{ ...CARD, color: 'var(--text-secondary)' }}>{t('connection_logs.accessDenied')}</p>
      )}

      {tab === 'sessions' && canViewSessions ? (
        <section id="sessions-panel" role="tabpanel" aria-labelledby="sessions-tab">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{t('connection_logs.sessions.title')}</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>{t('connection_logs.sessions.help')}</p>
            </div>
            {canExportSessions && (
              <button
                type="button"
                style={styles.btnSecondary}
                disabled={exportingSessions}
                aria-describedby={`session-export-guidance${sessionExportValidation ? ' session-export-validation' : ''}`}
                onClick={() => { void exportSessions(); }}
              >
                {exportingSessions ? t('connection_logs.export.preparing') : t('connection_logs.export.sessions')}
              </button>
            )}
          </div>
          {canExportSessions && (
            <p id="session-export-guidance" style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>
              {t('connection_logs.export.sessionGuidance')}
            </p>
          )}
          {sessionExportValidation && (
            <p id="session-export-validation" role="alert" style={styles.errorText}>
              {t(`connection_logs.export.${sessionExportValidation}`)}
            </p>
          )}
          {exportError && <p role="alert" style={styles.errorText}>{t('connection_logs.export.error')}</p>}
          <SessionFilterPanel
            values={sessionDraft}
            onChange={updateSessionDraft}
            onApply={applySessionFilters}
            onClear={clearSessionFilters}
            t={t}
          />
          <div style={styles.tableCard}>
            {sessionsQ.isLoading ? <LoadingState /> : sessionsQ.isError ? (
              <ErrorState message={t('connection_logs.sessions.error')} onRetry={() => { void sessionsQ.refetch(); }} />
            ) : sessionsQ.data && sessionsQ.data.data.length > 0 ? (
              <>
                <SessionTable rows={sessionsQ.data.data} locale={locale} t={t} />
                <Pagination
                  page={sessionPage}
                  totalPages={sessionsQ.data.meta.totalPages}
                  total={sessionsQ.data.meta.total}
                  pageSize={sessionLimit}
                  onPageChange={setSessionPage}
                  onPageSizeChange={(size) => { setSessionLimit(size); setSessionPage(1); }}
                />
              </>
            ) : <EmptyState message={t('connection_logs.sessions.empty')} />}
          </div>
        </section>
      ) : canUseAttribution ? (
        <section id="attribution-panel" role="tabpanel" aria-labelledby="attribution-tab">
          <div style={{ marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{t('connection_logs.attribution.title')}</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.5 }}>{t('connection_logs.attribution.help')}</p>
          </div>
          <aside style={{ ...CARD, borderColor: '#f59e0b', background: 'var(--warning-soft, #fffbeb)', marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{t('connection_logs.attribution.restrictedTitle')}</strong>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45, margin: '4px 0 0' }}>{t('connection_logs.attribution.restrictedHelp')}</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45, margin: '6px 0 0' }}>
              {t('connection_logs.attribution.caseHelp')}{' '}
              <Link to="/regulatory-compliance" style={{ color: 'var(--link)', fontWeight: 600 }}>
                {t('connection_logs.attribution.manageCases')}
              </Link>
            </p>
          </aside>
          <AttributionLookupForm
            values={attributionDraft}
            loading={attributionLoading}
            error={attributionError}
            onChange={(key, value) => {
              setAttributionDraft((current) => ({ ...current, [key]: value }));
              setAttributionResult(null);
              setAttributionQuery(null);
              setAttributionError(null);
              setAttributionExportError(null);
              setAttributionExportChecksum(null);
            }}
            onSubmit={submitAttributionLookup}
            onClear={clearAttributionLookup}
            t={t}
          />
          {attributionResult && (
            <>
              <AttributionResultPanel result={attributionResult} locale={locale} t={t} />
              {canExportAttribution && attributionQuery && (
                <div style={{ ...CARD, marginBottom: '1rem' }}>
                  <button
                    type="button"
                    style={styles.btnSecondary}
                    disabled={exportingAttribution}
                    onClick={() => { void exportAttribution(); }}
                  >
                    {exportingAttribution
                      ? t('connection_logs.attribution.export.preparing')
                      : t('connection_logs.attribution.export.download')}
                  </button>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.55rem 0 0', lineHeight: 1.45 }}>
                    {t('connection_logs.attribution.export.help')}
                  </p>
                  {attributionExportError && (
                    <p role="alert" style={styles.errorText}>
                      {t(`connection_logs.attribution.export.${attributionExportError}`)}
                    </p>
                  )}
                  {attributionExportChecksum && (
                    <p role="status" style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: '0.55rem 0 0', ...MONO }}>
                      {t('connection_logs.attribution.export.checksum', { checksum: attributionExportChecksum })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
