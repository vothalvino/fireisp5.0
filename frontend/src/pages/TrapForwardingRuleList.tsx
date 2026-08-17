// =============================================================================
// FireISP 5.0 — SNMP trap forwarding rules
// =============================================================================
// Blank match fields are wildcards. Populated match fields are joined with
// AND. Each rule sends to exactly one destination.
// =============================================================================

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { ErrorState, LoadingState } from '@/components/FetchStates';
import { modalStyles, RequiredMark, styles } from './crudStyles';

interface TrapForwardingRule {
  id: number;
  name: string;
  match_trap_type?: string | null;
  match_source_ip?: string | null;
  match_oid_prefix?: string | null;
  target_type: DestinationKind | null;
  target_display: string | null;
  target_display_code: TargetDisplayCode;
  target_needs_attention?: boolean;
  is_active: number | boolean;
  last_delivery_status?: string | null;
  last_delivery_at?: string | null;
  last_error?: string | null;
  last_delivery_is_test?: number | boolean | null;
}

interface TrapForwardingRuleConfiguration {
  forward_to_url: string | null;
  forward_to_email: string | null;
  forward_to_webhook_id: number | null;
}

type EditableTrapForwardingRule = TrapForwardingRule & TrapForwardingRuleConfiguration;

interface TrapForwardingRulesResponse {
  data: TrapForwardingRule[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface RegisteredWebhookOption {
  id: number;
  label?: string | null;
  url?: string | null;
}

type ForwardingReadinessReason = null
  | 'primary_schema_unavailable'
  | 'listener_not_ready'
  | 'invalid_port'
  | 'invalid_bind_ip'
  | 'bind_failed'
  | 'isolated_tenant_attribution_unsupported'
  | 'multi_organization_attribution_unsupported'
  | 'source_attribution_unavailable'
  | 'feature_disabled';

interface ForwardingIngestUsage {
  usage_date: string | null;
  trap_count: number;
  trap_limit: number;
  varbind_bytes: number;
  varbind_byte_limit: number;
  delivery_count: number;
  delivery_limit: number;
  metadata_only_count: number;
  dropped_trap_count: number;
  forwarding_skipped_count: number;
}

interface ForwardingReadiness {
  ready: boolean;
  status: 'ready' | 'unavailable';
  reason: ForwardingReadinessReason;
  ingest: ForwardingIngestUsage | null;
}

interface TrapForwardingRuleBody {
  name: string;
  match_trap_type: string | null;
  match_source_ip: string | null;
  match_oid_prefix: string | null;
  forward_to_url?: string | null;
  forward_to_email?: string | null;
  forward_to_webhook_id?: number | null;
  is_active: boolean;
}

type DestinationKind = 'url' | 'email' | 'webhook';
type TargetDisplayCode = 'direct_https_url' | 'email_recipient' | 'registered_webhook' | 'review_destination';
type FieldError = 'name' | 'matchTrapType' | 'matchSourceIp' | 'matchOidPrefix' | 'url' | 'email' | 'webhook' | 'destination';
type FieldErrors = Partial<Record<FieldError, string>>;

const PAGE_SIZE = 25;
const WEBHOOK_OPTIONS_PATH = '/trap-forwarding-rules/destinations';
const DELIVERY_POLL_INTERVAL_MS = 2_000;
const DELIVERY_POLL_MAX_FETCHES = 15;
const IN_FLIGHT_DELIVERY_STATUSES = new Set(['pending', 'processing', 'retrying']);

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', margin: 0,
};
const legendStyle: React.CSSProperties = {
  padding: '0 0.35rem', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)',
};
const helperStyle: React.CSSProperties = {
  margin: '0.28rem 0 0', color: 'var(--text-muted)', fontSize: '0.76rem', lineHeight: 1.45,
};
const summaryStyle: React.CSSProperties = {
  margin: '0.75rem 0 0', padding: '0.65rem 0.75rem', borderRadius: 6,
  background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.45,
};

function isRuleActive(value: number | boolean): boolean {
  return value === true || value === 1;
}

