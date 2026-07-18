// =============================================================================
// FireISP 5.0 — Client Group List (family / account grouping) — §1.1
// =============================================================================
// CRUD for account groups used for shared billing / family plans.
// =============================================================================

import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@/components/Pagination';
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
  primary_client_id?: number | null;
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

interface MemberBalance {
  client_id: number;
  name: string;
  is_primary: boolean;
  balance: number;
  currency: string;
}

interface GroupInvoice { invoice_id: number; invoice_number: string; client_name: string; balance_due: number; currency: string }
interface GroupBilling {
  group: { id: number; name: string; primary_client_id: number | null };
  members: MemberBalance[];
  open_invoices: GroupInvoice[];
  group_balance: number;
  group_currency: string;
  payable_total: number;
  other_currency_invoices?: GroupInvoice[];
}

const BILLING_MODES = ['separate', 'shared'];
const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'spei', 'oxxo_pay', 'check', 'other'];

function fmtMoney(n: number, currency: string): string {
  return `${n < 0 ? '-' : ''}${currency} ${Math.abs(n).toFixed(2)}`;
}

async function fetchGroups(page: number, pageSize: number): Promise<GroupsResponse> {
  const res = await api.GET('/client-groups', { params: { query: { page, limit: pageSize } as never } });
  if (res.error) throw new Error('Failed to load account groups');
  return res.data as unknown as GroupsResponse;
}

// ---------------------------------------------------------------------------
// Expandable members sub-row (lazy-loaded when the row is toggled open)
// ---------------------------------------------------------------------------

