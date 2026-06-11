// =============================================================================
// FireISP 5.0 — Config Compliance Rule Management — §6.6
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

interface ConfigComplianceRule {
  id: number;
  name: string;
  description: string | null;
  rule_type: string;
  pattern: string;
  severity: string;
  applies_to_device_type: string | null;
  is_enabled: number;
}

interface ConfigComplianceRulesResponse {
  data: ConfigComplianceRule[];
  meta: { total: number; page: number; limit: number };
}

interface RuleBody {
  name: string;
  description?: string;
  rule_type: string;
  pattern: string;
  severity?: string;
  applies_to_device_type?: string;
  is_enabled?: boolean;
}

const PAGE_SIZE = 25;
const RULE_TYPES = ['must_contain', 'must_not_contain', 'regex_match', 'regex_not_match'];
const SEVERITIES = ['info', 'warning', 'critical'];

async function fetchRules(page: number): Promise<ConfigComplianceRulesResponse> {
  const res = await api.GET('/config-compliance-rules' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load compliance rules');
  return (res as { data: unknown }).data as unknown as ConfigComplianceRulesResponse;
}

async function createRule(body: RuleBody): Promise<void> {
  const res = await api.POST('/config-compliance-rules' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create compliance rule');
}

async function updateRule(id: number, body: Partial<RuleBody>): Promise<void> {
  const res = await api.PUT('/config-compliance-rules/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update compliance rule');
}

async function deleteRule(id: number): Promise<void> {
  const res = await api.DELETE('/config-compliance-rules/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete compliance rule');
}

async function runAudit(backupId: number): Promise<{ total: number; passed: number; failed: number }> {
  const res = await api.POST('/config-compliance-rules/run' as never, { body: { backup_id: backupId } as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to run compliance audit');
  return ((res as { data: unknown }).data as { data: { total: number; passed: number; failed: number } }).data;
}

interface RuleFormProps {
  initial: Partial<ConfigComplianceRule>;
  onSave: (body: RuleBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function RuleForm({ initial, onSave, onClose, saving, editMode }: RuleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [ruleType, setRuleType] = useState(initial.rule_type ?? 'must_contain');
  const [pattern, setPattern] = useState(initial.pattern ?? '');
  const [severity, setSeverity] = useState(initial.severity ?? 'warning');
  const [appliesToDeviceType, setAppliesToDeviceType] = useState(initial.applies_to_device_type ?? '');
  const [isEnabled, setIsEnabled] = useState(initial.is_enabled !== 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: RuleBody = { name, rule_type: ruleType, pattern, severity, is_enabled: isEnabled };
    if (description) body.description = description;
    if (appliesToDeviceType) body.applies_to_device_type = appliesToDeviceType;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('config_compliance.edit') : t('config_compliance.new')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_compliance.name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_compliance.description')}</label>
            <textarea style={{ ...inp, minHeight: 56, resize: 'vertical' as const }} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('config_compliance.rule_type')}<RequiredMark /></label>
              <select style={inp} value={ruleType} onChange={e => setRuleType(e.target.value)} required>
                {RULE_TYPES.map(rt => <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={modalStyles.label}>{t('config_compliance.severity')}</label>
              <select style={inp} value={severity} onChange={e => setSeverity(e.target.value)}>
                {SEVERITIES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_compliance.pattern')}<RequiredMark /></label>
            <input style={{ ...inp, fontFamily: 'monospace' }} value={pattern} onChange={e => setPattern(e.target.value)} required placeholder="e.g. no telnet or ^ip route" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('config_compliance.applies_to_device_type')}</label>
            <input style={inp} value={appliesToDeviceType} onChange={e => setAppliesToDeviceType(e.target.value)} placeholder="e.g. router (leave blank for all)" />
          </div>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="is_enabled_rule" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
            <label htmlFor="is_enabled_rule" style={{ cursor: 'pointer' }}>{t('config_compliance.is_enabled')}</label>
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

interface AuditDialogProps {
  onRun: (backupId: number) => void;
  onClose: () => void;
  running: boolean;
  result: { total: number; passed: number; failed: number } | null;
}

function AuditDialog({ onRun, onClose, running, result }: AuditDialogProps) {
  const [backupId, setBackupId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onRun(Number(backupId));
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>Run Compliance Audit</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        {result ? (
          <div>
            <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Audit complete</p>
            <p>Total rules: {result.total}</p>
            <p style={{ color: '#065f46' }}>Passed: {result.passed}</p>
            <p style={{ color: result.failed > 0 ? '#991b1b' : '#374151' }}>Failed: {result.failed}</p>
            <div style={{ ...modalStyles.actions, marginTop: '1rem' }}>
              <button style={styles.btnPrimary} onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={modalStyles.label}>Backup ID<RequiredMark /></label>
              <input style={inp} type="number" min="1" value={backupId} onChange={e => setBackupId(e.target.value)} required />
            </div>
            <div style={modalStyles.actions}>
              <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" style={styles.btnPrimary} disabled={running}>{running ? 'Running...' : 'Run Audit'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ConfigComplianceRuleList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ConfigComplianceRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [auditResult, setAuditResult] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const rulesQ = useQuery({
    queryKey: ['config-compliance-rules', page],
    queryFn: () => fetchRules(page),
  });

  const rules = rulesQ.data?.data ?? [];
  const meta = rulesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-compliance-rules'] }); setShowForm(false); showMsg('ok', t('config_compliance.create_success')); },
    onError: () => showMsg('err', t('config_compliance.create_error')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<RuleBody> }) => updateRule(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-compliance-rules'] }); setEditing(null); showMsg('ok', t('config_compliance.update_success')); },
    onError: () => showMsg('err', t('config_compliance.update_error')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config-compliance-rules'] }); setDeleteConfirm(null); showMsg('ok', t('config_compliance.delete_success')); },
    onError: () => showMsg('err', t('config_compliance.delete_error')),
  });

  const auditMut = useMutation({
    mutationFn: runAudit,
    onSuccess: (result) => { setAuditResult(result); },
    onError: () => showMsg('err', 'Failed to run compliance audit.'),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function handleAuditClose() {
    setShowAudit(false);
    setAuditResult(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('config_compliance.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnSecondary, marginLeft: 'auto', marginRight: 8 }} onClick={() => setShowAudit(true)}>
          {t('config_compliance.run_audit')}
        </button>
        <button style={styles.btnPrimary} onClick={() => setShowForm(true)}>
          + {t('config_compliance.new')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {rulesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : rulesQ.error ? (
          <p style={styles.msgError}>{t('config_compliance.error')}</p>
        ) : rules.length === 0 ? (
          <p style={styles.msg}>{t('config_compliance.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Name', 'Rule Type', 'Severity', 'Device Type', 'Enabled', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} style={styles.tr}>
                    <td style={styles.td}><strong>{rule.name}</strong></td>
                    <td style={styles.td}><code style={{ fontSize: '0.78rem' }}>{rule.rule_type}</code></td>
                    <td style={styles.td}>{capitalize(rule.severity)}</td>
                    <td style={styles.td}>{rule.applies_to_device_type ?? 'All'}</td>
                    <td style={styles.td}>{rule.is_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(rule)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(rule.id)}>Delete</button>
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

      {showForm && <RuleForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <RuleForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}

      {showAudit && (
        <AuditDialog
          onRun={backupId => auditMut.mutate(backupId)}
          onClose={handleAuditClose}
          running={auditMut.isPending}
          result={auditResult}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('config_compliance.delete_confirm')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
