// =============================================================================
// FireISP 5.0 — Communication Campaigns — §1.4 Communication
// =============================================================================
// Bulk email / SMS / WhatsApp campaign management. Each campaign targets a
// filtered set of clients and sends a message template to all recipients.
// Stats (sent / delivered / opened / bounced) update as delivery callbacks
// arrive from the provider.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { styles } from './crudStyles';
import {
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
  dangerBtn,
} from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Campaign {
  id: number;
  name: string;
  channel: 'email' | 'sms' | 'whatsapp';
  status: string;
  template_id: number | null;
  filter_status: string | null;
  filter_plan_id: number | null;
  filter_tag: string | null;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  bounced_count: number;
  failed_count: number;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface CampaignResponse {
  data: Campaign[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface MessageTemplate {
  id: number;
  name: string;
  channel: string;
}

interface CampaignFormBody {
  name: string;
  channel: string;
  template_id?: number;
  filter_status?: string;
  filter_plan_id?: number;
  filter_tag?: string;
  notes?: string;
}

interface CampaignMessage {
  id: number;
  client_id: number | null;
  recipient: string;
  channel: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
}

interface MessagesResponse {
  data: CampaignMessage[];
  meta: { total: number; page: number; limit: number };
}

const DEFAULT_PAGE_SIZE = 50;
const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
const CLIENT_STATUSES = ['active', 'inactive', 'suspended', 'cancelled'] as const;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchCampaigns(page: number): Promise<CampaignResponse> {
  const res = await api.GET('/communication-campaigns' as never, {
    params: { query: { page, limit: DEFAULT_PAGE_SIZE } as never },
  } as never);
  if (res.error) throw new Error('Failed to load campaigns');
  return res.data as unknown as CampaignResponse;
}

async function fetchTemplates(): Promise<MessageTemplate[]> {
  const res = await api.GET('/message-templates' as never, {
    params: { query: { limit: 200 } as never },
  } as never);
  if (res.error) return [];
  const d = res.data as unknown as { data: MessageTemplate[] };
  return d.data ?? [];
}

async function fetchMessages(campaignId: number, page: number, status?: string): Promise<MessagesResponse> {
  const query: Record<string, unknown> = { page, limit: 50 };
  if (status) query.status = status;
  const res = await api.GET('/communication-campaigns/{id}/messages' as never, {
    params: { path: { id: campaignId } as never, query: query as never },
  } as never);
  if (res.error) throw new Error('Failed to load messages');
  return res.data as unknown as MessagesResponse;
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:     { bg: '#f3f4f6', color: '#374151' },
    sending:   { bg: '#fef3c7', color: '#92400e' },
    sent:      { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
    failed:    { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { bg: string; color: string; icon: string }> = {
    email:     { bg: '#dbeafe', color: '#1e40af', icon: '✉️' },
    sms:       { bg: '#f3e8ff', color: '#6b21a8', icon: '💬' },
    whatsapp:  { bg: '#dcfce7', color: '#166534', icon: '📱' },
  };
  const s = map[channel] ?? { bg: '#f3f4f6', color: '#374151', icon: '📨' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {s.icon} {channel}
    </span>
  );
}

function MsgStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    queued:    { bg: '#f3f4f6', color: '#374151' },
    sent:      { bg: '#fef3c7', color: '#92400e' },
    delivered: { bg: '#d1fae5', color: '#065f46' },
    opened:    { bg: '#dbeafe', color: '#1e40af' },
    bounced:   { bg: '#fee2e2', color: '#991b1b' },
    failed:    { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 6px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Campaign form modal
// ---------------------------------------------------------------------------

function CampaignFormModal({
  mode,
  initial,
  templates,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Campaign;
  templates: MessageTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CampaignFormBody>({
    name: initial?.name ?? '',
    channel: initial?.channel ?? 'email',
    template_id: initial?.template_id ?? undefined,
    filter_status: initial?.filter_status ?? undefined,
    filter_tag: initial?.filter_tag ?? undefined,
    notes: initial?.notes ?? undefined,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: CampaignFormBody) => {
      if (mode === 'create') {
        const { error: e } = await api.POST('/communication-campaigns' as never, { body: body as never } as never);
        if (e) throw new Error(extractApiError(e, t('communicationCampaigns.errors.createFailed')));
      } else {
        const { error: e } = await api.PUT('/communication-campaigns/{id}' as never, {
          params: { path: { id: initial!.id } as never },
          body: body as never,
        } as never);
        if (e) throw new Error(extractApiError(e, t('communicationCampaigns.errors.updateFailed')));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('communicationCampaigns.errors.saveFailed')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('communicationCampaigns.errors.nameRequired')); return; }
    const body: CampaignFormBody = {
      name: form.name.trim(),
      channel: form.channel,
    };
    if (form.template_id) body.template_id = form.template_id;
    if (form.filter_status) body.filter_status = form.filter_status;
    if (form.filter_tag?.trim()) body.filter_tag = form.filter_tag.trim();
    if (form.notes?.trim()) body.notes = form.notes.trim();
    setError('');
    mutation.mutate(body);
  }

  const channelTemplates = templates.filter(t => t.channel === form.channel);
  const title = mode === 'create'
    ? t('communicationCampaigns.modal.createTitle')
    : `${t('communicationCampaigns.modal.editTitle')}: ${initial?.name ?? ''}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>{t('communicationCampaigns.form.name')} *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus required
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />

          <label style={labelStyle}>{t('communicationCampaigns.form.channel')}</label>
          <select style={inputStyle} value={form.channel}
            onChange={e => setForm(p => ({ ...p, channel: e.target.value, template_id: undefined }))}>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <label style={labelStyle}>{t('communicationCampaigns.form.template')}</label>
          <select style={inputStyle} value={form.template_id ?? ''}
            onChange={e => setForm(p => ({ ...p, template_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <option value="">{t('communicationCampaigns.form.noTemplate')}</option>
            {channelTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <label style={labelStyle}>{t('communicationCampaigns.form.filterStatus')}</label>
          <select style={inputStyle} value={form.filter_status ?? ''}
            onChange={e => setForm(p => ({ ...p, filter_status: e.target.value || undefined }))}>
            <option value="">{t('communicationCampaigns.form.allStatuses')}</option>
            {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label style={labelStyle}>{t('communicationCampaigns.form.filterTag')}</label>
          <input style={inputStyle} type="text" value={form.filter_tag ?? ''}
            placeholder={t('communicationCampaigns.form.filterTagPlaceholder')}
            onChange={e => setForm(p => ({ ...p, filter_tag: e.target.value }))} />

          <label style={labelStyle}>{t('communicationCampaigns.form.notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.notes ?? ''}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>{t('common.cancel')}</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : mode === 'create' ? t('communicationCampaigns.actions.create') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch confirmation dialog
// ---------------------------------------------------------------------------

function DispatchConfirm({
  campaign,
  onClose,
  onDispatched,
}: {
  campaign: Campaign;
  onClose: () => void;
  onDispatched: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const { error: e } = await api.POST('/communication-campaigns/{id}/dispatch' as never, {
        params: { path: { id: campaign.id } as never },
      } as never);
      if (e) throw new Error(extractApiError(e, t('communicationCampaigns.errors.dispatchFailed')));
    },
    onSuccess: () => { onDispatched(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('communicationCampaigns.errors.dispatchFailed')),
  });

  return (
    <div style={overlay} role="alertdialog" aria-modal="true">
      <div style={{ ...modalBox, width: 440 }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>{t('communicationCampaigns.dispatch.title')}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          {t('communicationCampaigns.dispatch.confirm', { name: campaign.name, channel: campaign.channel })}
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => mutation.mutate()} style={submitBtn} disabled={mutation.isPending}>
            {mutation.isPending ? t('communicationCampaigns.dispatch.sending') : t('communicationCampaigns.dispatch.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function DeleteConfirm({
  campaign,
  onClose,
  onDeleted,
}: {
  campaign: Campaign;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const { error: e } = await api.DELETE('/communication-campaigns/{id}' as never, {
        params: { path: { id: campaign.id } as never },
      } as never);
      if (e) throw new Error(extractApiError(e, t('communicationCampaigns.errors.deleteFailed')));
    },
    onSuccess: () => { onDeleted(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed'),
  });

  return (
    <div style={overlay} role="alertdialog" aria-modal="true">
      <div style={{ ...modalBox, width: 400 }}>
        <p style={{ margin: '0 0 1rem' }}>
          {t('communicationCampaigns.delete.confirm', { name: campaign.name })}
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => mutation.mutate()} style={dangerBtn} disabled={mutation.isPending}>
            {mutation.isPending ? t('common.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaign messages panel (delivery stats)
// ---------------------------------------------------------------------------

function MessagesPanel({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');

  const msgsQ = useQuery({
    queryKey: ['campaign-messages', campaign.id, page, filterStatus],
    queryFn: () => fetchMessages(campaign.id, page, filterStatus || undefined),
  });
  const msgs = msgsQ.data?.data ?? [];
  const meta = msgsQ.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / (meta.limit || 50)) : 1;

  const fmt = (d: string | null) => d ? new Date(d).toLocaleString() : '—';

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('communicationCampaigns.messages.title')}>
      <div style={{ ...modalBox, width: 760, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>{t('communicationCampaigns.messages.title')} — {campaign.name}</h3>
          <button type="button" onClick={onClose} style={cancelBtn}>✕</button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
          {[
            { label: t('communicationCampaigns.stats.recipients'), val: campaign.recipient_count },
            { label: t('communicationCampaigns.stats.sent'), val: campaign.sent_count },
            { label: t('communicationCampaigns.stats.delivered'), val: campaign.delivered_count },
            { label: t('communicationCampaigns.stats.opened'), val: campaign.opened_count },
            { label: t('communicationCampaigns.stats.bounced'), val: campaign.bounced_count },
            { label: t('communicationCampaigns.stats.failed'), val: campaign.failed_count },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface-2)', padding: '0.5rem 0.75rem', borderRadius: 8, minWidth: 80, textAlign: 'center' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{s.val}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '0.75rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {t('communicationCampaigns.messages.filterStatus')}
          </label>
          <select style={{ ...inputStyle, width: 'auto', padding: '0.3rem 0.5rem' }}
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">{t('communicationCampaigns.messages.allStatuses')}</option>
            {['queued', 'sent', 'delivered', 'opened', 'bounced', 'failed'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {msgsQ.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : msgsQ.error ? (
          <div style={errorBox}>{t('communicationCampaigns.messages.loadError')}</div>
        ) : msgs.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {t('communicationCampaigns.messages.empty')}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    t('communicationCampaigns.messages.cols.recipient'),
                    t('communicationCampaigns.messages.cols.status'),
                    t('communicationCampaigns.messages.cols.sentAt'),
                    t('communicationCampaigns.messages.cols.deliveredAt'),
                    t('communicationCampaigns.messages.cols.openedAt'),
                    t('communicationCampaigns.messages.cols.error'),
                  ].map(h => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {msgs.map(m => (
                  <tr key={m.id} style={styles.tr}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{m.recipient}</td>
                    <td style={styles.td}><MsgStatusBadge status={m.status} /></td>
                    <td style={{ ...styles.td, fontSize: '0.78rem' }}>{fmt(m.sent_at)}</td>
                    <td style={{ ...styles.td, fontSize: '0.78rem' }}>{fmt(m.delivered_at)}</td>
                    <td style={{ ...styles.td, fontSize: '0.78rem' }}>{fmt(m.opened_at)}</td>
                    <td style={{ ...styles.td, fontSize: '0.75rem', color: '#991b1b' }}>
                      {m.error_message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '0.75rem' }}>
            <button type="button" style={cancelBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
              {page} / {totalPages}
            </span>
            <button type="button" style={cancelBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CommunicationCampaignList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [deleteCampaign, setDeleteCampaign] = useState<Campaign | null>(null);
  const [dispatchCampaign, setDispatchCampaign] = useState<Campaign | null>(null);
  const [messagesCampaign, setMessagesCampaign] = useState<Campaign | null>(null);

  const canCreate = can(user, 'campaigns.create');
  const canUpdate = can(user, 'campaigns.update');
  const canDelete = can(user, 'campaigns.delete');

  const campaignsQ = useQuery({
    queryKey: ['communication-campaigns', page],
    queryFn: () => fetchCampaigns(page),
  });
  const templatesQ = useQuery({ queryKey: ['message-templates-all'], queryFn: fetchTemplates });

  const campaigns = campaignsQ.data?.data ?? [];
  const meta = campaignsQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / (meta.limit ?? DEFAULT_PAGE_SIZE))) : 1);
  const templates = templatesQ.data ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['communication-campaigns'] });

  const canDispatch = (c: Campaign) => c.status === 'draft' || c.status === 'failed' || c.status === 'cancelled';

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('communicationCampaigns.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} {t('communicationCampaigns.total')}</span>}
        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}>
            + {t('communicationCampaigns.actions.new')}
          </button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        {t('communicationCampaigns.description')}
      </p>

      <div style={styles.tableCard}>
        {campaignsQ.isLoading ? (
          <p style={styles.msg}>{t('common.loading')}</p>
        ) : campaignsQ.error ? (
          <p style={styles.msgError}>{t('communicationCampaigns.errors.loadFailed')}</p>
        ) : campaigns.length === 0 ? (
          <p style={styles.msg}>{t('communicationCampaigns.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    t('communicationCampaigns.cols.id'),
                    t('communicationCampaigns.cols.name'),
                    t('communicationCampaigns.cols.channel'),
                    t('communicationCampaigns.cols.status'),
                    t('communicationCampaigns.cols.recipients'),
                    t('communicationCampaigns.cols.stats'),
                    t('communicationCampaigns.cols.actions'),
                  ].map(h => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>#{c.id}</td>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{c.name}</td>
                    <td style={styles.td}><ChannelBadge channel={c.channel} /></td>
                    <td style={styles.td}><StatusBadge status={c.status} /></td>
                    <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {c.recipient_count}
                    </td>
                    <td style={{ ...styles.td, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      <span title={t('communicationCampaigns.stats.sent')}>✉ {c.sent_count}</span>
                      {' · '}
                      <span title={t('communicationCampaigns.stats.delivered')}>✓ {c.delivered_count}</span>
                      {' · '}
                      <span title={t('communicationCampaigns.stats.opened')}>👁 {c.opened_count}</span>
                      {' · '}
                      <span title={t('communicationCampaigns.stats.bounced')} style={{ color: c.bounced_count > 0 ? '#991b1b' : undefined }}>
                        ✗ {c.bounced_count}
                      </span>
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                      <button type="button" style={styles.actionBtn}
                        onClick={() => setMessagesCampaign(c)}>
                        {t('communicationCampaigns.actions.details')}
                      </button>
                      {canUpdate && canDispatch(c) && (
                        <button type="button" style={{ ...styles.actionBtn, color: '#065f46' }}
                          onClick={() => setDispatchCampaign(c)}>
                          {t('communicationCampaigns.actions.dispatch')}
                        </button>
                      )}
                      {canUpdate && (c.status === 'draft') && (
                        <button type="button" style={styles.actionBtn}
                          onClick={() => setEditCampaign(c)}>
                          {t('common.edit')}
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteCampaign(c)}>
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button type="button" style={styles.btnSecondary} disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}>← {t('communicationCampaigns.prevPage')}</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {t('communicationCampaigns.pageInfo', { page, total: totalPages })}
            </span>
            <button type="button" style={styles.btnSecondary} disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}>{t('communicationCampaigns.nextPage')} →</button>
          </div>
        )}
      </div>

      {showCreate && (
        <CampaignFormModal
          mode="create"
          templates={templates}
          onClose={() => setShowCreate(false)}
          onSaved={refresh}
        />
      )}
      {editCampaign && (
        <CampaignFormModal
          mode="edit"
          initial={editCampaign}
          templates={templates}
          onClose={() => setEditCampaign(null)}
          onSaved={refresh}
        />
      )}
      {deleteCampaign && (
        <DeleteConfirm
          campaign={deleteCampaign}
          onClose={() => setDeleteCampaign(null)}
          onDeleted={refresh}
        />
      )}
      {dispatchCampaign && (
        <DispatchConfirm
          campaign={dispatchCampaign}
          onClose={() => setDispatchCampaign(null)}
          onDispatched={refresh}
        />
      )}
      {messagesCampaign && (
        <MessagesPanel
          campaign={messagesCampaign}
          onClose={() => setMessagesCampaign(null)}
        />
      )}
    </div>
  );
}
