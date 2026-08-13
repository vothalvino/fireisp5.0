import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';

export type MxContractEnvironment = 'sandbox' | 'production';
export type MxContractSourceStatus =
  | 'draft'
  | 'submitted'
  | 'sandbox_ready'
  | 'registered'
  | 'expired'
  | 'revoked';

export interface MxContractSourceEvidence {
  environment: MxContractEnvironment;
  status: MxContractSourceStatus;
  template_name: string;
  version: string | null;
  template_body: string | null;
  ift_registration_number: string | null;
  registered_at: string | null;
}

export async function fetchMxContractEnvironment(): Promise<MxContractEnvironment> {
  const response = await (api.GET as unknown as (
    path: string,
  ) => Promise<{ data?: unknown; error?: unknown }>)('/consumer-protection/contract-environment');
  if (response.error) throw new Error('Failed to load the MX contract environment');
  const environment = (response.data as {
    data?: { contract_environment?: string };
  } | undefined)?.data?.contract_environment;
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('The MX contract environment response is invalid');
  }
  return environment;
}

export function isEligibleMxContractSource<T extends MxContractSourceEvidence>(
  source: T | undefined,
  expectedEnvironment?: MxContractEnvironment,
): source is T {
  if (!source
      || (expectedEnvironment && source.environment !== expectedEnvironment)
      || !source.template_name?.trim()
      || !source.version?.trim()
      || !source.template_body?.trim()) return false;

  if (source.environment === 'sandbox') return source.status === 'sandbox_ready';
  return Boolean(
    source.status === 'registered'
      && source.ift_registration_number?.trim()
      && source.registered_at,
  );
}

export function MxContractEnvironmentBadge({ environment }: {
  environment: MxContractEnvironment;
}) {
  const { t } = useTranslation();
  const sandbox = environment === 'sandbox';
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 7px',
    borderRadius: 4,
    border: `1px solid ${sandbox ? '#f59e0b' : '#15803d'}`,
    background: sandbox ? '#fffbeb' : '#f0fdf4',
    color: sandbox ? '#92400e' : '#166534',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  };
  return <span style={style}>{t(`mxContractEnvironment.environments.${environment}`)}</span>;
}

/**
 * Customer-facing safety marker. The backend also freezes the warning into the
 * rendered document body; this independent banner keeps the test nature clear
 * even in read/signing UIs that style or truncate Markdown.
 */
export function MxSandboxDocumentBanner({ environment }: {
  environment?: MxContractEnvironment | null;
}) {
  const { t } = useTranslation();
  if (environment !== 'sandbox') return null;

  return (
    <div
      role="alert"
      data-testid="mx-contract-sandbox-banner"
      style={{
        border: '2px solid #b45309',
        background: '#fffbeb',
        color: '#78350f',
        padding: '10px 12px',
        marginBottom: 12,
        borderRadius: 6,
        fontWeight: 700,
        lineHeight: 1.45,
      }}
    >
      {t('mxContractEnvironment.documentWarning')}
    </div>
  );
}
