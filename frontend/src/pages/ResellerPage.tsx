// =============================================================================
// FireISP 5.0 — Reseller Management Page (Section 19)
// =============================================================================
// Multi-tab page covering §19 Reseller Support:
//   1. Resellers      — hierarchy list (master + sub-resellers)
//   2. Plan Prices    — per-reseller custom plan price overrides
//   3. Commissions    — commission earnings per reseller
//   4. Resources      — IP pool, bandwidth quota, OLT port allocations
//   5. Billing        — per-reseller billing entity configuration
//   6. Portal         — reseller portal dashboard & customer management
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { readCsrfCookie } from '@/api/csrf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'resellers' | 'planPrices' | 'commissions' | 'resources' | 'billing' | 'portal';

interface Reseller {
  id: number;
  name: string;
  email: string | null;
  contact_name: string | null;
  parent_id: number | null;
  parent_name: string | null;
  level: number;
  status: string;
  commission_rate: number;
  portal_name: string | null;
  portal_domain: string | null;
}

interface PlanPrice {
  id: number;
  reseller_id: number;
  plan_id: number;
  plan_name: string;
  base_price: number;
  custom_price: number;
  currency: string;
  is_active: number;
}

interface Commission {
  id: number;
  reseller_id: number;
  invoice_id: number;
  invoice_number: string | null;
  client_id: number | null;
  client_name: string | null;
  commission_rate: number;
  invoice_total: number;
  commission_amount: number;
  currency: string;
  status: string;
  created_at: string;
}

interface IpPoolAllocation {
  id: number;
  reseller_id: number;
  ip_pool_id: number;
  pool_name: string | null;
  network: string;
  subnet_mask: string;
  ip_version: string;
}

interface BandwidthQuota {
  id: number;
  reseller_id: number;
  download_mbps: number | null;
  upload_mbps: number | null;
  is_enforced: number;
}

interface BillingEntity {
  id: number;
  reseller_id: number;
  legal_name: string;
  tax_id: string | null;
  email: string | null;
  invoice_prefix: string | null;
  currency: string;
  is_active: number;
}

interface ResellerDashboard {
  reseller_id: number;
  subscriber_count: number;
  total_revenue: number;
  open_tickets: number;
  pending_commission: number;
}

interface ListMeta { total: number; page: number; limit: number }
interface ApiList<T> { data: T[]; meta: ListMeta }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const orgId = localStorage.getItem('orgId') ?? '1';
  const token = localStorage.getItem('token') ?? '';
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Org-Id': orgId,
      ...(readCsrfCookie() ? { 'X-CSRF-Token': readCsrfCookie()! } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ value }: { value: string }) {
  const color: Record<string, string> = {
    active: '#2ecc71', paid: '#2ecc71', approved: '#27ae60',
    suspended: '#e67e22', inactive: '#95a5a6',
    pending: '#f39c12', cancelled: '#e74c3c',
  };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, color: '#fff',
      background: color[value] ?? '#7f8c8d',
    }}>
      {value}
    </span>
  );
}

function ActionButton({ label, onClick, disabled, variant = 'primary' }:
  { label: string; onClick: () => void; disabled?: boolean; variant?: 'primary' | 'danger' | 'success' }) {
  const bg = variant === 'danger' ? '#e74c3c' : variant === 'success' ? '#2ecc71' : '#3498db';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '4px 10px', fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#ccc' : bg, color: '#fff', border: 'none', borderRadius: 4,
    }}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab: Resellers List
// ---------------------------------------------------------------------------

function ResellersTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<Reseller>>(`/resellers?page=${page}&limit=25`);
      setResellers(res.data); setMeta(res.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [page, t]);

  useEffect(() => { load(); }, [load]);

  async function handleSuspend(r: Reseller) {
    try {
      const result = await apiFetch<{ data: { status: string } }>(`/resellers/${r.id}/suspend`, { method: 'POST' });
      setMsg(`${r.name} is now ${result.data.status}`);
      load();
    } catch {
      setError(t('reseller.errorSuspend'));
    }
  }

  async function handleDelete(r: Reseller) {
    if (!window.confirm(t('reseller.confirmDelete'))) return;
    try {
      await apiFetch(`/resellers/${r.id}`, { method: 'DELETE' });
      setMsg(t('reseller.deleted'));
      load();
    } catch {
      setError(t('reseller.errorDelete'));
    }
  }

  return (
    <div>
      <h3>{t('reseller.resellerList')}</h3>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {msg && <p style={{ color: '#2ecc71' }}>{msg}</p>}
      {loading ? <p>{t('reseller.loading')}</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.name')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.level')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.parent')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.commissionRate')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.portalName')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.status')}</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {resellers.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 8, textAlign: 'center', color: '#999' }}>{t('reseller.noResellers')}</td></tr>
            )}
            {resellers.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.id}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.name}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.level === 1 ? 'Master' : 'Sub'}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.parent_name ?? '—'}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.commission_rate}%</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{r.portal_name ?? '—'}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}><StatusBadge value={r.status} /></td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd', display: 'flex', gap: 4 }}>
                  <ActionButton label={r.status === 'suspended' ? t('reseller.reactivate') : t('reseller.suspend')} onClick={() => handleSuspend(r)} variant={r.status === 'suspended' ? 'success' : 'danger'} />
                  <ActionButton label={t('reseller.delete')} onClick={() => handleDelete(r)} variant="danger" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {meta && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <ActionButton label="<" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} />
          <span>{t('reseller.page')} {page} / {Math.ceil(meta.total / meta.limit)}</span>
          <ActionButton label=">" onClick={() => setPage(p => p + 1)} disabled={page * meta.limit >= meta.total} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Plan Prices (requires a reseller selection)
// ---------------------------------------------------------------------------

function PlanPricesTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prices, setPrices] = useState<PlanPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiList<Reseller>>('/resellers?limit=100')
      .then(res => setResellers(res.data))
      .catch(() => setError(t('reseller.errorLoading')));
  }, [t]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<{ data: PlanPrice[] }>(`/resellers/${selectedId}/plan-prices`);
      setPrices(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [selectedId, t]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(ppId: number) {
    if (!selectedId) return;
    try {
      await apiFetch(`/resellers/${selectedId}/plan-prices/${ppId}`, { method: 'DELETE' });
      load();
    } catch {
      setError(t('reseller.errorDelete'));
    }
  }

  return (
    <div>
      <h3>{t('reseller.customPlanPrices')}</h3>
      <label>{t('reseller.selectReseller')}: </label>
      <select value={selectedId ?? ''} onChange={e => setSelectedId(parseInt(e.target.value, 10) || null)} style={{ padding: '4px 8px', marginBottom: 12 }}>
        <option value="">— {t('reseller.select')} —</option>
        {resellers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {loading && <p>{t('reseller.loading')}</p>}
      {selectedId && !loading && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.plan')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.basePrice')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.customPrice')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.currency')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.active')}</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 8, textAlign: 'center', color: '#999' }}>{t('reseller.noPlanPrices')}</td></tr>
            )}
            {prices.map((pp) => (
              <tr key={pp.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{pp.plan_name}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{pp.base_price}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}><strong>{pp.custom_price}</strong></td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{pp.currency}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{pp.is_active ? 'Yes' : 'No'}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>
                  <ActionButton label={t('reseller.delete')} onClick={() => handleDelete(pp.id)} variant="danger" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Commissions
// ---------------------------------------------------------------------------

function CommissionsTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiList<Reseller>>('/resellers?limit=100')
      .then(res => setResellers(res.data))
      .catch(() => setError(t('reseller.errorLoading')));
  }, [t]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<ApiList<Commission>>(`/resellers/${selectedId}/commissions?limit=50`);
      setCommissions(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [selectedId, t]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(c: Commission) {
    if (!selectedId) return;
    try {
      await apiFetch(`/resellers/${selectedId}/commissions/${c.id}/approve`, {
        method: 'POST', body: JSON.stringify({ status: 'approved' }),
      });
      setMsg(t('reseller.commissionApproved'));
      load();
    } catch {
      setError(t('reseller.errorApprove'));
    }
  }

  return (
    <div>
      <h3>{t('reseller.commissions')}</h3>
      <label>{t('reseller.selectReseller')}: </label>
      <select value={selectedId ?? ''} onChange={e => setSelectedId(parseInt(e.target.value, 10) || null)} style={{ padding: '4px 8px', marginBottom: 12 }}>
        <option value="">— {t('reseller.select')} —</option>
        {resellers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {msg && <p style={{ color: '#2ecc71' }}>{msg}</p>}
      {loading && <p>{t('reseller.loading')}</p>}
      {selectedId && !loading && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.invoice')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.client')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.rate')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.amount')}</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.status')}</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {commissions.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 8, textAlign: 'center', color: '#999' }}>{t('reseller.noCommissions')}</td></tr>
            )}
            {commissions.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{c.invoice_number ?? c.invoice_id}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{c.client_name ?? c.client_id}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{c.commission_rate}%</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{c.commission_amount} {c.currency}</td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}><StatusBadge value={c.status} /></td>
                <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>
                  {c.status === 'pending' && (
                    <ActionButton label={t('reseller.approve')} onClick={() => handleApprove(c)} variant="success" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Resources (IP pools + bandwidth quota + OLT ports)
// ---------------------------------------------------------------------------

function ResourcesTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ipPools, setIpPools] = useState<IpPoolAllocation[]>([]);
  const [bwQuota, setBwQuota] = useState<BandwidthQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiList<Reseller>>('/resellers?limit=100')
      .then(res => setResellers(res.data))
      .catch(() => setError(t('reseller.errorLoading')));
  }, [t]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const [poolsRes, bwRes] = await Promise.all([
        apiFetch<{ data: IpPoolAllocation[] }>(`/resellers/${selectedId}/ip-pools`),
        apiFetch<{ data: BandwidthQuota | null }>(`/resellers/${selectedId}/bandwidth-quota`),
      ]);
      setIpPools(poolsRes.data);
      setBwQuota(bwRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [selectedId, t]);

  useEffect(() => { load(); }, [load]);

  async function handleRemovePool(allocId: number) {
    if (!selectedId) return;
    try {
      await apiFetch(`/resellers/${selectedId}/ip-pools/${allocId}`, { method: 'DELETE' });
      load();
    } catch {
      setError(t('reseller.errorDelete'));
    }
  }

  return (
    <div>
      <h3>{t('reseller.resourceAllocation')}</h3>
      <label>{t('reseller.selectReseller')}: </label>
      <select value={selectedId ?? ''} onChange={e => setSelectedId(parseInt(e.target.value, 10) || null)} style={{ padding: '4px 8px', marginBottom: 12 }}>
        <option value="">— {t('reseller.select')} —</option>
        {resellers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {loading && <p>{t('reseller.loading')}</p>}

      {selectedId && !loading && (
        <>
          <h4>{t('reseller.bandwidthQuota')}</h4>
          {bwQuota ? (
            <p>
              {t('reseller.download')}: {bwQuota.download_mbps ?? '—'} Mbps |{' '}
              {t('reseller.upload')}: {bwQuota.upload_mbps ?? '—'} Mbps |{' '}
              {t('reseller.enforced')}: {bwQuota.is_enforced ? t('reseller.yes') : t('reseller.no')}
            </p>
          ) : <p style={{ color: '#999' }}>{t('reseller.noQuota')}</p>}

          <h4>{t('reseller.ipPools')}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.pool')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.network')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.version')}</th>
                <th style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{t('reseller.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {ipPools.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 8, textAlign: 'center', color: '#999' }}>{t('reseller.noIpPools')}</td></tr>
              )}
              {ipPools.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{p.pool_name ?? p.ip_pool_id}</td>
                  <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>{p.network}/{p.subnet_mask}</td>
                  <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>IPv{p.ip_version}</td>
                  <td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>
                    <ActionButton label={t('reseller.remove')} onClick={() => handleRemovePool(p.id)} variant="danger" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Billing Entities
// ---------------------------------------------------------------------------

function BillingEntitiesTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [entity, setEntity] = useState<BillingEntity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiList<Reseller>>('/resellers?limit=100')
      .then(res => setResellers(res.data))
      .catch(() => setError(t('reseller.errorLoading')));
  }, [t]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<{ data: BillingEntity | null }>(`/resellers/${selectedId}/billing-entity`);
      setEntity(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [selectedId, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h3>{t('reseller.billingEntities')}</h3>
      <label>{t('reseller.selectReseller')}: </label>
      <select value={selectedId ?? ''} onChange={e => setSelectedId(parseInt(e.target.value, 10) || null)} style={{ padding: '4px 8px', marginBottom: 12 }}>
        <option value="">— {t('reseller.select')} —</option>
        {resellers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {loading && <p>{t('reseller.loading')}</p>}
      {selectedId && !loading && (
        entity ? (
          <table style={{ width: '100%', maxWidth: 600, borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {([
                [t('reseller.legalName'), entity.legal_name],
                [t('reseller.taxId'), entity.tax_id ?? '—'],
                [t('reseller.email'), entity.email ?? '—'],
                [t('reseller.invoicePrefix'), entity.invoice_prefix ?? '—'],
                [t('reseller.currency'), entity.currency],
                [t('reseller.active'), entity.is_active ? t('reseller.yes') : t('reseller.no')],
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, width: 160 }}>{label}</td>
                  <td style={{ padding: '6px 8px' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={{ color: '#999' }}>{t('reseller.noBillingEntity')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Reseller Portal (dashboard + client list)
// ---------------------------------------------------------------------------

function PortalTab() {
  const { t } = useTranslation();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<ResellerDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ApiList<Reseller>>('/resellers?limit=100')
      .then(res => setResellers(res.data))
      .catch(() => setError(t('reseller.errorLoading')));
  }, [t]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiFetch<{ data: ResellerDashboard }>(`/reseller-portal/${selectedId}/dashboard`);
      setDashboard(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reseller.errorLoading'));
    } finally { setLoading(false); }
  }, [selectedId, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h3>{t('reseller.portal')}</h3>
      <label>{t('reseller.selectReseller')}: </label>
      <select value={selectedId ?? ''} onChange={e => setSelectedId(parseInt(e.target.value, 10) || null)} style={{ padding: '4px 8px', marginBottom: 12 }}>
        <option value="">— {t('reseller.select')} —</option>
        {resellers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      {loading && <p>{t('reseller.loading')}</p>}
      {selectedId && !loading && dashboard && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 8 }}>
          {[
            { label: t('reseller.subscribers'), value: dashboard.subscriber_count },
            { label: t('reseller.revenue'), value: `$${dashboard.total_revenue.toFixed(2)}` },
            { label: t('reseller.openTickets'), value: dashboard.open_tickets },
            { label: t('reseller.pendingCommission'), value: `$${dashboard.pending_commission.toFixed(2)}` },
          ].map((card) => (
            <div key={card.label} style={{
              background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 8,
              padding: 16, textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#2c3e50' }}>{card.value}</div>
              <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

const TABS: { key: Tab; labelKey: string }[] = [
  { key: 'resellers', labelKey: 'reseller.tabResellers' },
  { key: 'planPrices', labelKey: 'reseller.tabPlanPrices' },
  { key: 'commissions', labelKey: 'reseller.tabCommissions' },
  { key: 'resources', labelKey: 'reseller.tabResources' },
  { key: 'billing', labelKey: 'reseller.tabBilling' },
  { key: 'portal', labelKey: 'reseller.tabPortal' },
];

export default function ResellerPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('resellers');

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h2 style={{ marginBottom: 16, color: '#2c3e50' }}>{t('reseller.pageTitle')}</h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #dee2e6' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
              background: activeTab === tab.key ? '#3498db' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#555',
              borderRadius: '4px 4px 0 0',
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'resellers' && <ResellersTab />}
      {activeTab === 'planPrices' && <PlanPricesTab />}
      {activeTab === 'commissions' && <CommissionsTab />}
      {activeTab === 'resources' && <ResourcesTab />}
      {activeTab === 'billing' && <BillingEntitiesTab />}
      {activeTab === 'portal' && <PortalTab />}
    </div>
  );
}
