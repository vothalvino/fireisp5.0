// =============================================================================
// FireISP 5.0 — Config Template Management — §6.6
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

interface ConfigTemplate {
  id: number;
  name: string;
  description: string | null;
  device_type: string | null;
  manufacturer: string | null;
  template_content: string;
  status: string;
}

interface ConfigTemplatesResponse {
  data: ConfigTemplate[];
  meta: { total: number; page: number; limit: number };
}

interface ConfigTemplateBody {
  name: string;
  description?: string;
  device_type?: string;
  manufacturer?: string;
  template_content: string;
  status?: string;
}

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive', 'draft'];

async function fetchTemplates(page: number): Promise<ConfigTemplatesResponse> {
  const res = await api.GET('/config-templates' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load config templates');
  return (res as { data: unknown }).data as unknown as ConfigTemplatesResponse;
}

async function createTemplate(body: ConfigTemplateBody): Promise<void> {
  const res = await api.POST('/config-templates' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create config template');
}

async function updateTemplate(id: number, body: Partial<ConfigTemplateBody>): Promise<void> {
  const res = await api.PUT('/config-templates/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update config template');
}

async function deleteTemplate(id: number): Promise<void> {
  const res = await api.DELETE('/config-templates/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete config template');
}

async function deployTemplate(id: number, deviceId: number, variables: Record<string, string> | null): Promise<void> {
  const res = await api.POST('/config-templates/{id}/deploy' as never, {
    params: { path: { id } },
    body: { device_id: deviceId, variables } as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to deploy config template');
}

interface TemplateFormProps {
  initial: Partial<ConfigTemplate>;
  onSave: (body: ConfigTemplateBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function TemplateForm({ initial, onSave, onClose, saving, editMode }: TemplateFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [deviceType, setDeviceType] = useState(initial.device_type ?? '');
  const [manufacturer, setManufacturer] = useState(initial.manufacturer ?? '');
  const [templateContent, setTemplateContent] = useState(initial.template_content ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: ConfigTemplateBody = { name, template_content: templateContent, status };
    if (description) body.description = description;
    if (deviceType) body.device_type = deviceType;
    if (manufacturer) body.manufacturer = manufacturer;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('config_templates.edit') : t('config_templates.new')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_templates.name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_templates.description')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('config_templates.device_type')}</label>
              <input style={inp} value={deviceType} onChange={e => setDeviceType(e.target.value)} placeholder="e.g. router" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('config_templates.manufacturer')}</label>
              <input style={inp} value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. MikroTik" />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_templates.template_content')}<RequiredMark /></label>
            <textarea style={{ ...inp, minHeight: 120, fontFamily: 'monospace', resize: 'vertical' as const }} value={templateContent} onChange={e => setTemplateContent(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('config_templates.status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeployDialogProps {
  templateId: number;
  onDeploy: (deviceId: number, variables: Record<string, string> | null) => void;
  onClose: () => void;
  deploying: boolean;
}

function DeployDialog({ templateId: _templateId, onDeploy, onClose, deploying }: DeployDialogProps) {
  const [deviceId, setDeviceId] = useState('');
  const [variablesJson, setVariablesJson] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let vars: Record<string, string> | null = null;
    if (variablesJson.trim()) {
      try { vars = JSON.parse(variablesJson); } catch { vars = null; }
    }
    onDeploy(Number(deviceId), vars);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>Deploy Template</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>Device ID<RequiredMark /></label>
            <input style={inp} type="number" min="1" value={deviceId} onChange={e => setDeviceId(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>Variables (JSON, optional)</label>
            <textarea style={{ ...inp, minHeight: 80, fontFamily: 'monospace', resize: 'vertical' as const }} value={variablesJson} onChange={e => setVariablesJson(e.target.value)} placeholder='{"hostname": "Router1"}' />
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={deploying}>{deploying ? 'Deploying...' : 'Deploy'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ConfigTemplateList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ConfigTemplate | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deployTarget, setDeployTarget] = useState<ConfigTemplate | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const templatesQ = useQuery({
    queryKey: ['config-templates', page],
    queryFn: () => fetchTemplates(page),
  });

  const templates = templatesQ.data?.data ?? [];
  const meta = templatesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-templates'] }); setShowForm(false); showMsg('ok', t('config_templates.create_success')); },
    onError: () => showMsg('err', t('config_templates.create_error')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ConfigTemplateBody> }) => updateTemplate(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-templates'] }); setEditing(null); showMsg('ok', t('config_templates.update_success')); },
    onError: () => showMsg('err', t('config_templates.update_error')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-templates'] }); setDeleteConfirm(null); showMsg('ok', t('config_templates.delete_success')); },
    onError: () => showMsg('err', t('config_templates.delete_error')),
  });

  const deployMut = useMutation({
    mutationFn: ({ id, deviceId, variables }: { id: number; deviceId: number; variables: Record<string, string> | null }) =>
      deployTemplate(id, deviceId, variables),
    onSuccess: () => { setDeployTarget(null); showMsg('ok', 'Template deployed successfully.'); },
    onError: () => showMsg('err', 'Failed to deploy template.'),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('config_templates.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('config_templates.new')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {templatesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : templatesQ.error ? (
          <p style={styles.msgError}>{t('config_templates.error')}</p>
        ) : templates.length === 0 ? (
          <p style={styles.msg}>{t('config_templates.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Name', 'Device Type', 'Manufacturer', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {templates.map(tmpl => (
                  <tr key={tmpl.id} style={styles.tr}>
                    <td style={styles.td}><strong>{tmpl.name}</strong></td>
                    <td style={styles.td}>{tmpl.device_type ?? '—'}</td>
                    <td style={styles.td}>{tmpl.manufacturer ?? '—'}</td>
                    <td style={styles.td}>{capitalize(tmpl.status)}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(tmpl)}>Edit</button>
                      <button style={{ ...styles.btnPrimary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setDeployTarget(tmpl)}>{t('config_templates.deploy')}</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(tmpl.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}

      {showForm && <TemplateForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <TemplateForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('config_templates.delete_confirm')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deployTarget && (
        <DeployDialog
          templateId={deployTarget.id}
          onDeploy={(deviceId, variables) => deployMut.mutate({ id: deployTarget.id, deviceId, variables })}
          onClose={() => setDeployTarget(null)}
          deploying={deployMut.isPending}
        />
      )}
    </div>
  );
}
