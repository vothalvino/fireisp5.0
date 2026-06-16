// =============================================================================
// FireISP 5.0 — Client Group List (family / account grouping) — §1.1
// =============================================================================
// CRUD for account groups used for shared billing / family plans.
// =============================================================================

import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
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

interface ClientGroup {
  id: number;
  name: string;
  billing_mode: string;
  primary_client_id: number | null;
  notes: string | null;
  created_at: string;
}

interface GroupsResponse {
  data: ClientGroup[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface GroupFormBody {
  name: string;
  billing_mode: string;
  primary_client_id?: number;
  notes?: string;
}

interface GroupMember {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  client_type: string;
  status: string;
}

const BILLING_MODES = ['separate', 'shared'];

async function fetchGroups(): Promise<GroupsResponse> {
  const res = await api.GET('/client-groups', { params: { query: { limit: 200 } as never } });
  if (res.error) throw new Error('Failed to load account groups');
  return res.data as unknown as GroupsResponse;
}

// ---------------------------------------------------------------------------
// Expandable members sub-row (lazy-loaded when the row is toggled open)
// ---------------------------------------------------------------------------

function GroupMembersRow({ groupId, colSpan }: { groupId: number; colSpan: number }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-group-members', groupId],
    queryFn: async () => {
      const res = await api.GET('/client-groups/{id}/members', { params: { path: { id: groupId } } });
      if (res.error) throw new Error('Failed to load members');
      return (res.data as unknown as { data: GroupMember[] }).data;
    },
  });

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0 8px 12px 24px', background: 'var(--bg-subtle, transparent)' }}>
        {isLoading && <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>{t('clientList.loading')}</p>}
        {error && <div style={errorBox}>{(error as Error).message}</div>}
        {data && data.length === 0 && (
          <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>{t('clientList.noMembers')}</p>
        )}
        {data && data.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginTop: 4 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.name')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.email')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.phone')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.type')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    <Link to={`/clients/${m.id}`} style={{ color: 'var(--link)', textDecoration: 'none' }}>{m.name}</Link>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{m.email || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{m.phone || '—'}</td>
                  <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{m.client_type || '—'}</td>
                  <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

function GroupFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: ClientGroup;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<GroupFormBody>({
    name: initial?.name ?? '',
    billing_mode: initial?.billing_mode ?? 'separate',
    primary_client_id: initial?.primary_client_id ?? undefined,
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: GroupFormBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/client-groups', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create group'));
      } else {
        const { error } = await api.PUT('/client-groups/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update group'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save group'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const body: GroupFormBody = { name: form.name.trim(), billing_mode: form.billing_mode };
    if (form.primary_client_id) body.primary_client_id = Number(form.primary_client_id);
    if (form.notes && form.notes.trim()) body.notes = form.notes.trim();
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Account Group' : `Edit ${initial?.name ?? 'Group'}`;
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />

          <label style={labelStyle}>Billing mode</label>
          <select style={inputStyle} value={form.billing_mode}
            onChange={e => setForm(p => ({ ...p, billing_mode: e.target.value }))}>
            {BILLING_MODES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <label style={labelStyle}>Primary client ID (billing owner for shared)</label>
          <input style={inputStyle} type="number" min={1} value={form.primary_client_id ?? ''}
            onChange={e => setForm(p => ({ ...p, primary_client_id: e.target.value ? Number(e.target.value) : undefined }))} />

          <label style={labelStyle}>Notes</label>
          <input style={inputStyle} type="text" value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClientGroupList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editGroup, setEditGroup] = useState<ClientGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientGroup | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const canCreate = can(user?.role, 'clients.create');
  const canUpdate = can(user?.role, 'clients.update');
  const canDelete = can(user?.role, 'clients.delete');

  const { data, isLoading, error } = useQuery({ queryKey: ['client-groups'], queryFn: fetchGroups });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error: e } = await api.DELETE('/client-groups/{id}', { params: { path: { id } } });
      if (e) throw new Error(extractApiError(e, 'Failed to delete group'));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['client-groups'] }); setDeleteTarget(null); },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['client-groups'] });

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Account Groups</h2>
        {canCreate && (
          <button type="button" style={submitBtn} onClick={() => setShowCreate(true)}>+ New Group</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
        Group several client accounts together for shared billing or family plans.
      </p>

      {isLoading && <p>Loading…</p>}
      {error && <div style={errorBox}>{(error as Error).message}</div>}

      {data && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-strong)' }}>
              <th style={{ padding: '8px' }}>Name</th>
              <th style={{ padding: '8px' }}>Billing</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Primary client</th>
              <th style={{ padding: '8px' }}>Notes</th>
              <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '1rem', color: 'var(--text-secondary)' }}>No account groups yet.</td></tr>
            )}
            {data.data.map(g => (
              <Fragment key={g.id}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{g.name}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{g.billing_mode}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{g.primary_client_id ?? '—'}</td>
                  <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{g.notes ?? '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                      aria-expanded={expanded === g.id}
                      onClick={() => setExpanded(prev => (prev === g.id ? null : g.id))}>
                      {expanded === g.id ? `▾ ${t('clientList.members')}` : `▸ ${t('clientList.members')}`}
                    </button>
                    {canUpdate && (
                      <button type="button" style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                        onClick={() => setEditGroup(g)}>Edit</button>
                    )}
                    {canDelete && (
                      <button type="button" style={{ ...dangerBtn, padding: '4px 10px' }}
                        onClick={() => setDeleteTarget(g)}>Delete</button>
                    )}
                  </td>
                </tr>
                {expanded === g.id && <GroupMembersRow groupId={g.id} colSpan={5} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && <GroupFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />}
      {editGroup && <GroupFormModal mode="edit" initial={editGroup} onClose={() => setEditGroup(null)} onSaved={refresh} />}

      {deleteTarget && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label="Delete group">
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Delete group?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              <strong>{deleteTarget.name}</strong> will be removed. Member clients are not deleted; they are
              simply unlinked from this group.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteTarget(null)} style={cancelBtn}>Cancel</button>
              <button type="button" onClick={() => deleteMutation.mutate(deleteTarget.id)} style={dangerBtn} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