// ---- Add-members picker: search existing clients and assign them in bulk ---
function AddMembersModal({ groupId, existingIds, onClose, onSaved }: {
  groupId: number; existingIds: Set<number>; onClose: () => void; onSaved: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const results = useQuery({
    queryKey: ['client-picker', search],
    queryFn: async () => {
      const res = await api.GET('/clients', { params: { query: { search, limit: 20 } as never } });
      if (res.error) throw new Error('Failed to search clients');
      return (res.data as unknown as { data: { id: number; name: string; client_group_id: number | null }[] }).data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const ids = Object.keys(selected).map(Number);
      const { error: e } = await api.POST('/client-groups/{id}/members', {
        params: { path: { id: groupId } }, body: { client_ids: ids } as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to add members'));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to add members'),
  });

  const toggle = (id: number, name: string) => setSelected(prev => {
    const next = { ...prev };
    if (next[id]) delete next[id]; else next[id] = name;
    return next;
  });
  const selCount = Object.keys(selected).length;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Add members">
      <div style={{ ...modalBox, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Add members</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Search for existing clients and add them to this group.
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <input style={inputStyle} type="text" placeholder="Search by name, email or phone…" autoFocus
          value={search} onChange={e => setSearch(e.target.value)} />

        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 8 }}>
          {results.isLoading && <p style={{ padding: 10, color: 'var(--text-secondary)' }}>Searching…</p>}
          {results.data && results.data.length === 0 && <p style={{ padding: 10, color: 'var(--text-secondary)' }}>No clients found.</p>}
          {results.data && results.data.map(c => {
            const already = existingIds.has(c.id);
            return (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', opacity: already ? 0.5 : 1, cursor: already ? 'default' : 'pointer' }}>
                <input type="checkbox" disabled={already} checked={already || Boolean(selected[c.id])} onChange={() => toggle(c.id, c.name)} />
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {already && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>already in this group</span>}
                {!already && c.client_group_id != null && <span style={{ fontSize: '0.75rem', color: '#b45309' }}>in another group — will move</span>}
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
          <button type="button" onClick={() => { setError(''); add.mutate(); }} style={submitBtn} disabled={add.isPending || selCount === 0}>
            {add.isPending ? 'Adding…' : `Add ${selCount || ''} member${selCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Pay the group balance on behalf of members ----------------------------
function PayGroupModal({ group, billing, onClose, onSaved }: {
  group: ClientGroup; billing: GroupBilling; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(billing.payable_total.toFixed(2)));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ allocated_total: number; unallocated_credit: number; settled_invoices: unknown[] } | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await api.POST('/client-groups/{id}/pay', {
        params: { path: { id: group.id } },
        body: { amount: Number(amount), payment_method: method, reference_number: reference || undefined } as never,
      });
      if (e) throw new Error(extractApiError(e, 'Payment failed'));
      return (data as unknown as { data: { allocated_total: number; unallocated_credit: number; settled_invoices: unknown[] } }).data;
    },
    onSuccess: (r) => { setResult(r); onSaved(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Payment failed'),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Pay group balance">
      <div style={{ ...modalBox, width: 460 }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Pay group balance — {group.name}</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          A single payment recorded on the primary member, applied oldest-invoice-first across the group.
        </p>
        {error && <div style={errorBox}>{error}</div>}

        {result ? (
          <div>
            <div style={{ padding: 12, background: 'var(--bg-subtle, #f0fdf4)', borderRadius: 6, fontSize: '0.9rem' }}>
              ✓ Applied {fmtMoney(result.allocated_total, billing.group_currency)} across {result.settled_invoices.length} invoice(s).
              {result.unallocated_credit > 0 && <> Remaining {fmtMoney(result.unallocated_credit, billing.group_currency)} left as credit on the primary.</>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" onClick={onClose} style={submitBtn}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '0.85rem', marginBottom: 8 }}>
              Group open balance: <strong>{fmtMoney(billing.payable_total, billing.group_currency)}</strong>
            </div>
            <label style={labelStyle}>Amount</label>
            <input style={inputStyle} type="number" min={0.01} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
            <label style={labelStyle}>Payment method</label>
            <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <label style={labelStyle}>Reference (optional)</label>
            <input style={inputStyle} type="text" value={reference} onChange={e => setReference(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
              <button type="button" onClick={() => { setError(''); pay.mutate(); }} style={submitBtn} disabled={pay.isPending || !(Number(amount) > 0)}>
                {pay.isPending ? 'Processing…' : 'Pay now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable members sub-row (lazy-loaded when the row is toggled open) —
// lists members with balances, lets you add/remove members and set the
// primary, and (for shared groups) pay the combined balance.
// ---------------------------------------------------------------------------

function GroupMembersRow({ group, colSpan }: { group: ClientGroup; colSpan: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const groupId = group.id;
  const canUpdate = can(user, 'clients.update');
  const canPay = can(user, 'payments.create');
  const canViewBilling = can(user, 'payments.view');
  const isShared = group.billing_mode === 'shared';
  const [showAdd, setShowAdd] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [actionError, setActionError] = useState('');

  const membersQ = useQuery({
    queryKey: ['client-group-members', groupId],
    queryFn: async () => {
      const res = await api.GET('/client-groups/{id}/members', { params: { path: { id: groupId } } });
      if (res.error) throw new Error('Failed to load members');
      return (res.data as unknown as { data: GroupMember[] }).data;
    },
  });

  const billingQ = useQuery({
    queryKey: ['client-group-billing', groupId],
    enabled: isShared && canViewBilling,
    queryFn: async () => {
      const res = await api.GET('/client-groups/{id}/billing', { params: { path: { id: groupId } } });
      if (res.error) throw new Error('Failed to load billing');
      return (res.data as unknown as { data: GroupBilling }).data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-group-members', groupId] });
    qc.invalidateQueries({ queryKey: ['client-group-billing', groupId] });
    qc.invalidateQueries({ queryKey: ['client-groups'] });
  };

  const removeMember = useMutation({
    mutationFn: async (clientId: number) => {
      const { error: e } = await api.DELETE('/client-groups/{id}/members/{clientId}', { params: { path: { id: groupId, clientId } } });
      if (e) throw new Error(extractApiError(e, 'Failed to remove member'));
    },
    onSuccess: invalidate,
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : 'Failed to remove member'),
  });

  const makePrimary = useMutation({
    mutationFn: async (clientId: number) => {
      const { error: e } = await api.PUT('/client-groups/{id}', { params: { path: { id: groupId } }, body: { primary_client_id: clientId } as never });
      if (e) throw new Error(extractApiError(e, 'Failed to set primary'));
    },
    onSuccess: invalidate,
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : 'Failed to set primary'),
  });

  const members = membersQ.data ?? [];
  const balanceByClient = new Map<number, MemberBalance>((billingQ.data?.members ?? []).map(m => [m.client_id, m]));
  const existingIds = new Set(members.map(m => m.id));

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0 8px 14px 24px', background: 'var(--bg-subtle, transparent)' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 6px' }}>
          {canUpdate && (
            <button type="button" style={{ ...submitBtn, padding: '5px 12px' }} onClick={() => { setActionError(''); setShowAdd(true); }}>
              ＋ Add members
            </button>
          )}
          {isShared && canViewBilling && billingQ.data && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.85rem' }}>
                Group balance:{' '}
                <strong style={{ color: billingQ.data.group_balance > 0.005 ? '#b91c1c' : '#15803d' }}>
                  {fmtMoney(billingQ.data.group_balance, billingQ.data.group_currency)}
                </strong>
              </span>
              {canPay && billingQ.data.payable_total > 0.005 && (
                <button type="button" style={{ ...submitBtn, padding: '5px 12px' }} onClick={() => { setActionError(''); setShowPay(true); }}>
                  Pay group balance
                </button>
              )}
            </span>
          )}
        </div>
        {isShared && !group.primary_client_id && (
          <p style={{ margin: '2px 0 6px', fontSize: '0.8rem', color: '#b45309' }}>
            This shared group has no primary member yet — use ★ Make primary on a member to enable group payment.
          </p>
        )}
        {isShared && canViewBilling && (billingQ.data?.other_currency_invoices?.length ?? 0) > 0 && (
          <p style={{ margin: '2px 0 6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {billingQ.data!.other_currency_invoices!.length} legacy invoice(s) in another currency are shown below but settled separately — the group balance and payment are in {billingQ.data!.group_currency}.
          </p>
        )}
        {actionError && <div style={errorBox}>{actionError}</div>}
        {isShared && canViewBilling && billingQ.error && (
          <div style={errorBox}>{(billingQ.error as Error).message}</div>
        )}

        {membersQ.isLoading && <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>{t('clientList.loading')}</p>}
        {membersQ.error && <div style={errorBox}>{(membersQ.error as Error).message}</div>}
        {members.length === 0 && !membersQ.isLoading && (
          <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>{t('clientList.noMembers')}</p>
        )}

        {members.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginTop: 4 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.name')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.email')}</th>
                <th style={{ padding: '6px 8px' }}>{t('clientList.table.status')}</th>
                {isShared && canViewBilling && <th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance</th>}
                {canUpdate && <th style={{ padding: '6px 8px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const isPrimary = group.primary_client_id === m.id;
                const bal = balanceByClient.get(m.id);
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                      <Link to={`/clients/${m.id}`} style={{ color: 'var(--link)', textDecoration: 'none' }}>{m.name}</Link>
                      {isPrimary && <span title="Primary (billing owner)" style={{ marginLeft: 6, color: '#ca8a04' }}>★</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{m.email || '—'}</td>
                    <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{m.status}</td>
                    {isShared && canViewBilling && (
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: bal && bal.balance > 0.005 ? '#b91c1c' : 'inherit' }}>
                        {bal ? fmtMoney(bal.balance, bal.currency) : '—'}
                      </td>
                    )}
                    {canUpdate && (
                      <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isShared && !isPrimary && (
                          <button type="button" style={{ ...cancelBtn, padding: '3px 8px', marginRight: 6 }}
                            onClick={() => { setActionError(''); makePrimary.mutate(m.id); }} disabled={makePrimary.isPending}>★ Make primary</button>
                        )}
                        <button type="button" style={{ ...cancelBtn, padding: '3px 8px' }}
                          onClick={() => { setActionError(''); removeMember.mutate(m.id); }} disabled={removeMember.isPending}>Remove</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {showAdd && <AddMembersModal groupId={groupId} existingIds={existingIds} onClose={() => setShowAdd(false)} onSaved={invalidate} />}
        {showPay && billingQ.data && <PayGroupModal group={group} billing={billingQ.data} onClose={() => setShowPay(false)} onSaved={invalidate} />}
      </td>
    </tr>
  );
}

// ---- Reusable single-client search+select (like the Clients list search) ---
function ClientSearchSelect({ valueId, valueLabel, onPick, placeholder }: {
  valueId?: number; valueLabel?: string; onPick: (id: number | undefined, name: string) => void; placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const results = useQuery({
    queryKey: ['client-search-select', search],
    enabled: open && search.trim().length > 0,
    queryFn: async () => {
      const res = await api.GET('/clients', { params: { query: { search, limit: 10 } as never } });
      if (res.error) throw new Error('Failed to search clients');
      return (res.data as unknown as { data: { id: number; name: string }[] }).data;
    },
  });

  if (valueId && !open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...inputStyle, display: 'flex', alignItems: 'center', flex: 1 }}>
          ★ {valueLabel || `Client #${valueId}`}
        </span>
        <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }} onClick={() => { setOpen(true); setSearch(''); }}>Change</button>
        <button type="button" style={{ ...cancelBtn, padding: '4px 10px' }} onClick={() => onPick(undefined, '')}>Clear</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input style={inputStyle} type="text" value={search} placeholder={placeholder || 'Search clients by name, email or phone…'}
        onFocus={() => setOpen(true)} onChange={e => { setSearch(e.target.value); setOpen(true); }} />
      {open && search.trim().length > 0 && (
        <div style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, background: 'var(--bg-primary, #fff)', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
          {results.isLoading && <p style={{ padding: 8, margin: 0, color: 'var(--text-secondary)' }}>Searching…</p>}
          {results.data && results.data.length === 0 && <p style={{ padding: 8, margin: 0, color: 'var(--text-secondary)' }}>No clients found.</p>}
          {results.data && results.data.map(c => (
            <button key={c.id} type="button"
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
              onClick={() => { onPick(c.id, c.name); setOpen(false); setSearch(''); }}>
              {c.name} <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>#{c.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const [primaryLabel, setPrimaryLabel] = useState('');
  const [error, setError] = useState('');

  // In edit mode, resolve the existing primary's NAME so the picker shows a
  // person, not "Client #id".
  useQuery({
    queryKey: ['client-name', initial?.primary_client_id],
    enabled: mode === 'edit' && Boolean(initial?.primary_client_id),
    queryFn: async () => {
      const res = await api.GET('/clients/{id}', { params: { path: { id: initial!.primary_client_id! } } });
      if (res.error) return null;
      const name = (res.data as unknown as { data?: { name?: string } }).data?.name ?? '';
      if (name) setPrimaryLabel(name);
      return name;
    },
  });

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
    if (form.primary_client_id) {
      body.primary_client_id = Number(form.primary_client_id);
    } else if (mode === 'edit' && initial?.primary_client_id) {
      // Explicitly clear a previously-set primary (null, not omit-to-keep).
      body.primary_client_id = null;
    }
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

          <label style={labelStyle}>Primary member (billing owner)</label>
          <ClientSearchSelect
            valueId={form.primary_client_id ?? undefined}
            valueLabel={primaryLabel}
            placeholder="Search for the billing owner…"
            onPick={(id, name) => { setForm(p => ({ ...p, primary_client_id: id })); setPrimaryLabel(name); }}
          />
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            For shared billing. You can also set it later with ★ Make primary in the members list.
          </p>

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const canCreate = can(user, 'clients.create');
  const canUpdate = can(user, 'clients.update');
  const canDelete = can(user, 'clients.delete');

  const { data, isLoading, error } = useQuery({
    queryKey: ['client-groups', page, pageSize],
    queryFn: () => fetchGroups(page, pageSize),
  });

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
        <>
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
                {expanded === g.id && <GroupMembersRow group={g} colSpan={5} />}
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <Pagination
          page={page}
          totalPages={data?.meta?.totalPages ?? 1}
          total={data?.meta?.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
        </>
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
