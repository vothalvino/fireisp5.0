// =============================================================================
// FireISP 5.0 — Mexico SNII infrastructure reporting preparation
// =============================================================================
// This is deliberately a preparation/evidence workflow. Generating an artifact
// never means it was submitted to, or accepted by, the CRT.
// =============================================================================

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authedFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { Badge, Button, Card, Field, Modal, Table } from '@/components/ui';

type Tab = 'readiness' | 'inventory' | 'packages' | 'evidence';

interface ElementType {
  key: string;
  slug?: string;
  label?: string;
  official_name?: string;
  filename: string;
  official_template_filename?: string;
  preparation_filename?: string;
  format: 'csv' | 'kml' | string;
  generated_format?: 'csv' | 'kml' | string;
  geometry?: 'point' | 'line' | 'area' | string;
  frequency?: 'annual' | 'semiannual' | 'voluntary' | string;
  periodicity?: 'annual' | 'semiannual' | 'voluntary' | string;
  fields?: Array<{ key: string; required?: boolean; label?: string }>;
  headers?: string[];
  wire_headers?: string[];
  required_headers?: string[];
  supported?: boolean;
}

interface Catalog {
  module_mode: string;
  legal_basis?: string;
  authority?: string;
  template_contract?: { version?: string; source_url?: string; reviewed_at?: string };
  element_types: ElementType[] | Record<string, ElementType>;
  source_types?: string[];
  decisions?: string[];
  exclusion_reasons?: string[];
  applicability_states?: string[];
  batch_states?: string[];
  filing_event_types?: string[];
  export_formats?: string[];
}

interface Profile {
  id: number;
  concession_title_id?: number | null;
  concession_title_snapshot?: ConcessionTitleSnapshot | null;
  concession_title_sha256?: string | null;
  electronic_folio: string;
  source_channel: 'crt_ventanilla_current' | string;
  source_attestation_reference: string;
  template_version: string;
  template_source_url: string;
  template_sha256: string;
  template_effective_date?: string | null;
  dictionary_version: string;
  dictionary_source_url: string;
  dictionary_sha256: string;
  annex_v_version: string;
  annex_v_source_url: string;
  annex_v_sha256: string;
  official_sources_reviewed_at: string;
  adapter_reconciliation_reference?: string | null;
  adapter_reconciliation_sha256?: string | null;
  adapter_reconciled_at?: string | null;
  subject_applicability?: 'unreviewed' | 'applicable' | 'not_applicable' | string;
  applicability_basis?: string | null;
  external_decision_reference?: string | null;
  source_freshness_days?: number | null;
  updated_at?: string | null;
}

interface ConcessionTitleSnapshot {
  id: number;
  title_number: string;
  concession_type: string;
  services_authorized: unknown[];
  geographic_scope?: string | null;
  spectrum_bands?: unknown[] | null;
  granted_date?: string | null;
  expiration_date?: string | null;
  renewal_filed_at?: string | null;
  regulatory_body?: string | null;
  document_file_id?: number | null;
  status?: string | null;
}

interface ApplicabilitySnapshot {
  subject?: {
    status?: string;
    basis?: string | null;
    external_decision_reference?: string | null;
    decided_by?: number | null;
    decided_at?: string | null;
  };
  elements?: Array<{
    element_type: string;
    applicability: string;
    rationale?: string | null;
    population_status?: string | null;
    population_evidence_reference?: string | null;
    reviewed_by?: number | null;
    reviewed_at?: string | null;
  }>;
}

interface Applicability {
  element_type: string;
  status?: 'applicable' | 'not_applicable' | 'unreviewed' | string;
  applicability?: 'applicable' | 'not_applicable' | 'unreviewed' | string;
  rationale?: string | null;
  population_status?: 'unreviewed' | 'has_assets' | 'zero_population' | string;
  population_evidence_reference?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
}

interface Readiness {
  ready: boolean;
  blockers?: Array<string | { code?: string; message?: string; count?: number }>;
  counts?: Record<string, number>;
  schedule?: {
    folio_last_digit?: number | string;
    first_window?: ScheduleWindow | string | null;
    second_window?: ScheduleWindow | string | null;
    next_window?: ScheduleWindow | string | null;
  };
}

interface ScheduleWindow {
  year?: number;
  start_month?: number;
  end_month?: number;
  reference_range?: string;
}

interface ProfileEnvelope {
  data: Profile | null;
  applicability?: Applicability[];
  readiness?: Readiness;
}

interface Candidate {
  source_type: string;
  source_id: number | string;
  suggested_element_type?: string | null;
  source_hash: string;
  registry_id?: number | null;
  decision?: string | null;
  approval_status?: string | null;
  eligibility?: boolean | string;
  blockers?: string[];
  payload?: Record<string, unknown>;
}

const MANUAL_CANDIDATE: Candidate = {
  source_type: 'manual',
  source_id: 'manual',
  suggested_element_type: null,
  source_hash: '',
  decision: 'unreviewed',
  eligibility: 'manual_review',
};

interface Asset {
  id: number;
  profile_id: number;
  source_type: string;
  source_id?: number | null;
  element_type: string;
  decision: string;
  exclusion_reason?: string | null;
  official_code?: string | null;
  ownership?: string | null;
  owner_name?: string | null;
  field_overrides?: Record<string, unknown> | string | null;
  source_hash?: string | null;
  source_snapshot_hash?: string | null;
  classification_hash?: string | null;
  classification_revision?: number | null;
  current_source_hash?: string | null;
  approval_status?: 'pending' | 'approved' | 'rejected' | string;
  classified_by?: number | null;
  approved_by?: number | null;
  is_stale?: boolean | number | null;
  decision_evidence_reference?: string | null;
  manual_payload?: Record<string, unknown> | string | null;
  reviewed_payload?: Record<string, unknown> | string | null;
  current_reviewed_payload?: Record<string, unknown> | string | null;
  reviewed_at?: string | null;
  approved_at?: string | null;
}

interface Artifact {
  id: number;
  element_type: string;
  filename?: string;
  file_name?: string;
  mime_type?: string;
  byte_size?: number;
  sha256?: string;
  content_sha256?: string;
  created_at?: string;
}

interface FilingEvent {
  id: number;
  event_type: string;
  occurred_at: string;
  authority_reference?: string;
  attempt_no?: number;
  occurred_timezone?: string;
  evidence_upload_id?: number;
  evidence_file_name?: string;
  evidence_mime_type?: string;
  evidence_byte_size?: number;
  evidence_sha256?: string;
  notes?: string;
  created_at?: string;
}

interface Batch {
  id: number;
  profile_id: number;
  revision?: number;
  revision_no?: number;
  period_start: string;
  period_end: string;
  state?: string;
  status?: string;
  snapshot_hash?: string | null;
  validation_result?: { valid?: boolean; errors?: Array<Record<string, unknown>> } | null;
  concession_title_id?: number | null;
  concession_title_snapshot?: ConcessionTitleSnapshot | null;
  concession_title_sha256?: string | null;
  applicability_snapshot?: ApplicabilitySnapshot | null;
  electronic_folio?: string;
  filing_year?: number;
  filing_frequency?: string;
  full_load?: boolean | number;
  template_version?: string;
  template_sha256?: string;
  dictionary_version?: string;
  dictionary_sha256?: string;
  annex_v_version?: string;
  annex_v_sha256?: string;
  source_attestation_reference?: string;
  official_sources_reviewed_by?: number;
  official_sources_reviewed_at?: string;
  source_freshness_days?: number;
  adapter_reconciliation_sha256?: string;
  item_count?: number;
  created_at?: string;
  approved_at?: string | null;
  artifacts?: Artifact[];
  filing_events?: FilingEvent[];
  items?: unknown[];
  element_types_snapshot?: string[];
  filing_kind?: 'initial' | 'update' | 'voluntary' | string;
  filing_window?: 'initial' | 'first_semiannual' | 'second_combined' | 'anytime' | string;
  supersedes_batch_id?: number | null;
  correction_root_batch_id?: number | null;
  supersession_reason?: string | null;
}

interface AuditEvent {
  id: number;
  action: string;
  entity_type?: string;
  entity_id?: number;
  outcome?: string;
  actor_user_id?: number;
  occurred_at?: string;
  created_at?: string;
}

const pageStyle: CSSProperties = {
  padding: 'var(--sp-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
  color: 'var(--text-primary)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-2) var(--sp-3)',
  border: '1px solid var(--input-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--input-bg)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.85rem',
  boxSizing: 'border-box',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 'var(--sp-3)',
};

