// =============================================================================
// FireISP 5.0 — Client Communication Preferences (DND) — §1.4
// =============================================================================
// Per-customer, per-channel Do Not Disturb preferences. Rendered as the
// "Communication" tab inside ClientDetail. Shows all channel opt-outs and
// quiet-hour windows; allows support/billing staff to update them.
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  extractApiError,
  errorBox,
  labelStyle,
  inputStyle,
  submitBtn,
  cancelBtn,
} from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DndPref {
  id: number;
  channel: 'email' | 'sms' | 'whatsapp' | 'all';
  opt_out: number | boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  reason: string | null;
}

interface DndResponse {
  data: DndPref[];
}

type Channel = 'all' | 'email' | 'sms' | 'whatsapp';

const CHANNELS: Channel[] = ['all', 'email', 'sms', 'whatsapp'];

const CHANNEL_LABELS: Record<Channel, string> = {
  all:       '📵 All channels',
  email:     '✉️ Email',
  sms:       '💬 SMS',
  whatsapp:  '📱 WhatsApp',
};

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchDnd(clientId: number): Promise<DndPref[]> {
  const res = await api.GET('/clients/{clientId}/dnd' as never, {
    params: { path: { clientId } as never },
  } as never);
  if (res.error) throw new Error('Failed to load DND preferences');
  return ((res.data as DndResponse).data ?? []);
}

// ---------------------------------------------------------------------------
// Single channel row (edit inline)
// ---------------------------------------------------------------------------

function DndChannelRow({
  clientId,
  channel,
  pref,
  canEdit,
  onSaved,
}: {
  clientId: number;
  channel: Channel;
  pref: DndPref | undefined;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    opt_out: pref ? (Boolean(pref.opt_out)) : false,
    quiet_hours_start: pref?.quiet_hours_start ?? '',
    quiet_hours_end: pref?.quiet_hours_end ?? '',
    reason: pref?.reason ?? '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        opt_out: form.opt_out,
      };
      if (form.quiet_hours_start) body.quiet_hours_start = form.quiet_hours_start;
      if (form.quiet_hours_end) body.quiet_hours_end = form.quiet_hours_end;
      if (form.reason.trim()) body.reason = form.reason.trim();

      const { error: e } = await api.PATCH(
        '/clients/{clientId}/dnd/{channel}' as never,
        {
          params: { path: { clientId, channel } as never },
          body: body as never,
        } as never,
      );
      if (e) throw new Error(extractApiError(e, t('clientDnd.errors.saveFailed')));
    },
    onSuccess: () => { setEditing(false); onSaved(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('clientDnd.errors.saveFailed')),
  });

  const isOptOut = pref ? Boolean(pref.opt_out) : false;

  if (!editing) {
    return (
      <tr>
        <td style={tdStyle}>{CHANNEL_LABELS[channel]}</td>
        <td style={tdStyle}>
          {isOptOut ? (
            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
              {t('clientDnd.optedOut')}
            </span>
          ) : (
            <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
              {t('clientDnd.subscribed')}
            </span>
          )}
        </td>
        <td style={tdStyle}>
          {pref?.quiet_hours_start && pref.quiet_hours_end
            ? `${pref.quiet_hours_start} – ${pref.quiet_hours_end}`
            : '—'}
        </td>
        <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          {pref?.reason ?? '—'}
        </td>
        <td style={tdStyle}>
          {canEdit && (
            <button type="button" onClick={() => {
              setForm({
                opt_out: isOptOut,
                quiet_hours_start: pref?.quiet_hours_start ?? '',
                quiet_hours_end: pref?.quiet_hours_end ?? '',
                reason: pref?.reason ?? '',
              });
              setError('');
              setEditing(true);
            }} style={editBtnStyle}>
              {t('common.edit')}
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={tdStyle}>{CHANNEL_LABELS[channel]}</td>
      <td colSpan={3} style={{ ...tdStyle, padding: '0.75rem' }}>
        {error && <div style={{ ...errorBox, marginBottom: '0.5rem' }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.opt_out}
              onChange={e => setForm(p => ({ ...p, opt_out: e.target.checked }))} />
            {t('clientDnd.form.optOut')}
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <label style={labelStyle}>{t('clientDnd.form.quietStart')}</label>
              <input style={{ ...inputStyle, width: 120 }} type="time"
                value={form.quiet_hours_start}
                onChange={e => setForm(p => ({ ...p, quiet_hours_start: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('clientDnd.form.quietEnd')}</label>
              <input style={{ ...inputStyle, width: 120 }} type="time"
                value={form.quiet_hours_end}
                onChange={e => setForm(p => ({ ...p, quiet_hours_end: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('clientDnd.form.reason')}</label>
            <input style={inputStyle} type="text" value={form.reason}
              placeholder={t('clientDnd.form.reasonPlaceholder')}
              onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => mutation.mutate()} style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(''); }} style={cancelBtn}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </td>
      <td style={tdStyle} />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main exported component (used as a tab inside ClientDetail)
// ---------------------------------------------------------------------------

export function ClientCommunicationPrefs({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = can(user, 'dnd.update');

  const dndQ = useQuery({
    queryKey: ['client-dnd', clientId],
    queryFn: () => fetchDnd(clientId),
  });
  const prefs = dndQ.data ?? [];

  function getPref(channel: Channel) {
    return prefs.find(p => p.channel === channel);
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['client-dnd', clientId] });

  return (
    <div style={{ padding: '1rem 0.5rem' }}>
      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {t('clientDnd.description')}
      </p>

      {dndQ.isLoading && <p style={{ fontSize: '0.85rem' }}>{t('common.loading')}</p>}
      {dndQ.error && (
        <div style={errorBox}>{t('clientDnd.errors.loadFailed')}</div>
      )}

      {!dndQ.isLoading && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-strong)' }}>
                <th style={thStyle}>{t('clientDnd.cols.channel')}</th>
                <th style={thStyle}>{t('clientDnd.cols.status')}</th>
                <th style={thStyle}>{t('clientDnd.cols.quietHours')}</th>
                <th style={thStyle}>{t('clientDnd.cols.reason')}</th>
                <th style={thStyle}>{t('clientDnd.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map(channel => (
                <DndChannelRow
                  key={channel}
                  clientId={clientId}
                  channel={channel}
                  pref={getPref(channel)}
                  canEdit={canEdit}
                  onSaved={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: '1rem 0 0', fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>
        {t('clientDnd.note')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local styles
// ---------------------------------------------------------------------------

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
};

const editBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: '0.82rem',
  padding: '2px 4px',
  fontWeight: 500,
};
