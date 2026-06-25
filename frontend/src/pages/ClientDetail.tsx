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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { gql } from '@/api/graphql';
import { api, authedFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  ClientFormModal,
  extractApiError,
  overlay,
  modalBox,
  errorBox,
  labelStyle,
  inputStyle,
  twoCol,
  submitBtn,
  cancelBtn,
  type ClientFormInitial,
} from '@/components/ClientFormModal';
import { ProfileExtrasTab, CustomFieldsTab, DocumentsTab, DuplicatesTab } from '@/pages/ClientProfileTabs';
import { ActivityTimelineTab } from '@/pages/ClientActivityTab';
import { ClientCommunicationPrefs } from '@/pages/ClientCommunicationPrefs';

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
      locale
      notes
      createdAt
      balance
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
      contacts {
        id
        name
        email
        phone
        role
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
  locale: string | null;
  notes: string | null;
  createdAt: string;
  balance: string;
  contracts: Contract[];
  invoices: Invoice[];
  payments: Payment[];
  devices: Device[];
  ledger: LedgerEntry[];
  contacts: Contact[];
}

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
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

type TabId = 'activity' | 'contracts' | 'invoices' | 'payments' | 'devices' | 'tickets' | 'ledger' | 'contacts' | 'profile' | 'customFields' | 'documents' | 'duplicates' | 'communication';

const TABS: { id: TabId; label: string }[] = [
  { id: 'activity',  label: '📅 Activity' },
  { id: 'contracts', label: '📄 Contracts' },
  { id: 'invoices',  label: '🧾 Invoices' },
  { id: 'payments',  label: '💳 Payments' },
  { id: 'devices',   label: '🖧 Devices' },
  { id: 'tickets',   label: '🎫 Tickets' },
  { id: 'ledger',    label: '📒 Ledger' },
  { id: 'contacts',  label: '👤 Contacts' },
  { id: 'profile',   label: '🧭 Profile' },
  { id: 'customFields', label: '🏷️ Custom Fields' },
  { id: 'documents', label: '📎 Documents' },
  { id: 'duplicates', label: '🔍 Duplicates' },
  { id: 'communication', label: '📵 DND / Comms' },
];

// ---------------------------------------------------------------------------
// Tab panels — receive pre-loaded data as props (no sub-queries needed)
// ---------------------------------------------------------------------------

interface ClientTicket {
  id: number;
  subject: string;
  priority: string | null;
  status: string;
  created_at: string;
}

