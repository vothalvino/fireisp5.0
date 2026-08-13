// =============================================================================
// FireISP 5.0 — Legal Document Templates (migration 447)
// =============================================================================
// Per-org Markdown legal texts: the arrival installation authorization, the
// PROFECO-registered activation contract (contrato de adhesión), a comodato
// annex for rented equipment, or custom documents. Activating a template is
// what switches on flow generation + the work-order signature gates — so the
// page is explicit about what activation means, and templates ship inactive.
// =============================================================================

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
} from '@/components/MxContractEnvironment';
import { extractApiError } from '@/components/ClientFormModal';
import { LEGAL_DOCUMENT_PLACEHOLDER_HELP } from '@/legalDocumentPlaceholders';
import { styles, modalStyles } from './crudStyles';

interface DocumentTemplate {
  id: number;
  template_type: 'installation_authorization' | 'activation_contract' | 'equipment_comodato' | 'custom';
  name: string;
  body_md: string;
  contract_template_mx_id: number | null;
  contract_template_mx_environment?: MxContractEnvironment | null;
  is_active: number;
  created_at: string;
}

interface RegisteredContractTemplateMx extends MxContractSourceEvidence {
  id: number;
  status: MxContractSourceStatus;
}

interface RegisteredContractTemplatePage {
  data: RegisteredContractTemplateMx[];
  meta?: { totalPages?: number };
}

const TYPES: DocumentTemplate['template_type'][] = [
  'installation_authorization', 'activation_contract', 'equipment_comodato', 'custom',
];

async function fetchTemplates(): Promise<DocumentTemplate[]> {
  const res = await (api.GET as unknown as (p: string) => Promise<{ data?: unknown; error?: unknown }>)('/document-templates');
  if (res.error) throw new Error('Failed to load templates');
  return (res.data as { data: DocumentTemplate[] }).data;
}

async function fetchRegisteredContractTemplates(): Promise<RegisteredContractTemplateMx[]> {
  const requestPage = async (page: number): Promise<RegisteredContractTemplatePage> => {
    const res = await (api.GET as unknown as (
      p: string,
      options?: unknown,
    ) => Promise<{ data?: unknown; error?: unknown }>)(
      '/consumer-protection/contract-templates-mx',
      { params: { query: { page, limit: 100, order_by: 'id', order: 'ASC' } } },
    );
    if (res.error) throw new Error('Failed to load MX contract sources');
    return (res.data as RegisteredContractTemplatePage | undefined) ?? { data: [] };
  };

  const firstPage = await requestPage(1);
  const totalPages = Math.max(1, Number(firstPage.meta?.totalPages) || 1);
  const remainingPages = totalPages > 1
    ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => requestPage(index + 2)))
    : [];
  const byId = new Map<number, RegisteredContractTemplateMx>();
  for (const source of [firstPage, ...remainingPages].flatMap(page => page.data ?? [])) {
    byId.set(source.id, {
      ...source,
      // Sources created before environments existed are real registered evidence.
      environment: source.environment ?? 'production',
    });
  }
  return [...byId.values()];
}

async function fetchRegisteredContractTemplate(id: number): Promise<RegisteredContractTemplateMx> {
  const res = await (api.GET as unknown as (
    p: string,
  ) => Promise<{ data?: unknown; error?: unknown }>)(`/consumer-protection/contract-templates-mx/${id}`);
  if (res.error) throw new Error('Failed to load the linked MX contract source');
  const source = (res.data as { data?: RegisteredContractTemplateMx } | undefined)?.data;
  if (!source) throw new Error('The linked MX contract source was not found');
  return { ...source, environment: source.environment ?? 'production' };
}

function isTerminalRegisteredSource(source: RegisteredContractTemplateMx | undefined): boolean {
  return source?.status === 'expired' || source?.status === 'revoked';
}

