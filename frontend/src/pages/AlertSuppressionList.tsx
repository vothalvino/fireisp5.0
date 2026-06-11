// =============================================================================
// FireISP 5.0 — Alert Suppression Rule Management
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

interface SuppressionRule {
  id: number;
  name: string;
  upstream_device_id: number | null;
  downstream_device_id: number | null;
  suppress_duration_minutes: number;
  is_enabled: boolean;
}

interface RulesResponse {
  data: SuppressionRule[];
  meta: { total: number; page: number; limit: number };
}

interface RuleBody {
  name: string;
  upstream_device_id?: number;
  downstream_device_id?: number;
  suppress_duration_minutes?: number;
  is_enabled?: boolean;
}

const PAGE_SIZE = 25;

async function fetchRules(page: number): Promise<RulesResponse> {
  const res = await api.GET('/alerts/suppression-rules' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load suppression rules');
  return (res as { data: unknown }).data as unknown as RulesResponse;
}

async function createRule(body: RuleBody): Promise<void> {
  const res = await api.POST('/alerts/suppression-rules' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create suppression rule');
}

async function updateRule(id: number, body: Partial<RuleBody>): Promise<void> {
  const res = await api.PUT('/alerts/suppression-rules/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update suppression rule');
}

async function deleteRule(id: number): Promise<void> {
  const res = await api.DELETE('/alerts/suppression-rules/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete suppression rule');
}

interface RuleFormProps {
  initial: Partial<SuppressionRule>;
  onSave: (body: RuleBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function RuleForm({ initial, onSave, onClose, saving, editMode }: RuleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [upstreamDeviceId, setUpstreamDeviceId] = useState(initial.upstream_device_id?.toString() ?? '');
  const [downstreamDeviceId, setDownstreamDeviceId] = useState(initial.downstream_device_id?.toString() ?? '');
  const [suppressDuration, setSuppressDuration] = useState(initial.suppress_duration_minutes?.toString() ?? '60');
  const [isEnabled, setIsEnabled] = useState(initial.is_enabled !== false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: RuleBody = { name, is_enabled: isEnabled };
    if (upstreamDeviceId) body.upstream_device_id = parseInt(upstreamDeviceId, 10);
    if (downstreamDeviceId) body.downstream_device_id = parseInt(downstreamDeviceId, 10);
    if (suppressDuration) body.suppress_duration_minutes = parseInt(suppressDuration, 10);
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('alert_suppression.edit', 'Edit Suppression Rule') : t('alert_suppression.new', 'New Suppression Rule')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('alert_suppression.name', 'Rule Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('alert_suppression.upstream_device_id', 'Upstream Device ID')}</label>
              <input type="number" style={inp} value={upstreamDeviceId} onChange={e => setUpstreamDeviceId(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('alert_suppression.downstream_device_id', 'Downstream Device ID')}</label>
              <input type="number" style={inp} value={downstreamDeviceId} onChange={e => setDownstreamDeviceId(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('alert_suppression.suppress_duration_minutes', 'Suppress Duration (minutes)')}</label>
            <input type="number" style={inp} value={suppressDuration} onChange={e => setSuppressDuration(e.target.value)} min={1} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
              {t('alert_suppression.is_enabled', 'Enabled')}
            </label>
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

export function AlertSuppressionList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SuppressionRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const rulesQ = useQuery({
    queryKey: ['suppression-rules', page],
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppression-rules'] }); setShowForm(false); showMsg('ok', t('alert_suppression.create_success', 'Suppression rule created.')); },
    onError: () => showMsg('err', t('alert_suppression.create_error', 'Failed to create suppression rule.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<RuleBody> }) => updateRule(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppression-rules'] }); setEditing(null); showMsg('ok', t('alert_suppression.update_success', 'Suppression rule updated.')); },
    onError: () => showMsg('err', t('alert_suppression.update_error', 'Failed to update suppression rule.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppression-rules'] }); setDeleteConfirm(null); showMsg('ok', t('alert_suppression.delete_success', 'Suppression rule deleted.')); },
    onError: () => showMsg('err', t('alert_suppression.delete_error', 'Failed to delete suppression rule.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('alert_suppression.title', 'Alert Suppression Rules')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('alert_suppression.new', 'New Suppression Rule')}
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
          <p style={styles.msgError}>{t('alert_suppression.error', 'Failed to load suppression rules.')}</p>
        ) : rules.length === 0 ? (
          <p style={styles.msg}>{t('alert_suppression.empty', 'No suppression rules found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Upstream Device</th>
                  <th style={styles.th}>Downstream Device</th>
                  <th style={styles.th}>Duration (min)</th>
                  <th style={styles.th}>Enabled</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.td}><strong>{r.name}</strong></td>
                    <td style={styles.td}>{r.upstream_device_id ?? '—'}</td>
                    <td style={styles.td}>{r.downstream_device_id ?? '—'}</td>
                    <td style={styles.td}>{r.suppress_duration_minutes}</td>
                    <td style={styles.td}>{r.is_enabled ? 'Yes' : 'No'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(r)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(r.id)}>Delete</button>
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

      {showForm && (
        <RuleForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />
      )}
      {editing && (
        <RuleForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />
      )}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('alert_suppression.delete_confirm', 'Delete this suppression rule?')}</p>
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
