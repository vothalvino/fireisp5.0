// =============================================================================
// FireISP 5.0 — Contract Management
// =============================================================================
// Standalone page at /contracts. Shows all contracts across all clients with:
//   • Filtering by status
//   • Paginated table with client name, plan, type, dates, status
//   • Per-row actions: Renew (→ active), Suspend, Cancel
//   • "New Contract" button opens an inline modal form
// =============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';
import { useTableSort, SortableTh } from '@/components/SortableTh';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contract {
  id: number;
  client_id: number;
  plan_id: number;
  connection_type: string | null;
  start_date: string;
  end_date: string | null;
  billing_day: number | null;
  ip_address: string | null;
  price_override: string | null;
  status: string;
  facturar: boolean | number | null;
  notes: string | null;
}

// A provisioned PPPoE / RADIUS account belonging to a contract.  The backend
// returns the password in plaintext by design (operators need it to configure
// CPE).  A contract may have 0 or several accounts.
interface RadiusAccount {
  id: number;
  username: string;
  password: string | null;
  ip_address: string | null;
  ipv6_address: string | null;
  status: string | null;
  auth_method: string | null;
  mac_address: string | null;
  vlan_id: number | string | null;
  profile: string | null;
  nas_id: number | null;
}

interface ContractsResponse {
  data: Contract[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface Plan {
  id: number;
  name: string;
  price: string;
}

interface Client {
  id: number;
  name: string;
}

interface CreateContractBody {
  client_id: number;
  plan_id: number;
  connection_type?: string;
  start_date: string;
  billing_day?: number;
  price_override?: number;
  ip_address?: string;
  status?: string;
  facturar?: boolean;
}

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function fetchContracts(
  page: number,
  pageSize: number,
  statusFilter: string,
  orderBy: string,
  order: string,
): Promise<ContractsResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize, order_by: orderBy, order };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/contracts', {
    params: { query: query as never },
  });
  if (res.error) throw new Error('Failed to load contracts');
  return res.data as unknown as ContractsResponse;
}

// Sentinel thrown by fetchRadiusByContract so the UI can show a tailored
// "insufficient permission" message.  This endpoint requires `devices.view`
// (NOT `contracts.view`), so a viewer who can see contracts may still get 403.
const RADIUS_FORBIDDEN = 'radius_forbidden';

async function fetchRadiusByContract(id: number): Promise<RadiusAccount[]> {
  const res = await api.GET('/radius/contract/{contractId}', {
    params: { path: { contractId: id } as never },
  });
  // These endpoints are typed loosely, so the success/error union collapses to
  // `never` on the error branch — read `response.status` through an explicit
  // cast rather than relying on narrowing.
  const { error, response } = res as unknown as {
    error: unknown;
    response: { status: number };
  };
  if (error) {
    if (response?.status === 401 || response?.status === 403) {
      throw new Error(RADIUS_FORBIDDEN);
    }
    throw new Error('Failed to load RADIUS accounts');
  }
  return (res.data as unknown as { data: RadiusAccount[] }).data;
}

async function fetchPlans(): Promise<Plan[]> {
  const res = await api.GET('/plans', {
    params: { query: { limit: 200 } as never },
  });
  if (res.error) throw new Error('Failed to load plans');
  return (res.data as unknown as { data: Plan[] }).data;
}

async function fetchClients(): Promise<Client[]> {
  const res = await api.GET('/clients', {
    params: { query: { limit: 500 } as never },
  });
  if (res.error) throw new Error('Failed to load clients');
  return (res.data as unknown as { data: Client[] }).data;
}

async function patchContractStatus(
  id: number,
  status: string,
  endDate?: string | null,
): Promise<void> {
  const body: Record<string, unknown> = { status };
  if (endDate !== undefined) body.end_date = endDate;
  // PATCH is not in the generated OpenAPI schema yet; use raw fetch with the stored token.
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/contracts/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to update contract');
}

