// =============================================================================
// FireISP 5.0 — Suspension Rule Management (grace period policies) — §1.2 + §2.4
// =============================================================================
// Full CRUD for suspension / dunning rules. Each rule defines:
//   • days_past_due      — how many overdue days trigger the rule
//   • grace_period_days  — extra days to wait before executing the action
//   • action             — auto_suspend | auto_disconnect | notify_only
//   • notify_before_days — advance warning notification window
// =============================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

interface SuspensionRule {
  id: number;
  name: string;
  days_past_due: number;
  grace_period_days: number;
  action: string;
  notify_before_days: number | null;
  is_active: number | boolean;
}

interface SuspensionRuleResponse {
  data: SuspensionRule[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

interface RuleFormBody {
  name: string;
  days_past_due: number;
  grace_period_days: number;
  action: string;
  notify_before_days?: number;
  is_enabled?: boolean;
  soft_suspend_download_kbps?: number;
  soft_suspend_upload_kbps?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const ACTIONS = ['auto_suspend', 'auto_disconnect', 'notify_only', 'soft_suspend'] as const;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchRules(page: number): Promise<SuspensionRuleResponse> {
  const res = await api.GET('/suspension-rules', {
    params: { query: { page, limit: DEFAULT_PAGE_SIZE } as never },
  });
  if (res.error) throw new Error('Failed to load suspension rules');
  return res.data as unknown as SuspensionRuleResponse;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    auto_suspend:     { bg: '#fef3c7', color: '#92400e' },
    auto_disconnect:  { bg: '#fee2e2', color: '#991b1b' },
    notify_only:      { bg: '#dbeafe', color: '#1e40af' },
    soft_suspend:     { bg: '#ede9fe', color: '#5b21b6' },
  };
  const s = map[action] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {action.replace(/_/g, ' ')}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span style={{ background: enabled ? '#d1fae5' : '#f3f4f6', color: enabled ? '#065f46' : '#374151', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form modal (create + edit)
// ---------------------------------------------------------------------------

function RuleFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: SuspensionRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RuleFormBody>({
    name: initial?.name ?? '',
    days_past_due: initial?.days_past_due ?? 15,
    grace_period_days: initial?.grace_period_days ?? 0,
    action: initial?.action ?? 'auto_suspend',
    notify_before_days: initial?.notify_before_days ?? undefined,
    is_enabled: initial !== undefined ? Boolean(initial.is_active) : true,
    soft_suspend_download_kbps: 128,
    soft_suspend_upload_kbps: 128,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (body: RuleFormBody) => {
      if (mode === 'create') {
        const { error } = await api.POST('/suspension-rules', { body: body as never });
        if (error) throw new Error(extractApiError(error, 'Failed to create rule'));
      } else {
        const { error } = await api.PUT('/suspension-rules/{id}', {
          params: { path: { id: initial!.id } },
          body: body as never,
        });
        if (error) throw new Error(extractApiError(error, 'Failed to update rule'));
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save rule'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (Number(form.days_past_due) < 1) { setError('Days past due must be at least 1.'); return; }
    const body: RuleFormBody = {
      name: form.name.trim(),
      days_past_due: Number(form.days_past_due),
      grace_period_days: Number(form.grace_period_days) || 0,
      action: form.action,
      is_enabled: form.is_enabled,
    };
    const n = Number(form.notify_before_days);
    if (form.notify_before_days !== undefined && !Number.isNaN(n)) body.notify_before_days = n;
    if (form.action === 'soft_suspend') {
      body.soft_suspend_download_kbps = Number(form.soft_suspend_download_kbps) || 128;
      body.soft_suspend_upload_kbps = Number(form.soft_suspend_upload_kbps) || 128;
    }
    setError('');
    mutation.mutate(body);
  }

  const title = mode === 'create' ? 'New Suspension Rule' : `Edit Rule: ${initial?.name ?? ''}`;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={{ ...modalBox, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>{title}</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Rule name *</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus required
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />

          <label style={labelStyle}>Days past due (trigger threshold) *</label>
          <input style={inputStyle} type="number" min={1} value={form.days_past_due} required
            onChange={e => setForm(p => ({ ...p, days_past_due: Number(e.target.value) }))} />
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Rule fires when an invoice is this many days overdue.
          </p>

          <label style={labelStyle}>Grace period (additional days before action executes)</label>
          <input style={inputStyle} type="number" min={0} value={form.grace_period_days}
            onChange={e => setForm(p => ({ ...p, grace_period_days: Number(e.target.value) }))} />
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Client has this many extra days after the trigger threshold before the action runs. Set 0 for immediate action.
          </p>

          <label style={labelStyle}>Action</label>
          <select style={inputStyle} value={form.action}
            onChange={e => setForm(p => ({ ...p, action: e.target.value }))}>
            {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>

          {form.action === 'soft_suspend' && (
            <>
              <label style={labelStyle}>Throttled download speed (kbps)</label>
              <input style={inputStyle} type="number" min={1} value={form.soft_suspend_download_kbps ?? 128}
                onChange={e => setForm(p => ({ ...p, soft_suspend_download_kbps: Number(e.target.value) }))} />

              <label style={labelStyle}>Throttled upload speed (kbps)</label>
              <input style={inputStyle} type="number" min={1} value={form.soft_suspend_upload_kbps ?? 128}
                onChange={e => setForm(p => ({ ...p, soft_suspend_upload_kbps: Number(e.target.value) }))} />
            </>
          )}

          <label style={labelStyle}>Advance notice (days before suspension to notify, blank = none)</label>
          <input style={inputStyle} type="number" min={0} value={form.notify_before_days ?? ''}
            onChange={e => setForm(p => ({ ...p, notify_before_days: e.target.value ? Number(e.target.value) : undefined }))} />

          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.is_enabled}
              onChange={e => setForm(p => ({ ...p, is_enabled: e.target.checked }))} />
            Rule enabled
          </label>

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

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteConfirm({ rule, onClose, onDeleted }: { rule: SuspensionRule; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/suspension-rules/{id}', { params: { path: { id: rule.id } } });
      if (error) throw new Error(extractApiError(error, 'Failed to delete rule'));
    },
    onSuccess: () => { onDeleted(); onClose(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed'),
  });

  return (
    <div style={overlay} role="alertdialog" aria-modal="true">
      <div style={{ ...modalBox, width: 400 }}>
        <p style={{ margin: '0 0 1rem' }}>Delete rule <strong>{rule.name}</strong>? This cannot be undone.</p>
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} style={dangerBtn} disabled={mutation.isPending}>
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuspensionRuleList component
// ---------------------------------------------------------------------------

export function SuspensionRuleList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<SuspensionRule | null>(null);
  const [deleteRule, setDeleteRule] = useState<SuspensionRule | null>(null);

  const canCreate = can(user?.role, 'suspension_rules.create');
  const canUpdate = can(user?.role, 'suspension_rules.update');
  const canDelete = can(user?.role, 'suspension_rules.delete');

  const rulesQ = useQuery({ queryKey: ['suspension-rules', page], queryFn: () => fetchRules(page) });
  const rules = rulesQ.data?.data ?? [];
  const meta = rulesQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const refresh = () => qc.invalidateQueries({ queryKey: ['suspension-rules'] });

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>⛔ Suspension Rules</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        {canCreate && (
          <button type="button" style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}>+ New Rule</button>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Configure automated dunning and grace-period policies. Each rule defines when overdue clients are suspended or notified based on invoice age.
      </p>

      <div style={styles.tableCard}>
        {rulesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : rulesQ.error ? (
          <p style={styles.msgError}>Failed to load suspension rules.</p>
        ) : rules.length === 0 ? (
          <p style={styles.msg}>No suspension rules configured.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'Days Past Due', 'Grace Days', 'Notify Before', 'Action', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} style={styles.tr}>
                      <td style={styles.td}>#{r.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{r.name}</td>
                      <td style={styles.td}>{r.days_past_due} days</td>
                      <td style={{ ...styles.td, fontWeight: r.grace_period_days > 0 ? 600 : undefined }}>
                        {r.grace_period_days} days
                      </td>
                      <td style={styles.td}>{r.notify_before_days != null ? `${r.notify_before_days} days` : '—'}</td>
                      <td style={styles.td}><ActionBadge action={r.action} /></td>
                      <td style={styles.td}><EnabledBadge enabled={Boolean(r.is_active)} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {canUpdate && (
                          <button type="button"
                            style={{ ...cancelBtn, padding: '4px 10px', marginRight: 6 }}
                            onClick={() => setEditRule(r)}>Edit</button>
                        )}
                        {canDelete && (
                          <button type="button"
                            style={{ ...dangerBtn, padding: '4px 10px' }}
                            onClick={() => setDeleteRule(r)}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={styles.pagination}>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Prev
                </button>
                <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                <button style={styles.pageBtn} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <RuleFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editRule && (
        <RuleFormModal mode="edit" initial={editRule} onClose={() => setEditRule(null)} onSaved={refresh} />
      )}
      {deleteRule && (
        <DeleteConfirm rule={deleteRule} onClose={() => setDeleteRule(null)} onDeleted={refresh} />
      )}
    </div>
  );
}
