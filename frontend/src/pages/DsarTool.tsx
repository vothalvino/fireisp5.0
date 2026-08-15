// =============================================================================
// FireISP 5.0 — DSAR (Data Subject Access Request) Tool
// =============================================================================
// Admin page at /dsar. Operators enter a client ID to assemble the enumerated
// FireISP datasets attributable to that client (LFPDPPP / GDPR data-subject
// access request) via GET /dsar/clients/{id}, review the declared export scope,
// and download the JSON document for case review. This is a read/export tool,
// so there are no mutations.
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DsarExportData {
  client: { id: number; name: string; email: string | null } & Record<string, unknown>;
  contacts: unknown[];
  mxProfile: unknown | null;
  mxProfiles: unknown[];
  contracts: unknown[];
  invoices: unknown[];
  payments: unknown[];
  tickets: unknown[];
  connectionLogs: unknown[];
  radiusAccountingEvents: unknown[];
  radiusAccountingUsageDaily: unknown[];
  cgnatAttributionBindings: unknown[];
  cgnatAttributionEvents: unknown[];
  ipAssignments: unknown[];
  aiReplyLogs: unknown[];
}

type DsarCollectionKey = Exclude<keyof DsarExportData, 'client' | 'mxProfile'>;
type DsarCollectionCounts = Partial<Record<DsarCollectionKey, number>>;

interface DsarExport {
  meta: {
    generatedAt: string;
    requestedBy?: string | null;
    clientId: number;
    organizationId: number;
    version: string;
    completeForEnumeratedDatasets: boolean;
    collectionCounts: DsarCollectionCounts;
    scope: {
      description: string | null;
      organizationScoped: boolean;
      connectionAttribution: string | null;
      compatibilityViews: string | null;
      allStorageSystemsCovered: boolean;
    };
    cancellation: {
      automaticDeletionPerformed: boolean;
      handling: string | null;
      notice: string | null;
    };
  };
  data: DsarExportData;
}

// Sections of the export shown in the summary table, in display order.
const SECTIONS: { key: DsarCollectionKey; labelKey: string }[] = [
  { key: 'contacts', labelKey: 'dsarTool.sections.contacts' },
  { key: 'mxProfiles', labelKey: 'dsarTool.sections.mxProfiles' },
  { key: 'contracts', labelKey: 'dsarTool.sections.contracts' },
  { key: 'invoices', labelKey: 'dsarTool.sections.invoices' },
  { key: 'payments', labelKey: 'dsarTool.sections.payments' },
  { key: 'tickets', labelKey: 'dsarTool.sections.tickets' },
  { key: 'connectionLogs', labelKey: 'dsarTool.sections.connectionLogs' },
  { key: 'radiusAccountingEvents', labelKey: 'dsarTool.sections.radiusAccountingEvents' },
  { key: 'radiusAccountingUsageDaily', labelKey: 'dsarTool.sections.radiusAccountingUsageDaily' },
  { key: 'cgnatAttributionBindings', labelKey: 'dsarTool.sections.cgnatAttributionBindings' },
  { key: 'cgnatAttributionEvents', labelKey: 'dsarTool.sections.cgnatAttributionEvents' },
  { key: 'ipAssignments', labelKey: 'dsarTool.sections.ipAssignments' },
  { key: 'aiReplyLogs', labelKey: 'dsarTool.sections.aiReplyLogs' },
];

function collectionCount(result: DsarExport, key: DsarCollectionKey): number {
  const reportedCount = result.meta.collectionCounts[key];
  return Number.isSafeInteger(reportedCount) && Number(reportedCount) >= 0
    ? Number(reportedCount)
    : Array.isArray(result.data[key]) ? result.data[key].length : 0;
}

