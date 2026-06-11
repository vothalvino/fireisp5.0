// =============================================================================
// FireISP 5.0 — Alert Escalation Chain Management
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

interface EscalationChain {
  id: number;
  name: string;
  description: string | null;
}

interface ChainsResponse {
  data: EscalationChain[];
  meta: { total: number; page: number; limit: number };
}

interface ChainBody {
  name: string;
  description?: string;
}

const PAGE_SIZE = 25;

async function fetchChains(page: number): Promise<ChainsResponse> {
  const res = await api.GET('/alerts/escalation-chains' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load escalation chains');
  return (res as { data: unknown }).data as unknown as ChainsResponse;
}

async function createChain(body: ChainBody): Promise<void> {
  const res = await api.POST('/alerts/escalation-chains' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create escalation chain');
}

async function updateChain(id: number, body: Partial<ChainBody>): Promise<void> {
  const res = await api.PUT('/alerts/escalation-chains/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update escalation chain');
}

async function deleteChain(id: number): Promise<void> {
  const res = await api.DELETE('/alerts/escalation-chains/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete escalation chain');
}

interface ChainFormProps {
  initial: Partial<EscalationChain>;
  onSave: (body: ChainBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function ChainForm({ initial, onSave, onClose, saving, editMode }: ChainFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: ChainBody = { name };
    if (description) body.description = description;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('alert_escalations.edit', 'Edit Escalation Chain') : t('alert_escalations.new', 'New Escalation Chain')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('alert_escalations.name', 'Chain Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('alert_escalations.description', 'Description')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={description} onChange={e => setDescription(e.target.value)} />
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

export function AlertEscalationChainList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EscalationChain | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const chainsQ = useQuery({
    queryKey: ['escalation-chains', page],
    queryFn: () => fetchChains(page),
  });

  const chains = chainsQ.data?.data ?? [];
  const meta = chainsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createChain,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-chains'] }); setShowForm(false); showMsg('ok', t('alert_escalations.create_success', 'Escalation chain created.')); },
    onError: () => showMsg('err', t('alert_escalations.create_error', 'Failed to create escalation chain.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ChainBody> }) => updateChain(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-chains'] }); setEditing(null); showMsg('ok', t('alert_escalations.update_success', 'Escalation chain updated.')); },
    onError: () => showMsg('err', t('alert_escalations.update_error', 'Failed to update escalation chain.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteChain,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-chains'] }); setDeleteConfirm(null); showMsg('ok', t('alert_escalations.delete_success', 'Escalation chain deleted.')); },
    onError: () => showMsg('err', t('alert_escalations.delete_error', 'Failed to delete escalation chain.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('alert_escalations.title', 'Alert Escalation Chains')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('alert_escalations.new', 'New Escalation Chain')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {chainsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : chainsQ.error ? (
          <p style={styles.msgError}>{t('alert_escalations.error', 'Failed to load escalation chains.')}</p>
        ) : chains.length === 0 ? (
          <p style={styles.msg}>{t('alert_escalations.empty', 'No escalation chains found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {chains.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}><strong>{c.name}</strong></td>
                    <td style={styles.td}>{c.description ?? '—'}</td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(c)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(c.id)}>Delete</button>
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
        <ChainForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />
      )}
      {editing && (
        <ChainForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />
      )}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('alert_escalations.delete_confirm', 'Delete this escalation chain?')}</p>
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
