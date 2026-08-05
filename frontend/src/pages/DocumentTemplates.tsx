// =============================================================================
// FireISP 5.0 — Legal Document Templates (migration 447)
// =============================================================================
// Per-org Markdown legal texts: the arrival installation authorization, the
// PROFECO-registered activation contract (contrato de adhesión), a comodato
// annex for rented equipment, or custom documents. Activating a template is
// what switches on flow generation + the work-order signature gates — so the
// page is explicit about what activation means, and templates ship inactive.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles } from './crudStyles';

interface DocumentTemplate {
  id: number;
  template_type: 'installation_authorization' | 'activation_contract' | 'equipment_comodato' | 'custom';
  name: string;
  body_md: string;
  is_active: number;
  created_at: string;
}

const TYPES: DocumentTemplate['template_type'][] = [
  'installation_authorization', 'activation_contract', 'equipment_comodato', 'custom',
];

const PLACEHOLDER_HELP = '{{client.name}} {{client.address}} {{client.rfc}} {{client.curp}} {{client.razon_social}} {{contract.id}} {{plan.name}} {{plan.price}} {{order.number}} {{order.address}} {{org.name}} {{org.razon_social}} {{org.rfc}} {{date}}';

async function fetchTemplates(): Promise<DocumentTemplate[]> {
  const res = await (api.GET as unknown as (p: string) => Promise<{ data?: unknown; error?: unknown }>)('/document-templates');
  if (res.error) throw new Error('Failed to load templates');
  return (res.data as { data: DocumentTemplate[] }).data;
}

function TemplateModal({ initial, onClose, onSaved }: {
  initial: DocumentTemplate | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<DocumentTemplate['template_type']>(initial?.template_type ?? 'installation_authorization');
  const [body, setBody] = useState(initial?.body_md ?? '');
  const [active, setActive] = useState(Boolean(initial?.is_active));
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), template_type: type, body_md: body, is_active: active };
      const call = initial
        ? (api.PUT as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates/{id}', { params: { path: { id: initial.id } }, body: payload })
        : (api.POST as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates', { body: payload });
      const res = await call;
      if (res.error) throw new Error('Failed to save the template');
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : 'Failed to save the template'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
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
            <input style={modalStyles.input} value={name} onChange={e => setName(e.target.value)} maxLength={200} />
          </label>
          <label style={modalStyles.label}>
            {t('documentTemplates.type')} *
            <select style={modalStyles.input} value={type} onChange={e => setType(e.target.value as DocumentTemplate['template_type'])}>
              {TYPES.map(tp => <option key={tp} value={tp}>{t(`documentTemplates.types.${tp}`)}</option>)}
            </select>
          </label>
          <label style={modalStyles.label}>
            {t('documentTemplates.body')} *
            <textarea
              style={{ ...modalStyles.input, minHeight: 260, fontFamily: 'monospace', fontSize: '0.82rem' }}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </label>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('documentTemplates.placeholders')}: <code style={{ fontSize: '0.72rem' }}>{PLACEHOLDER_HELP}</code>
          </p>
          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
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
  const qc = useQueryClient();
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [showNew, setShowNew] = useState(false);

  const q = useQuery({ queryKey: ['document-templates'], queryFn: fetchTemplates });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await (api.DELETE as unknown as (p: string, o: unknown) => Promise<{ error?: unknown }>)('/document-templates/{id}', { params: { path: { id } } });
      if (res.error) throw new Error('Failed to delete');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document-templates'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['document-templates'] });

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📜 {t('documentTemplates.title')}</h1>
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + {t('documentTemplates.new')}
        </button>
      </div>
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {t('documentTemplates.intro')}
      </p>

      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>{t('common.loading')}</p>
          : q.error ? <p style={styles.msgError}>{t('documentTemplates.loadError')}</p>
            : !(q.data ?? []).length ? <p style={styles.msg}>{t('documentTemplates.empty')}</p>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>{[t('documentTemplates.name'), t('documentTemplates.type'), t('documentTemplates.status'), ''].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(q.data ?? []).map(tpl => (
                        <tr key={tpl.id} style={styles.tr}>
                          <td style={{ ...styles.td, fontWeight: 500 }}>{tpl.name}</td>
                          <td style={styles.td}>{t(`documentTemplates.types.${tpl.template_type}`)}</td>
                          <td style={styles.td}>
                            {tpl.is_active
                              ? <span style={{ color: 'var(--accent, #16a34a)', fontWeight: 600 }}>{t('documentTemplates.active')}</span>
                              : <span style={{ color: 'var(--text-secondary)' }}>{t('documentTemplates.inactive')}</span>}
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            <button style={styles.actionBtn} onClick={() => setEditing(tpl)}>{t('common.edit')}</button>
                            <button style={{ ...styles.actionBtn, color: '#991b1b' }} onClick={() => deleteMutation.mutate(tpl.id)}>{t('common.delete')}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </div>

      {showNew && <TemplateModal initial={null} onClose={() => setShowNew(false)} onSaved={refresh} />}
      {editing && <TemplateModal initial={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}
