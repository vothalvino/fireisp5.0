// =============================================================================
// FireISP 5.0 — Client Detail
// =============================================================================
// Shows a single client with tabbed sub-sections:
//   Contracts | Invoices | Payments | Devices | Ledger
//
// P3.3 — Uses a single GraphQL query to fetch all nested data in one round-trip,
// eliminating the 5+ sequential REST calls that were previously needed.
// =============================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gql } from '@/api/graphql';

// ---------------------------------------------------------------------------
// GraphQL query — fetches the client + all sub-resources in one request
// ---------------------------------------------------------------------------

const CLIENT_DETAIL_QUERY = /* GraphQL */ `
  query ClientDetail($id: ID!) {
    client(id: $id) {
      id
      name
      email
      phone
      clientType
      status
      address
      city
      state
      zipCode
      country
      taxId
      notes
      createdAt
      contracts {
        id
        connectionType
        startDate
        endDate
        billingDay
        ipAddress
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
      payments {
        id
        amount
        currency
        paymentMethod
        reference
        status
        createdAt
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
      ledger {
        id
        entryType
        amount
        currency
        balanceAfter
        notes
        createdAt
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types (derived from GraphQL schema)
// ---------------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  clientType: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: string;
  contracts: Contract[];
  invoices: Invoice[];
  payments: Payment[];
  devices: Device[];
  ledger: LedgerEntry[];
}

interface Contract {
  id: string;
  connectionType: string | null;
  startDate: string | null;
  endDate: string | null;
  billingDay: number | null;
  ipAddress: string | null;
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

interface Payment {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
  createdAt: string;
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

interface LedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  currency: string;
  balanceAfter: string;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fetch helper (single GraphQL query)
// ---------------------------------------------------------------------------

async function fetchClientDetail(id: string): Promise<Client> {
  const data = await gql<{ client: Client | null }>(CLIENT_DETAIL_QUERY, { id });
  if (!data.client) throw new Error('Client not found');
  return data.client;
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
// Tab panels — receive pre-loaded data as props (no sub-queries needed)
// ---------------------------------------------------------------------------

function ContractsTab({ contracts }: { contracts: Contract[] }) {
  if (!contracts.length) return <p style={styles.msg}>No contracts found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['ID', 'Type', 'Start', 'End', 'Billing Day', 'IP Address', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {contracts.map(c => (
            <tr key={c.id} style={styles.tr}>
              <td style={styles.td}>#{c.id}</td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{c.connectionType || '—'}</td>
              <td style={styles.td}>{fmt(c.startDate)}</td>
              <td style={styles.td}>{fmt(c.endDate)}</td>
              <td style={styles.td}>{c.billingDay ?? '—'}</td>
              <td style={{ ...styles.td, fontFamily: 'monospace' }}>{c.ipAddress || '—'}</td>
              <td style={styles.td}><StatusBadge status={c.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
              <td style={{ ...styles.td, fontWeight: 600 }}>{inv.invoiceNumber}</td>
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

function PaymentsTab({ payments }: { payments: Payment[] }) {
  if (!payments.length) return <p style={styles.msg}>No payments found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['ID', 'Amount', 'Method', 'Reference', 'Date', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {payments.map(p => (
            <tr key={p.id} style={styles.tr}>
              <td style={styles.td}>#{p.id}</td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(p.amount, p.currency)}
              </td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{p.paymentMethod || '—'}</td>
              <td style={styles.td}>{p.reference || '—'}</td>
              <td style={styles.td}>{fmt(p.createdAt)}</td>
              <td style={styles.td}><StatusBadge status={p.status} /></td>
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

function LedgerTab({ ledger }: { ledger: LedgerEntry[] }) {
  if (!ledger.length) return <p style={styles.msg}>No ledger entries found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Date', 'Type', 'Amount', 'Balance After', 'Notes'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {ledger.map(e => {
            const isCredit = parseFloat(e.amount) >= 0;
            return (
              <tr key={e.id} style={styles.tr}>
                <td style={styles.td}>{fmt(e.createdAt)}</td>
                <td style={{ ...styles.td, textTransform: 'capitalize' }}>
                  {(e.entryType || '').replace(/_/g, ' ')}
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
                  {fmtMoney(e.balanceAfter, e.currency)}
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
  const location = [client.address, client.city, client.state, client.zipCode, client.country]
    .filter(Boolean)
    .join(', ');

  return (
    <div style={styles.infoCard}>
      <div style={styles.infoGrid}>
        <InfoRow label="Email"    value={client.email}       />
        <InfoRow label="Phone"    value={client.phone}       />
        <InfoRow label="Type"     value={client.clientType}  capitalize />
        <InfoRow label="Tax ID"   value={client.taxId}       mono />
        <InfoRow label="Location" value={location || null}   />
        <InfoRow label="Since"    value={fmt(client.createdAt)} />
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
    queryKey: ['client-detail-gql', id],
    queryFn: () => fetchClientDetail(id!),
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
        {activeTab === 'contracts' && <ContractsTab contracts={client.contracts} />}
        {activeTab === 'invoices'  && <InvoicesTab  invoices={client.invoices}   />}
        {activeTab === 'payments'  && <PaymentsTab  payments={client.payments}   />}
        {activeTab === 'devices'   && <DevicesTab   devices={client.devices}     />}
        {activeTab === 'ledger'    && <LedgerTab    ledger={client.ledger}       />}
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

