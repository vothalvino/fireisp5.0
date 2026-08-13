import { useEffect, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  fetchMxContractEnvironment,
  isEligibleMxContractSource,
  MxContractEnvironmentBadge,
  MxSandboxDocumentBanner,
  type MxContractEnvironment,
  type MxContractSourceEvidence,
  type MxContractSourceStatus,
} from './MxContractEnvironment';

interface ActivationDocumentTemplate {
  id: number;
  template_type: string;
  contract_template_mx_id: number | null;
  contract_template_mx_environment?: MxContractEnvironment | null;
  is_active: boolean | number;
}

export interface RegisteredContractSource extends MxContractSourceEvidence {
  id: number;
  status: MxContractSourceStatus;
}

type ActiveSourceResolution =
  | { kind: 'ready'; sourceId: number }
  | { kind: 'missing' | 'unlinked' | 'ambiguous' };

async function resolveActiveSource(environment: MxContractEnvironment): Promise<ActiveSourceResolution> {
  const res = await (api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>)('/document-templates');
  if (res.error) throw new Error('Failed to load active activation documents');

  const activeTemplates = ((res.data as { data?: ActivationDocumentTemplate[] } | undefined)?.data ?? [])
    .filter(template => template.template_type === 'activation_contract' && Boolean(template.is_active));
  // Linked activation documents can coexist — one for each immutable source
  // lane. An old row without the joined environment is production evidence;
  // an unlinked active row is unsafe for either lane and remains visible here.
  const templates = activeTemplates.filter(template => (
    !template.contract_template_mx_id
      || (template.contract_template_mx_environment ?? 'production') === environment
  ));
  if (templates.length === 0) return { kind: 'missing' };
  if (templates.some(template => !template.contract_template_mx_id)) return { kind: 'unlinked' };

  const sourceIds = new Set(templates.map(template => Number(template.contract_template_mx_id)));
  if (sourceIds.size !== 1) return { kind: 'ambiguous' };
  return { kind: 'ready', sourceId: [...sourceIds][0] };
}

async function fetchRegisteredSource(id: number): Promise<RegisteredContractSource> {
  // Fetch the one source referenced by the current active activation documents
  // directly. The generic registry list is paginated, so intersecting a single
  // list page could incorrectly hide a valid source (or offer an unrelated one).
  const res = await (api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>)(`/consumer-protection/contract-templates-mx/${id}`);
  if (res.error) throw new Error('Failed to load the registered MX contract source');
  const source = (res.data as { data?: RegisteredContractSource } | undefined)?.data;
  if (!source) throw new Error('Registered MX contract source was not found');
  return { ...source, environment: source.environment ?? 'production' };
}

export interface MxRegisteredContractSourceFieldProps {
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
  frozenEnvironment?: MxContractEnvironment | null;
  disabled?: boolean;
  required?: boolean;
  labelStyle?: CSSProperties;
  selectStyle?: CSSProperties;
}

/**
 * Selects the exact registered source used by the organization's CURRENT
 * active activation document. prepareActivation enforces the same equality,
 * so unrelated registered rows must never be offered here.
 */
