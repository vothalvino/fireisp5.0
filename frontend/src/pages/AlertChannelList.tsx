// =============================================================================
// FireISP 5.0 — Alert Notification Channel Management
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

interface AlertChannel {
  id: number;
  name: string;
  channel_type: string;
  is_enabled: boolean;
}

interface ChannelsResponse {
  data: AlertChannel[];
  meta: { total: number; page: number; limit: number };
}

interface ChannelBody {
  name: string;
  channel_type: string;
  is_enabled?: boolean;
}

const PAGE_SIZE = 25;
const CHANNEL_TYPES = ['email', 'sms', 'whatsapp', 'telegram', 'webhook'];

async function fetchChannels(page: number): Promise<ChannelsResponse> {
  const res = await api.GET('/alerts/notification-channels' as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load notification channels');
  return (res as { data: unknown }).data as unknown as ChannelsResponse;
}

async function createChannel(body: ChannelBody): Promise<void> {
  const res = await api.POST('/alerts/notification-channels' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create notification channel');
}

async function updateChannel(id: number, body: Partial<ChannelBody>): Promise<void> {
  const res = await api.PUT('/alerts/notification-channels/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update notification channel');
}

async function deleteChannel(id: number): Promise<void> {
  const res = await api.DELETE('/alerts/notification-channels/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete notification channel');
}

interface ChannelFormProps {
  initial: Partial<AlertChannel>;
  onSave: (body: ChannelBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function ChannelForm({ initial, onSave, onClose, saving, editMode }: ChannelFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [channelType, setChannelType] = useState(initial.channel_type ?? 'email');
  const [isEnabled, setIsEnabled] = useState(initial.is_enabled !== false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ name, channel_type: channelType, is_enabled: isEnabled });
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('alert_channels.edit', 'Edit Notification Channel') : t('alert_channels.new', 'New Notification Channel')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('alert_channels.name', 'Channel Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('alert_channels.channel_type', 'Channel Type')}<RequiredMark /></label>
            <select style={inp} value={channelType} onChange={e => setChannelType(e.target.value)}>
              {CHANNEL_TYPES.map(ct => <option key={ct} value={ct}>{capitalize(ct)}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
              {t('alert_channels.is_enabled', 'Enabled')}
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

export function AlertChannelList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AlertChannel | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const channelsQ = useQuery({
    queryKey: ['alert-channels', page],
    queryFn: () => fetchChannels(page),
  });

  const channels = channelsQ.data?.data ?? [];
  const meta = channelsQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createChannel,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-channels'] }); setShowForm(false); showMsg('ok', t('alert_channels.create_success', 'Notification channel created.')); },
    onError: () => showMsg('err', t('alert_channels.create_error', 'Failed to create notification channel.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ChannelBody> }) => updateChannel(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-channels'] }); setEditing(null); showMsg('ok', t('alert_channels.update_success', 'Notification channel updated.')); },
    onError: () => showMsg('err', t('alert_channels.update_error', 'Failed to update notification channel.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteChannel,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-channels'] }); setDeleteConfirm(null); showMsg('ok', t('alert_channels.delete_success', 'Notification channel deleted.')); },
    onError: () => showMsg('err', t('alert_channels.delete_error', 'Failed to delete notification channel.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('alert_channels.title', 'Alert Notification Channels')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('alert_channels.new', 'New Notification Channel')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {channelsQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : channelsQ.error ? (
          <p style={styles.msgError}>{t('alert_channels.error', 'Failed to load notification channels.')}</p>
        ) : channels.length === 0 ? (
          <p style={styles.msg}>{t('alert_channels.empty', 'No notification channels found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Enabled</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}><strong>{c.name}</strong></td>
                    <td style={styles.td}>{capitalize(c.channel_type)}</td>
                    <td style={styles.td}>{c.is_enabled ? 'Yes' : 'No'}</td>
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
        <ChannelForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />
      )}
      {editing && (
        <ChannelForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />
      )}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('alert_channels.delete_confirm', 'Delete this notification channel?')}</p>
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