function hasInFlightDelivery(rules: TrapForwardingRule[]): boolean {
  return rules.some(rule => Boolean(
    rule.last_delivery_status && IN_FLIGHT_DELIVERY_STATUSES.has(rule.last_delivery_status),
  ));
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function destinationCount(rule: Pick<TrapForwardingRuleConfiguration, 'forward_to_url' | 'forward_to_email' | 'forward_to_webhook_id'>): number {
  return Number(Boolean(rule.forward_to_url))
    + Number(Boolean(rule.forward_to_email))
    + Number(rule.forward_to_webhook_id != null);
}

function initialDestination(rule: Partial<TrapForwardingRuleConfiguration>): DestinationKind | '' {
  // Legacy rows could contain zero or multiple targets. Force an explicit
  // choice before saving instead of silently picking one and sending traffic.
  if (destinationCount({
    forward_to_url: rule.forward_to_url ?? null,
    forward_to_email: rule.forward_to_email ?? null,
    forward_to_webhook_id: rule.forward_to_webhook_id ?? null,
  }) !== 1) return '';
  if (rule.forward_to_url) return 'url';
  if (rule.forward_to_email) return 'email';
  return 'webhook';
}

function isValidIp(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
    && value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeUrlOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function webhookOptionLabel(option: RegisteredWebhookOption): string {
  return option.label?.trim() || safeUrlOrigin(option.url) || `#${option.id}`;
}

async function fetchRules(page: number): Promise<TrapForwardingRulesResponse> {
  const response = await api.GET('/trap-forwarding-rules', {
    params: { query: { page, limit: PAGE_SIZE } },
  });
  if (response.error || !response.data) throw new Error('Failed to load trap forwarding rules');
  return response.data;
}

async function fetchWebhookOptions(): Promise<RegisteredWebhookOption[]> {
  const response = await api.GET(WEBHOOK_OPTIONS_PATH);
  if (response.error || !response.data) throw new Error('Failed to load registered webhooks');
  return response.data.data
    .filter(option => Number.isInteger(option.id) && option.id > 0)
    .map(option => ({ ...option, id: Number(option.id) }));
}

async function fetchRuleConfiguration(id: number): Promise<TrapForwardingRuleConfiguration> {
  const response = await api.GET('/trap-forwarding-rules/{id}/configuration', {
    params: { path: { id } },
  });
  if (response.error || !response.data) throw new Error('Failed to load rule configuration');
  const configuration = response.data.data;
  return {
    forward_to_url: typeof configuration?.forward_to_url === 'string' ? configuration.forward_to_url : null,
    forward_to_email: typeof configuration?.forward_to_email === 'string' ? configuration.forward_to_email : null,
    forward_to_webhook_id: configuration?.forward_to_webhook_id != null
      ? Number(configuration.forward_to_webhook_id)
      : null,
  };
}

async function fetchForwardingReadiness(): Promise<ForwardingReadiness> {
  const response = await api.GET('/trap-forwarding-rules/readiness');
  if (response.error || !response.data) throw new Error('Failed to load forwarding readiness');
  const value: Partial<ForwardingReadiness> = response.data.data;
  const reasons: ForwardingReadinessReason[] = [
    null,
    'primary_schema_unavailable',
    'listener_not_ready',
    'invalid_port',
    'invalid_bind_ip',
    'bind_failed',
    'isolated_tenant_attribution_unsupported',
    'multi_organization_attribution_unsupported',
    'source_attribution_unavailable',
    'feature_disabled',
  ];
  const ingest = value?.ingest;
  const ingestFields: Array<keyof Omit<ForwardingIngestUsage, 'usage_date'>> = [
    'trap_count', 'trap_limit', 'varbind_bytes', 'varbind_byte_limit',
    'delivery_count', 'delivery_limit', 'metadata_only_count',
    'dropped_trap_count', 'forwarding_skipped_count',
  ];
  const validIngest = ingest == null || Boolean(
    ingest && typeof ingest === 'object'
    && (ingest.usage_date === null || typeof ingest.usage_date === 'string')
    && ingestFields.every(field => Number.isInteger(ingest[field]) && ingest[field] >= 0),
  );
  if (typeof value?.ready !== 'boolean'
    || !['ready', 'unavailable'].includes(value.status ?? '')
    || !reasons.includes(value.reason as ForwardingReadinessReason)
    || !validIngest
    || value.ready !== (value.status === 'ready')
    || (value.ready && value.reason !== null)) {
    throw new Error('Invalid forwarding readiness response');
  }
  return value as ForwardingReadiness;
}

async function createRule(body: TrapForwardingRuleBody): Promise<void> {
  const response = await api.POST('/trap-forwarding-rules', { body });
  if (response.error) throw new Error('Failed to create trap forwarding rule');
}

async function updateRule(id: number, body: TrapForwardingRuleBody): Promise<void> {
  const response = await api.PUT('/trap-forwarding-rules/{id}', {
    params: { path: { id } }, body,
  });
  if (response.error) throw new Error('Failed to update trap forwarding rule');
}

async function deleteRule(id: number): Promise<void> {
  const response = await api.DELETE('/trap-forwarding-rules/{id}', { params: { path: { id } } });
  if (response.error) throw new Error('Failed to delete trap forwarding rule');
}

async function sendTest(id: number): Promise<void> {
  const response = await api.POST('/trap-forwarding-rules/{id}/test', {
    params: { path: { id } },
  });
  if (response.error) throw new Error('Failed to queue test delivery');
}

function StatusBadge({ active, needsAttention, forwardingReady }: { active: boolean; needsAttention: boolean; forwardingReady: boolean }) {
  const { t } = useTranslation();
  const paused = active && !needsAttention && !forwardingReady;
  const background = needsAttention || paused ? 'var(--warning-soft)' : active ? 'var(--success-soft)' : 'var(--bg-secondary)';
  const color = needsAttention || paused ? 'var(--warning)' : active ? 'var(--success)' : 'var(--text-muted)';
  const label = needsAttention
    ? t('trap_forwarding_rules.needs_attention')
    : paused
      ? t('trap_forwarding_rules.sending_paused')
      : active ? t('trap_forwarding_rules.enabled') : t('trap_forwarding_rules.disabled');
  return (
    <span style={{ background, color, border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {label}
    </span>
  );
}

function MatchSummary({ rule }: { rule: Pick<TrapForwardingRule, 'match_trap_type' | 'match_source_ip' | 'match_oid_prefix'> }) {
  const { t } = useTranslation();
  const conditions = [
    rule.match_trap_type && t('trap_forwarding_rules.summary_trap_type', { value: rule.match_trap_type }),
    rule.match_source_ip && t('trap_forwarding_rules.summary_source_ip', { value: rule.match_source_ip }),
    rule.match_oid_prefix && t('trap_forwarding_rules.summary_oid_prefix', { value: rule.match_oid_prefix }),
  ].filter(Boolean) as string[];
  if (conditions.length === 0) return <span>{t('trap_forwarding_rules.match_all_traps')}</span>;
  return (
    <div>
      {conditions.map(condition => <div key={condition}>{condition}</div>)}
      {conditions.length > 1 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2 }}>
          {t('trap_forwarding_rules.all_conditions_required')}
        </div>
      )}
    </div>
  );
}

function DestinationSummary({ rule }: { rule: Pick<TrapForwardingRule, 'target_type' | 'target_display_code' | 'target_needs_attention'> }) {
  const { t } = useTranslation();
  if (!rule.target_type) {
    return <span style={{ color: 'var(--danger)' }}>{t('trap_forwarding_rules.no_destination')}</span>;
  }
  const labels: Record<TargetDisplayCode, string> = {
    direct_https_url: t('trap_forwarding_rules.target_direct_https_url'),
    email_recipient: t('trap_forwarding_rules.target_email_recipient'),
    registered_webhook: t('trap_forwarding_rules.target_registered_webhook'),
    review_destination: t('trap_forwarding_rules.target_review_destination'),
  };
  return (
    <div style={{ overflowWrap: 'anywhere' }}>
      <strong>{labels[rule.target_display_code] ?? labels.review_destination}</strong>
      {rule.target_needs_attention && (
        <div style={{ color: 'var(--danger)', fontSize: '0.72rem', marginTop: 2 }}>
          {t('trap_forwarding_rules.destination_review_required')}
        </div>
      )}
    </div>
  );
}

function DeliverySummary({ rule }: { rule: TrapForwardingRule }) {
  const { t } = useTranslation();
  if (!rule.last_delivery_status) return <span style={{ color: 'var(--text-muted)' }}>{t('trap_forwarding_rules.never_sent')}</span>;
  const status = ['pending', 'processing', 'retrying', 'success', 'dead_letter', 'cancelled'].includes(rule.last_delivery_status)
    ? rule.last_delivery_status
    : 'unknown';
  const label = t(`trap_forwarding_rules.delivery_status_${status}`);
  return (
    <div>
      <div style={{ fontWeight: 600 }}>
        {(rule.last_delivery_is_test === true || rule.last_delivery_is_test === 1) && <span>{t('trap_forwarding_rules.test_prefix')}: </span>}
        {label}
      </div>
      {rule.last_delivery_at && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          {new Date(rule.last_delivery_at).toLocaleString()}
        </div>
      )}
      {rule.last_error && status === 'dead_letter' && (
        <div style={{ color: 'var(--danger)', fontSize: '0.72rem' }}>{t('trap_forwarding_rules.delivery_failed_hint')}</div>
      )}
    </div>
  );
}