export function MxRegisteredContractSourceField({
  value,
  onChange,
  onAvailabilityChange,
  frozenEnvironment,
  disabled = false,
  required = true,
  labelStyle,
  selectStyle,
}: MxRegisteredContractSourceFieldProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const mayViewDocuments = can(user, 'document_templates.view');
  const mayViewRegistry = can(user, 'contract_templates_mx.view');
  const mayResolveSource = mayViewDocuments && mayViewRegistry;
  const organizationId = user?.organization_id ?? null;
  const hasFrozenEnvironment = frozenEnvironment === 'sandbox' || frozenEnvironment === 'production';

  const environmentQ = useQuery({
    queryKey: ['mx-contract-environment', organizationId],
    queryFn: fetchMxContractEnvironment,
    enabled: mayResolveSource && !hasFrozenEnvironment,
  });
  const activeEnvironment = hasFrozenEnvironment ? frozenEnvironment : environmentQ.data;

  const activeSourceQ = useQuery({
    queryKey: ['document-templates', organizationId, 'active-mx-contract-source', activeEnvironment],
    queryFn: () => resolveActiveSource(activeEnvironment!),
    enabled: mayResolveSource && Boolean(activeEnvironment),
  });
  const resolvedSourceId = activeSourceQ.data?.kind === 'ready'
    ? activeSourceQ.data.sourceId
    : null;
  const sourceQ = useQuery({
    queryKey: ['contract-templates-mx', organizationId, 'active-contract-source', activeEnvironment, resolvedSourceId],
    queryFn: () => fetchRegisteredSource(resolvedSourceId!),
    enabled: mayResolveSource && Boolean(activeEnvironment) && resolvedSourceId !== null,
  });
  const usableSource = isEligibleMxContractSource(sourceQ.data, activeEnvironment) ? sourceQ.data : undefined;
  const sourceAvailable = Boolean(usableSource);

  useEffect(() => {
    onAvailabilityChange?.(sourceAvailable);
  }, [onAvailabilityChange, sourceAvailable]);

  // A pending contract may point at an older registered row after the active
  // legal document changes. Clear that stale local choice once resolution is
  // authoritative, forcing the operator to select the one source that can pass
  // prepareActivation today.
  useEffect(() => {
    if (mayResolveSource && (hasFrozenEnvironment || environmentQ.isSuccess) && activeSourceQ.isSuccess
        && !sourceQ.isLoading && (!environmentQ.error || hasFrozenEnvironment)
        && !activeSourceQ.error && !sourceQ.error
        && value && (!usableSource || Number(value) !== Number(usableSource.id))) onChange('');
  }, [activeSourceQ.error, activeSourceQ.isSuccess, environmentQ.error, environmentQ.isSuccess,
    hasFrozenEnvironment, mayResolveSource, onChange, sourceQ.error, sourceQ.isLoading, usableSource, value]);

  const isLoading = mayResolveSource && ((!hasFrozenEnvironment && environmentQ.isLoading) || activeSourceQ.isLoading
    || (resolvedSourceId !== null && sourceQ.isLoading));
  const loadFailed = Boolean((!hasFrozenEnvironment && environmentQ.error)
    || activeSourceQ.error || sourceQ.error);
  const resolutionKind = activeSourceQ.data?.kind;
  const messageStyle: CSSProperties = {
    margin: '6px 0 0',
    color: 'var(--text-secondary)',
    fontSize: '0.78rem',
    lineHeight: 1.4,
  };
  const alertStyle: CSSProperties = { ...messageStyle, color: '#991b1b' };
  const fieldId = 'mx-registered-contract-source';
  const helpId = `${fieldId}-help`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle} htmlFor={fieldId}>
        {t('mxContractSource.label')}{required ? ' *' : ''}{' '}
        {activeEnvironment && <MxContractEnvironmentBadge environment={activeEnvironment} />}
      </label>
      <select
        id={fieldId}
        name="contract_template_mx_id"
        style={selectStyle}
        value={usableSource && Number(value) === usableSource.id ? value : ''}
        onChange={event => onChange(event.target.value)}
        disabled={disabled || !sourceAvailable || isLoading}
        required={required}
        aria-describedby={helpId}
      >
        <option value="">
          {isLoading ? t('common.loading') : t('mxContractSource.select')}
        </option>
        {usableSource && (
          <option value={usableSource.id}>{usableSource.template_name}</option>
        )}
      </select>

      <div id={helpId} aria-live="polite">
        {!mayResolveSource && (
          <p style={required ? alertStyle : messageStyle} role={required ? 'alert' : undefined}>
            {t(required ? 'mxContractSource.permissionRequired' : 'mxContractSource.serverDerivedHint')}
          </p>
        )}
        {loadFailed && (
          <p style={alertStyle} role="alert">
            {t('mxContractSource.loadError')}{' '}
            <button
              type="button"
              onClick={() => {
                if (!hasFrozenEnvironment && environmentQ.error) void environmentQ.refetch();
                if (activeSourceQ.error) void activeSourceQ.refetch();
                if (sourceQ.error) void sourceQ.refetch();
              }}
              style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}
            >
              {t('common.retry')}
            </button>
          </p>
        )}
        {!isLoading && !loadFailed && mayResolveSource && resolutionKind === 'missing' && (
          <p style={alertStyle} role="alert">{t('mxContractSource.noActiveDocument')}</p>
        )}
        {!isLoading && !loadFailed && mayResolveSource && resolutionKind === 'unlinked' && (
          <p style={alertStyle} role="alert">{t('mxContractSource.unlinkedDocument')}</p>
        )}
        {!isLoading && !loadFailed && mayResolveSource && resolutionKind === 'ambiguous' && (
          <p style={alertStyle} role="alert">{t('mxContractSource.ambiguousDocument')}</p>
        )}
        {!isLoading && !loadFailed && resolvedSourceId !== null && sourceQ.data && !usableSource && (
          <p style={alertStyle} role="alert">{t('mxContractSource.sourceNotUsable')}</p>
        )}
        <MxSandboxDocumentBanner environment={usableSource?.environment} />
        {usableSource && (
          <p style={messageStyle}>
            {usableSource.environment === 'sandbox'
              ? t('mxContractSource.sandboxEvidence', { version: usableSource.version })
              : t('mxContractSource.evidence', {
                number: usableSource.ift_registration_number,
                version: usableSource.version,
                date: String(usableSource.registered_at).slice(0, 10),
              })}
          </p>
        )}
        {!sourceAvailable && !isLoading && mayResolveSource && (
          <p style={messageStyle}>
            {t('mxContractSource.configureHint')}{' '}
            {user?.role === 'admin' && (
              <>
                <a href="/regulatory-compliance" style={{ color: 'var(--accent)' }}>
                  {t('mxContractSource.registryLink')}
                </a>
                {' · '}
                <a href="/document-templates" style={{ color: 'var(--accent)' }}>
                  {t('mxContractSource.documentsLink')}
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
