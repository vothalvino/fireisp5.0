import { useEffect, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';

interface ActivationDocumentTemplate {
  id: number;
  template_type: string;
  contract_template_mx_id: number | null;
  is_active: boolean | number;
}

export interface RegisteredContractSource {
  id: number;
  template_name: string;
  ift_registration_number: string | null;
  registered_at: string | null;
  version: string | null;
  template_body: string | null;
  status: 'draft' | 'submitted' | 'registered' | 'expired' | 'revoked';
}

type ActiveSourceResolution =
  | { kind: 'ready'; sourceId: number }
  | { kind: 'missing' | 'unlinked' | 'ambiguous' };

async function resolveActiveSource(): Promise<ActiveSourceResolution> {
  const res = await (api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>)('/document-templates');
  if (res.error) throw new Error('Failed to load active activation documents');

  const templates = ((res.data as { data?: ActivationDocumentTemplate[] } | undefined)?.data ?? [])
    .filter(template => template.template_type === 'activation_contract' && Boolean(template.is_active));
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
  return source;
}

function isUsableRegisteredSource(source: RegisteredContractSource | undefined): source is RegisteredContractSource {
  return Boolean(
    source
      && source.status === 'registered'
      && source.template_name?.trim()
      && source.ift_registration_number?.trim()
      && source.registered_at
      && source.version?.trim()
      && source.template_body?.trim(),
  );
}

export interface MxRegisteredContractSourceFieldProps {
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
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

  const activeSourceQ = useQuery({
    queryKey: ['document-templates', 'active-mx-contract-source'],
    queryFn: resolveActiveSource,
    enabled: mayResolveSource,
  });
  const resolvedSourceId = activeSourceQ.data?.kind === 'ready'
    ? activeSourceQ.data.sourceId
    : null;
  const sourceQ = useQuery({
    queryKey: ['contract-templates-mx', 'active-contract-source', resolvedSourceId],
    queryFn: () => fetchRegisteredSource(resolvedSourceId!),
    enabled: mayResolveSource && resolvedSourceId !== null,
  });
  const usableSource = isUsableRegisteredSource(sourceQ.data) ? sourceQ.data : undefined;
  const sourceAvailable = Boolean(usableSource);

  useEffect(() => {
    onAvailabilityChange?.(sourceAvailable);
  }, [onAvailabilityChange, sourceAvailable]);

  // A pending contract may point at an older registered row after the active
  // legal document changes. Clear that stale local choice once resolution is
  // authoritative, forcing the operator to select the one source that can pass
  // prepareActivation today.
  useEffect(() => {
    if (usableSource && value && Number(value) !== Number(usableSource.id)) onChange('');
  }, [onChange, usableSource, value]);

  const isLoading = mayResolveSource && (activeSourceQ.isLoading
    || (resolvedSourceId !== null && sourceQ.isLoading));
  const loadFailed = Boolean(activeSourceQ.error || sourceQ.error);
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
        {t('mxContractSource.label')}{required ? ' *' : ''}
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
        {usableSource && (
          <p style={messageStyle}>
            {t('mxContractSource.evidence', {
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