function unwrapRows<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data as T[];
  if (record.data && typeof record.data === 'object') {
    const nested = record.data as Record<string, unknown>;
    for (const key of ['items', 'rows', 'assets', 'candidates', 'batches', 'events']) {
      if (Array.isArray(nested[key])) return nested[key] as T[];
    }
  }
  for (const key of ['items', 'rows', 'assets', 'candidates', 'batches', 'events']) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await authedFetch(`/api/v1/snii-reporting${path}`, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => null) as {
    error?: { message?: string; details?: Array<{ field?: string; message?: string; code?: string; element_type?: string; asset_id?: number }> };
  } | null;
  if (!response.ok) {
    const details = body?.error?.details
      ?.map(detail => {
        if (detail.field || detail.message) return [detail.field, detail.message].filter(Boolean).join(': ');
        const label = detail.code ? detail.code.replace(/_/g, ' ') : 'blocked';
        const context = [detail.element_type && `object ${detail.element_type}`,
          detail.asset_id && `asset #${detail.asset_id}`].filter(Boolean).join(', ');
        return context ? `${label} (${context})` : label;
      })
      .filter(Boolean)
      .join(', ');
    throw new Error(details || body?.error?.message || `HTTP ${response.status}`);
  }
  return body as T;
}

function elementList(catalog?: Catalog): ElementType[] {
  if (!catalog?.element_types) return [];
  const values = Array.isArray(catalog.element_types)
    ? catalog.element_types
    : Object.entries(catalog.element_types).map(([key, value]) => ({ ...value, key }));
  return values.map((value) => {
    const key = value.key || value.slug || '';
    return {
      ...value,
      key,
      filename: value.filename || value.preparation_filename || value.official_template_filename || key,
      format: value.format || value.generated_format || 'csv',
      frequency: value.frequency || value.periodicity,
      headers: value.headers || value.wire_headers,
      fields: value.fields || value.wire_headers?.map(header => ({
        key: header,
        required: value.required_headers?.includes(header) ?? false,
      })),
    };
  });
}

function toneFor(value: string | boolean | null | undefined) {
  if (value === true || ['ready', 'accepted', 'approved', 'validated', 'included', 'applicable', 'success'].includes(String(value))) return 'success' as const;
  if (['rejected', 'failed', 'blocked', 'stale', 'correction_required', 'superseded'].includes(String(value))) return 'danger' as const;
  if (['unreviewed', 'draft', 'exported', 'filed', 'warning'].includes(String(value))) return 'warning' as const;
  return 'neutral' as const;
}

function normalizedError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function localDateTimeToIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoInstantToLocalDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  const milliseconds = String(parsed.getMilliseconds()).padStart(3, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}.${milliseconds}`;
}

function formatValidationDetail(detail: Record<string, unknown>): string {
  const message = typeof detail.message === 'string' ? detail.message : '';
  if (message) return message;
  const code = typeof detail.code === 'string' ? detail.code.replace(/_/g, ' ') : 'validation error';
  const context = [
    typeof detail.element_type === 'string' ? `object ${detail.element_type}` : '',
    typeof detail.official_code === 'string' ? `identifier ${detail.official_code}` : '',
    typeof detail.item_id === 'number' ? `item #${detail.item_id}` : '',
  ].filter(Boolean).join(', ');
  return context ? `${code} (${context})` : code;
}

function formatFilingOccurrence(value: string, timeZone?: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const zone = timeZone || 'UTC';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'shortOffset',
    }).formatToParts(parsed).filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
      + ` ${parts.timeZoneName} (${zone})`;
  } catch (_error) {
    return `${parsed.toISOString()} (UTC)`;
  }
}

function localDateTimeWithOffset(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const offsetMinutes = -parsed.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  const local = value.length === 16 ? `${value}:00` : value;
  return `${local}${sign}${hours}:${minutes}`;
}

function scheduleWindowLabel(value: ScheduleWindow | string | null | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (value.reference_range) return value.reference_range;
  const months = value.start_month && value.end_month
    ? `${value.start_month}–${value.end_month}` : null;
  return [value.year, months].filter(Boolean).join(' / ') || '—';
}