function TicketsTab({ clientId }: { clientId: number }) {
  const { data: tickets = [], isLoading, error } = useQuery({
    queryKey: ['client-tickets', clientId],
    queryFn: async () => {
      const res = await api.GET('/tickets', { params: { query: { client_id: clientId, limit: 100 } as never } });
      if (res.error) throw new Error('Failed to load tickets');
      return (res.data as unknown as { data: ClientTicket[] }).data ?? [];
    },
  });

  if (isLoading) return <p style={styles.msg}>Loading tickets…</p>;
  if (error) return <p style={styles.msg}>Failed to load tickets.</p>;
  if (!tickets.length) return <p style={styles.msg}>No tickets found.</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['#', 'Subject', 'Priority', 'Status', 'Created'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {tickets.map(tk => (
            <tr key={tk.id} style={styles.tr}>
              <td style={styles.td}>
                <Link to={`/tickets/${tk.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>#{tk.id}</Link>
              </td>
              <td style={styles.td}>
                <Link to={`/tickets/${tk.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{tk.subject}</Link>
              </td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{tk.priority || '—'}</td>
              <td style={styles.td}><StatusBadge status={tk.status} /></td>
              <td style={styles.td}>{fmt(tk.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
              <td style={styles.td}>
                <Link
                  to={`/contracts/${c.id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                >
                  #{c.id}
                </Link>
              </td>
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
              <td style={styles.td}>
                <Link to={`/payments/${p.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                  #{p.id}
                </Link>
              </td>
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
// Contacts tab
// ---------------------------------------------------------------------------

function ContactsTab({
  contacts,
  canEdit,
  onAdd,
  onDelete,
}: {
  contacts: Contact[];
  canEdit: boolean;
  onAdd: () => void;
  onDelete: (contactId: string) => void;
}) {
  return (
    <div>
      {canEdit && (
        <div style={{ padding: '0.75rem 0.75rem 0', textAlign: 'right' }}>
          <button type="button" onClick={onAdd} style={styles.smallPrimaryBtn}>+ Add Contact</button>
        </div>
      )}
      {!contacts.length ? (
        <p style={styles.msg}>No contacts found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name', 'Role', 'Email', 'Phone'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
                {canEdit && <th style={styles.th} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ ...styles.td, textTransform: 'capitalize' }}>{c.role || '—'}</td>
                  <td style={styles.td}>{c.email || '—'}</td>
                  <td style={styles.td}>{c.phone || '—'}</td>
                  {canEdit && (
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => onDelete(c.id)}
                        style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: '0.82rem' }}
                        title="Delete contact"
                      >
                        🗑 Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Info Card
// ---------------------------------------------------------------------------

function ClientInfoCard({ client, accountGroup }: { client: Client; accountGroup: string }) {
  const { t } = useTranslation();
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
        <InfoRow label={t('clientList.accountGroup')} value={accountGroup} />
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
// Add Contact modal
// ---------------------------------------------------------------------------

function AddContactModal({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    const body: Record<string, string> = { name: form.name.trim() };
    if (form.role.trim()) body.role = form.role.trim();
    if (form.email.trim()) body.email = form.email.trim();
    if (form.phone.trim()) body.phone = form.phone.trim();
    const { error: apiError } = await api.POST('/clients/{id}/contacts', {
      params: { path: { id: Number(clientId) } },
      body: body as never,
    });
    setSaving(false);
    if (apiError) { setError(extractApiError(apiError, 'Failed to add contact.')); return; }
    onSaved();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Add contact">
      <form style={modalBox} onSubmit={handleSubmit}>
        <h2 style={modalTitle}>Add Contact</h2>
        {error && <div style={errorBox}>{error}</div>}
        <label style={labelStyle}>Name *</label>
        <input style={inputStyle} value={form.name} onChange={set('name')} autoFocus />
        <label style={labelStyle}>Role</label>
        <input style={inputStyle} value={form.role} onChange={set('role')} />
        <div style={twoCol}>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input style={inputStyle} value={form.phone} onChange={set('phone')} />
          </div>
        </div>
        <div style={modalActions}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" style={submitBtn} disabled={saving}>{saving ? 'Saving…' : 'Add Contact'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MX Profile modal
// ---------------------------------------------------------------------------

interface MxProfile {
  rfc?: string | null;
  curp?: string | null;
  razon_social?: string | null;
  regimen_fiscal?: string | null;
  codigo_postal_fiscal?: string | null;
}

function MxProfileModal({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    rfc: '', curp: '', razon_social: '', regimen_fiscal: '', codigo_postal_fiscal: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { isLoading } = useQuery({
    queryKey: ['client-mx-profile', clientId],
    queryFn: async () => {
      const { data, error: apiError } = await api.GET('/clients/{id}/mx-profile', {
        params: { path: { id: Number(clientId) } },
      });
      if (apiError) throw new Error(extractApiError(apiError, 'Failed to load MX profile.'));
      const profile = (data as { data?: MxProfile } | undefined)?.data;
      if (profile) {
        setForm({
          rfc: profile.rfc ?? '',
          curp: profile.curp ?? '',
          razon_social: profile.razon_social ?? '',
          regimen_fiscal: profile.regimen_fiscal ?? '',
          codigo_postal_fiscal: profile.codigo_postal_fiscal ?? '',
        });
      }
      return profile ?? null;
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.rfc.trim() || !form.razon_social.trim() ||
        !form.regimen_fiscal.trim() || !form.codigo_postal_fiscal.trim()) {
      setError('RFC, Razón social, Régimen fiscal and Código postal fiscal are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const body: Record<string, string> = {
      rfc: form.rfc.trim(),
      razon_social: form.razon_social.trim(),
      regimen_fiscal: form.regimen_fiscal.trim(),
      codigo_postal_fiscal: form.codigo_postal_fiscal.trim(),
    };
    if (form.curp.trim()) body.curp = form.curp.trim();
    const { error: apiError } = await api.PUT('/clients/{id}/mx-profile', {
      params: { path: { id: Number(clientId) } },
      body: body as never,
    });
    setSaving(false);
    if (apiError) { setError(extractApiError(apiError, 'Failed to save MX profile.')); return; }
    onSaved();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="MX fiscal profile">
      <form style={modalBox} onSubmit={handleSubmit}>
        <h2 style={modalTitle}>MX Fiscal Profile</h2>
        {error && <div style={errorBox}>{error}</div>}
        {isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : (
          <>
            <label style={labelStyle}>RFC *</label>
            <input style={inputStyle} value={form.rfc} onChange={set('rfc')} maxLength={13} />
            <label style={labelStyle}>Razón social *</label>
            <input style={inputStyle} value={form.razon_social} onChange={set('razon_social')} />
            <div style={twoCol}>
              <div>
                <label style={labelStyle}>Régimen fiscal *</label>
                <input style={inputStyle} value={form.regimen_fiscal} onChange={set('regimen_fiscal')} maxLength={3} />
              </div>
              <div>
                <label style={labelStyle}>Código postal fiscal *</label>
                <input style={inputStyle} value={form.codigo_postal_fiscal} onChange={set('codigo_postal_fiscal')} maxLength={5} />
              </div>
            </div>
            <label style={labelStyle}>CURP</label>
            <input style={inputStyle} value={form.curp} onChange={set('curp')} maxLength={18} />
          </>
        )}
        <div style={modalActions}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" style={submitBtn} disabled={saving || isLoading}>{saving ? 'Saving…' : 'Save Profile'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal password modal
// ---------------------------------------------------------------------------

function PortalPasswordModal({
  clientId,
  username,
  onClose,
  onSaved,
}: {
  clientId: string;
  username: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true);
    setError(null);
    const { error: apiError } = await api.PUT('/clients/{id}/portal-password', {
      params: { path: { id: Number(clientId) } },
      body: { password } as never,
    });
    setSaving(false);
    if (apiError) { setError(extractApiError(apiError, 'Failed to set portal password.')); return; }
    onSaved();
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Set portal password">
      <form style={modalBox} onSubmit={handleSubmit}>
        <h2 style={modalTitle}>Set Portal Password</h2>
        {error && <div style={errorBox}>{error}</div>}
        <label style={labelStyle}>Portal username</label>
        {username ? (
          <>
            <input style={{ ...inputStyle, background: 'var(--bg-subtle)' }} type="text" value={username} readOnly />
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
              The client signs in to the portal with this email and the password below.
            </p>
          </>
        ) : (
          <div style={errorBox}>
            This client has no email. The portal login uses the email as the username, so add an email
            to the client before the portal password can be used.
          </div>
        )}
        <label style={labelStyle}>New password *</label>
        <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
        <label style={labelStyle}>Confirm password *</label>
        <input style={inputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        <div style={modalActions}>
          <button type="button" style={cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" style={submitBtn} disabled={saving}>{saving ? 'Saving…' : 'Set Password'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('contracts');
  const [showEdit, setShowEdit] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showMxProfile, setShowMxProfile] = useState(false);
  const [showPortalPassword, setShowPortalPassword] = useState(false);

  const canEdit = can(user?.role, 'clients.update');

  const { data: client, isLoading, error } = useQuery({
    queryKey: ['client-detail-gql', id],
    queryFn: () => fetchClientDetail(id!),
    enabled: Boolean(id),
  });

  // Raw REST record supplies the §1.1 profile fields the GraphQL query does not
  // expose (curp, credit_score, risk_rating, latitude, longitude) so the edit
  // modal pre-fills them and does not clobber existing values on save.
  const { data: clientRaw } = useQuery({
    queryKey: ['client-raw', Number(id)],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}', { params: { path: { id: Number(id) } } });
      if (res.error) return null;
      return (res.data as { data: Record<string, unknown> }).data;
    },
    enabled: Boolean(id),
  });

  // Account-group options — shared cache with ClientList / ClientProfileTabs so
  // we can resolve the client's client_group_id to a human-readable name.
  const { data: clientGroups } = useQuery({
    queryKey: ['client-groups-options'],
    queryFn: async () => {
      const res = await api.GET('/client-groups', { params: { query: { limit: 200 } as never } });
      if (res.error) throw new Error('Failed to load groups');
      return (res.data as unknown as { data: { id: number; name: string }[] }).data;
    },
  });

  const refetchClient = () => queryClient.invalidateQueries({ queryKey: ['client-detail-gql', id] });

  async function handleDeleteContact(contactId: string) {
    if (!window.confirm('Delete this contact?')) return;
    const res = await authedFetch(`/api/v1/clients/${id}/contacts/${contactId}`, { method: 'DELETE' });
    if (res.ok) refetchClient();
  }

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

  const editInitial: ClientFormInitial = {
    id: Number(client.id),
    name: client.name,
    email: client.email,
    phone: client.phone,
    client_type: client.clientType,
    status: client.status,
    tax_id: client.taxId,
    address: client.address,
    city: client.city,
    state: client.state,
    zip_code: client.zipCode,
    country: client.country,
    locale: client.locale,
    curp: (clientRaw?.curp as string | null) ?? null,
    credit_score: (clientRaw?.credit_score as number | null) ?? null,
    risk_rating: (clientRaw?.risk_rating as string | null) ?? null,
    latitude: (clientRaw?.latitude as number | string | null) ?? null,
    longitude: (clientRaw?.longitude as number | string | null) ?? null,
  };

  const clientGroupId = (clientRaw?.client_group_id as number | null) ?? null;
  const accountGroupName =
    clientGroupId == null
      ? '—'
      : (clientGroups ?? []).find(g => g.id === clientGroupId)?.name ?? '—';

  // Current account balance (postpaid: positive = owed by client, negative = credit).
  const balanceAmount = parseFloat(client.balance || '0');
  const balanceCurrency = client.ledger[0]?.currency || 'MXN';
  const owes = balanceAmount > 0.005;
  const inCredit = balanceAmount < -0.005;

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
        {canEdit && (
          <div style={styles.headerActions}>
            <button type="button" style={styles.actionBtn} onClick={() => setShowEdit(true)}>✏️ Edit</button>
            <button type="button" style={styles.actionBtn} onClick={() => setShowMxProfile(true)}>🧾 MX Profile</button>
            <button type="button" style={styles.actionBtn} onClick={() => setShowPortalPassword(true)}>🔑 Portal Password</button>
          </div>
        )}
      </div>

      {/* Account balance — shown prominently */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.75rem 1rem', margin: '0.75rem 0', borderRadius: 8,
          border: '1px solid',
          background: owes ? '#fef2f2' : inCredit ? '#f0fdf4' : '#f9fafb',
          borderColor: owes ? '#fecaca' : inCredit ? '#bbf7d0' : '#e5e7eb',
          color: owes ? '#991b1b' : inCredit ? '#166534' : '#374151',
        }}
      >
        <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.85 }}>
          Account Balance
        </span>
        <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>
          {fmtMoney(String(Math.abs(balanceAmount)), balanceCurrency)}
        </span>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.9 }}>
          {owes ? '⚠ Owed by client' : inCredit ? '✓ Client in credit' : '✓ Settled'}
        </span>
      </div>

      {/* Info card */}
      <ClientInfoCard client={client} accountGroup={accountGroupName} />

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
        {activeTab === 'activity'  && <ActivityTimelineTab clientId={Number(client.id)} />}
        {activeTab === 'contracts' && <ContractsTab contracts={client.contracts} />}
        {activeTab === 'invoices'  && <InvoicesTab  invoices={client.invoices}   />}
        {activeTab === 'payments'  && <PaymentsTab  payments={client.payments}   />}
        {activeTab === 'devices'   && <DevicesTab   devices={client.devices}     />}
        {activeTab === 'tickets'   && <TicketsTab   clientId={Number(client.id)}  />}
        {activeTab === 'ledger'    && <LedgerTab    ledger={client.ledger}       />}
        {activeTab === 'contacts'  && (
          <ContactsTab
            contacts={client.contacts}
            canEdit={canEdit}
            onAdd={() => setShowAddContact(true)}
            onDelete={handleDeleteContact}
          />
        )}
        {activeTab === 'profile'      && <ProfileExtrasTab clientId={Number(client.id)} canEdit={canEdit} />}
        {activeTab === 'customFields' && <CustomFieldsTab  clientId={Number(client.id)} canEdit={canEdit} />}
        {activeTab === 'documents'    && <DocumentsTab     clientId={Number(client.id)} canEdit={canEdit} />}
        {activeTab === 'duplicates'   && <DuplicatesTab    clientId={Number(client.id)} canEdit={canEdit} />}
        {activeTab === 'communication' && <ClientCommunicationPrefs clientId={Number(client.id)} />}
      </div>

      {/* Modals */}
      {showEdit && (
        <ClientFormModal
          mode="edit"
          initial={editInitial}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); refetchClient(); }}
        />
      )}
      {showAddContact && (
        <AddContactModal
          clientId={client.id}
          onClose={() => setShowAddContact(false)}
          onSaved={() => { setShowAddContact(false); refetchClient(); }}
        />
      )}
      {showMxProfile && (
        <MxProfileModal
          clientId={client.id}
          onClose={() => setShowMxProfile(false)}
          onSaved={() => { setShowMxProfile(false); refetchClient(); }}
        />
      )}
      {showPortalPassword && (
        <PortalPasswordModal
          clientId={client.id}
          username={client.email}
          onClose={() => setShowPortalPassword(false)}
          onSaved={() => setShowPortalPassword(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const modalTitle: React.CSSProperties = {
  margin: '0 0 1rem', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)',
};
const modalActions: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.25rem',
};

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
  breadcrumbLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:     { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  clientHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  clientName: { margin: '0 0 0.35rem', color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  clientId: { color: 'var(--text-dimmed)', fontSize: '0.8rem' },
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
  smallPrimaryBtn: {
    padding: '0.4rem 0.85rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 600,
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
  infoRow: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 60 },
  infoValue: { color: 'var(--text-secondary)' },
  notesRow: { marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' },
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
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
};
