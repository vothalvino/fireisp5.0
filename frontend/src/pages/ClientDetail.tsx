// =============================================================================
// FireISP 5.0 — Client Detail
// =============================================================================
// Shows a single client with tabbed sub-sections:
//   Contracts | Invoices | Payments | Devices | Ledger
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  client_type: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  tax_id: string | null;
  notes: string | null;
  created_at: string;
}

interface Contract {
  id: number;
  plan_id: number;
  connection_type: string;
  start_date: string;
  end_date: string | null;
  billing_day: number;
  status: string;
  ip_address: string | null;
  price_override: string | null;
  notes: string | null;
}

interface Invoice {
  id: number;
  invoice_number: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  currency: string;
  due_date: string;
  paid_at: string | null;
  status: string;
  created_at: string;
}

interface Payment {
  id: number;
  amount: string;
  currency: string;
  payment_method: string;
  reference: string | null;
  status: string;
  created_at: string;
}

interface Device {
  id: number;
  name: string;
  type: string;
  manufacturer: string | null;
  model: string | null;
  mac_address: string | null;
  ip_address: string | null;
  status: string;
  contract_id: number | null;
}

interface LedgerEntry {
  id: number;
  entry_type: string;
  amount: string;
  currency: string;
  reference_type: string | null;
  reference_id: number | null;
  balance_after: string;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchClient(id: string): Promise<Client> {
  const res = await api.GET('/clients/{id}', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Client not found');
  return (res.data as unknown as { data: Client }).data;
}

async function fetchClientContracts(id: string): Promise<Contract[]> {
  const res = await api.GET('/clients/{id}/contracts', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Failed to load contracts');
  return (res.data as unknown as { data: Contract[] }).data;
}

async function fetchClientInvoices(id: string): Promise<Invoice[]> {
  const res = await api.GET('/clients/{id}/invoices', { params: { path: { id: Number(id) } } });
  if (res.error) throw new Error('Failed to load invoices');
  return (res.data as unknown as { data: Invoice[] }).data;
}

async function fetchClientPayments(id: string): Promise<Payment[]> {
  const res = await api.GET('/payments', {
    params: { query: { client_id: id, limit: 100 } as never },
  });
  if (res.error) throw new Error('Failed to load payments');
  return (res.data as unknown as { data: Payment[] }).data;
}

async function fetchClientDevices(contractIds: number[]): Promise<Device[]> {
  if (contractIds.length === 0) return [];
  // Fetch devices for each contract in parallel, then flatten.
  const results = await Promise.all(
    contractIds.map(cid =>
      api
        .GET('/devices', { params: { query: { contract_id: cid, limit: 100 } as never } })
        .then(res => {
          if (res.error) return [] as Device[];
          return (res.data as unknown as { data: Device[] }).data;
        }),
    ),
  );
  return results.flat();
}

async function fetchClientLedger(id: string): Promise<LedgerEntry[]> {
  const res = await api.GET('/clients/{id}/balance-ledger', {
    params: { path: { id: Number(id) } },
  });
  if (res.error) throw new Error('Failed to load ledger');
  return (res.data as unknown as { data: LedgerEntry[] }).data;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
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

function StatusBadge({ status, colorMap }: { status: string; colorMap?: Record<string, { bg: string; color: string }> }) {
  const defaultMap: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#d1fae5', color: '#065f46' },
    paid:      { bg: '#d1fae5', color: '#065f46' },
    completed: { bg: '#d1fae5', color: '#065f46' },
    suspended: { bg: '#fef3c7', color: '#92400e' },
    overdue:   { bg: '#fee2e2', color: '#991b1b' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
    failed:    { bg: '#fee2e2', color: '#991b1b' },
    pending:   { bg: '#ede9fe', color: '#5b21b6' },
    inactive:  { bg: '#f3f4f6', color: '#6b7280' },
    draft:     { bg: '#f3f4f6', color: '#6b7280' },
  };
  const map = colorMap ?? defaultMap;
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

type TabId = 'contracts' | 'invoices' | 'payments' | 'devices' | 'ledger';

const TABS: { id: TabId; label: string }[] = [
  { id: 'contracts', label: '📄 Contracts' },
  { id: 'invoices',  label: '🧾 Invoices' },
  { id: 'payments',  label: '💳 Payments' },
  { id: 'devices',   label: '🖧 Devices' },
  { id: 'ledger',    label: '📒 Ledger' },
];

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function ContractsTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-contracts', clientId],
    queryFn: () => fetchClientContracts(clientId),
  });
  if (isLoading) return <p style={styles.msg}>Loading…</p>;
  if (error)     return <p style={styles.msgError}>Failed to load contracts.</p>;
  if (!data?.length) return <p style={styles.msg}>No contracts found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['ID', 'Type', 'Start', 'End', 'Billing Day', 'IP Address', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.map(c => (
            <tr key={c.id} style={styles.tr}>
              <td style={styles.td}>#{c.id}</td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{c.connection_type || '—'}</td>
              <td style={styles.td}>{fmt(c.start_date)}</td>
              <td style={styles.td}>{fmt(c.end_date)}</td>
              <td style={styles.td}>{c.billing_day ?? '—'}</td>
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{c.ip_address || '—'}</td>
              <td style={styles.td}><StatusBadge status={c.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-invoices', clientId],
    queryFn: () => fetchClientInvoices(clientId),
  });
  if (isLoading) return <p style={styles.msg}>Loading…</p>;
  if (error)     return <p style={styles.msgError}>Failed to load invoices.</p>;
  if (!data?.length) return <p style={styles.msg}>No invoices found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Invoice #', 'Total', 'Due Date', 'Paid At', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.map(inv => (
            <tr key={inv.id} style={styles.tr}>
              <td style={{ ...styles.td, fontWeight: 600 }}>{inv.invoice_number}</td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(inv.total, inv.currency)}
              </td>
              <td style={styles.td}>{fmt(inv.due_date)}</td>
              <td style={styles.td}>{fmt(inv.paid_at)}</td>
              <td style={styles.td}><StatusBadge status={inv.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-payments', clientId],
    queryFn: () => fetchClientPayments(clientId),
  });
  if (isLoading) return <p style={styles.msg}>Loading…</p>;
  if (error)     return <p style={styles.msgError}>Failed to load payments.</p>;
  if (!data?.length) return <p style={styles.msg}>No payments found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['ID', 'Amount', 'Method', 'Reference', 'Date', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.map(p => (
            <tr key={p.id} style={styles.tr}>
              <td style={styles.td}>#{p.id}</td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(p.amount, p.currency)}
              </td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{p.payment_method || '—'}</td>
              <td style={styles.td}>{p.reference || '—'}</td>
              <td style={styles.td}>{fmt(p.created_at)}</td>
              <td style={styles.td}><StatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesTab({ clientId }: { clientId: string }) {
  // First get contracts, then fetch devices per contract.
  const contractsQ = useQuery({
    queryKey: ['client-contracts', clientId],
    queryFn: () => fetchClientContracts(clientId),
  });

  const contractIds = (contractsQ.data ?? []).map(c => c.id);

  const devicesQ = useQuery({
    queryKey: ['client-devices', clientId, contractIds],
    queryFn: () => fetchClientDevices(contractIds),
    enabled: contractsQ.isSuccess,
  });

  if (contractsQ.isLoading || devicesQ.isLoading) return <p style={styles.msg}>Loading…</p>;
  if (devicesQ.error) return <p style={styles.msgError}>Failed to load devices.</p>;
  const devices = devicesQ.data ?? [];
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
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.mac_address || '—'}</td>
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.ip_address || '—'}</td>
              <td style={styles.td}><StatusBadge status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-ledger', clientId],
    queryFn: () => fetchClientLedger(clientId),
  });
  if (isLoading) return <p style={styles.msg}>Loading…</p>;
  if (error)     return <p style={styles.msgError}>Failed to load ledger.</p>;
  if (!data?.length) return <p style={styles.msg}>No ledger entries found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Date', 'Type', 'Amount', 'Balance After', 'Notes'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.map(e => {
            const isCredit = parseFloat(e.amount) >= 0;
            return (
              <tr key={e.id} style={styles.tr}>
                <td style={styles.td}>{fmt(e.created_at)}</td>
                <td style={{ ...styles.td, textTransform: 'capitalize' }}>
                  {(e.entry_type || '').replace(/_/g, ' ')}
                </td>
                <td
                  style={{
                    ...styles.td,
                    fontVariantNumeric: 'tabular-nums',
                    color: isCredit ? '#065f46' : '#991b1b',
                    fontWeight: 600,
                  }}
                >
                  {isCredit ? '+' : ''}{fmtMoney(e.amount, e.currency)}
                </td>
                <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(e.balance_after, e.currency)}
                </td>
                <td style={{ ...styles.td, color: '#6b7280' }}>{e.notes || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Info Card
// ---------------------------------------------------------------------------

function ClientInfoCard({ client }: { client: Client }) {
  const location = [client.address, client.city, client.state, client.zip_code, client.country]
    .filter(Boolean)
    .join(', ');

  return (
    <div style={styles.infoCard}>
      <div style={styles.infoGrid}>
        <InfoRow label="Email"  value={client.email}    />
        <InfoRow label="Phone"  value={client.phone}    />
        <InfoRow label="Type"   value={client.client_type} capitalize />
        <InfoRow label="Tax ID" value={client.tax_id}   mono />
        <InfoRow label="Location" value={location || null} />
        <InfoRow label="Since"  value={fmt(client.created_at)} />
      </div>
      {client.notes && (
        <div style={styles.notesRow}>
          <span style={styles.noteLabel}>Notes: </span>
          {client.notes}
        </div>
      )}
    </div>
  );
}

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('contracts');

  const { data: client, isLoading, error } = useQuery({
    queryKey: ['client', id],
    queryFn: () => fetchClient(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div style={styles.page}>
        <p style={styles.msg}>Loading client…</p>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>Client not found.</p>
        <Link to="/clients" style={styles.backLink}>← Back to Clients</Link>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/clients" style={styles.breadcrumbLink}>👥 Clients</Link>
        <span style={styles.breadcrumbSep}>›</span>
        <span style={styles.breadcrumbCurrent}>{client.name}</span>
      </div>

      {/* Client header */}
      <div style={styles.clientHeader}>
        <div>
          <h1 style={styles.clientName}>{client.name}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={client.status} />
            <span style={styles.clientId}>ID #{client.id}</span>
          </div>
        </div>
      </div>

      {/* Info card */}
      <ClientInfoCard client={client} />

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
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
        {activeTab === 'contracts' && <ContractsTab clientId={id!} />}
        {activeTab === 'invoices'  && <InvoicesTab  clientId={id!} />}
        {activeTab === 'payments'  && <PaymentsTab  clientId={id!} />}
        {activeTab === 'devices'   && <DevicesTab   clientId={id!} />}
        {activeTab === 'ledger'    && <LedgerTab    clientId={id!} />}
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
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 1100,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '1.25rem',
    fontSize: '0.85rem',
  },
  breadcrumbLink: { color: '#e25822', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:     { color: '#9ca3af' },
  breadcrumbCurrent: { color: '#374151' },
  backLink: { color: '#e25822', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  clientHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  clientName: { margin: '0 0 0.35rem', color: '#111827', fontSize: '1.6rem', fontWeight: 700 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  clientId: { color: '#9ca3af', fontSize: '0.8rem' },

  infoCard: {
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  infoGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '0.5rem 1.5rem',
  },
  infoRow: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: '#9ca3af', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 60 },
  infoValue: { color: '#374151' },
  notesRow: { marginTop: '0.75rem', fontSize: '0.82rem', color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' },
  noteLabel: { fontWeight: 600, color: '#374151' },

  tabBar: {
    display: 'flex',
    gap: '0.25rem',
    borderBottom: '2px solid #e5e7eb',
    marginBottom: '0',
  },
  tabBtn: {
    padding: '0.6rem 1rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#6b7280',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    transition: 'color .15s',
  },
  tabBtnActive: {
    color: '#e25822',
    borderBottom: '2px solid #e25822',
    fontWeight: 600,
  },
  tabContent: {
    background: '#fff',
    borderRadius: '0 0 8px 8px',
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
    minHeight: 200,
  },

  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.6rem 0.75rem',
    textAlign: 'left' as const,
    color: '#6b7280',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid #f3f4f6',
    whiteSpace: 'nowrap' as const,
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.65rem 0.75rem', color: '#374151', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: '#6b7280', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
} as const;
