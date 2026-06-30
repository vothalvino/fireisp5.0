// =============================================================================
// FireISP 5.0 — Late Fee Rule Management (§2.2B)
// =============================================================================
// Billing-only page for CRUD management of late fee rules. Each rule defines:
//   - fee_type: flat | percent
//   - fee_amount: applied to overdue invoices past grace_period_days
//   - max_applications: NULL = unlimited
// =============================================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authedFetch } from '@/api/client';
import { styles } from './crudStyles';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LateFeeRule {
  id: number;
  name: string;
  fee_type: 'flat' | 'percent';
  fee_amount: string | number;
  grace_period_days: number;
  max_applications: number | null;
  is_active: number | boolean;
  created_at: string;
}

interface RulesResponse {
  data: LateFeeRule[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface FormState {
  name: string;
  fee_type: 'flat' | 'percent';
  fee_amount: string;
  grace_period_days: string;
  max_applications: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  fee_type: 'flat',
  fee_amount: '0',
  grace_period_days: '0',
  max_applications: '',
  is_active: true,
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function apiFetch(path: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await authedFetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...((opts.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: { message?: string } }).error?.message || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchRules(page: number, pageSize: number): Promise<RulesResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  return apiFetch(`/late-fee-rules?${params}`) as Promise<RulesResponse>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LateFeeRuleList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LateFeeRule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LateFeeRule | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data, isLoading } = useQuery({
    queryKey: ['late-fee-rules', page, pageSize],
    queryFn: () => fetchRules(page, pageSize),
  });
  const rules = data?.data || [];

  const createMutation = useMutation({
    mutationFn: (body: object) => apiFetch('/late-fee-rules', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['late-fee-rules'] }); setShowForm(false); setForm(EMPTY_FORM); },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/late-fee-rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['late-fee-rules'] }); setEditing(null); setForm(EMPTY_FORM); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/late-fee-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['late-fee-rules'] }); setDeleteTarget(null); },
  });

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(rule: LateFeeRule) {
    setEditing(rule);
    setForm({
      name: rule.name,
      fee_type: rule.fee_type,
      fee_amount: String(rule.fee_amount),
      grace_period_days: String(rule.grace_period_days),
      max_applications: rule.max_applications != null ? String(rule.max_applications) : '',
      is_active: Boolean(rule.is_active),
    });
    setFormError(null);
    setShowForm(true);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = {
      name: form.name,
      fee_type: form.fee_type,
      fee_amount: parseFloat(form.fee_amount) || 0,
      grace_period_days: parseInt(form.grace_period_days, 10) || 0,
      max_applications: form.max_applications ? parseInt(form.max_applications, 10) : null,
      is_active: form.is_active ? 1 : 0,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('lateFeeRules.title')}</h1>
        <button style={styles.btnPrimary} onClick={openNew}>{t('lateFeeRules.newRule')}</button>
      </div>

      {isLoading && <p>{t('common.loading')}</p>}

      {!isLoading && rules.length === 0 && (
        <p style={{ color: '#6b7280' }}>{t('lateFeeRules.noRules')}</p>
      )}

      {rules.length > 0 && (
        <>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('lateFeeRules.name')}</th>
              <th style={styles.th}>{t('lateFeeRules.feeType')}</th>
              <th style={styles.th}>{t('lateFeeRules.feeAmount')}</th>
              <th style={styles.th}>{t('lateFeeRules.gracePeriodDays')}</th>
              <th style={styles.th}>{t('lateFeeRules.maxApplications')}</th>
              <th style={styles.th}>{t('lateFeeRules.isActive')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.id}>
                <td style={styles.td}>{rule.name}</td>
                <td style={styles.td}>
                  {rule.fee_type === 'flat' ? t('lateFeeRules.feeTypeFlat') : t('lateFeeRules.feeTypePercent')}
                </td>
                <td style={styles.td}>
                  {rule.fee_type === 'percent'
                    ? `${parseFloat(String(rule.fee_amount)).toFixed(2)}%`
                    : parseFloat(String(rule.fee_amount)).toFixed(2)}
                </td>
                <td style={styles.td}>{rule.grace_period_days}</td>
                <td style={styles.td}>
                  {rule.max_applications == null ? t('lateFeeRules.maxApplicationsUnlimited') : rule.max_applications}
                </td>
                <td style={styles.td}>{rule.is_active ? 'Yes' : 'No'}</td>
                <td style={styles.td}>
                  <button style={styles.actionBtn} onClick={() => openEdit(rule)}>{t('common.edit')}</button>
                  {' '}
                  <button style={{ ...styles.actionBtn, color: 'var(--danger)' }} onClick={() => setDeleteTarget(rule)}>{t('common.delete')}</button>
                </td>
              </tr>
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

      {/* Create / Edit Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 420, maxWidth: '95vw' }}>
            <h2 style={{ marginTop: 0, marginBottom: 20, fontSize: 18, fontWeight: 700 }}>
              {editing ? t('common.edit') : t('lateFeeRules.newRule')}
            </h2>
            {formError && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{formError}</div>}
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{t('lateFeeRules.name')}</label>
                <input style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }}
                  required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{t('lateFeeRules.feeType')}</label>
                <select style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                  value={form.fee_type} onChange={e => setForm(f => ({ ...f, fee_type: e.target.value as 'flat' | 'percent' }))}>
                  <option value="flat">{t('lateFeeRules.feeTypeFlat')}</option>
                  <option value="percent">{t('lateFeeRules.feeTypePercent')}</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{t('lateFeeRules.feeAmount')}</label>
                <input style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }}
                  type="number" step="0.01" min="0" value={form.fee_amount}
                  onChange={e => setForm(f => ({ ...f, fee_amount: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{t('lateFeeRules.gracePeriodDays')}</label>
                <input style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }}
                  type="number" min="0" value={form.grace_period_days}
                  onChange={e => setForm(f => ({ ...f, grace_period_days: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{t('lateFeeRules.maxApplications')}</label>
                <input style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }}
                  type="number" min="1" placeholder={t('lateFeeRules.maxApplicationsUnlimited')}
                  value={form.max_applications}
                  onChange={e => setForm(f => ({ ...f, max_applications: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="is_active" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="is_active" style={{ fontSize: 13, fontWeight: 600 }}>{t('lateFeeRules.isActive')}</label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" style={{ padding: '8px 18px', background: '#1a5276', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  disabled={isPending}>
                  {isPending ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" style={{ padding: '8px 18px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                  onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); }}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 360 }}>
            <p style={{ marginTop: 0 }}>{t('lateFeeRules.deleteConfirm')}</p>
            <p style={{ fontWeight: 700 }}>{deleteTarget.name}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}>
                {t('common.delete')}
              </button>
              <button style={{ padding: '8px 18px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
