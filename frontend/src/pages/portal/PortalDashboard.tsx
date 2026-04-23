// =============================================================================
// FireISP 5.0 — Portal Dashboard
// =============================================================================
// Landing page for the client self-service portal.
// Shows a summary of the client's open invoices and recent tickets.
// =============================================================================

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePortalAuth, portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface Invoice {
  id: number;
  invoice_number: string;
  total: string;
  currency: string;
  due_date: string | null;
  status: string;
}

interface Ticket {
  id: number;
  subject: string;
  priority: string;
  status: string;
  created_at: string;
}

async function portalFetch<T>(path: string): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Request failed');
  return (await res.json()) as T;
}

export function PortalDashboard() {
  const { client } = usePortalAuth();

  const { data: invoicesData } = useQuery({
    queryKey: ['portal-invoices-summary'],
    queryFn: () => portalFetch<{ data: Invoice[] }>('/invoices?status=issued&limit=5'),
  });

  const { data: ticketsData } = useQuery({
    queryKey: ['portal-tickets-summary'],
    queryFn: () => portalFetch<{ data: Ticket[] }>('/tickets?status=open&limit=5'),
  });

  const pendingInvoices = invoicesData?.data ?? [];
  const openTickets = ticketsData?.data ?? [];

  return (
    <div>
      <h1 style={styles.heading}>Welcome, {client?.name}</h1>
      <p style={styles.sub}>Manage your invoices, payments, and support requests below.</p>

      <div style={styles.grid}>
        {/* Open invoices summary */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>🧾 Unpaid Invoices</h2>
            <Link to="/portal/invoices" style={styles.viewAll}>View all →</Link>
          </div>
          {pendingInvoices.length === 0 ? (
            <p style={styles.empty}>No outstanding invoices. 🎉</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Invoice #</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}>Due</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {pendingInvoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{inv.currency} {parseFloat(inv.total).toFixed(2)}</td>
                    <td style={styles.td}>{inv.due_date ? inv.due_date.slice(0, 10) : '—'}</td>
                    <td style={styles.td}>
                      <Link to={`/portal/invoices/${inv.id}`} style={styles.payLink}>Pay</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Open tickets summary */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>🎫 Open Tickets</h2>
            <Link to="/portal/tickets" style={styles.viewAll}>View all →</Link>
          </div>
          {openTickets.length === 0 ? (
            <p style={styles.empty}>No open support tickets.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Subject</th>
                  <th style={styles.th}>Priority</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {openTickets.map(t => (
                  <tr key={t.id}>
                    <td style={styles.td}>
                      <Link to={`/portal/tickets/${t.id}`} style={styles.ticketLink}>{t.subject}</Link>
                    </td>
                    <td style={styles.td}>{t.priority}</td>
                    <td style={styles.td}>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: '1rem' }}>
            <Link to="/portal/tickets/new" style={styles.newTicketBtn}>+ Open a ticket</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

const styles = {
  heading: { margin: '0 0 0.25rem', fontSize: '1.5rem', color: '#111827' },
  sub: { margin: '0 0 1.5rem', color: '#6b7280', fontSize: '0.95rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    background: '#fff',
    borderRadius: 8,
    padding: '1.25rem',
    boxShadow: '0 1px 4px rgba(0,0,0,.07)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  cardTitle: { margin: 0, fontSize: '1rem', color: '#374151' },
  viewAll: { fontSize: '0.85rem', color: '#e25822', textDecoration: 'none' },
  empty: { color: '#9ca3af', fontSize: '0.9rem', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.4rem 0.5rem', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.5rem', borderBottom: '1px solid #f9fafb', color: '#374151' },
  payLink: { color: '#e25822', fontWeight: 600, textDecoration: 'none' },
  ticketLink: { color: '#1d4ed8', textDecoration: 'none' },
  newTicketBtn: {
    display: 'inline-block',
    padding: '0.4rem 0.9rem',
    background: '#e25822',
    color: '#fff',
    borderRadius: 4,
    textDecoration: 'none',
    fontSize: '0.875rem',
    fontWeight: 600,
  },
} as const;