interface RuleFormProps {
  initial: Partial<EditableTrapForwardingRule>;
  webhookOptions: RegisteredWebhookOption[];
  webhooksLoading: boolean;
  webhooksUnavailable: boolean;
  onSave: (body: TrapForwardingRuleBody) => void;
  onClose: () => void;
  saving: boolean;
  saveError?: string | null;
  editMode: boolean;
  forwardingReady: boolean;
}

function RuleForm({
  initial, webhookOptions, webhooksLoading, webhooksUnavailable, onSave, onClose, saving, saveError, editMode,
  forwardingReady,
}: RuleFormProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [name, setName] = useState(initial.name ?? '');
  const [matchTrapType, setMatchTrapType] = useState(initial.match_trap_type ?? '');
  const [matchSourceIp, setMatchSourceIp] = useState(initial.match_source_ip ?? '');
  const [matchOidPrefix, setMatchOidPrefix] = useState(initial.match_oid_prefix ?? '');
  const [forwardToUrl, setForwardToUrl] = useState(initial.forward_to_url ?? '');
  const [forwardToEmail, setForwardToEmail] = useState(initial.forward_to_email ?? '');
  const [forwardToWebhookId, setForwardToWebhookId] = useState(
    initial.forward_to_webhook_id != null ? String(initial.forward_to_webhook_id) : '',
  );
  const [destination, setDestination] = useState<DestinationKind | ''>(() => initialDestination(initial));
  const initiallyActive = initial.is_active !== undefined && isRuleActive(initial.is_active);
  const [active, setActive] = useState(initial.is_active === undefined ? forwardingReady : initiallyActive);
  const [errors, setErrors] = useState<FieldErrors>({});
  const currentWebhookId = initial.forward_to_webhook_id != null ? Number(initial.forward_to_webhook_id) : null;
  const currentWebhookMissing = !webhooksLoading && !webhooksUnavailable
    && currentWebhookId != null
    && !webhookOptions.some(option => option.id === currentWebhookId);
  const preserveCurrentWebhook = webhooksUnavailable && currentWebhookId != null;
  const webhookChoiceDisabled = webhooksLoading
    || (!webhooksUnavailable && webhookOptions.length === 0)
    || (webhooksUnavailable && currentWebhookId == null);
  const inputStyle: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' };

  useEffect(() => {
    // The choices endpoint only returns active, same-organization webhooks.
    // Once it confirms an old selection is unavailable, force the operator to
    // make a safe new choice instead of resubmitting an undeliverable target.
    if (currentWebhookMissing && destination === 'webhook') {
      setDestination('');
      setForwardToWebhookId('');
    }
  }, [currentWebhookMissing, destination]);

  useEffect(() => {
    // Availability may change while the dialog is open. Preserve an existing
    // active configuration, but never let a new or inactive rule become active
    // after the server has stopped forwarding.
    if (!forwardingReady && !initiallyActive) setActive(false);
  }, [forwardingReady, initiallyActive]);

  function fieldId(name: string): string {
    return `${formId}-${name}`;
  }

  function selectDestination(kind: DestinationKind) {
    setDestination(kind);
    setErrors(previous => ({ ...previous, destination: undefined, url: undefined, email: undefined, webhook: undefined }));
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    const trapType = matchTrapType.trim();
    const sourceIp = matchSourceIp.trim();
    const oidPrefix = matchOidPrefix.trim();
    if (!name.trim()) next.name = t('trap_forwarding_rules.validation_name');
    if (trapType.includes('*')) next.matchTrapType = t('trap_forwarding_rules.validation_blank_wildcard');
    if (sourceIp.includes('*')) next.matchSourceIp = t('trap_forwarding_rules.validation_blank_wildcard');
    else if (sourceIp && !isValidIp(sourceIp)) next.matchSourceIp = t('trap_forwarding_rules.validation_ip');
    if (oidPrefix.includes('*')) next.matchOidPrefix = t('trap_forwarding_rules.validation_blank_wildcard');
    else if (oidPrefix && !/^\d+(?:\.\d+)*$/.test(oidPrefix)) next.matchOidPrefix = t('trap_forwarding_rules.validation_oid');
    if (!destination) next.destination = t('trap_forwarding_rules.validation_destination');
    if (destination === 'url') {
      if (!forwardToUrl.trim()) next.url = t('trap_forwarding_rules.validation_url_required');
      else if (!isValidHttpsUrl(forwardToUrl.trim())) next.url = t('trap_forwarding_rules.validation_https');
    }
    if (destination === 'email') {
      if (!forwardToEmail.trim()) next.email = t('trap_forwarding_rules.validation_email_required');
      else if (!isValidEmail(forwardToEmail.trim())) next.email = t('trap_forwarding_rules.validation_email');
    }
    if (destination === 'webhook' && !forwardToWebhookId) next.webhook = t('trap_forwarding_rules.validation_webhook');
    return next;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const body: TrapForwardingRuleBody = {
      name: name.trim(),
      match_trap_type: trimOrNull(matchTrapType),
      match_source_ip: trimOrNull(matchSourceIp),
      match_oid_prefix: trimOrNull(matchOidPrefix),
      is_active: active,
    };

    const originalDestination = initialDestination(initial);
    const destinationUnchanged = editMode
      && destination === originalDestination
      && (destination !== 'url' || trimOrNull(forwardToUrl) === (initial.forward_to_url ?? null))
      && (destination !== 'email' || trimOrNull(forwardToEmail) === (initial.forward_to_email ?? null))
      && (destination !== 'webhook' || Number(forwardToWebhookId) === Number(initial.forward_to_webhook_id));

    // Ordinary edits preserve the server-side destination without resending
    // credentials. Switching or changing a target clears every stale target
    // explicitly so the backend always sees exactly one destination.
    if (!destinationUnchanged) {
      body.forward_to_url = destination === 'url' ? trimOrNull(forwardToUrl) : null;
      body.forward_to_email = destination === 'email' ? trimOrNull(forwardToEmail) : null;
      body.forward_to_webhook_id = destination === 'webhook' ? Number(forwardToWebhookId) : null;
    }

    onSave(body);
  }

  const draftRule = {
    match_trap_type: trimOrNull(matchTrapType), match_source_ip: trimOrNull(matchSourceIp), match_oid_prefix: trimOrNull(matchOidPrefix),
  };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 720 }} onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={fieldId('title')}>
        <div style={modalStyles.header}>
          <div>
            <h2 id={fieldId('title')} style={modalStyles.title}>{editMode ? t('trap_forwarding_rules.edit') : t('trap_forwarding_rules.new')}</h2>
            <p style={{ ...helperStyle, marginTop: 4 }}>{t('trap_forwarding_rules.form_intro')}</p>
          </div>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <fieldset style={sectionStyle}>
            <legend style={legendStyle}>{t('trap_forwarding_rules.section_basics')}</legend>
            <label htmlFor={fieldId('name')} style={modalStyles.label}>{t('trap_forwarding_rules.name')} <RequiredMark /></label>
            <input id={fieldId('name')} style={inputStyle} value={name} maxLength={200} onChange={event => { setName(event.target.value); setErrors(previous => ({ ...previous, name: undefined })); }} placeholder={t('trap_forwarding_rules.name_placeholder')} aria-invalid={Boolean(errors.name)} autoFocus />
            {errors.name && <p role="alert" style={modalStyles.error}>{errors.name}</p>}
          </fieldset>

          <fieldset style={sectionStyle}>
            <legend style={legendStyle}>{t('trap_forwarding_rules.section_match')}</legend>
            <p style={{ ...helperStyle, marginTop: 0 }}>{t('trap_forwarding_rules.match_help')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: '0.8rem', marginTop: '0.8rem' }}>
              <div>
                <label htmlFor={fieldId('trap-type')} style={modalStyles.label}>{t('trap_forwarding_rules.match_trap_type')}</label>
                <input id={fieldId('trap-type')} style={inputStyle} value={matchTrapType} maxLength={64} onChange={event => { setMatchTrapType(event.target.value); setErrors(previous => ({ ...previous, matchTrapType: undefined })); }} placeholder={t('trap_forwarding_rules.trap_type_placeholder')} aria-invalid={Boolean(errors.matchTrapType)} />
                <p style={helperStyle}>{t('trap_forwarding_rules.trap_type_help')}</p>
                {errors.matchTrapType && <p role="alert" style={modalStyles.error}>{errors.matchTrapType}</p>}
              </div>
              <div>
                <label htmlFor={fieldId('source-ip')} style={modalStyles.label}>{t('trap_forwarding_rules.match_source_ip')}</label>
                <input id={fieldId('source-ip')} style={inputStyle} value={matchSourceIp} maxLength={45} onChange={event => { setMatchSourceIp(event.target.value); setErrors(previous => ({ ...previous, matchSourceIp: undefined })); }} placeholder={t('trap_forwarding_rules.source_ip_placeholder')} aria-invalid={Boolean(errors.matchSourceIp)} />
                <p style={helperStyle}>{t('trap_forwarding_rules.source_ip_help')}</p>
                {errors.matchSourceIp && <p role="alert" style={modalStyles.error}>{errors.matchSourceIp}</p>}
              </div>
              <div>
                <label htmlFor={fieldId('oid-prefix')} style={modalStyles.label}>{t('trap_forwarding_rules.match_oid_prefix')}</label>
                <input id={fieldId('oid-prefix')} style={inputStyle} value={matchOidPrefix} maxLength={255} onChange={event => { setMatchOidPrefix(event.target.value); setErrors(previous => ({ ...previous, matchOidPrefix: undefined })); }} placeholder={t('trap_forwarding_rules.oid_placeholder')} aria-invalid={Boolean(errors.matchOidPrefix)} />
                <p style={helperStyle}>{t('trap_forwarding_rules.oid_help')}</p>
                {errors.matchOidPrefix && <p role="alert" style={modalStyles.error}>{errors.matchOidPrefix}</p>}
              </div>
            </div>
            <div style={summaryStyle} aria-live="polite"><strong>{t('trap_forwarding_rules.match_summary')}:</strong> <MatchSummary rule={draftRule} /></div>
          </fieldset>

          <fieldset style={sectionStyle}>
            <legend style={legendStyle}>{t('trap_forwarding_rules.section_destination')}</legend>
            <p style={{ ...helperStyle, marginTop: 0 }}>{t('trap_forwarding_rules.destination_help')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.8rem' }}>
              <div style={{ padding: '0.75rem', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                <label style={modalStyles.checkboxLabel}><input type="radio" name={`${formId}-destination`} checked={destination === 'email'} onChange={() => selectDestination('email')} />{t('trap_forwarding_rules.destination_email')}</label>
                <p style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.destination_email_help')}</p>
                {destination === 'email' && <div style={{ margin: '0.6rem 0 0 1.55rem' }}><label htmlFor={fieldId('email')} style={modalStyles.label}>{t('trap_forwarding_rules.email_address')}</label><input id={fieldId('email')} type="email" style={inputStyle} value={forwardToEmail} maxLength={255} onChange={event => { setForwardToEmail(event.target.value); setErrors(previous => ({ ...previous, email: undefined })); }} placeholder={t('trap_forwarding_rules.email_placeholder')} aria-invalid={Boolean(errors.email)} />{errors.email && <p role="alert" style={modalStyles.error}>{errors.email}</p>}</div>}
              </div>
              <div style={{ padding: '0.75rem', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                <label style={modalStyles.checkboxLabel}><input type="radio" name={`${formId}-destination`} checked={destination === 'url'} onChange={() => selectDestination('url')} />{t('trap_forwarding_rules.destination_https')}</label>
                <p style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.destination_https_help')}</p>
                {destination === 'url' && <div style={{ margin: '0.6rem 0 0 1.55rem' }}><label htmlFor={fieldId('url')} style={modalStyles.label}>{t('trap_forwarding_rules.https_url')}</label><input id={fieldId('url')} type="url" style={inputStyle} value={forwardToUrl} maxLength={500} onChange={event => { setForwardToUrl(event.target.value); setErrors(previous => ({ ...previous, url: undefined })); }} placeholder={t('trap_forwarding_rules.url_placeholder')} aria-invalid={Boolean(errors.url)} />{errors.url && <p role="alert" style={modalStyles.error}>{errors.url}</p>}</div>}
              </div>
              <div style={{ padding: '0.75rem', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                <label style={{ ...modalStyles.checkboxLabel, opacity: webhookChoiceDisabled ? 0.65 : 1 }}><input type="radio" name={`${formId}-destination`} checked={destination === 'webhook'} disabled={webhookChoiceDisabled} onChange={() => selectDestination('webhook')} />{t('trap_forwarding_rules.destination_webhook')}</label>
                <p style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.destination_webhook_help')}</p>
                {webhooksLoading && <p role="status" style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.webhooks_loading')}</p>}
                {webhooksUnavailable && currentWebhookId == null && <p role="status" style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.webhooks_unavailable')}</p>}
                {!webhooksLoading && !webhooksUnavailable && webhookOptions.length === 0 && currentWebhookId == null && <p role="status" style={{ ...helperStyle, marginLeft: '1.55rem' }}>{t('trap_forwarding_rules.webhooks_empty')}</p>}
                {currentWebhookMissing && <p role="alert" style={{ ...helperStyle, marginLeft: '1.55rem', color: 'var(--warning)' }}>{t('trap_forwarding_rules.current_webhook_help')}</p>}
                {destination === 'webhook' && <div style={{ margin: '0.6rem 0 0 1.55rem' }}><label htmlFor={fieldId('webhook')} style={modalStyles.label}>{t('trap_forwarding_rules.registered_webhook')}</label><select id={fieldId('webhook')} style={{ ...modalStyles.select, width: '100%' }} value={forwardToWebhookId} onChange={event => { setForwardToWebhookId(event.target.value); setErrors(previous => ({ ...previous, webhook: undefined })); }} aria-invalid={Boolean(errors.webhook)}><option value="">{t('trap_forwarding_rules.select_webhook')}</option>{preserveCurrentWebhook && <option value={currentWebhookId!}>{t('trap_forwarding_rules.current_webhook_unavailable', { id: currentWebhookId })}</option>}{webhookOptions.map(option => <option key={option.id} value={option.id}>{webhookOptionLabel(option)}</option>)}</select>{preserveCurrentWebhook && <p role="status" style={helperStyle}>{t('trap_forwarding_rules.webhook_check_unavailable')}</p>}{errors.webhook && <p role="alert" style={modalStyles.error}>{errors.webhook}</p>}</div>}
              </div>
            </div>
            {errors.destination && <p role="alert" style={{ ...modalStyles.error, marginTop: '0.75rem' }}>{errors.destination}</p>}
          </fieldset>

          <fieldset style={sectionStyle}>
            <legend style={legendStyle}>{t('trap_forwarding_rules.section_status')}</legend>
            <label style={{ ...modalStyles.checkboxLabel, opacity: !forwardingReady && !active ? 0.65 : 1 }}><input type="checkbox" checked={active} disabled={!forwardingReady && !active} onChange={event => setActive(event.target.checked)} />{t('trap_forwarding_rules.enable_rule')}</label>
            <p role={!forwardingReady ? 'status' : undefined} style={{ ...helperStyle, marginLeft: '1.55rem', color: !forwardingReady ? 'var(--warning)' : undefined }}>{!forwardingReady ? t('trap_forwarding_rules.enable_unavailable_help') : active ? t('trap_forwarding_rules.enabled_help') : t('trap_forwarding_rules.disabled_help')}</p>
          </fieldset>

          <div style={modalStyles.actions}>
            {saveError && <p role="alert" style={{ ...modalStyles.error, marginRight: 'auto' }}>{saveError}</p>}
            <button type="button" style={styles.btnSecondary} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? t('common.saving') : editMode ? t('trap_forwarding_rules.save_changes') : t('trap_forwarding_rules.create_rule')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TrapForwardingRuleList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mayCreate = can(user, 'trap_forwarding.create');
  const mayUpdate = can(user, 'trap_forwarding.update');
  const mayDelete = can(user, 'trap_forwarding.delete');
  const hasRowActions = mayUpdate || mayDelete;
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditableTrapForwardingRule | null>(null);
  const [editingLoadingId, setEditingLoadingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TrapForwardingRule | null>(null);
  const [testConfirm, setTestConfirm] = useState<TrapForwardingRule | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const deliveryPollActive = useRef(false);
  const deliveryPollFetches = useRef(0);

  function resetDeliveryPolling() {
    deliveryPollActive.current = false;
    deliveryPollFetches.current = 0;
  }

  const rulesQuery = useQuery({
    queryKey: ['trap-forwarding-rules', page],
    queryFn: () => {
      // Count actual network attempts, including failed ones, so an unavailable
      // API can never turn delivery-status refresh into an endless request loop.
      if (deliveryPollActive.current) deliveryPollFetches.current += 1;
      return fetchRules(page);
    },
    refetchInterval: query => {
      const response = query.state.data as TrapForwardingRulesResponse | undefined;
      if (!response || !hasInFlightDelivery(response.data)) {
        resetDeliveryPolling();
        return false;
      }
      if (!deliveryPollActive.current) {
        deliveryPollActive.current = true;
        deliveryPollFetches.current = 0;
      }
      return deliveryPollFetches.current < DELIVERY_POLL_MAX_FETCHES
        ? DELIVERY_POLL_INTERVAL_MS
        : false;
    },
  });
  const readinessQuery = useQuery({
    queryKey: ['trap-forwarding-readiness'],
    queryFn: fetchForwardingReadiness,
    retry: false,
    staleTime: 5_000,
  });
  const webhooksQuery = useQuery({
    queryKey: ['trap-forwarding-webhook-options'],
    queryFn: fetchWebhookOptions,
    retry: false,
    enabled: mayCreate || mayUpdate,
  });
  const rules = rulesQuery.data?.data ?? [];
  const meta = rulesQuery.data?.meta;
  const webhookOptions = webhooksQuery.data ?? [];
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / PAGE_SIZE)) : 1);
  const forwardingReady = readinessQuery.data?.ready === true;
  const readinessReason = readinessQuery.data?.reason ?? null;
  const ingest = readinessQuery.data?.ingest ?? null;

  function showMessage(type: 'ok' | 'err', message: string) {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 4000);
  }

  const createMutation = useMutation({
    mutationFn: createRule,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['trap-forwarding-rules'] }); setShowForm(false); showMessage('ok', t('trap_forwarding_rules.create_success')); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: TrapForwardingRuleBody }) => updateRule(id, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['trap-forwarding-rules'] }); setEditing(null); showMessage('ok', t('trap_forwarding_rules.update_success')); },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['trap-forwarding-rules'] }); setDeleteConfirm(null); showMessage('ok', t('trap_forwarding_rules.delete_success')); },
  });
  const testMutation = useMutation({
    mutationFn: sendTest,
    onSuccess: () => {
      resetDeliveryPolling();
      queryClient.invalidateQueries({ queryKey: ['trap-forwarding-rules'] });
      setTestConfirm(null);
      showMessage('ok', t('trap_forwarding_rules.test_queued'));
    },
    onError: () => {
      setTestConfirm(null);
      showMessage('err', t('trap_forwarding_rules.test_error'));
    },
  });
  const formProps = {
    webhookOptions,
    webhooksLoading: webhooksQuery.isLoading,
    webhooksUnavailable: webhooksQuery.isError,
    forwardingReady,
  };

  async function openEditor(rule: TrapForwardingRule) {
    updateMutation.reset();
    setEditingLoadingId(rule.id);
    try {
      const configuration = await fetchRuleConfiguration(rule.id);
      setEditing({ ...rule, ...configuration });
    } catch {
      showMessage('err', t('trap_forwarding_rules.configuration_error'));
    } finally {
      setEditingLoadingId(null);
    }
  }

  function refreshRules() {
    resetDeliveryPolling();
    void rulesQuery.refetch();
    void readinessQuery.refetch();
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div><h1 style={styles.pageTitle}>{t('trap_forwarding_rules.title')}</h1><p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>{t('trap_forwarding_rules.subtitle')}</p></div>
        {meta && <span style={styles.countBadge}>{t('trap_forwarding_rules.total', { count: meta.total })}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" style={styles.btnSecondary} onClick={refreshRules}>{t('trap_forwarding_rules.refresh_status')}</button>
          {mayCreate && <button style={styles.btnPrimary} onClick={() => { createMutation.reset(); setShowForm(true); }}>+ {t('trap_forwarding_rules.add_rule')}</button>}
        </div>
      </div>

      <section aria-labelledby="trap-forwarding-about" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem 1.1rem', marginBottom: '1rem' }}>
        <h2 id="trap-forwarding-about" style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem' }}>{t('trap_forwarding_rules.what_is_trap')}</h2>
        <p style={{ margin: '0.45rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.55 }}>{t('trap_forwarding_rules.trap_explanation')}</p>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{t('trap_forwarding_rules.trap_examples')}</p>
        <p style={{ margin: '0.65rem 0 0', paddingTop: '0.65rem', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          <strong>{t('trap_forwarding_rules.setup_label')}:</strong> {t('trap_forwarding_rules.setup_hint')}
        </p>
      </section>

      {readinessQuery.isLoading ? (
        <div role="status" style={{ padding: '0.75rem 0.9rem', marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
          {t('trap_forwarding_rules.readiness_checking')}
        </div>
      ) : !forwardingReady && (
        <div role={readinessQuery.isError ? 'alert' : 'status'} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0.8rem 0.95rem', marginBottom: '1rem', border: '1px solid var(--warning)', borderRadius: 7, background: 'var(--warning-soft)', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
          <strong style={{ color: 'var(--warning)' }}>{t('trap_forwarding_rules.readiness_unavailable_title')}</strong>
          <span>{t(`trap_forwarding_rules.readiness_reason_${readinessQuery.isError ? 'unknown' : readinessReason ?? 'unknown'}`)}</span>
          <span>{t('trap_forwarding_rules.readiness_unavailable_help')}</span>
        </div>
      )}

      {ingest && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0.75rem 0.9rem', marginBottom: '1rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.45 }}>
          <strong>{t('trap_forwarding_rules.ingest_limits_title')}</strong>
          <span>{t('trap_forwarding_rules.ingest_limits_summary', {
            traps: ingest.trap_count, trapLimit: ingest.trap_limit,
            deliveries: ingest.delivery_count, deliveryLimit: ingest.delivery_limit,
            bytes: ingest.varbind_bytes, byteLimit: ingest.varbind_byte_limit,
          })}</span>
          {ingest.metadata_only_count > 0 && <span style={{ color: 'var(--warning)' }}>{t('trap_forwarding_rules.ingest_metadata_only_warning', { count: ingest.metadata_only_count })}</span>}
          {ingest.dropped_trap_count > 0 && <span style={{ color: 'var(--warning)' }}>{t('trap_forwarding_rules.ingest_dropped_warning', { count: ingest.dropped_trap_count })}</span>}
          {ingest.forwarding_skipped_count > 0 && <span style={{ color: 'var(--warning)' }}>{t('trap_forwarding_rules.ingest_forwarding_skipped_warning', { count: ingest.forwarding_skipped_count })}</span>}
        </div>
      )}

      {feedback && <div role={feedback.type === 'err' ? 'alert' : 'status'} style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? 'var(--success-soft)' : 'var(--danger-soft)', color: feedback.type === 'ok' ? 'var(--success)' : 'var(--danger)', fontSize: '0.85rem' }}>{feedback.message}</div>}

      <div style={styles.tableCard}>
        {rulesQuery.isLoading ? <LoadingState /> : rulesQuery.isError ? <ErrorState message={t('trap_forwarding_rules.error')} onRetry={() => rulesQuery.refetch()} /> : rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}><h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{t('trap_forwarding_rules.empty_title')}</h2><p style={{ margin: '0.45rem auto 1rem', maxWidth: 560, color: 'var(--text-muted)', fontSize: '0.84rem', lineHeight: 1.5 }}>{t('trap_forwarding_rules.empty')}</p>{mayCreate && <button style={styles.btnPrimary} onClick={() => { createMutation.reset(); setShowForm(true); }}>{t('trap_forwarding_rules.create_first')}</button>}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}><table style={styles.table}><thead><tr><th style={styles.th}>{t('trap_forwarding_rules.column_rule')}</th><th style={styles.th}>{t('trap_forwarding_rules.column_matches')}</th><th style={styles.th}>{t('trap_forwarding_rules.column_destination')}</th><th style={styles.th}>{t('trap_forwarding_rules.column_last_delivery')}</th><th style={styles.th}>{t('trap_forwarding_rules.column_status')}</th>{hasRowActions && <th style={styles.th}>{t('common.actions')}</th>}</tr></thead><tbody>{rules.map(rule => {
            const invalidDestination = Boolean(rule.target_needs_attention) || !rule.target_type;
            return <tr key={rule.id} style={styles.tr}><td style={styles.td}><strong style={{ color: 'var(--text-primary)' }}>{rule.name}</strong></td><td style={{ ...styles.td, minWidth: 205, lineHeight: 1.45 }}><MatchSummary rule={rule} /></td><td style={{ ...styles.td, minWidth: 230, fontSize: '0.8rem', lineHeight: 1.5 }}><DestinationSummary rule={rule} /></td><td style={{ ...styles.td, minWidth: 145 }}><DeliverySummary rule={rule} /></td><td style={styles.td}><StatusBadge active={isRuleActive(rule.is_active) && !invalidDestination} needsAttention={invalidDestination} forwardingReady={forwardingReady} /></td>{hasRowActions && <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{mayUpdate && <><button style={styles.actionBtn} onClick={() => openEditor(rule)} disabled={editingLoadingId !== null}>{editingLoadingId === rule.id ? t('trap_forwarding_rules.edit_loading') : t('common.edit')}</button><button style={styles.actionBtn} onClick={() => { testMutation.reset(); setTestConfirm(rule); }} disabled={!forwardingReady || invalidDestination || editingLoadingId !== null} title={!forwardingReady ? t('trap_forwarding_rules.test_readiness_unavailable') : invalidDestination ? t('trap_forwarding_rules.test_unavailable') : t('trap_forwarding_rules.send_test_help')}>{t('trap_forwarding_rules.send_test')}</button></>}{mayDelete && <button style={{ ...styles.actionBtn, color: 'var(--danger)' }} onClick={() => { deleteMutation.reset(); setDeleteConfirm(rule); }} disabled={editingLoadingId !== null}>{t('common.delete')}</button>}</td>}</tr>;
          })}</tbody></table></div>
        )}
      </div>

      {totalPages > 1 && <div style={styles.pagination}><button style={styles.pageBtn} disabled={page <= 1} onClick={() => { resetDeliveryPolling(); setPage(previous => previous - 1); }}>{t('common.prev')}</button><span style={styles.pageInfo}>{t('trap_forwarding_rules.page_of', { page, total: totalPages })}</span><button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => { resetDeliveryPolling(); setPage(previous => previous + 1); }}>{t('common.next')}</button></div>}

      {showForm && <RuleForm initial={{}} {...formProps} onSave={body => createMutation.mutate(body)} onClose={() => { createMutation.reset(); setShowForm(false); }} saving={createMutation.isPending} saveError={createMutation.isError ? t('trap_forwarding_rules.create_error') : null} editMode={false} />}
      {editing && <RuleForm initial={editing} {...formProps} onSave={body => updateMutation.mutate({ id: editing.id, body })} onClose={() => { updateMutation.reset(); setEditing(null); }} saving={updateMutation.isPending} saveError={updateMutation.isError ? t('trap_forwarding_rules.update_error') : null} editMode />}

      {deleteConfirm && <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}><div style={{ ...modalStyles.panel, maxWidth: 400 }} onClick={event => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-trap-rule-title"><h2 id="delete-trap-rule-title" style={{ ...modalStyles.title, marginBottom: '0.6rem' }}>{t('trap_forwarding_rules.delete_title')}</h2><p style={{ margin: '0 0 0.45rem', color: 'var(--text-secondary)' }}>{t('trap_forwarding_rules.delete_confirm', { name: deleteConfirm.name })}</p><p style={{ ...helperStyle, marginBottom: '1.25rem' }}>{t('trap_forwarding_rules.delete_help')}</p>{deleteMutation.isError && <p role="alert" style={{ ...modalStyles.error, marginBottom: '0.75rem' }}>{t('trap_forwarding_rules.delete_error')}</p>}<div style={modalStyles.actions}><button style={styles.btnSecondary} onClick={() => { deleteMutation.reset(); setDeleteConfirm(null); }} disabled={deleteMutation.isPending}>{t('common.cancel')}</button><button style={styles.btnDanger} onClick={() => deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? t('common.deleting') : t('trap_forwarding_rules.delete_rule')}</button></div></div></div>}

      {testConfirm && <div style={modalStyles.backdrop} onClick={() => setTestConfirm(null)}><div style={{ ...modalStyles.panel, maxWidth: 440 }} onClick={event => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="test-trap-rule-title"><h2 id="test-trap-rule-title" style={{ ...modalStyles.title, marginBottom: '0.6rem' }}>{t('trap_forwarding_rules.send_test_title')}</h2><p style={{ margin: '0 0 0.6rem', color: 'var(--text-secondary)' }}>{t('trap_forwarding_rules.send_test_confirm', { name: testConfirm.name })}</p><div style={{ ...summaryStyle, margin: '0 0 0.75rem' }}><DestinationSummary rule={testConfirm} /></div><p style={{ ...helperStyle, marginBottom: forwardingReady ? '1.25rem' : '0.65rem' }}>{t('trap_forwarding_rules.send_test_notice')}</p>{!forwardingReady && <p role="alert" style={{ ...modalStyles.error, marginBottom: '1.25rem' }}>{t('trap_forwarding_rules.test_readiness_unavailable')}</p>}<div style={modalStyles.actions}><button style={styles.btnSecondary} onClick={() => setTestConfirm(null)} disabled={testMutation.isPending}>{t('common.cancel')}</button><button style={styles.btnPrimary} onClick={() => testMutation.mutate(testConfirm.id)} disabled={testMutation.isPending || !forwardingReady}>{testMutation.isPending ? t('trap_forwarding_rules.sending_test') : t('trap_forwarding_rules.confirm_send_test')}</button></div></div></div>}
    </div>
  );
}