async function postContractAction(
  id: number,
  action: 'suspend' | 'unsuspend' | 'renew' | 'terminate',
  extra?: Record<string, unknown>,
): Promise<void> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/contracts/${id}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(extra ?? {}),
  });
  if (!res.ok) throw new Error(`Failed to ${action} contract`);
}

async function createContract(body: CreateContractBody): Promise<void> {
  const res = await api.POST('/contracts', { body: body as never });
  if (res.error) throw new Error('Failed to create contract');
}

interface UpdateContractBody {
  plan_id?: number;
  connection_type?: string;
  start_date?: string;
  end_date?: string | null;
  billing_day?: number;
  price_override?: number;
  ip_address?: string;
  status?: string;
  facturar?: boolean;
}

async function updateContract(id: number, body: UpdateContractBody): Promise<void> {
  const res = await api.PUT('/contracts/{id}', {
    params: { path: { id } },
    body: body as never,
  });
  if (res.error) throw new Error('Failed to update contract');
}

async function deleteContract(id: number): Promise<void> {
  const res = await api.DELETE('/contracts/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete contract');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function capitalizeStatus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Copy `text` to the clipboard, guarding for non-secure contexts (http / older
// browsers) where navigator.clipboard is undefined.  Falls back to a hidden
// textarea + execCommand and resolves false if even that is unavailable so the
// caller never throws.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:     { bg: '#d1fae5', color: '#065f46' },
    pending:    { bg: '#ede9fe', color: '#5b21b6' },
    suspended:  { bg: '#fef3c7', color: '#92400e' },
    cancelled:  { bg: '#fee2e2', color: '#991b1b' },
    terminated: { bg: '#f3f4f6', color: '#6b7280' },
    expired:    { bg: '#fde68a', color: '#78350f' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New Contract Modal
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().split('T')[0];

interface NewContractModalProps {
  plans: Plan[];
  clients: Client[];
  onClose: () => void;
  onCreated: () => void;
}

function NewContractModal({ plans, clients, onClose, onCreated }: NewContractModalProps) {
  const [form, setForm] = useState({
    client_id: '',
    plan_id: '',
    connection_type: 'pppoe',
    start_date: TODAY,
    billing_day: '1',
    ip_address: '',
    price_override: '',
    facturar: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id || !form.plan_id || !form.start_date) {
      setError('Client, Plan, and Start Date are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body: CreateContractBody = {
        client_id: Number(form.client_id),
        plan_id: Number(form.plan_id),
        connection_type: form.connection_type,
        start_date: form.start_date,
        billing_day: form.billing_day ? Math.min(28, Math.max(1, Number(form.billing_day))) : undefined,
        ip_address: form.ip_address || undefined,
        price_override: form.price_override ? Number(form.price_override) : undefined,
        facturar: form.facturar,
      };
      await createContract(body);
      onCreated();
      onClose();
    } catch {
      setError('Failed to create contract. Check all fields and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div style={modalStyles.header}>
          <h2 id="modal-title" style={modalStyles.title}>📄 New Contract</h2>
          <button
            style={modalStyles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          {/* Client */}
          <label style={modalStyles.label}>
            Client <span style={{ color: '#ef4444' }}>*</span>
            <select
              style={modalStyles.select}
              value={form.client_id}
              onChange={e => setField('client_id', e.target.value)}
              required
            >
              <option value="">— select client —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* Plan */}
          <label style={modalStyles.label}>
            Plan <span style={{ color: '#ef4444' }}>*</span>
            <select
              style={modalStyles.select}
              value={form.plan_id}
              onChange={e => setField('plan_id', e.target.value)}
              required
            >
              <option value="">— select plan —</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {/* Connection type */}
          <label style={modalStyles.label}>
            Connection Type
            <select
              style={modalStyles.select}
              value={form.connection_type}
              onChange={e => setField('connection_type', e.target.value)}
            >
              <option value="pppoe">PPPoE</option>
              <option value="pppoe_dual">PPPoE Dual</option>
              <option value="static">Static</option>
              <option value="dual">Dual</option>
            </select>
          </label>

          {/* Start date */}
          <label style={modalStyles.label}>
            Start Date <span style={{ color: '#ef4444' }}>*</span>
            <input
              style={modalStyles.input}
              type="date"
              value={form.start_date}
              onChange={e => setField('start_date', e.target.value)}
              required
            />
          </label>

          {/* Billing day */}
          <label style={modalStyles.label}>
            Billing Day (1–28)
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              max={28}
              value={form.billing_day}
              onChange={e => setField('billing_day', e.target.value)}
              placeholder="e.g. 1"
            />
          </label>

          {/* IP address */}
          <label style={modalStyles.label}>
            IP Address
            <input
              style={modalStyles.input}
              type="text"
              value={form.ip_address}
              onChange={e => setField('ip_address', e.target.value)}
              placeholder="e.g. 192.168.1.100"
              maxLength={45}
            />
          </label>

          {/* Price override */}
          <label style={modalStyles.label}>
            Price Override (leave blank for plan default)
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              step="0.01"
              value={form.price_override}
              onChange={e => setField('price_override', e.target.value)}
              placeholder="e.g. 350.00"
            />
          </label>

          {/* Facturar */}
          <label style={modalStyles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.facturar}
              onChange={e => setField('facturar', e.target.checked)}
            />
            Generate CFDI invoice automatically
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button
              type="button"
              onClick={onClose}
              style={styles.btnSecondary}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={styles.btnPrimary}
              disabled={submitting}
            >
              {submitting ? 'Creating…' : 'Create Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: '#111827' }}>
          {message}
        </p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renew modal (set new end date + activate)
// ---------------------------------------------------------------------------

interface RenewModalProps {
  contractId: number;
  onClose: () => void;
  onRenewed: () => void;
}

function RenewModal({ contractId, onClose, onRenewed }: RenewModalProps) {
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      // Use the dedicated /renew endpoint — PATCH {status:'active'} is blocked by
      // the DB FSM trigger for suspended/expired/cancelled contracts.
      await postContractAction(contractId, 'renew', { end_date: endDate || null });
      onRenewed();
      onClose();
    } catch {
      setError('Failed to renew contract. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="renew-title"
      >
        <div style={modalStyles.header}>
          <h2 id="renew-title" style={modalStyles.title}>🔄 Renew Contract</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            New End Date (leave blank for month-to-month)
            <input
              style={modalStyles.input}
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </label>
          {error && <p style={modalStyles.error}>{error}</p>}
          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={submitting}>
              {submitting ? 'Renewing…' : 'Renew'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Contract Modal
// ---------------------------------------------------------------------------

interface EditContractModalProps {
  contract: Contract;
  plans: Plan[];
  onClose: () => void;
  onSaved: () => void;
}

const EDIT_STATUSES = ['pending', 'active', 'suspended', 'cancelled', 'terminated'];

function EditContractModal({ contract, plans, onClose, onSaved }: EditContractModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    plan_id: String(contract.plan_id),
    connection_type: contract.connection_type || 'pppoe',
    start_date: contract.start_date ? contract.start_date.split('T')[0] : '',
    end_date: contract.end_date ? contract.end_date.split('T')[0] : '',
    billing_day: contract.billing_day != null ? String(contract.billing_day) : '',
    ip_address: contract.ip_address || '',
    price_override: contract.price_override != null ? String(contract.price_override) : '',
    status: contract.status,
    facturar: !!contract.facturar,
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: UpdateContractBody = {
        plan_id: Number(form.plan_id),
        connection_type: form.connection_type,
        status: form.status,
        facturar: form.facturar,
        end_date: form.end_date || null,
      };
      if (form.start_date) body.start_date = form.start_date;
      if (form.billing_day) body.billing_day = Math.min(28, Math.max(1, Number(form.billing_day)));
      if (form.ip_address) body.ip_address = form.ip_address;
      if (form.price_override) body.price_override = Number(form.price_override);
      return updateContract(contract.id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      onSaved();
      onClose();
    },
    onError: () => setError('Failed to update contract. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contract-title"
      >
        <div style={modalStyles.header}>
          <h2 id="edit-contract-title" style={modalStyles.title}>📝 Edit Contract #{contract.id}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Plan
            <select style={modalStyles.select} value={form.plan_id} onChange={e => setField('plan_id', e.target.value)}>
              {/* If the contract runs on an archived plan (absent from the active
                  list), keep it shown + selectable so the selection stays correct
                  and the contract isn't silently moved off it. */}
              {!plans.some(p => p.id === contract.plan_id) && (
                <option value={contract.plan_id}>Archived plan (#{contract.plan_id})</option>
              )}
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Connection Type
            <select style={modalStyles.select} value={form.connection_type} onChange={e => setField('connection_type', e.target.value)}>
              <option value="pppoe">PPPoE</option>
              <option value="pppoe_dual">PPPoE Dual</option>
              <option value="static">Static</option>
              <option value="dual">Dual</option>
            </select>
          </label>

          <label style={modalStyles.label}>
            Status
            <select style={modalStyles.select} value={form.status} onChange={e => setField('status', e.target.value)}>
              {EDIT_STATUSES.map(s => <option key={s} value={s}>{capitalizeStatus(s)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            Start Date
            <input style={modalStyles.input} type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            End Date (leave blank for month-to-month)
            <input style={modalStyles.input} type="date" value={form.end_date} onChange={e => setField('end_date', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Billing Day (1–28)
            <input style={modalStyles.input} type="number" min={1} max={28} value={form.billing_day} onChange={e => setField('billing_day', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            IP Address
            <input style={modalStyles.input} type="text" maxLength={45} value={form.ip_address} onChange={e => setField('ip_address', e.target.value)} />
          </label>

          <label style={modalStyles.label}>
            Price Override (leave blank for plan default)
            <input style={modalStyles.input} type="number" min={0} step="0.01" value={form.price_override} onChange={e => setField('price_override', e.target.value)} />
          </label>

          <label style={modalStyles.checkboxLabel}>
            <input type="checkbox" checked={form.facturar} onChange={e => setField('facturar', e.target.checked)} />
            Generate CFDI invoice automatically
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract Detail Modal — summary + PPPoE / RADIUS credentials
// ---------------------------------------------------------------------------

interface ContractDetailModalProps {
  contract: Contract;
  plans: Plan[];
  onClose: () => void;
}

/** One labelled value row with an optional Copy button. */
function CredentialRow({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  copyable?: string | null;
  mono?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!copyable) return;
    const ok = await copyToClipboard(copyable);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div style={detailStyles.credRow}>
      <span style={detailStyles.credLabel}>{label}</span>
      <span style={{ ...detailStyles.credValue, ...(mono ? detailStyles.mono : {}) }}>
        {value}
      </span>
      {copyable != null && copyable !== '' && (
        <button type="button" style={detailStyles.copyBtn} onClick={handleCopy} title={t('contractList.copy')}>
          {copied ? '✓' : `⧉ ${t('contractList.copy')}`}
        </button>
      )}
    </div>
  );
}

/** A single PPPoE/RADIUS account block with a password reveal toggle. */
function RadiusAccountCard({ account }: { account: RadiusAccount }) {
  const { t } = useTranslation();
  const [showPw, setShowPw] = useState(false);

  const assignedIp = [account.ip_address, account.ipv6_address].filter(Boolean).join(' / ') || '—';
  const macVlan = [
    account.mac_address ? `MAC ${account.mac_address}` : null,
    account.vlan_id != null && account.vlan_id !== '' ? `VLAN ${account.vlan_id}` : null,
  ].filter(Boolean).join(' · ') || '—';

  return (
    <div style={detailStyles.accountCard}>
      <CredentialRow label={t('contractList.username')} value={account.username || '—'} copyable={account.username} mono />
      <CredentialRow
        label={t('contractList.password')}
        value={
          <span style={detailStyles.mono}>
            {account.password == null
              ? '—'
              : showPw
                ? account.password
                : '•'.repeat(Math.min(12, Math.max(6, account.password.length)))}
            {account.password != null && (
              <button
                type="button"
                style={detailStyles.toggleBtn}
                onClick={() => setShowPw(s => !s)}
              >
                {showPw ? t('contractList.hidePassword') : t('contractList.showPassword')}
              </button>
            )}
          </span>
        }
        copyable={account.password}
      />
      <CredentialRow label={t('contractList.assignedIp')} value={assignedIp} copyable={assignedIp !== '—' ? assignedIp : null} mono />
      <CredentialRow label={t('contractList.table.status')} value={account.status ? <StatusBadge status={account.status} /> : '—'} />
      <CredentialRow label={t('contractList.authMethod')} value={account.auth_method || '—'} />
      <CredentialRow label="MAC / VLAN" value={macVlan} mono />
      <CredentialRow label={t('contractList.table.plan')} value={account.profile || '—'} />
    </div>
  );
}

function ContractDetailModal({ contract, plans, onClose }: ContractDetailModalProps) {
  const { t } = useTranslation();
  const plan = plans.find(p => p.id === contract.plan_id);

  const radiusQ = useQuery({
    queryKey: ['radius-contract', contract.id],
    queryFn: () => fetchRadiusByContract(contract.id),
  });

  const accounts = radiusQ.data ?? [];
  const forbidden = radiusQ.error instanceof Error && radiusQ.error.message === RADIUS_FORBIDDEN;

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-detail-title"
      >
        <div style={modalStyles.header}>
          <h2 id="contract-detail-title" style={modalStyles.title}>
            🔑 {t('contractList.credentials')} — #{contract.id}
          </h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Contract summary */}
        <div style={detailStyles.summary}>
          <CredentialRow label={t('contractList.table.plan')} value={plan ? plan.name : `Plan #${contract.plan_id}`} />
          <CredentialRow label={t('contractList.table.type')} value={contract.connection_type || '—'} />
          <CredentialRow label={t('contractList.table.status')} value={<StatusBadge status={contract.status} />} />
          <CredentialRow label={t('contractList.table.start')} value={fmt(contract.start_date)} />
          <CredentialRow label={t('contractList.table.end')} value={fmt(contract.end_date)} />
          <CredentialRow label={t('contractList.table.billingDay')} value={contract.billing_day ?? '—'} />
        </div>

        <h3 style={detailStyles.sectionTitle}>{t('contractList.credentials')}</h3>

        {radiusQ.isLoading ? (
          <p style={styles.msg}>{t('contractList.loading')}</p>
        ) : forbidden ? (
          <p style={modalStyles.error}>{t('contractList.credentialsForbidden')}</p>
        ) : radiusQ.error ? (
          <p style={modalStyles.error}>{t('contractList.credentialsError')}</p>
        ) : accounts.length === 0 ? (
          <p style={styles.msg}>{t('contractList.noRadius')}</p>
        ) : (
          accounts.map(acc => <RadiusAccountCard key={acc.id} account={acc} />)
        )}

        <div style={modalStyles.actions}>
          <button type="button" onClick={onClose} style={styles.btnSecondary}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContractList component
// ---------------------------------------------------------------------------

type ConfirmAction =
  | { type: 'suspend'; contractId: number }
  | { type: 'terminate'; contractId: number }
  | { type: 'cancel'; contractId: number }
  | { type: 'delete'; contractId: number };

const STATUS_OPTIONS = ['', 'active', 'pending', 'suspended', 'cancelled', 'terminated', 'expired'];

export function ContractList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [renewId, setRenewId] = useState<number | null>(null);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [detailContract, setDetailContract] = useState<Contract | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const sort = useTableSort('created_at', 'DESC');

  useEffect(() => { setPage(1); }, [sort.sortBy, sort.sortDir]);

  // Mutation for terminate (uses dedicated endpoint)
  const terminateMutation = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      postContractAction(id, 'terminate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  // Contracts query
  const contractsQ = useQuery({
    queryKey: ['contracts', page, pageSize, statusFilter, sort.sortBy, sort.sortDir],
    queryFn: () => fetchContracts(page, pageSize, statusFilter, sort.order_by, sort.order),
  });

  // Plans + clients (needed for new contract form)
  const plansQ = useQuery({
    queryKey: ['plans-lookup'],
    queryFn: fetchPlans,
    staleTime: 60_000,
  });

  const clientsQ = useQuery({
    queryKey: ['clients-lookup'],
    queryFn: fetchClients,
    staleTime: 60_000,
  });

  const clientMap = new Map((clientsQ.data ?? []).map((c: Client) => [c.id, c.name]));

  // Mutation for suspend (uses dedicated CoA-disconnect endpoint)
  const suspendMutation = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      postContractAction(id, 'suspend'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  // Mutation for cancel (still uses PATCH — no RADIUS session to kick)
  const cancelMutation = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      patchContractStatus(id, 'cancelled'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  // Mutation for soft-delete
  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: number }) => deleteContract(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handleConfirm() {
    if (!confirm) return;
    if (confirm.type === 'suspend') {
      suspendMutation.mutate({ id: confirm.contractId });
    } else if (confirm.type === 'terminate') {
      terminateMutation.mutate({ id: confirm.contractId });
    } else if (confirm.type === 'delete') {
      deleteMutation.mutate({ id: confirm.contractId });
    } else {
      cancelMutation.mutate({ id: confirm.contractId });
    }
    setConfirm(null);
  }

  const contracts = contractsQ.data?.data ?? [];
  const meta = contractsQ.data?.meta;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📄 {t('contractList.title')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button
          style={{ ...styles.btnPrimary, marginLeft: 'auto' }}
          onClick={() => setShowNew(true)}
        >
          {t('contractList.newContract')}
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>{t('contractList.filterStatus')}</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? capitalizeStatus(s) : t('contractList.filterAll')}</option>
          ))}
        </select>
        {statusFilter && (
          <button
            type="button"
            style={styles.btnSecondary}
            onClick={() => handleFilterChange('')}
          >
            {t('contractList.clearFilter')}
          </button>
        )}
      </div>

      {/* Mutation error banner */}
      {(suspendMutation.isError || cancelMutation.isError || terminateMutation.isError || deleteMutation.isError) && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {t('contractList.actionFailed')}
        </p>
      )}

      {/* Table */}
      <div style={styles.tableCard}>
        {contractsQ.isLoading ? (
          <p style={styles.msg}>{t('contractList.loading')}</p>
        ) : contractsQ.error ? (
          <p style={styles.msgError}>{t('contractList.error')}</p>
        ) : contracts.length === 0 ? (
          <p style={styles.msg}>{t('contractList.noContracts')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <SortableTh label={t('contractList.table.id')} col="id" sort={sort} style={styles.th} />
                    {/* Client name (non-sortable — from a JOIN); narrow ID column sorts by client_id */}
                    <th style={styles.th}>{t('contractList.table.client')}</th>
                    <th style={{ ...styles.th, width: 40 }}>{t('contractList.table.clientId')}</th>
                    {/* plan name comes from a JOIN → non-sortable; plan_id is real but less useful */}
                    <th style={styles.th}>{t('contractList.table.plan')}</th>
                    <SortableTh label={t('contractList.table.type')} col="connection_type" sort={sort} style={styles.th} />
                    <SortableTh label={t('contractList.table.start')} col="start_date" sort={sort} style={styles.th} />
                    <SortableTh label={t('contractList.table.end')} col="end_date" sort={sort} style={styles.th} />
                    <SortableTh label={t('contractList.table.billingDay')} col="billing_day" sort={sort} style={styles.th} />
                    <th style={styles.th}>{t('contractList.table.ip')}</th>
                    <SortableTh label={t('contractList.table.status')} col="status" sort={sort} style={styles.th} />
                    <th style={styles.th}>{t('contractList.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <ContractRow
                      key={c.id}
                      contract={c}
                      plans={plansQ.data ?? []}
                      clientName={clientMap.get(c.client_id) ?? null}
                      onSuspend={() => setConfirm({ type: 'suspend', contractId: c.id })}
                      onTerminate={() => setConfirm({ type: 'terminate', contractId: c.id })}
                      onCancel={() => setConfirm({ type: 'cancel', contractId: c.id })}
                      onRenew={() => setRenewId(c.id)}
                      onEdit={() => setEditContract(c)}
                      onDelete={() => setConfirm({ type: 'delete', contractId: c.id })}
                      onCredentials={() => setDetailContract(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <Pagination
              page={page}
              totalPages={meta?.totalPages ?? 1}
              total={meta?.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {/* Modals */}
      {showNew && plansQ.data && clientsQ.data && (
        <NewContractModal
          plans={plansQ.data}
          clients={clientsQ.data}
          onClose={() => setShowNew(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['contracts'] })}
        />
      )}

      {renewId !== null && (
        <RenewModal
          contractId={renewId}
          onClose={() => setRenewId(null)}
          onRenewed={() => queryClient.invalidateQueries({ queryKey: ['contracts'] })}
        />
      )}

      {editContract && plansQ.data && (
        <EditContractModal
          contract={editContract}
          plans={plansQ.data}
          onClose={() => setEditContract(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['contracts'] })}
        />
      )}

      {detailContract && (
        <ContractDetailModal
          contract={detailContract}
          plans={plansQ.data ?? []}
          onClose={() => setDetailContract(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={
            confirm.type === 'suspend'
              ? 'Suspend this contract? The client will lose service.'
              : confirm.type === 'terminate'
                ? 'Terminate this contract? This permanently ends service and cannot be undone.'
                : confirm.type === 'delete'
                  ? 'Delete this contract? It will be soft-deleted and removed from the list.'
                  : 'Cancel this contract? This action is difficult to reverse.'
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContractRow
// ---------------------------------------------------------------------------

interface ContractRowProps {
  contract: Contract;
  plans: Plan[];
  clientName: string | null;
  onSuspend: () => void;
  onTerminate: () => void;
  onCancel: () => void;
  onRenew: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCredentials: () => void;
}

function ContractRow({ contract: c, plans, clientName, onSuspend, onTerminate, onCancel, onRenew, onEdit, onDelete, onCredentials }: ContractRowProps) {
  const { t } = useTranslation();
  const plan = plans.find(p => p.id === c.plan_id);

  const canSuspend = c.status === 'active' || c.status === 'pending';
  const canTerminate = c.status === 'active' || c.status === 'suspended';
  const canCancel = c.status !== 'cancelled' && c.status !== 'terminated' && c.status !== 'expired';
  const canRenew = c.status === 'suspended' || c.status === 'cancelled' || c.status === 'expired' || c.status === 'terminated';

  return (
    <tr style={styles.tr}>
      <td style={styles.td}>
        <Link
          to={`/contracts/${c.id}`}
          style={styles.idLink}
          title={t('contractList.view')}
        >
          #{c.id}
        </Link>
      </td>
      <td style={styles.td}>
        <Link
          to={`/clients/${c.client_id}`}
          style={{ color: 'var(--link)', textDecoration: 'none', fontWeight: 500 }}
        >
          {clientName ?? String(c.client_id)}
        </Link>
      </td>
      <td style={{ ...styles.td, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap', width: 40 }}>
        {c.client_id}
      </td>
      <td style={styles.td}>{plan ? plan.name : `Plan #${c.plan_id}`}</td>
      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{c.connection_type || '—'}</td>
      <td style={styles.td}>{fmt(c.start_date)}</td>
      <td style={styles.td}>{fmt(c.end_date)}</td>
      <td style={styles.td}>{c.billing_day ?? '—'}</td>
      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{c.ip_address || '—'}</td>
      <td style={styles.td}><StatusBadge status={c.status} /></td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        <button
          style={styles.actionBtn}
          onClick={onCredentials}
          title={t('contractList.credentials')}
        >
          🔑 {t('contractList.credentials')}
        </button>
        <button
          style={styles.actionBtn}
          onClick={onEdit}
          title="Edit this contract"
        >
          ✏️ Edit
        </button>
        {canRenew && (
          <button
            style={styles.actionBtn}
            onClick={onRenew}
            title="Reactivate this contract"
          >
            🔄 Renew
          </button>
        )}
        {canSuspend && (
          <button
            style={{ ...styles.actionBtn, color: '#92400e' }}
            onClick={onSuspend}
            title="Suspend this contract"
          >
            ⏸ Suspend
          </button>
        )}
        {canTerminate && (
          <button
            style={{ ...styles.actionBtn, color: '#991b1b' }}
            onClick={onTerminate}
            title="Permanently terminate this contract"
          >
            🚫 Terminate
          </button>
        )}
        {canCancel && (
          <button
            style={{ ...styles.actionBtn, color: '#991b1b' }}
            onClick={onCancel}
            title="Cancel this contract"
          >
            ✕ Cancel
          </button>
        )}
        <button
          style={{ ...styles.actionBtn, color: '#991b1b' }}
          onClick={onDelete}
          title="Delete this contract"
        >
          🗑 Delete
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1280,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1.25rem',
    flexWrap: 'wrap' as const,
  },
  pageTitle: { margin: 0, color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700 },
  countBadge: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: '0.78rem',
    fontWeight: 600,
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  filterLabel: { fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 },
  filterSelect: {
    padding: '0.4rem 0.65rem',
    border: '1px solid var(--input-border)',
    borderRadius: 6,
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    background: 'var(--input-bg)',
    cursor: 'pointer',
  },
  btnPrimary: {
    padding: '0.5rem 1rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  btnSecondary: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  btnDanger: {
    padding: '0.5rem 1rem',
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  tableCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    padding: '0.5rem 0',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.6rem 0.75rem',
    textAlign: 'left' as const,
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid var(--border-subtle)',
    whiteSpace: 'nowrap' as const,
  },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  actionBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--link)',
    padding: '2px 4px',
    marginRight: 4,
    borderRadius: 3,
  },
  idLink: {
    color: 'var(--link)',
    fontWeight: 600,
    fontSize: '0.85rem',
    textDecoration: 'underline',
  },
  msg: { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--border-subtle)',
    marginTop: 4,
  },
  pageBtn: {
    padding: '0.35rem 0.85rem',
    border: '1px solid var(--border-strong)',
    borderRadius: 5,
    background: 'var(--bg-card)',
    cursor: 'pointer',
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
  },
  pageInfo: { color: 'var(--text-muted)', fontSize: '0.82rem' },
};

const modalStyles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem',
  },
  panel: {
    background: 'var(--bg-card)',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,.2)',
    padding: '1.5rem',
    width: '100%',
    maxWidth: 520,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.25rem',
  },
  title: { margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    color: 'var(--text-muted)',
    padding: '2px 6px',
    borderRadius: 4,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.9rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.3rem',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  input: {
    padding: '0.45rem 0.65rem',
    border: '1px solid var(--input-border)',
    borderRadius: 6,
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
  },
  select: {
    padding: '0.45rem 0.65rem',
    border: '1px solid var(--input-border)',
    borderRadius: 6,
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    background: 'var(--input-bg)',
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  error: {
    color: '#ef4444',
    fontSize: '0.82rem',
    margin: 0,
    padding: '0.4rem 0.75rem',
    background: '#fef2f2',
    borderRadius: 4,
    border: '1px solid #fecaca',
  },
  checkboxLabel: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
};

// Styles specific to the Contract Detail / credentials modal.
const detailStyles = {
  summary: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.35rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid var(--border-subtle)',
    marginBottom: '0.75rem',
  },
  sectionTitle: {
    margin: '0 0 0.75rem',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  accountCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.35rem',
    padding: '0.75rem',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    marginBottom: '0.75rem',
    background: 'var(--input-bg)',
  },
  credRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
    fontSize: '0.82rem',
  },
  credLabel: {
    minWidth: 110,
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  credValue: {
    color: 'var(--text-primary)',
    wordBreak: 'break-all' as const,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
  },
  copyBtn: {
    background: 'transparent',
    border: '1px solid var(--border-strong)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    padding: '1px 8px',
    marginLeft: 'auto',
  },
  toggleBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--link)',
    padding: '0 0 0 8px',
  },
};