async function sha256Hex(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function SniiInfrastructureReportingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('readiness');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetEditor, setAssetEditor] = useState<Candidate | Asset | null>(null);
  const [assetApproval, setAssetApproval] = useState<Asset | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  const isMx = user?.organization_locale === 'MX';
  const mayView = can(user, 'snii_reporting.view');
  const mayReview = can(user, 'snii_reporting.review');
  const mayPrepare = can(user, 'snii_reporting.prepare');
  const mayApprove = can(user, 'snii_reporting.approve');
  const mayExport = can(user, 'snii_reporting.export');
  const mayFile = can(user, 'snii_reporting.file');
  const mayViewEvidence = can(user, 'snii_reporting.evidence');

  const catalogQ = useQuery({
    queryKey: ['snii', 'catalog'],
    queryFn: async () => {
      const response = await requestJson<{ data: Catalog }>('/catalog');
      return response.data;
    },
    enabled: mayView && isMx,
  });
  const profileQ = useQuery({
    queryKey: ['snii', 'profile'],
    queryFn: () => requestJson<ProfileEnvelope>('/profile'),
    enabled: mayView && isMx,
  });
  const candidatesQ = useQuery({
    queryKey: ['snii', 'candidates'],
    queryFn: async () => unwrapRows<Candidate>(await requestJson<unknown>('/candidates?limit=250&offset=0')),
    enabled: mayView && isMx && tab === 'inventory',
  });
  const assetsQ = useQuery({
    queryKey: ['snii', 'assets'],
    queryFn: async () => unwrapRows<Asset>(await requestJson<unknown>('/assets?limit=250&offset=0')),
    enabled: mayView && isMx && tab === 'inventory',
  });
  const batchesQ = useQuery({
    queryKey: ['snii', 'batches'],
    queryFn: async () => unwrapRows<Batch>(await requestJson<unknown>('/batches')),
    enabled: mayView && isMx && (tab === 'packages' || tab === 'evidence'),
  });
  const auditQ = useQuery({
    queryKey: ['snii', 'audit'],
    queryFn: async () => unwrapRows<AuditEvent>(await requestJson<unknown>('/audit-events?limit=100&offset=0')),
    enabled: mayView && isMx && tab === 'evidence',
  });
  const batchQ = useQuery({
    queryKey: ['snii', 'batch', selectedBatchId],
    queryFn: async () => {
      const response = await requestJson<{ data: Batch }>(`/batches/${selectedBatchId}`);
      return response.data;
    },
    enabled: mayView && isMx && selectedBatchId !== null,
  });

  const elements = useMemo(() => elementList(catalogQ.data), [catalogQ.data]);
  const elementByKey = useMemo(
    () => new Map(elements.map(element => [element.key, element])),
    [elements],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['snii', 'profile'] }),
      queryClient.invalidateQueries({ queryKey: ['snii', 'candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['snii', 'assets'] }),
      queryClient.invalidateQueries({ queryKey: ['snii', 'batches'] }),
      queryClient.invalidateQueries({ queryKey: ['snii', 'batch'] }),
      queryClient.invalidateQueries({ queryKey: ['snii', 'audit'] }),
    ]);
  };

  const runMutation = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: string; body?: unknown }) => requestJson<unknown>(path, {
      method,
      body: body === undefined
        ? undefined
        : body instanceof FormData ? body : JSON.stringify(body),
    }),
    onSuccess: async () => {
      setError(null);
      setNotice(t('sniiReporting.saved'));
      await refresh();
    },
    onError: mutationError => {
      setNotice(null);
      setError(normalizedError(mutationError, t('sniiReporting.errors.action')));
    },
  });

  const loadAssetDetail = async (asset: Asset, purpose: 'edit' | 'approve') => {
    setError(null);
    setAssetDetailLoading(true);
    try {
      const response = await requestJson<{ data: Asset }>(`/assets/${asset.id}`);
      if (purpose === 'edit') setAssetEditor(response.data);
      else setAssetApproval(response.data);
    } catch (detailError) {
      setError(normalizedError(detailError, t('sniiReporting.errors.assetDetail')));
    } finally {
      setAssetDetailLoading(false);
    }
  };

  const downloadArtifact = async (artifact: Artifact) => {
    setNotice(null);
    setError(null);
    try {
      const response = await authedFetch(`/api/v1/snii-reporting/artifacts/${artifact.id}/download`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }
      const expected = response.headers.get('x-evidence-sha256')?.toLowerCase();
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(t('sniiReporting.errors.checksumMissing'));
      const blob = await response.blob();
      const actual = await sha256Hex(blob);
      if (actual !== expected) throw new Error(t('sniiReporting.errors.checksumMismatch'));
      const disposition = response.headers.get('content-disposition') ?? '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : quoted || artifact.filename || artifact.file_name || 'snii-artifact';
      downloadBlob(blob, filename.replace(/[\\/\r\n]/g, '_'));
      setNotice(t('sniiReporting.downloadVerified', { hash: actual }));
      await refresh();
    } catch (downloadError) {
      setError(normalizedError(downloadError, t('sniiReporting.errors.download')));
    }
  };

  const downloadFilingEvidence = async (filingEvent: FilingEvent) => {
    setNotice(null);
    setError(null);
    try {
      const response = await authedFetch(`/api/v1/snii-reporting/filing-events/${filingEvent.id}/evidence/download`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }
      const expected = response.headers.get('x-evidence-sha256')?.toLowerCase();
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(t('sniiReporting.errors.checksumMissing'));
      const blob = await response.blob();
      const actual = await sha256Hex(blob);
      if (actual !== expected || (filingEvent.evidence_sha256 && actual !== filingEvent.evidence_sha256.toLowerCase())) {
        throw new Error(t('sniiReporting.errors.checksumMismatch'));
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : quoted || filingEvent.evidence_file_name || 'snii-filing-evidence';
      downloadBlob(blob, filename.replace(/[\\/\r\n]/g, '_'));
      setNotice(t('sniiReporting.downloadVerified', { hash: actual }));
      await refresh();
    } catch (downloadError) {
      setError(normalizedError(downloadError, t('sniiReporting.errors.evidenceDownload')));
    }
  };

  if (!isMx || !mayView) {
    return (
      <div style={pageStyle}>
        <h1>{t('sniiReporting.title')}</h1>
        <Card><p>{t(isMx ? 'sniiReporting.noAccess' : 'sniiReporting.mxOnly')}</p></Card>
      </div>
    );
  }

  const profileEnvelope = profileQ.data;
  const readiness = profileEnvelope?.readiness;
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'readiness', label: t('sniiReporting.tabs.readiness') },
    { key: 'inventory', label: t('sniiReporting.tabs.inventory') },
    { key: 'packages', label: t('sniiReporting.tabs.packages') },
    { key: 'evidence', label: t('sniiReporting.tabs.evidence') },
  ];

  return (
    <div style={pageStyle}>
      <header>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{t('sniiReporting.title')}</h1>
          <Badge tone="warning">{t('sniiReporting.preparationOnly')}</Badge>
          <Badge tone={readiness?.ready ? 'success' : 'warning'}>
            {readiness?.ready ? t('sniiReporting.ready') : t('sniiReporting.notReady')}
          </Badge>
        </div>
        <p style={{ color: 'var(--text-muted)', maxWidth: 900 }}>
          {t('sniiReporting.subtitle')}
        </p>
      </header>

      <div role="tablist" aria-label={t('sniiReporting.title')} style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {tabs.map(item => (
          <Button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            variant={tab === item.key ? 'primary' : 'secondary'}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {notice && <div role="status" style={{ color: 'var(--success)' }}>{notice}</div>}
      {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
      {(catalogQ.isLoading || profileQ.isLoading) && <p>{t('common.loading')}</p>}
      {(catalogQ.error || profileQ.error) && (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          {normalizedError(catalogQ.error || profileQ.error, t('common.loadError'))}
        </div>
      )}

      {tab === 'readiness' && (
        <ReadinessTab
          profile={profileEnvelope?.data ?? null}
          applicability={profileEnvelope?.applicability ?? []}
          readiness={readiness}
          elements={elements}
          mayPrepare={mayPrepare}
          mayReview={mayReview}
          busy={runMutation.isPending}
          onSaveProfile={body => runMutation.mutate({ path: '/profile', method: 'PUT', body })}
          onSubjectApplicability={body => runMutation.mutate({ path: '/profile/subject-applicability', method: 'PUT', body })}
          onApplicability={(elementType, body) => runMutation.mutate({ path: `/profile/applicability/${encodeURIComponent(elementType)}`, method: 'PUT', body })}
        />
      )}

      {tab === 'inventory' && (
        <InventoryTab
          candidates={candidatesQ.data ?? []}
          assets={assetsQ.data ?? []}
          loading={candidatesQ.isLoading || assetsQ.isLoading}
          mayReview={mayReview}
          mayApprove={mayApprove}
          elementByKey={elementByKey}
          busy={assetDetailLoading || runMutation.isPending}
          onEdit={value => {
            if ('id' in value) void loadAssetDetail(value, 'edit');
            else setAssetEditor(value);
          }}
          onAddManual={() => setAssetEditor(MANUAL_CANDIDATE)}
          onApprove={asset => void loadAssetDetail(asset, 'approve')}
        />
      )}

      {tab === 'packages' && (
        <PackagesTab
          profile={profileEnvelope?.data ?? null}
          batches={batchesQ.data ?? []}
          selected={batchQ.data ?? null}
          selectedId={selectedBatchId}
          elements={elements}
          loading={batchesQ.isLoading || batchQ.isLoading}
          mayPrepare={mayPrepare}
          mayApprove={mayApprove}
          mayExport={mayExport}
          mayFile={mayFile}
          mayViewEvidence={mayViewEvidence}
          busy={runMutation.isPending}
          onSelect={setSelectedBatchId}
          onAction={(path, method, body) => runMutation.mutate({ path, method, body })}
          onDownload={downloadArtifact}
          onEvidenceDownload={downloadFilingEvidence}
        />
      )}

      {tab === 'evidence' && (
        <EvidenceTab events={auditQ.data ?? []} loading={auditQ.isLoading} />
      )}

      <AssetEditor
        open={assetEditor !== null}
        candidateOrAsset={assetEditor}
        profileId={profileEnvelope?.data?.id ?? null}
        elements={elements}
        exclusionReasons={catalogQ.data?.exclusion_reasons ?? []}
        busy={runMutation.isPending}
        onClose={() => setAssetEditor(null)}
        onSubmit={(editingId, body) => {
          runMutation.mutate({
            path: editingId ? `/assets/${editingId}` : '/assets',
            method: editingId ? 'PATCH' : 'POST',
            body,
          }, { onSuccess: () => setAssetEditor(null) });
        }}
      />

      <AssetApprovalModal
        asset={assetApproval}
        busy={runMutation.isPending}
        onClose={() => setAssetApproval(null)}
        onApprove={asset => {
          runMutation.mutate({
            path: `/assets/${asset.id}/approve`,
            method: 'POST',
            body: {
              expected_source_snapshot_hash: asset.source_snapshot_hash,
              expected_classification_hash: asset.classification_hash,
            },
          }, { onSuccess: () => setAssetApproval(null) });
        }}
      />
    </div>
  );
}

function ReadinessTab({
  profile,
  applicability,
  readiness,
  elements,
  mayPrepare,
  mayReview,
  busy,
  onSaveProfile,
  onSubjectApplicability,
  onApplicability,
}: {
  profile: Profile | null;
  applicability: Applicability[];
  readiness?: Readiness;
  elements: ElementType[];
  mayPrepare: boolean;
  mayReview: boolean;
  busy: boolean;
  onSaveProfile: (body: Record<string, unknown>) => void;
  onSubjectApplicability: (body: Record<string, unknown>) => void;
  onApplicability: (elementType: string, body: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    concession_title_id: '',
    electronic_folio: '',
    source_channel: 'crt_ventanilla_current',
    source_attestation_reference: '',
    adapter_reconciliation_reference: '',
    adapter_reconciliation_sha256: '',
    adapter_reconciled_at: '',
    template_version: '',
    template_source_url: '',
    template_sha256: '',
    template_effective_date: '',
    dictionary_version: '',
    dictionary_source_url: '',
    dictionary_sha256: '',
    annex_v_version: '',
    annex_v_source_url: '',
    annex_v_sha256: '',
    official_sources_reviewed_at: '',
    subject_applicability: 'unreviewed',
    applicability_basis: '',
    external_decision_reference: '',
    source_freshness_days: '90',
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      concession_title_id: profile.concession_title_id ? String(profile.concession_title_id) : '',
      electronic_folio: profile.electronic_folio ?? '',
      source_channel: profile.source_channel ?? 'crt_ventanilla_current',
      source_attestation_reference: profile.source_attestation_reference ?? '',
      adapter_reconciliation_reference: profile.adapter_reconciliation_reference ?? '',
      adapter_reconciliation_sha256: profile.adapter_reconciliation_sha256 ?? '',
      adapter_reconciled_at: isoInstantToLocalDateTime(profile.adapter_reconciled_at),
      template_version: profile.template_version ?? '',
      template_source_url: profile.template_source_url ?? '',
      template_sha256: profile.template_sha256 ?? '',
      template_effective_date: profile.template_effective_date?.slice(0, 10) ?? '',
      dictionary_version: profile.dictionary_version ?? '',
      dictionary_source_url: profile.dictionary_source_url ?? '',
      dictionary_sha256: profile.dictionary_sha256 ?? '',
      annex_v_version: profile.annex_v_version ?? '',
      annex_v_source_url: profile.annex_v_source_url ?? '',
      annex_v_sha256: profile.annex_v_sha256 ?? '',
      official_sources_reviewed_at: isoInstantToLocalDateTime(profile.official_sources_reviewed_at),
      subject_applicability: profile.subject_applicability ?? 'unreviewed',
      applicability_basis: profile.applicability_basis ?? '',
      external_decision_reference: profile.external_decision_reference ?? '',
      source_freshness_days: String(profile.source_freshness_days ?? 90),
    });
  }, [profile]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSaveProfile({
      concession_title_id: form.concession_title_id ? Number(form.concession_title_id) : null,
      electronic_folio: form.electronic_folio.trim(),
      source_channel: 'crt_ventanilla_current',
      source_attestation_reference: form.source_attestation_reference.trim(),
      adapter_reconciliation_reference: form.adapter_reconciliation_reference.trim(),
      adapter_reconciliation_sha256: form.adapter_reconciliation_sha256.trim().toLowerCase(),
      adapter_reconciled_at: localDateTimeToIso(form.adapter_reconciled_at),
      template_version: form.template_version.trim(),
      template_source_url: form.template_source_url.trim(),
      template_sha256: form.template_sha256.trim().toLowerCase(),
      template_effective_date: form.template_effective_date || null,
      dictionary_version: form.dictionary_version.trim(),
      dictionary_source_url: form.dictionary_source_url.trim(),
      dictionary_sha256: form.dictionary_sha256.trim().toLowerCase(),
      annex_v_version: form.annex_v_version.trim(),
      annex_v_source_url: form.annex_v_source_url.trim(),
      annex_v_sha256: form.annex_v_sha256.trim().toLowerCase(),
      official_sources_reviewed_at: localDateTimeToIso(form.official_sources_reviewed_at),
      source_freshness_days: Number(form.source_freshness_days),
    });
  };

  const blockers = readiness?.blockers ?? [];
  return (
    <>
      <div style={gridStyle}>
        <Card title={t('sniiReporting.readiness.title')}>
          <p><Badge tone={readiness?.ready ? 'success' : 'warning'}>{readiness?.ready ? t('sniiReporting.ready') : t('sniiReporting.notReady')}</Badge></p>
          {blockers.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('sniiReporting.readiness.noBlockers')}</p>
          ) : (
            <ul>
              {blockers.map((blocker, index) => (
                <li key={index}>{typeof blocker === 'string' ? blocker : blocker.message || blocker.code || JSON.stringify(blocker)}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('sniiReporting.readiness.schedule')}>
          <dl>
            <dt>{t('sniiReporting.profile.electronicFolio')}</dt>
            <dd>{profile?.electronic_folio || '—'}</dd>
            <dt>{t('sniiReporting.readiness.firstWindow')}</dt>
            <dd>{scheduleWindowLabel(readiness?.schedule?.first_window)}</dd>
            <dt>{t('sniiReporting.readiness.secondWindow')}</dt>
            <dd>{scheduleWindowLabel(readiness?.schedule?.second_window)}</dd>
          </dl>
        </Card>
        <Card title={t('sniiReporting.readiness.counts')}>
          {Object.entries(readiness?.counts ?? {}).length === 0 ? <p>—</p> : (
            <dl>{Object.entries(readiness?.counts ?? {}).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{value}</dd></div>)}</dl>
          )}
        </Card>
      </div>

      <Card title={t('sniiReporting.profile.title')}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div style={gridStyle}>
            <Field label={t('sniiReporting.profile.concessionTitleId')} type="number" value={form.concession_title_id} onChange={event => setForm(current => ({ ...current, concession_title_id: event.target.value }))} disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.electronicFolio')} value={form.electronic_folio} onChange={event => setForm(current => ({ ...current, electronic_folio: event.target.value }))} required disabled={!mayPrepare || busy} hint={t('sniiReporting.profile.folioHint')} />
            <label>{t('sniiReporting.profile.sourceChannel')}<select style={inputStyle} value={form.source_channel} disabled><option value="crt_ventanilla_current">{t('sniiReporting.profile.currentVentanilla')}</option></select></label>
            <Field label={t('sniiReporting.profile.sourceAttestationReference')} value={form.source_attestation_reference} onChange={event => setForm(current => ({ ...current, source_attestation_reference: event.target.value }))} required disabled={!mayPrepare || busy} hint={t('sniiReporting.profile.sourceAttestationHint')} />
            <Field label={t('sniiReporting.profile.adapterReconciliationReference')} value={form.adapter_reconciliation_reference} onChange={event => setForm(current => ({ ...current, adapter_reconciliation_reference: event.target.value }))} required disabled={!mayPrepare || busy} hint={t('sniiReporting.profile.adapterReconciliationHint')} />
            <Field label={t('sniiReporting.profile.adapterReconciliationSha256')} value={form.adapter_reconciliation_sha256} onChange={event => setForm(current => ({ ...current, adapter_reconciliation_sha256: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.adapterReconciledAt')} type="datetime-local" step="0.001" value={form.adapter_reconciled_at} onChange={event => setForm(current => ({ ...current, adapter_reconciled_at: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.templateVersion')} value={form.template_version} onChange={event => setForm(current => ({ ...current, template_version: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.effectiveDate')} type="date" value={form.template_effective_date} onChange={event => setForm(current => ({ ...current, template_effective_date: event.target.value }))} disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.templateSourceUrl')} type="url" value={form.template_source_url} onChange={event => setForm(current => ({ ...current, template_source_url: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.templateSha256')} value={form.template_sha256} onChange={event => setForm(current => ({ ...current, template_sha256: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.dictionaryVersion')} value={form.dictionary_version} onChange={event => setForm(current => ({ ...current, dictionary_version: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.dictionarySourceUrl')} type="url" value={form.dictionary_source_url} onChange={event => setForm(current => ({ ...current, dictionary_source_url: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.dictionarySha256')} value={form.dictionary_sha256} onChange={event => setForm(current => ({ ...current, dictionary_sha256: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.annexVersion')} value={form.annex_v_version} onChange={event => setForm(current => ({ ...current, annex_v_version: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.annexSourceUrl')} type="url" value={form.annex_v_source_url} onChange={event => setForm(current => ({ ...current, annex_v_source_url: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.annexSha256')} value={form.annex_v_sha256} onChange={event => setForm(current => ({ ...current, annex_v_sha256: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.sourcesReviewedAt')} type="datetime-local" step="0.001" value={form.official_sources_reviewed_at} onChange={event => setForm(current => ({ ...current, official_sources_reviewed_at: event.target.value }))} required disabled={!mayPrepare || busy} />
            <Field label={t('sniiReporting.profile.freshnessDays')} type="number" value={form.source_freshness_days} onChange={event => setForm(current => ({ ...current, source_freshness_days: event.target.value }))} required disabled={!mayPrepare || busy} />
          </div>
          {mayPrepare && <Button type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>}
        </form>
        <hr style={{ border: 0, borderTop: '1px solid var(--border-subtle)', margin: 'var(--sp-4) 0' }} />
        {profile?.concession_title_snapshot && (
          <section aria-label={t('sniiReporting.profile.titleReviewContext')}>
            <h3>{t('sniiReporting.profile.titleReviewContext')}</h3>
            <dl style={gridStyle}>
              <div><dt>{t('sniiReporting.profile.titleNumber')}</dt><dd>{profile.concession_title_snapshot.title_number}</dd></div>
              <div><dt>{t('sniiReporting.profile.titleType')}</dt><dd>{profile.concession_title_snapshot.concession_type}</dd></div>
              <div><dt>{t('sniiReporting.columns.status')}</dt><dd>{profile.concession_title_snapshot.status || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.regulator')}</dt><dd>{profile.concession_title_snapshot.regulatory_body || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.authorizedServices')}</dt><dd>{profile.concession_title_snapshot.services_authorized?.join(', ') || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.geographicScope')}</dt><dd>{profile.concession_title_snapshot.geographic_scope || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.grantedDate')}</dt><dd>{profile.concession_title_snapshot.granted_date || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.expirationDate')}</dt><dd>{profile.concession_title_snapshot.expiration_date || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.renewalFiledAt')}</dt><dd>{profile.concession_title_snapshot.renewal_filed_at || '—'}</dd></div>
              <div><dt>{t('sniiReporting.profile.documentReference')}</dt><dd>{profile.concession_title_snapshot.document_file_id ? `#${profile.concession_title_snapshot.document_file_id}` : '—'}</dd></div>
              <div style={{ gridColumn: '1 / -1' }}><dt>SHA-256</dt><dd><code style={{ wordBreak: 'break-all' }}>{profile.concession_title_sha256 || '—'}</code></dd></div>
            </dl>
          </section>
        )}
        <div style={gridStyle}>
          <label>{t('sniiReporting.profile.subjectApplicability')}<select style={inputStyle} value={form.subject_applicability} onChange={event => setForm(current => ({ ...current, subject_applicability: event.target.value }))} disabled={!mayReview || busy}><option value="unreviewed">{t('sniiReporting.status.unreviewed')}</option><option value="applicable">{t('sniiReporting.status.applicable')}</option><option value="not_applicable">{t('sniiReporting.status.notApplicable')}</option></select></label>
          <Field label={t('sniiReporting.profile.applicabilityBasis')} value={form.applicability_basis} onChange={event => setForm(current => ({ ...current, applicability_basis: event.target.value }))} required={form.subject_applicability !== 'unreviewed'} disabled={!mayReview || busy} />
          <Field label={t('sniiReporting.profile.externalDecisionReference')} value={form.external_decision_reference} onChange={event => setForm(current => ({ ...current, external_decision_reference: event.target.value }))} required={form.subject_applicability !== 'unreviewed'} disabled={!mayReview || busy} />
        </div>
        {mayReview && <Button type="button" disabled={busy} onClick={() => onSubjectApplicability({
          status: form.subject_applicability,
          applicability_basis: form.applicability_basis.trim() || null,
          external_decision_reference: form.external_decision_reference.trim() || null,
        })}>{t('sniiReporting.profile.saveApplicability')}</Button>}
      </Card>

      <Card title={t('sniiReporting.applicability.title')} padding={false}>
        <Table
          columns={[
            { key: 'type', header: t('sniiReporting.columns.objectType') },
            { key: 'frequency', header: t('sniiReporting.columns.frequency') },
            { key: 'status', header: t('sniiReporting.columns.status') },
            { key: 'population', header: t('sniiReporting.columns.population') },
            { key: 'rationale', header: t('sniiReporting.columns.rationale') },
            { key: 'actions', header: t('common.actions') },
          ]}
          rows={elements.map(element => {
            const row = applicability.find(entry => entry.element_type === element.key);
            const status = row?.status || row?.applicability || 'unreviewed';
            return {
              type: element.label || element.official_name || element.key,
              frequency: element.frequency || '—',
              status: <Badge tone={toneFor(status)}>{status}</Badge>,
              population: row?.population_status || 'unreviewed',
              rationale: row?.rationale || '—',
              actions: mayReview ? (
                <ApplicabilityEditor
                  status={status}
                  rationale={row?.rationale || ''}
                  populationStatus={row?.population_status || 'unreviewed'}
                  populationEvidence={row?.population_evidence_reference || ''}
                  disabled={busy}
                  onSave={(nextStatus, rationale, populationStatus, populationEvidence) => onApplicability(element.key, {
                    status: nextStatus,
                    rationale,
                    population_status: nextStatus === 'applicable' ? populationStatus : 'unreviewed',
                    population_evidence_reference: nextStatus === 'applicable' && populationStatus === 'zero_population' ? populationEvidence : null,
                  })}
                />
              ) : null,
            };
          })}
          empty={t('sniiReporting.applicability.empty')}
        />
      </Card>
    </>
  );
}

function ApplicabilityEditor({ status, rationale, populationStatus, populationEvidence, disabled, onSave }: { status: string; rationale: string; populationStatus: string; populationEvidence: string; disabled: boolean; onSave: (status: string, rationale: string, populationStatus: string, populationEvidence: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(status);
  const [reason, setReason] = useState(rationale);
  const [population, setPopulation] = useState(populationStatus === 'unreviewed' ? 'has_assets' : populationStatus);
  const [populationReference, setPopulationReference] = useState(populationEvidence);
  useEffect(() => {
    setValue(status);
    setReason(rationale);
    setPopulation(populationStatus === 'unreviewed' ? 'has_assets' : populationStatus);
    setPopulationReference(populationEvidence);
  }, [populationEvidence, populationStatus, rationale, status]);
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', minWidth: 420 }}>
      <select aria-label={t('sniiReporting.columns.status')} style={{ ...inputStyle, width: 145 }} value={value} onChange={event => setValue(event.target.value)} disabled={disabled}>
        <option value="unreviewed">{t('sniiReporting.status.unreviewed')}</option>
        <option value="applicable">{t('sniiReporting.status.applicable')}</option>
        <option value="not_applicable">{t('sniiReporting.status.notApplicable')}</option>
      </select>
      {value === 'applicable' && <select aria-label={t('sniiReporting.columns.population')} style={{ ...inputStyle, width: 170 }} value={population} onChange={event => setPopulation(event.target.value)} disabled={disabled}><option value="has_assets">{t('sniiReporting.applicability.hasAssets')}</option><option value="zero_population">{t('sniiReporting.applicability.zeroPopulation')}</option></select>}
      {value === 'applicable' && population === 'zero_population' && <input aria-label={t('sniiReporting.applicability.populationEvidence')} style={inputStyle} value={populationReference} onChange={event => setPopulationReference(event.target.value)} disabled={disabled} />}
      <input aria-label={t('sniiReporting.columns.rationale')} style={inputStyle} value={reason} onChange={event => setReason(event.target.value)} disabled={disabled} />
      <Button size="sm" variant="secondary" type="button" disabled={disabled} onClick={() => onSave(value, reason.trim(), population, populationReference.trim())}>{t('common.save')}</Button>
    </div>
  );
}

function InventoryTab({ candidates, assets, loading, busy, mayReview, mayApprove, elementByKey, onEdit, onAddManual, onApprove }: { candidates: Candidate[]; assets: Asset[]; loading: boolean; busy: boolean; mayReview: boolean; mayApprove: boolean; elementByKey: Map<string, ElementType>; onEdit: (value: Candidate | Asset) => void; onAddManual: () => void; onApprove: (asset: Asset) => void }) {
  const { t } = useTranslation();
  if (loading) return <p>{t('common.loading')}</p>;
  return (
    <>
      <Card title={t('sniiReporting.inventory.warning')}>
        <p>{t('sniiReporting.inventory.boundary')}</p>
        {mayReview && <Button type="button" variant="secondary" onClick={onAddManual}>{t('sniiReporting.inventory.addManual')}</Button>}
      </Card>
      <Card title={t('sniiReporting.inventory.candidates')} padding={false}>
        <Table
          columns={[
            { key: 'source', header: t('sniiReporting.columns.source') },
            { key: 'suggestion', header: t('sniiReporting.columns.suggestion') },
            { key: 'eligibility', header: t('sniiReporting.columns.eligibility') },
            { key: 'decision', header: t('sniiReporting.columns.decision') },
            { key: 'approval', header: t('sniiReporting.columns.approval') },
            { key: 'actions', header: t('common.actions') },
          ]}
          rows={candidates.map(candidate => ({
            source: `${candidate.source_type} #${candidate.source_id}`,
            suggestion: candidate.suggested_element_type ? (elementByKey.get(candidate.suggested_element_type)?.label || candidate.suggested_element_type) : '—',
            eligibility: <span>{String(candidate.eligibility ?? 'unreviewed')}{candidate.blockers?.length ? ` — ${candidate.blockers.join(', ')}` : ''}</span>,
            decision: <Badge tone={toneFor(candidate.decision)}>{candidate.decision || 'unreviewed'}</Badge>,
            approval: candidate.registry_id ? <Badge tone={toneFor(candidate.approval_status)}>{candidate.approval_status || t('sniiReporting.status.pending')}</Badge> : '—',
            actions: mayReview && !candidate.registry_id ? <Button size="sm" onClick={() => onEdit(candidate)}>{t('sniiReporting.inventory.review')}</Button> : null,
          }))}
          empty={t('sniiReporting.inventory.noCandidates')}
        />
      </Card>
      <Card title={t('sniiReporting.inventory.registry')} padding={false}>
        <Table
          columns={[
            { key: 'source', header: t('sniiReporting.columns.source') },
            { key: 'type', header: t('sniiReporting.columns.objectType') },
            { key: 'decision', header: t('sniiReporting.columns.decision') },
            { key: 'approval', header: t('sniiReporting.columns.approval') },
            { key: 'code', header: t('sniiReporting.columns.officialCode') },
            { key: 'stale', header: t('sniiReporting.columns.sourceState') },
            { key: 'actions', header: t('common.actions') },
          ]}
          rows={assets.map(asset => ({
            source: `${asset.source_type}${asset.source_id ? ` #${asset.source_id}` : ''}`,
            type: elementByKey.get(asset.element_type)?.label || asset.element_type,
            decision: <Badge tone={toneFor(asset.decision)}>{asset.decision}</Badge>,
            approval: <Badge tone={toneFor(asset.approval_status)}>{asset.approval_status || 'pending'}</Badge>,
            code: asset.official_code || '—',
            stale: asset.is_stale === true || asset.is_stale === 1
              ? <Badge tone="danger">{t('sniiReporting.status.stale')}</Badge>
              : asset.is_stale === false || asset.is_stale === 0
                ? <Badge tone="success">{t('sniiReporting.status.current')}</Badge>
                : <Badge tone="warning">{t('sniiReporting.status.unknown')}</Badge>,
            actions: <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              {mayReview && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onEdit(asset)}>{t('common.edit')}</Button>}
              {mayApprove && asset.decision !== 'unreviewed' && asset.approval_status !== 'approved' && <Button size="sm" disabled={busy} onClick={() => onApprove(asset)}>{t('sniiReporting.inventory.reviewApproval')}</Button>}
            </div>,
          }))}
          empty={t('sniiReporting.inventory.noAssets')}
        />
      </Card>
    </>
  );
}

function AssetEditor({ open, candidateOrAsset, profileId, elements, exclusionReasons, busy, onClose, onSubmit }: { open: boolean; candidateOrAsset: Candidate | Asset | null; profileId: number | null; elements: ElementType[]; exclusionReasons: string[]; busy: boolean; onClose: () => void; onSubmit: (editingId: number | null, body: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const editing = candidateOrAsset && 'id' in candidateOrAsset ? candidateOrAsset as Asset : null;
  const candidate = candidateOrAsset && !('id' in candidateOrAsset) ? candidateOrAsset as Candidate : null;
  const manual = candidate?.source_type === 'manual' || editing?.source_type === 'manual';
  const [form, setForm] = useState({ element_type: '', decision: 'unreviewed', exclusion_reason: '', decision_evidence_reference: '', official_code: '', ownership: 'owned', owner_name: '', fields: '{}' });

  useEffect(() => {
    if (!candidateOrAsset) return;
    const rawFields = manual
      ? editing?.manual_payload ?? editing?.reviewed_payload
      : editing?.field_overrides;
    setForm({
      element_type: editing?.element_type || candidate?.suggested_element_type || elements[0]?.key || '',
      decision: editing?.decision || candidate?.decision || 'unreviewed',
      exclusion_reason: editing?.exclusion_reason || '',
      decision_evidence_reference: editing?.decision_evidence_reference || '',
      official_code: editing?.official_code || '',
      ownership: editing?.ownership || 'owned',
      owner_name: editing?.owner_name || '',
      fields: typeof rawFields === 'string' ? rawFields : JSON.stringify(rawFields || {}, null, 2),
    });
  }, [candidateOrAsset, candidate, editing, elements, manual]);

  const submit = () => {
    let fieldOverrides: Record<string, unknown>;
    try {
      fieldOverrides = JSON.parse(form.fields) as Record<string, unknown>;
    } catch {
      return;
    }
    const body: Record<string, unknown> = {
      element_type: form.element_type,
      decision: form.decision,
      exclusion_reason: form.decision === 'excluded' ? form.exclusion_reason.trim() : null,
      decision_evidence_reference: form.decision === 'unreviewed' ? null : form.decision_evidence_reference.trim(),
      official_code: form.official_code.trim() || null,
      ownership: form.ownership,
      owner_name: form.owner_name.trim() || null,
      field_overrides: fieldOverrides,
    };
    if (manual) body.manual_payload = fieldOverrides;
    if (!editing) {
      body.profile_id = profileId;
      body.source_type = manual ? 'manual' : candidate?.source_type;
      body.source_id = manual ? null : candidate?.source_id;
    }
    onSubmit(editing?.id ?? null, body);
  };

  return (
    <Modal
      open={open}
      title={t('sniiReporting.inventory.reviewTitle')}
      onClose={onClose}
      style={{ width: 760 }}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy || !profileId} onClick={submit}>{t('common.save')}</Button></>}
    >
      <p>{t('sniiReporting.inventory.reviewHelp')}</p>
      {manual && <p style={{ color: 'var(--text-muted)' }}>{t('sniiReporting.inventory.manualHelp')}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <label>{t('sniiReporting.columns.objectType')}<select style={inputStyle} value={form.element_type} onChange={event => setForm(current => ({ ...current, element_type: event.target.value }))}>{elements.map(element => <option key={element.key} value={element.key}>{element.label || element.official_name || element.key}</option>)}</select></label>
        <label>{t('sniiReporting.columns.decision')}<select style={inputStyle} value={form.decision} onChange={event => setForm(current => ({ ...current, decision: event.target.value }))}><option value="unreviewed">{t('sniiReporting.status.unreviewed')}</option><option value="included">{t('sniiReporting.status.included')}</option><option value="excluded">{t('sniiReporting.status.excluded')}</option></select></label>
        {form.decision === 'excluded' && <label>{t('sniiReporting.inventory.exclusionReason')}<select required style={inputStyle} value={form.exclusion_reason} onChange={event => setForm(current => ({ ...current, exclusion_reason: event.target.value }))}><option value="">{t('sniiReporting.inventory.chooseExclusionReason')}</option>{exclusionReasons.map(reason => <option key={reason} value={reason}>{t(`sniiReporting.exclusionReasons.${reason}`, { defaultValue: reason.replace(/_/g, ' ') })}</option>)}</select></label>}
        {form.decision !== 'unreviewed' && <Field label={t('sniiReporting.inventory.decisionEvidence')} value={form.decision_evidence_reference} onChange={event => setForm(current => ({ ...current, decision_evidence_reference: event.target.value }))} required hint={t('sniiReporting.inventory.decisionEvidenceHint')} />}
        <div style={gridStyle}>
          <Field label={t('sniiReporting.columns.officialCode')} value={form.official_code} onChange={event => setForm(current => ({ ...current, official_code: event.target.value }))} />
          <label>{t('sniiReporting.inventory.ownership')}<select style={inputStyle} value={form.ownership} onChange={event => setForm(current => ({ ...current, ownership: event.target.value }))}><option value="owned">{t('sniiReporting.inventory.owned')}</option><option value="leased">{t('sniiReporting.inventory.leased')}</option><option value="third_party">{t('sniiReporting.inventory.thirdParty')}</option></select></label>
          <Field label={t('sniiReporting.inventory.ownerName')} value={form.owner_name} onChange={event => setForm(current => ({ ...current, owner_name: event.target.value }))} />
        </div>
        <label>{t('sniiReporting.inventory.officialFields')}<textarea rows={12} spellCheck={false} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} value={form.fields} onChange={event => setForm(current => ({ ...current, fields: event.target.value }))} /></label>
      </div>
    </Modal>
  );
}

function AssetApprovalModal({ asset, busy, onClose, onApprove }: { asset: Asset | null; busy: boolean; onClose: () => void; onApprove: (asset: Asset) => void }) {
  const { t } = useTranslation();
  const payload = asset?.current_reviewed_payload ?? asset?.reviewed_payload ?? null;
  const canApprove = Boolean(
    asset
    && asset.decision !== 'unreviewed'
    && asset.source_snapshot_hash
    && asset.classification_hash
    && (asset.is_stale === false || asset.is_stale === 0),
  );
  return (
    <Modal
      open={asset !== null}
      title={t('sniiReporting.inventory.approvalTitle')}
      onClose={onClose}
      style={{ width: 760 }}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy || !canApprove} onClick={() => asset && onApprove(asset)}>{t('sniiReporting.inventory.approveClassification')}</Button></>}
    >
      {asset && <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <p>{t('sniiReporting.inventory.approvalHelp')}</p>
        {asset.is_stale !== false && asset.is_stale !== 0 && <div role="alert" style={{ color: 'var(--danger)' }}>{t('sniiReporting.inventory.approvalStale')}</div>}
        <dl>
          <dt>{t('sniiReporting.columns.decision')}</dt><dd>{asset.decision}</dd>
          {asset.decision === 'excluded' && <>
            <dt>{t('sniiReporting.inventory.exclusionReason')}</dt>
            <dd>
              <code>{asset.exclusion_reason || '—'}</code>
              {asset.exclusion_reason && ` — ${t(`sniiReporting.exclusionReasons.${asset.exclusion_reason}`, { defaultValue: asset.exclusion_reason.replace(/_/g, ' ') })}`}
            </dd>
          </>}
          <dt>{t('sniiReporting.columns.objectType')}</dt><dd>{asset.element_type}</dd>
          <dt>{t('sniiReporting.inventory.decisionEvidence')}</dt><dd>{asset.decision_evidence_reference || '—'}</dd>
          <dt>{t('sniiReporting.inventory.classifiedBy')}</dt><dd>{asset.classified_by || '—'}</dd>
          <dt>{t('sniiReporting.inventory.sourceHash')}</dt><dd><code style={{ wordBreak: 'break-all' }}>{asset.source_snapshot_hash || '—'}</code></dd>
          <dt>{t('sniiReporting.inventory.classificationHash')}</dt><dd><code style={{ wordBreak: 'break-all' }}>{asset.classification_hash || '—'}</code></dd>
        </dl>
        <label>{t('sniiReporting.inventory.reviewedPayload')}<textarea readOnly rows={14} spellCheck={false} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} value={payload ? JSON.stringify(payload, null, 2) : ''} /></label>
      </div>}
    </Modal>
  );
}

function PackagesTab({ profile, batches, selected, selectedId, elements, loading, mayPrepare, mayApprove, mayExport, mayFile, mayViewEvidence, busy, onSelect, onAction, onDownload, onEvidenceDownload }: { profile: Profile | null; batches: Batch[]; selected: Batch | null; selectedId: number | null; elements: ElementType[]; loading: boolean; mayPrepare: boolean; mayApprove: boolean; mayExport: boolean; mayFile: boolean; mayViewEvidence: boolean; busy: boolean; onSelect: (id: number | null) => void; onAction: (path: string, method: string, body?: unknown) => void; onDownload: (artifact: Artifact) => void; onEvidenceDownload: (event: FilingEvent) => void }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState({ start: '', end: '', filing_kind: 'update', filing_window: 'second_combined', supersedes_batch_id: '', supersession_reason: '' });
  const [artifactType, setArtifactType] = useState('');
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [filing, setFiling] = useState({
    event_type: 'submitted',
    attempt_no: '1',
    occurred_at: '',
    occurred_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    authority_reference: '',
    notes: '',
  });

  const selectedElements = useMemo(() => {
    const selectedElementKeys = selected?.element_types_snapshot ?? [];
    return elements.filter(element => selectedElementKeys.includes(element.key));
  }, [elements, selected?.element_types_snapshot]);

  useEffect(() => {
    if (!selectedElements.some(element => element.key === artifactType)) {
      setArtifactType(selectedElements[0]?.key ?? '');
    }
  }, [artifactType, selectedElements]);

  useEffect(() => {
    setApprovalConfirmed(false);
  }, [selected?.id, selected?.snapshot_hash]);

  const replacementPredecessor = batches.find(batch =>
    String(batch.id) === period.supersedes_batch_id);
  const internalReplacement = replacementPredecessor
    && ['draft', 'validated'].includes(replacementPredecessor.state || replacementPredecessor.status || '');

  if (loading && batches.length === 0) return <p>{t('common.loading')}</p>;
  return (
    <>
      <Card title={t('sniiReporting.packages.truthBoundary')}>
        <p>{t('sniiReporting.packages.truthHelp')}</p>
      </Card>
      {mayPrepare && (
        <Card title={t('sniiReporting.packages.create')}>
          <form onSubmit={event => {
            event.preventDefault();
            if (!profile) return;
            const filingFrequency = period.filing_kind === 'initial'
              ? 'initial'
              : period.filing_kind === 'voluntary'
                ? 'voluntary'
                : period.filing_window === 'first_semiannual' ? 'semiannual' : 'annual_and_semiannual';
            onAction('/batches', 'POST', {
              profile_id: profile.id,
              period_start: period.start,
              period_end: period.end,
              filing_kind: period.filing_kind,
              filing_window: period.filing_window,
              filing_year: Number(period.start.slice(0, 4)),
              filing_frequency: filingFrequency,
              supersedes_batch_id: period.supersedes_batch_id ? Number(period.supersedes_batch_id) : null,
              supersession_reason: period.supersedes_batch_id
                ? period.supersession_reason.trim() || null : null,
            });
          }} style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end' }}>
            <Field label={t('sniiReporting.packages.periodStart')} type="date" value={period.start} onChange={event => setPeriod(current => ({ ...current, start: event.target.value }))} required disabled={busy} />
            <Field label={t('sniiReporting.packages.periodEnd')} type="date" value={period.end} onChange={event => setPeriod(current => ({ ...current, end: event.target.value }))} required disabled={busy} />
            <label>{t('sniiReporting.packages.filingKind')}<select style={inputStyle} value={period.filing_kind} onChange={event => setPeriod(current => ({ ...current, filing_kind: event.target.value, filing_window: event.target.value === 'initial' ? 'initial' : event.target.value === 'voluntary' ? 'anytime' : 'second_combined', supersedes_batch_id: event.target.value === 'voluntary' ? '' : current.supersedes_batch_id, supersession_reason: event.target.value === 'voluntary' ? '' : current.supersession_reason }))} disabled={busy}><option value="initial">{t('sniiReporting.packages.initial')}</option><option value="update">{t('sniiReporting.packages.update')}</option><option value="voluntary">{t('sniiReporting.packages.voluntary')}</option></select></label>
            <label>{t('sniiReporting.packages.filingWindow')}<select style={inputStyle} value={period.filing_window} onChange={event => setPeriod(current => ({ ...current, filing_window: event.target.value }))} disabled={busy || period.filing_kind !== 'update'}><option value="initial">{t('sniiReporting.packages.initialWindow')}</option><option value="first_semiannual">{t('sniiReporting.packages.firstWindow')}</option><option value="second_combined">{t('sniiReporting.packages.secondWindow')}</option><option value="anytime">{t('sniiReporting.packages.anytimeWindow')}</option></select></label>
            <label>{t('sniiReporting.packages.supersedesBatchId')}<select style={inputStyle} value={period.supersedes_batch_id} onChange={event => setPeriod(current => ({ ...current, supersedes_batch_id: event.target.value, supersession_reason: '' }))} disabled={busy}><option value="">{t('sniiReporting.packages.noPredecessor')}</option>{batches.filter(batch => ['draft', 'validated', 'correction_required'].includes(batch.state || batch.status || '')).map(batch => <option key={batch.id} value={batch.id}>{t('sniiReporting.packages.predecessorOption', { id: batch.id, revision: batch.revision ?? batch.revision_no ?? batch.id, status: batch.state || batch.status })}</option>)}</select><small style={{ color: 'var(--text-muted)' }}>{t('sniiReporting.packages.supersedesHint')}</small></label>
            {period.supersedes_batch_id && <Field label={t('sniiReporting.packages.supersessionReason')} value={period.supersession_reason} onChange={event => setPeriod(current => ({ ...current, supersession_reason: event.target.value }))} required={Boolean(internalReplacement)} maxLength={500} disabled={busy} hint={t('sniiReporting.packages.supersessionReasonHint')} />}
            <Button type="submit" disabled={busy || !profile}>{t('sniiReporting.packages.freezeDraft')}</Button>
          </form>
        </Card>
      )}
      <Card title={t('sniiReporting.packages.title')} padding={false}>
        <Table
          columns={[
            { key: 'revision', header: t('sniiReporting.columns.revision') },
            { key: 'period', header: t('sniiReporting.columns.period') },
            { key: 'state', header: t('sniiReporting.columns.status') },
            { key: 'items', header: t('sniiReporting.columns.items'), numeric: true },
            { key: 'actions', header: t('common.actions') },
          ]}
          rows={batches.map(batch => {
            const state = batch.state || batch.status || 'draft';
            return {
              revision: batch.revision ?? batch.revision_no ?? batch.id,
              period: `${batch.period_start?.slice(0, 10)} – ${batch.period_end?.slice(0, 10)}`,
              state: <Badge tone={toneFor(state)}>{state}</Badge>,
              items: batch.item_count ?? batch.items?.length ?? '—',
              actions: <Button size="sm" variant={selectedId === batch.id ? 'primary' : 'secondary'} onClick={() => onSelect(batch.id)}>{t('sniiReporting.packages.open')}</Button>,
            };
          })}
          empty={t('sniiReporting.packages.empty')}
        />
      </Card>

      {selected && (
        <Card title={t('sniiReporting.packages.details', { id: selected.id })}>
          {(() => {
            const state = selected.state || selected.status || 'draft';
            const title = selected.concession_title_snapshot;
            const applicabilityElements = selected.applicability_snapshot?.elements ?? [];
            return <>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
            {mayPrepare && ['draft', 'validated'].includes(state) && <Button variant="secondary" disabled={busy} onClick={() => onAction(`/batches/${selected.id}/validate`, 'POST')}>{t('sniiReporting.packages.validate')}</Button>}
          </div>
          {selected.validation_result?.valid === false && (
            <div role="alert" style={{ color: 'var(--danger)', marginBottom: 'var(--sp-3)' }}>
              <strong>{t('sniiReporting.packages.validationFailed')}</strong>
              <ul>{(selected.validation_result.errors ?? []).map((error, index) => <li key={index}>{formatValidationDetail(error)}</li>)}</ul>
            </div>
          )}
          <dl>
            <dt>{t('sniiReporting.columns.status')}</dt><dd><Badge tone={toneFor(state)}>{state}</Badge></dd>
            <dt>{t('sniiReporting.columns.revision')}</dt><dd>{selected.revision ?? selected.revision_no ?? '—'}</dd>
            <dt>{t('sniiReporting.columns.period')}</dt><dd>{selected.period_start?.slice(0, 10)} – {selected.period_end?.slice(0, 10)}</dd>
            <dt>{t('sniiReporting.packages.filingKind')}</dt><dd>{selected.filing_kind || '—'} / {selected.filing_window || '—'} / {selected.filing_frequency || '—'} ({selected.filing_year || '—'})</dd>
            <dt>{t('sniiReporting.packages.correctionRoot')}</dt><dd>{selected.correction_root_batch_id ? `#${selected.correction_root_batch_id}` : '—'}</dd>
            <dt>{t('sniiReporting.packages.supersessionReason')}</dt><dd>{selected.supersession_reason || '—'}</dd>
            <dt>{t('sniiReporting.packages.fullLoad')}</dt><dd>{selected.full_load ? t('sniiReporting.packages.yes') : t('sniiReporting.packages.no')}</dd>
            <dt>{t('sniiReporting.profile.electronicFolio')}</dt><dd>{selected.electronic_folio || '—'}</dd>
            <dt>{t('sniiReporting.profile.titleNumber')}</dt><dd>{title?.title_number || '—'}{title?.status ? ` (${title.status})` : ''}</dd>
            <dt>{t('sniiReporting.profile.titleReviewContext')} SHA-256</dt><dd><code style={{ wordBreak: 'break-all' }}>{selected.concession_title_sha256 || '—'}</code></dd>
            <dt>{t('sniiReporting.profile.sourcesReviewedAt')}</dt><dd>{selected.official_sources_reviewed_at || '—'}{selected.official_sources_reviewed_by ? ` (user #${selected.official_sources_reviewed_by})` : ''}</dd>
            <dt>{t('sniiReporting.profile.freshnessDays')}</dt><dd>{selected.source_freshness_days ?? '—'}</dd>
            <dt>{t('sniiReporting.packages.objectDecisions')}</dt><dd>{applicabilityElements.length ? applicabilityElements.map(item => `${item.element_type}: ${item.applicability}/${item.population_status || 'unreviewed'}`).join('; ') : '—'}</dd>
            <dt>{t('sniiReporting.columns.items')}</dt><dd>{selected.item_count ?? selected.items?.length ?? '—'}</dd>
            <dt>{t('sniiReporting.profile.templateVersion')}</dt><dd>{selected.template_version || '—'} <code>{selected.template_sha256 || '—'}</code></dd>
            <dt>{t('sniiReporting.profile.dictionaryVersion')}</dt><dd>{selected.dictionary_version || '—'} <code>{selected.dictionary_sha256 || '—'}</code></dd>
            <dt>{t('sniiReporting.profile.annexVersion')}</dt><dd>{selected.annex_v_version || '—'} <code>{selected.annex_v_sha256 || '—'}</code></dd>
            <dt>{t('sniiReporting.packages.snapshotHash')}</dt><dd style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{selected.snapshot_hash || '—'}</dd>
          </dl>
          {mayApprove && state === 'validated' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <label><input type="checkbox" checked={approvalConfirmed} onChange={event => setApprovalConfirmed(event.target.checked)} /> {t('sniiReporting.packages.confirmApprovalReview')}</label>
              <Button disabled={busy || !selected.snapshot_hash || !approvalConfirmed} onClick={() => onAction(`/batches/${selected.id}/approve`, 'POST', { expected_snapshot_hash: selected.snapshot_hash })}>{t('sniiReporting.packages.approve')}</Button>
            </div>
          )}

          {mayExport && ['approved', 'exported'].includes(state) && (
            <div style={{ ...gridStyle, alignItems: 'end', marginTop: 'var(--sp-4)' }}>
              <label>{t('sniiReporting.columns.objectType')}<select style={inputStyle} value={artifactType} onChange={event => setArtifactType(event.target.value)}>{selectedElements.map(element => <option key={element.key} value={element.key}>{element.label || element.official_name || element.key}</option>)}</select></label>
              <Button disabled={busy || !artifactType} onClick={() => {
                const element = selectedElements.find(item => item.key === artifactType);
                const format = element?.format || element?.generated_format;
                onAction(`/batches/${selected.id}/artifacts`, 'POST', { element_type: artifactType, format: format === 'kml' ? 'kml' : 'csv' });
              }}>{t('sniiReporting.packages.generate')}</Button>
            </div>
          )}

          <h3>{t('sniiReporting.packages.artifacts')}</h3>
          <Table
            columns={[
              { key: 'filename', header: t('sniiReporting.columns.filename') },
              { key: 'type', header: t('sniiReporting.columns.objectType') },
              { key: 'hash', header: 'SHA-256' },
              { key: 'size', header: t('sniiReporting.columns.size'), numeric: true },
              { key: 'actions', header: t('common.actions') },
            ]}
            rows={(selected.artifacts ?? []).map(artifact => ({
              filename: artifact.filename || artifact.file_name || '—',
              type: artifact.element_type,
              hash: <code>{(artifact.sha256 || artifact.content_sha256 || '').slice(0, 16)}…</code>,
              size: artifact.byte_size ?? '—',
              actions: mayExport ? <Button size="sm" onClick={() => onDownload(artifact)}>{t('sniiReporting.packages.download')}</Button> : null,
            }))}
            empty={t('sniiReporting.packages.noArtifacts')}
          />

          <h3>{t('sniiReporting.filing.title')}</h3>
          {mayFile && ['exported', 'filed'].includes(state) && (
            <form onSubmit={event => {
              event.preventDefault();
              if (!evidenceFile) return;
              const body = new FormData();
              body.append('evidence_file', evidenceFile);
              body.append('event_type', filing.event_type);
              body.append('attempt_no', String(Number(filing.attempt_no)));
              body.append('occurred_at', localDateTimeWithOffset(filing.occurred_at));
              body.append('occurred_timezone', filing.occurred_timezone);
              body.append('authority_reference', filing.authority_reference.trim());
              body.append('notes', filing.notes.trim());
              onAction(`/batches/${selected.id}/filing-events`, 'POST', body);
            }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <div style={gridStyle}>
                <label>{t('sniiReporting.filing.eventType')}<select style={inputStyle} value={filing.event_type} onChange={event => setFiling(current => ({ ...current, event_type: event.target.value }))}>{['submitted', 'acuse_received', 'accepted', 'rejected', 'correction_requested', 'corrected_submission'].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
                <Field label={t('sniiReporting.filing.attemptNo')} type="number" value={filing.attempt_no} onChange={event => setFiling(current => ({ ...current, attempt_no: event.target.value }))} required />
                <Field label={t('sniiReporting.filing.occurredAt')} type="datetime-local" step="1" value={filing.occurred_at} onChange={event => setFiling(current => ({ ...current, occurred_at: event.target.value }))} required />
                <Field label={t('sniiReporting.filing.timezone')} value={filing.occurred_timezone} onChange={() => undefined} required disabled hint={t('sniiReporting.filing.timezoneHint')} />
                <Field label={t('sniiReporting.filing.authorityReference')} value={filing.authority_reference} onChange={event => setFiling(current => ({ ...current, authority_reference: event.target.value }))} required />
                <label>{t('sniiReporting.filing.evidenceFile')}<input aria-label={t('sniiReporting.filing.evidenceFile')} type="file" accept=".pdf,.xml,.txt,.csv,.jpg,.jpeg,.png" required style={inputStyle} onChange={event => setEvidenceFile(event.target.files?.[0] ?? null)} /></label>
              </div>
              <Field label={t('sniiReporting.filing.notes')} value={filing.notes} onChange={event => setFiling(current => ({ ...current, notes: event.target.value }))} />
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('sniiReporting.filing.evidenceHelp')}</p>
              <Button type="submit" disabled={busy || !evidenceFile}>{t('sniiReporting.filing.record')}</Button>
            </form>
          )}
          <Table
            columns={[
              { key: 'event', header: t('sniiReporting.filing.eventType') },
              { key: 'time', header: t('sniiReporting.filing.occurredAt') },
              { key: 'reference', header: t('sniiReporting.filing.authorityReference') },
              { key: 'evidence', header: t('sniiReporting.filing.evidenceFile') },
              { key: 'actions', header: t('common.actions') },
            ]}
            rows={(selected.filing_events ?? []).map(event => ({ event: `${event.event_type}${event.attempt_no ? ` #${event.attempt_no}` : ''}`, time: formatFilingOccurrence(event.occurred_at, event.occurred_timezone), reference: event.authority_reference || '—', evidence: event.evidence_file_name || (event.evidence_upload_id ? `#${event.evidence_upload_id}` : '—'), actions: mayViewEvidence && event.evidence_upload_id ? <Button size="sm" onClick={() => onEvidenceDownload(event)}>{t('sniiReporting.filing.verifyDownload')}</Button> : null }))}
            empty={t('sniiReporting.filing.empty')}
          />
            </>;
          })()}
        </Card>
      )}
    </>
  );
}

function EvidenceTab({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <Card title={t('sniiReporting.evidence.title')} padding={false}>
      {loading ? <p style={{ padding: 'var(--sp-4)' }}>{t('common.loading')}</p> : (
        <Table
          columns={[
            { key: 'time', header: t('sniiReporting.evidence.time') },
            { key: 'action', header: t('sniiReporting.evidence.action') },
            { key: 'entity', header: t('sniiReporting.evidence.entity') },
            { key: 'actor', header: t('sniiReporting.evidence.actor') },
            { key: 'outcome', header: t('sniiReporting.evidence.outcome') },
          ]}
          rows={events.map(event => ({
            time: event.occurred_at || event.created_at || '—',
            action: event.action,
            entity: `${event.entity_type || '—'}${event.entity_id ? ` #${event.entity_id}` : ''}`,
            actor: event.actor_user_id || '—',
            outcome: <Badge tone={toneFor(event.outcome)}>{event.outcome || 'recorded'}</Badge>,
          }))}
          empty={t('sniiReporting.evidence.empty')}
        />
      )}
    </Card>
  );
}