function formatDateTime(value: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchDsar(id: number): Promise<DsarExport> {
  const res = await api.GET('/dsar/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to assemble DSAR export');
  return res.data as unknown as DsarExport;
}

function downloadJson(payload: DsarExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dsar-client-${payload.meta.clientId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// DsarTool component
// ---------------------------------------------------------------------------

export function DsarTool() {
  const { t, i18n } = useTranslation();
  const [clientId, setClientId] = useState('');

  const mutation = useMutation({
    mutationFn: (id: number) => fetchDsar(id),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(clientId.trim());
    if (!Number.isInteger(id) || id <= 0) return;
    mutation.mutate(id);
  }

  const result = mutation.data;
  const yes = t('dsarTool.values.yes');
  const no = t('dsarTool.values.no');
  const notReported = t('dsarTool.values.notReported');
  const generatedAt = result
    ? formatDateTime(result.meta.generatedAt, i18n.resolvedLanguage || i18n.language) || notReported
    : notReported;
  const cancellationHandling = result?.meta.cancellation.handling === 'review_required'
    ? t('dsarTool.cancellation.handlingValues.reviewRequired')
    : result?.meta.cancellation.handling?.trim() || notReported;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>
          <span aria-hidden="true">🔐 </span>{t('dsarTool.title')}
        </h1>
      </div>

      <p id="dsar-tool-description" style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 720 }}>
        {t('dsarTool.intro')}
      </p>

      <form
        onSubmit={handleSubmit}
        aria-label={t('dsarTool.form.ariaLabel')}
        aria-describedby="dsar-tool-description"
        style={{ ...styles.filterRow, alignItems: 'flex-end' }}
      >
        <label htmlFor="dsar-client-id" style={{ ...styles.filterLabel, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {t('dsarTool.form.clientId')}
          <input
            id="dsar-client-id"
            style={{ ...styles.filterSelect, width: 160, cursor: 'text' }}
            type="number"
            min={1}
            step={1}
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder={t('dsarTool.form.placeholder')}
          />
        </label>
        <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending || !clientId.trim()}>
          {mutation.isPending ? t('dsarTool.form.assembling') : t('dsarTool.form.assemble')}
        </button>
        {result && (
          <button
            type="button"
            aria-label={t('dsarTool.form.downloadAria')}
            style={styles.btnSecondary}
            onClick={() => downloadJson(result)}
          >
            <span aria-hidden="true">⬇ </span>{t('dsarTool.form.download')}
          </button>
        )}
      </form>

      {mutation.isError && (
        <p role="alert" style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {t('dsarTool.error')}
        </p>
      )}

      {result && (
        <div style={styles.tableCard}>
          <div
            role="group"
            aria-label={t('dsarTool.summary.ariaLabel')}
            style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              {result.data.client.name} (#{result.data.client.id})
            </strong>
            <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.8rem', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
              <div><dt style={{ display: 'inline', fontWeight: 600 }}>{t('dsarTool.summary.email')}: </dt><dd style={{ display: 'inline', margin: 0 }}>{result.data.client.email || t('dsarTool.summary.noEmail')}</dd></div>
              <div><dt style={{ display: 'inline', fontWeight: 600 }}>{t('dsarTool.summary.generated')}: </dt><dd style={{ display: 'inline', margin: 0 }}>{generatedAt}</dd></div>
              <div><dt style={{ display: 'inline', fontWeight: 600 }}>{t('dsarTool.summary.schema')}: </dt><dd style={{ display: 'inline', margin: 0 }}>v{result.meta.version}</dd></div>
              <div><dt style={{ display: 'inline', fontWeight: 600 }}>{t('dsarTool.summary.requestedBy')}: </dt><dd style={{ display: 'inline', margin: 0 }}>{result.meta.requestedBy?.trim() || notReported}</dd></div>
            </dl>
          </div>
          <div
            role="group"
            aria-label={t('dsarTool.scope.ariaLabel')}
            style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>{t('dsarTool.scope.title')}</strong>
            <p style={{ margin: '0.35rem 0 0.45rem' }}>{t('dsarTool.scope.framing')}</p>
            <p style={{ margin: '0 0 0.6rem' }}>
              <strong>{t('dsarTool.scope.serverDescription')}: </strong>
              {result.meta.scope.description?.trim() || t('dsarTool.scope.serverDescriptionFallback')}
            </p>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(190px, max-content) 1fr',
                gap: '0.3rem 0.75rem',
                margin: 0,
              }}
            >
              <dt>{t('dsarTool.scope.completeForEnumeratedDatasets')}</dt>
              <dd style={{ margin: 0 }}>{result.meta.completeForEnumeratedDatasets ? yes : no}</dd>
              <dt>{t('dsarTool.scope.organizationScoped')}</dt>
              <dd style={{ margin: 0 }}>{result.meta.scope.organizationScoped ? yes : no}</dd>
              <dt>{t('dsarTool.scope.allStorageSystemsCovered')}</dt>
              <dd style={{ margin: 0 }}>
                {result.meta.scope.allStorageSystemsCovered
                  ? yes
                  : t('dsarTool.scope.externalSystemsReview')}
              </dd>
              <dt>{t('dsarTool.scope.connectionAttribution')}</dt>
              <dd style={{ margin: 0 }}>{result.meta.scope.connectionAttribution?.trim() || notReported}</dd>
              <dt>{t('dsarTool.scope.compatibilityViews')}</dt>
              <dd style={{ margin: 0 }}>{result.meta.scope.compatibilityViews?.trim() || notReported}</dd>
            </dl>
          </div>
          <div
            role="note"
            aria-label={t('dsarTool.cancellation.ariaLabel')}
            style={{
              margin: '0.75rem 1rem',
              padding: '0.65rem 0.75rem',
              border: '1px solid var(--warning)',
              borderRadius: 6,
              background: 'var(--warning-soft)',
              color: 'var(--text-secondary)',
              fontSize: '0.82rem',
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>{t('dsarTool.cancellation.title')}</strong>{' '}
            {t('dsarTool.cancellation.framing')}
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, max-content) 1fr', gap: '0.3rem 0.75rem', margin: '0.55rem 0 0' }}>
              <dt>{t('dsarTool.cancellation.automaticDeletionPerformed')}</dt>
              <dd style={{ margin: 0 }}>{result.meta.cancellation.automaticDeletionPerformed ? yes : no}</dd>
              <dt>{t('dsarTool.cancellation.handling')}</dt>
              <dd style={{ margin: 0 }}>{cancellationHandling}</dd>
              <dt>{t('dsarTool.cancellation.serverNotice')}</dt>
              <dd style={{ margin: 0 }}>
                {result.meta.cancellation.notice?.trim() || t('dsarTool.cancellation.serverNoticeFallback')}
              </dd>
            </dl>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table aria-label={t('dsarTool.table.ariaLabel')} style={styles.table}>
              <caption style={{ padding: '0 1rem 0.6rem', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {t('dsarTool.table.caption')}
              </caption>
              <thead>
                <tr>
                  <th style={styles.th}>{t('dsarTool.table.section')}</th>
                  <th style={styles.th}>{t('dsarTool.table.records')}</th>
                </tr>
              </thead>
              <tbody>
                <tr style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 500 }}>{t('dsarTool.sections.mxProfile')}</td>
                  <td style={styles.td}>{result.data.mxProfile ? t('dsarTool.table.present') : '—'}</td>
                </tr>
                {SECTIONS.map(s => (
                  <tr key={s.key} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{t(s.labelKey)}</td>
                    <td style={styles.td}>{collectionCount(result, s.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
