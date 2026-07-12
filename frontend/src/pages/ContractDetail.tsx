// =============================================================================
// FireISP 5.0 — Contract Detail
// =============================================================================
// Shows a single contract with tabbed sub-sections:
//   Invoices | Devices | Add-ons
//
// Mirrors ClientDetail's structure: single GraphQL query, loading/not-found
// states, breadcrumb, header with StatusBadge, info card, and tab bar.
// Action buttons (Renew / Suspend / Unsuspend / Terminate) call the existing
// REST endpoints via postContractAction (same helper as ContractList).
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gql } from '@/api/graphql';
import { api, authedFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { overlay, modalBox, cancelBtn, dangerBtn } from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// GraphQL query — fetches the contract + all sub-resources in one request
// ---------------------------------------------------------------------------

const CONTRACT_DETAIL_QUERY = /* GraphQL */ `
  query ContractDetail($id: ID!) {
    contract(id: $id) {
      id
      clientId
      planId
      connectionType
      startDate
      endDate
      billingDay
      status
      ipAddress
      priceOverride
      notes
      createdAt
      client {
        id
        name
        status
      }
      invoices {
        id
        invoiceNumber
        total
        currency
        dueDate
        paidAt
        status
      }
      devices {
        id
        name
        type
        manufacturer
        model
        macAddress
        ipAddress
        status
      }
      addons {
        id
        addonName
        addonType
        quantity
        unitPrice
        startDate
        endDate
        status
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContractClient {
  id: string;
  name: string;
  status: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string | null;
  paidAt: string | null;
  status: string;
}

interface Device {
  id: string;
  name: string;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  status: string;
}

interface ContractAddon {
  id: string;
  addonName: string | null;
  addonType: string | null;
  quantity: string | null;
  unitPrice: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

interface Contract {
  id: string;
  clientId: string;
  planId: string | null;
  connectionType: string | null;
  startDate: string | null;
  endDate: string | null;
  billingDay: number | null;
  status: string;
  ipAddress: string | null;
  priceOverride: string | null;
  notes: string | null;
  createdAt: string;
  client: ContractClient | null;
  invoices: Invoice[];
  devices: Device[];
  addons: ContractAddon[];
}

// ---------------------------------------------------------------------------
// Fetch helper (single GraphQL query)
// ---------------------------------------------------------------------------

async function fetchContractDetail(id: string): Promise<Contract> {
  const data = await gql<{ contract: Contract | null }>(CONTRACT_DETAIL_QUERY, { id });
  if (!data.contract) throw new Error('Contract not found');
  return data.contract;
}

// ---------------------------------------------------------------------------
// REST action helper (mirrors ContractList.postContractAction)
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

async function postContractAction(
  id: string,
  action: 'suspend' | 'unsuspend' | 'renew' | 'terminate',
): Promise<void> {
  const res = await authedFetch(`${API_BASE}/contracts/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to ${action} contract`);
}

// ---------------------------------------------------------------------------
// PPPoE credential helpers
// ---------------------------------------------------------------------------

interface RadiusAccount {
  id: number;
  username: string;
  password: string;
  status: string | null;
}

async function fetchRadiusAccounts(contractId: string): Promise<RadiusAccount[]> {
  const res = await api.GET('/radius/contract/{contractId}' as never, {
    params: { path: { contractId: Number(contractId) } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load PPPoE account');
  const d = (res as { data: unknown }).data as { data?: RadiusAccount[] } | RadiusAccount[];
  return Array.isArray(d) ? d : d.data ?? [];
}

async function regeneratePppoe(id: string): Promise<{ username: string; password: string; pushed: boolean }> {
  const res = await authedFetch(`${API_BASE}/contracts/${id}/regenerate-pppoe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let msg = 'Failed to regenerate PPPoE credentials';
    try { const j = await res.json(); msg = j?.error?.message ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return { username: j.data.username, password: j.data.password, pushed: Boolean(j.pushed) };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  // GraphQL serialises DATETIME columns via Date.valueOf() to an epoch-millis
  // STRING (e.g. "1779165933000"); REST returns ISO. Handle both, then guard an
  // unparseable value (which previously rendered the literal "Invalid Date").
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtMoney(amount: string | null, currency = 'MXN'): string {
  if (!amount) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(parseFloat(amount));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:     { bg: '#d1fae5', color: '#065f46' },
    paid:       { bg: '#d1fae5', color: '#065f46' },
    pending:    { bg: '#ede9fe', color: '#5b21b6' },
    suspended:  { bg: '#fef3c7', color: '#92400e' },
    overdue:    { bg: '#fee2e2', color: '#991b1b' },
    cancelled:  { bg: '#fee2e2', color: '#991b1b' },
    terminated: { bg: '#f3f4f6', color: '#6b7280' },
    expired:    { bg: '#fde68a', color: '#78350f' },
    failed:     { bg: '#fee2e2', color: '#991b1b' },
    draft:      { bg: '#f3f4f6', color: '#6b7280' },
    inactive:   { bg: '#f3f4f6', color: '#6b7280' },
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
// Tab types
// ---------------------------------------------------------------------------

type TabId = 'pppoe' | 'invoices' | 'devices' | 'addons';

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'devices',  label: 'Devices' },
  { id: 'addons',   label: 'Add-ons' },
];

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  if (!invoices.length) return <p style={styles.msg}>No invoices found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Invoice #', 'Total', 'Due Date', 'Paid At', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={styles.tr}>
              <td style={styles.td}>
                <Link to={`/invoices/${inv.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(inv.total, inv.currency)}
              </td>
              <td style={styles.td}>{fmt(inv.dueDate)}</td>
              <td style={styles.td}>{fmt(inv.paidAt)}</td>
              <td style={styles.td}><StatusBadge status={inv.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesTab({ devices }: { devices: Device[] }) {
  if (!devices.length) return <p style={styles.msg}>No devices found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Name', 'Type', 'Manufacturer / Model', 'MAC', 'IP', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {devices.map(d => (
            <tr key={d.id} style={styles.tr}>
              <td style={{ ...styles.td, fontWeight: 600 }}>{d.name}</td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{d.type || '—'}</td>
              <td style={styles.td}>
                {[d.manufacturer, d.model].filter(Boolean).join(' / ') || '—'}
              </td>
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.macAddress || '—'}</td>
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.ipAddress || '—'}</td>
              <td style={styles.td}><StatusBadge status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddonsTab({ addons }: { addons: ContractAddon[] }) {
  if (!addons.length) return <p style={styles.msg}>No add-ons found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Name', 'Type', 'Qty', 'Unit Price', 'Start', 'End', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {addons.map(a => (
            <tr key={a.id} style={styles.tr}>
              <td style={{ ...styles.td, fontWeight: 600 }}>{a.addonName || '—'}</td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{a.addonType || '—'}</td>
              <td style={styles.td}>{a.quantity ?? '—'}</td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {a.unitPrice ? fmtMoney(a.unitPrice) : '—'}
              </td>
              <td style={styles.td}>{fmt(a.startDate)}</td>
              <td style={styles.td}>{fmt(a.endDate)}</td>
              <td style={styles.td}><StatusBadge status={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PPPoE credentials tab
// ---------------------------------------------------------------------------

function CredField({
  label,
  value,
  secret,
  reveal,
  onToggle,
}: {
  label: string;
  value: string;
  secret?: boolean;
  reveal?: boolean;
  onToggle?: () => void;
}) {
  const shown = secret && !reveal ? '••••••••••' : value;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, fontFamily: 'monospace' }}>{shown}</span>
      {secret && (
        <button type="button" style={styles.linkBtn} onClick={onToggle}>
          {reveal ? 'Hide' : 'Show'}
        </button>
      )}
      <button
        type="button"
        style={styles.linkBtn}
        onClick={() => { void navigator.clipboard?.writeText(value); }}
      >
        Copy
      </button>
    </div>
  );
}

function PppoeTab({ contractId, canEdit }: { contractId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<{ password: string; pushed: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ['contract-radius', contractId],
    queryFn: () => fetchRadiusAccounts(contractId),
  });

  if (isLoading) return <p style={styles.msg}>Loading PPPoE account…</p>;
  if (error) return <p style={styles.msg}>Unable to load PPPoE credentials (no account, or insufficient permission).</p>;

  const account = accounts?.[0];
  if (!account) {
    return <p style={styles.msg}>No PPPoE account for this contract. Use “Renew” to provision one.</p>;
  }

  const password = regenerated?.password ?? account.password;

  async function handleRegenerate() {
    setConfirmOpen(false);
    setRegenError(null);
    setRegenerating(true);
    try {
      const r = await regeneratePppoe(contractId);
      setRegenerated({ password: r.password, pushed: r.pushed });
      setReveal(true);
      qc.invalidateQueries({ queryKey: ['contract-radius', contractId] });
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : 'Failed to regenerate credentials');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div style={{ padding: '1.25rem' }}>
      <div style={styles.infoGrid}>
        <CredField label="Username" value={account.username} />
        <CredField label="Password" value={password} secret reveal={reveal} onToggle={() => setReveal(v => !v)} />
      </div>

      {canEdit && (
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={styles.actionBtn} onClick={() => setConfirmOpen(true)} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Regenerate password'}
          </button>
          {regenerated && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              New password generated{regenerated.pushed ? ' and pushed to the NAS' : ' — reconfigure the CPE'}.
            </span>
          )}
        </div>
      )}

      {regenError && <div style={{ ...styles.errorBanner, marginTop: '1rem' }}>{regenError}</div>}

      <p style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', marginTop: '1rem' }}>
        Rotating the password requires reconfiguring the subscriber’s CPE with the new credentials.
      </p>

      {confirmOpen && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label="Confirm password regeneration">
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Regenerate PPPoE password?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              This generates a new password for <strong>{account.username}</strong> and invalidates the
              current one. The subscriber will be offline until their CPE is reconfigured with the new
              credentials. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button type="button" style={cancelBtn} onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button type="button" style={dangerBtn} onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? 'Regenerating…' : 'Regenerate password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract Info Card
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span
        style={{
          ...styles.infoValue,
          ...(capitalize ? { textTransform: 'capitalize' as const } : {}),
          ...(mono ? { fontFamily: 'monospace' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ContractInfoCard({ contract }: { contract: Contract }) {
  return (
    <div style={styles.infoCard}>
      <div style={styles.infoGrid}>
        {contract.client && (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Client</span>
            <Link to={`/clients/${contract.client.id}`} style={styles.infoLink}>
              {contract.client.name}
            </Link>
          </div>
        )}
        <InfoRow label="Plan"        value={contract.planId ? `Plan #${contract.planId}` : null} />
        <InfoRow label="Type"        value={contract.connectionType} capitalize />
        <InfoRow label="Start Date"  value={fmt(contract.startDate)} />
        <InfoRow label="End Date"    value={fmt(contract.endDate)} />
        <InfoRow label="Billing Day" value={contract.billingDay != null ? String(contract.billingDay) : null} />
        <InfoRow label="IP Address"  value={contract.ipAddress} mono />
        <InfoRow label="Created"     value={fmt(contract.createdAt)} />
        {contract.priceOverride && (
          <InfoRow label="Price Override" value={fmtMoney(contract.priceOverride)} />
        )}
      </div>
      {contract.notes && (
        <div style={styles.notesRow}>
          <span style={styles.noteLabel}>Notes: </span>
          {contract.notes}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('invoices');
  const [actionError, setActionError] = useState<string | null>(null);

  const canEdit = can(user, 'contracts.update');

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ['contract-detail-gql', id],
    queryFn: () => fetchContractDetail(id!),
    enabled: Boolean(id),
  });

  const refetchContract = () =>
    queryClient.invalidateQueries({ queryKey: ['contract-detail-gql', id] });

  const isPppoe =
    contract?.connectionType === 'pppoe' || contract?.connectionType === 'pppoe_dual';
  const TABS = isPppoe ? [{ id: 'pppoe' as TabId, label: 'PPPoE' }, ...BASE_TABS] : BASE_TABS;

  async function handleAction(action: 'suspend' | 'unsuspend' | 'renew' | 'terminate') {
    if (!id) return;
    setActionError(null);
    try {
      await postContractAction(id, action);
      await refetchContract();
      // A renew may (re)provision the PPPoE account — surface the credentials.
      if (action === 'renew' && isPppoe) {
        queryClient.invalidateQueries({ queryKey: ['contract-radius', id] });
        setActiveTab('pppoe');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} contract`);
    }
  }

  if (isLoading) {
    return (
      <div style={styles.page}>
        <p style={styles.msg}>Loading contract…</p>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>Contract not found.</p>
        <Link to="/contracts" style={styles.backLink}>Back to Contracts</Link>
      </div>
    );
  }

  const status = contract.status;
  const canSuspend   = status === 'active' || status === 'pending';
  const canUnsuspend = status === 'suspended';
  const canTerminate = status === 'active' || status === 'suspended';
  const canRenew     = status === 'suspended' || status === 'cancelled' || status === 'expired' || status === 'terminated';

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/contracts" style={styles.breadcrumbLink}>Contracts</Link>
        <span style={styles.breadcrumbSep}>›</span>
        {contract.client && (
          <>
            <Link to={`/clients/${contract.client.id}`} style={styles.breadcrumbLink}>
              {contract.client.name}
            </Link>
            <span style={styles.breadcrumbSep}>›</span>
          </>
        )}
        <span style={styles.breadcrumbCurrent}>Contract #{contract.id}</span>
      </div>

      {/* Contract header */}
      <div style={styles.contractHeader}>
        <div>
          <h1 style={styles.contractTitle}>Contract #{contract.id}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={contract.status} />
            {contract.connectionType && (
              <span style={styles.metaChip}>{contract.connectionType}</span>
            )}
            {contract.planId && (
              <span style={styles.metaChip}>Plan #{contract.planId}</span>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={styles.headerActions}>
            {canRenew && (
              <button
                type="button"
                style={styles.actionBtn}
                onClick={() => handleAction('renew')}
              >
                Renew
              </button>
            )}
            {canSuspend && (
              <button
                type="button"
                style={{ ...styles.actionBtn, color: '#92400e' }}
                onClick={() => handleAction('suspend')}
              >
                Suspend
              </button>
            )}
            {canUnsuspend && (
              <button
                type="button"
                style={styles.actionBtn}
                onClick={() => handleAction('unsuspend')}
              >
                Unsuspend
              </button>
            )}
            {canTerminate && (
              <button
                type="button"
                style={{ ...styles.actionBtn, color: '#991b1b' }}
                onClick={() => handleAction('terminate')}
              >
                Terminate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Action error */}
      {actionError && (
        <div style={styles.errorBanner}>{actionError}</div>
      )}

      {/* Info card */}
      <ContractInfoCard contract={contract} />

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'pppoe'    && isPppoe && id && <PppoeTab contractId={id} canEdit={canEdit} />}
        {activeTab === 'invoices' && <InvoicesTab invoices={contract.invoices} />}
        {activeTab === 'devices'  && <DevicesTab  devices={contract.devices}   />}
        {activeTab === 'addons'   && <AddonsTab   addons={contract.addons}     />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1100,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '1.25rem',
    fontSize: '0.85rem',
  },
  breadcrumbLink:    { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:     { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink:          { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  contractHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  contractTitle: {
    margin: '0 0 0.35rem',
    color: 'var(--text-primary)',
    fontSize: '1.6rem',
    fontWeight: 700,
  },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const },
  metaChip: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '1px 8px',
    textTransform: 'capitalize' as const,
  },
  headerActions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const },
  actionBtn: {
    padding: '0.45rem 0.85rem',
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },

  errorBanner: {
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 6,
    padding: '0.6rem 1rem',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    border: '1px solid #fecaca',
  },

  infoCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  infoGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '0.5rem 1.5rem',
  },
  infoRow:   { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 80 },
  infoValue: { color: 'var(--text-secondary)' },
  infoLink:  { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },
  linkBtn:   { background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0 0.25rem' },
  notesRow:  { marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' },
  noteLabel: { fontWeight: 600, color: 'var(--text-secondary)' },

  tabBar: {
    display: 'flex',
    gap: '0.25rem',
    borderBottom: '2px solid var(--border)',
    marginBottom: '0',
  },
  tabBtn: {
    padding: '0.6rem 1rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    fontFamily: 'var(--font-sans)',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    transition: 'color .15s',
  },
  tabBtnActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
    fontWeight: 600,
  },
  tabContent: {
    background: 'var(--bg-card)',
    borderRadius: '0 0 8px 8px',
    boxShadow: '0 0 0 1px var(--border)',
    minHeight: 200,
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
  tr:       { borderBottom: '1px solid var(--border-subtle)' },
  td:       { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
};