function TemplateModal({ initial, onClose, onSaved }: {
  initial: DocumentTemplate | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<DocumentTemplate['template_type']>(initial?.template_type ?? 'installation_authorization');
  const [body, setBody] = useState(initial?.body_md ?? '');
  const [registeredSourceId, setRegisteredSourceId] = useState<number | null>(initial?.contract_template_mx_id ?? null);
  const [active, setActive] = useState(Boolean(initial?.is_active));
  const [err, setErr] = useState('');
  const isActivationContract = type === 'activation_contract';
  const mayViewRegisteredSources = can(user, 'contract_templates_mx.view');
  const organizationId = user?.organization_id ?? null;
  const environmentQ = useQuery({
    queryKey: ['mx-contract-environment', organizationId],
    queryFn: fetchMxContractEnvironment,
    enabled: isActivationContract && mayViewRegisteredSources,
  });
  const sourcesQ = useQuery({
    queryKey: ['contract-templates-mx', organizationId, 'legal-document-source-picker'],
    queryFn: fetchRegisteredContractTemplates,
    enabled: isActivationContract && mayViewRegisteredSources,
  });
  const initialSourceId = initial?.contract_template_mx_id ?? null;
  const initialSourceMissing = Boolean(
    initialSourceId
      && sourcesQ.isSuccess
      && !(sourcesQ.data ?? []).some(source => source.id === initialSourceId),
  );
  const exactInitialSourceQ = useQuery({
    queryKey: ['contract-templates-mx', organizationId, 'legal-document-source', initialSourceId],
    queryFn: () => fetchRegisteredContractTemplate(initialSourceId!),
    enabled: isActivationContract && mayViewRegisteredSources && initialSourceMissing,
  });
  const availableSources = exactInitialSourceQ.data
    ? [...(sourcesQ.data ?? []), exactInitialSourceQ.data]
    : (sourcesQ.data ?? []);
  const selectedSource = availableSources.find(source => source.id === registeredSourceId);
  const selectedSourceIsEligible = isEligibleMxContractSource(selectedSource);
  const isExactTerminalSourceDeactivation = Boolean(
    initial
      && initial.template_type === 'activation_contract'
      && Boolean(initial.is_active)
      && isActivationContract
      && !active
      && isTerminalRegisteredSource(selectedSource)
      && registeredSourceId === initial.contract_template_mx_id
      && name === initial.name
      && body === initial.body_md,
  );
  const isExactLegacyUnlinkedDeactivation = Boolean(
    initial
      && initial.template_type === 'activation_contract'
      && Boolean(initial.is_active)
      && initial.contract_template_mx_id === null
      && type === initial.template_type
      && !active
      && registeredSourceId === null
      && name === initial.name
      && body === initial.body_md,
  );

  // The registered row is the evidence source. Never let a second, subtly
  // different copy be typed into document_templates: copy both fields exactly
  // whenever the selected row arrives or changes.
  useEffect(() => {
    // A terminal source is no longer selectable legal content. Preserve the
    // currently-active template byte-for-byte so the operator can perform the
    // one safe action the API permits: an exact active -> inactive transition.
    if (!isActivationContract || !isEligibleMxContractSource(selectedSource)) return;
    setName(selectedSource.template_name);
    setBody(selectedSource.template_body ?? '');
  }, [isActivationContract, selectedSource]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        // For MX activation contracts, preserve the source name byte-for-byte
        // just as we do its body. Other document types retain the existing
        // whitespace-normalising behaviour.
        name: isActivationContract ? name : name.trim(),
        template_type: type,
        body_md: body,
        contract_template_mx_id: isActivationContract ? registeredSourceId : null,
        is_active: active,
      };
      const call = initial
        ? (api.PUT as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates/{id}', { params: { path: { id: initial.id } }, body: payload })
        : (api.POST as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates', { body: payload });
      const res = await call;
      if (res.error) throw new Error(extractApiError(res.error, 'Failed to save the template'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'Failed to save the template'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isActivationContract
      && !selectedSourceIsEligible
      && !isExactTerminalSourceDeactivation
      && !isExactLegacyUnlinkedDeactivation) {
      setErr(t('documentTemplates.registeredSourceRequired'));
      return;
    }
    if (!name.trim()) { setErr(t('documentTemplates.nameRequired')); return; }
    if (!body.trim()) { setErr(t('documentTemplates.bodyRequired')); return; }
    setErr('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 720 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={initial ? 'Edit template' : 'New template'}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{initial ? t('documentTemplates.edit') : t('documentTemplates.new')}</h2>
        </div>
        <form style={modalStyles.form} onSubmit={submit}>
          <label style={modalStyles.label}>
            {t('documentTemplates.name')} *
            <input
              style={modalStyles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={200}
              readOnly={isActivationContract}
            />
          </label>
          <label style={modalStyles.label}>
            {t('documentTemplates.type')} *
            <select
              style={modalStyles.input}
              value={type}
              onChange={e => {
                const nextType = e.target.value as DocumentTemplate['template_type'];
                setType(nextType);
                setActive(false);
                if (nextType !== 'activation_contract') setRegisteredSourceId(null);
              }}
            >
              {TYPES.map(tp => <option key={tp} value={tp}>{t(`documentTemplates.types.${tp}`)}</option>)}
            </select>
          </label>
          {isActivationContract && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={modalStyles.label} htmlFor="registered-contract-source">
                {t('documentTemplates.registeredSource')} *
                <select
                  id="registered-contract-source"
                  style={modalStyles.input}
                  value={registeredSourceId ?? ''}
                  onChange={e => {
                    const nextId = Number(e.target.value) || null;
                    setRegisteredSourceId(nextId);
                    setActive(false);
                    setErr('');
                  }}
                  disabled={!mayViewRegisteredSources || sourcesQ.isLoading || exactInitialSourceQ.isLoading
                    || Boolean(sourcesQ.error || exactInitialSourceQ.error)}
                >
                  <option value="">{sourcesQ.isLoading ? t('common.loading') : t('documentTemplates.selectRegisteredSource')}</option>
                  {(['sandbox', 'production'] as const).map(environment => (
                    <optgroup
                      key={environment}
                      label={t(`mxContractEnvironment.environments.${environment}`)}
                    >
                      {availableSources
                        .filter(source => source.environment === environment)
                        .map(source => (
                          <option key={source.id} value={source.id} disabled={!isEligibleMxContractSource(source)}>
                            {source.template_name} · {t(`documentTemplates.registrationStatuses.${source.status}`)}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {environmentQ.data && (
                <p style={{ ...styles.msg, margin: 0 }}>
                  {t('documentTemplates.currentEnvironment')}{' '}
                  <MxContractEnvironmentBadge environment={environmentQ.data} />
                </p>
              )}
              {!mayViewRegisteredSources && <p style={styles.msgError}>{t('documentTemplates.registeredSourcePermission')}</p>}
              {(sourcesQ.error || exactInitialSourceQ.error) && <p style={styles.msgError}>{t('documentTemplates.registeredSourceLoadError')}</p>}
              {!sourcesQ.isLoading && !exactInitialSourceQ.isLoading
                && !sourcesQ.error && !exactInitialSourceQ.error && mayViewRegisteredSources
                && !availableSources.some(source => isEligibleMxContractSource(source))
                && <p style={styles.msg}>{t('documentTemplates.noRegisteredSources')}</p>}
              {selectedSource && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: '0.82rem' }}>
                  <strong>{t('documentTemplates.sourceEvidence')}</strong>{' '}
                  <MxContractEnvironmentBadge environment={selectedSource.environment} />
                  <MxSandboxDocumentBanner environment={selectedSource.environment} />
                  <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 12px', margin: '10px 0 0' }}>
                    {selectedSource.environment === 'production' && (
                      <>
                        <dt>{t('documentTemplates.registrationNumber')}</dt><dd style={{ margin: 0 }}>{selectedSource.ift_registration_number || '—'}</dd>
                        <dt>{t('documentTemplates.registrationDate')}</dt><dd style={{ margin: 0 }}>{selectedSource.registered_at ? String(selectedSource.registered_at).slice(0, 10) : '—'}</dd>
                      </>
                    )}
                    <dt>{t('documentTemplates.registrationVersion')}</dt><dd style={{ margin: 0 }}>{selectedSource.version || '—'}</dd>
                    <dt>{t('documentTemplates.registrationStatus')}</dt><dd style={{ margin: 0 }}>{t(`documentTemplates.registrationStatuses.${selectedSource.status}`)}</dd>
                  </dl>
                  {!selectedSourceIsEligible && <p style={{ ...styles.msgError, marginBottom: 0 }}>{t('documentTemplates.registeredSourceIncomplete')}</p>}
                </div>
              )}
            </div>
          )}
          <label style={modalStyles.label}>
            {t('documentTemplates.body')} *
            <textarea
              style={{ ...modalStyles.input, minHeight: 260, fontFamily: 'monospace', fontSize: '0.82rem' }}
              value={body}
              onChange={e => setBody(e.target.value)}
              readOnly={isActivationContract}
            />
          </label>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('documentTemplates.placeholders')}: <code style={{ fontSize: '0.72rem' }}>{LEGAL_DOCUMENT_PLACEHOLDER_HELP}</code>
          </p>
          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={e => setActive(e.target.checked)}
              disabled={isActivationContract && !active && !selectedSourceIsEligible
                && !isExactTerminalSourceDeactivation && !isExactLegacyUnlinkedDeactivation}
            />
            {t('documentTemplates.activeToggle')}
          </label>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('documentTemplates.activeHint')}
          </p>
          {err && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: 0 }}>{err}</p>}
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DocumentTemplates() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  // STRICTLY MX (user decision): the backend 403s every template verb for
  // non-MX orgs; the nav entry is requiredLocale-gated. This covers a typed
  // URL with an explanation instead of an error page.
  const isMxOrg = user?.organization_locale === 'MX';
  const mayViewTemplates = can(user, 'document_templates.view');
  const mayCreateTemplates = can(user, 'document_templates.create');
  const mayUpdateTemplates = can(user, 'document_templates.update');
  const mayDeleteTemplates = can(user, 'document_templates.delete');
  const mayViewRegisteredSources = can(user, 'contract_templates_mx.view');
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [showNew, setShowNew] = useState(false);

  const organizationId = user?.organization_id ?? null;
  const q = useQuery({
    queryKey: ['document-templates', organizationId, 'legal-document-admin'],
    queryFn: fetchTemplates,
    enabled: isMxOrg && mayViewTemplates,
  });
  const environmentQ = useQuery({
    queryKey: ['mx-contract-environment', organizationId],
    queryFn: fetchMxContractEnvironment,
    enabled: isMxOrg && mayViewRegisteredSources,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await (api.DELETE as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates/{id}', { params: { path: { id } } });
      if (res.error) throw new Error('Failed to delete');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-templates', organizationId] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['document-templates', organizationId] });

  if (!isMxOrg) {
    return (
      <div style={styles.page}>
        <h1 style={styles.pageTitle}>📜 {t('documentTemplates.title')}</h1>
        <p style={styles.msg}>{t('documentTemplates.mxOnly')}</p>
      </div>
    );
  }

  if (!mayViewTemplates) {
    return (
      <div style={styles.page}>
        <h1 style={styles.pageTitle}>📜 {t('documentTemplates.title')}</h1>
        <p style={styles.msg}>{t('documentTemplates.viewPermission')}</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📜 {t('documentTemplates.title')}</h1>
        {mayCreateTemplates && (
          <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
            + {t('documentTemplates.new')}
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {t('documentTemplates.intro')}
      </p>
      {environmentQ.data && (
        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {t('documentTemplates.currentEnvironment')}{' '}
          <MxContractEnvironmentBadge environment={environmentQ.data} />{' '}
          {t('documentTemplates.bothLanesHint')}
        </p>
      )}

      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>{t('common.loading')}</p>
          : q.error ? <p style={styles.msgError}>{t('documentTemplates.loadError')}</p>
            : !(q.data ?? []).length ? <p style={styles.msg}>{t('documentTemplates.empty')}</p>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>{[t('documentTemplates.name'), t('documentTemplates.type'), t('documentTemplates.environment'), t('documentTemplates.status'), ''].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(q.data ?? []).map(tpl => (
                        <tr key={tpl.id} style={styles.tr}>
                          <td style={{ ...styles.td, fontWeight: 500 }}>{tpl.name}</td>
                          <td style={styles.td}>{t(`documentTemplates.types.${tpl.template_type}`)}</td>
                          <td style={styles.td}>
                            {tpl.template_type === 'activation_contract' && tpl.contract_template_mx_environment
                              ? <MxContractEnvironmentBadge environment={tpl.contract_template_mx_environment} />
                              : '—'}
                          </td>
                          <td style={styles.td}>
                            {tpl.is_active
                              ? <span style={{ color: 'var(--accent, #16a34a)', fontWeight: 600 }}>{t('documentTemplates.active')}</span>
                              : <span style={{ color: 'var(--text-secondary)' }}>{t('documentTemplates.inactive')}</span>}
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            {mayUpdateTemplates && (
                              <button style={styles.actionBtn} onClick={() => setEditing(tpl)}>{t('common.edit')}</button>
                            )}
                            {mayDeleteTemplates && (
                              <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => deleteMutation.mutate(tpl.id)}>{t('common.delete')}</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </div>

      {mayCreateTemplates && showNew && <TemplateModal initial={null} onClose={() => setShowNew(false)} onSaved={refresh} />}
      {mayUpdateTemplates && editing && <TemplateModal initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}
