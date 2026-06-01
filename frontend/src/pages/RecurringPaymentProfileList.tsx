// =============================================================================
// FireISP 5.0 — Recurring Payment Profile Viewer
// =============================================================================
// Read-only page at /recurring-payment-profiles. Lists the stored autopay
// card/token profiles per client with their gateway, masked card, expiry,
// default flag and lifecycle status. Card tokens are stored by the payment
// gateway and managed through a dedicated secure flow, so this page is a
// visibility view and exposes no create/edit/delete actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecurringPaymentProfile {
  id: number;
  client_id: number;
  payment_gateway_id: number;
  card_brand: string | null;
  card_last_four: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  is_default: number | boolean;
  status: string;
}

interface RecurringPaymentProfileResponse {
  data: RecurringPaymentProfile[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchProfiles(page: number): Promise<RecurringPaymentProfileResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/recurring-payment-profiles', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load recurring payment profiles');
  return res.data as unknown as RecurringPaymentProfileResponse;
}

// ---------------------------------------------------------------------------
// Badge / formatting
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    expired: { bg: '#fef3c7', color: '#92400e' },
    revoked: { bg: '#fee2e2', color: '#991b1b' },
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

function formatCard(p: RecurringPaymentProfile): string {
  const brand = p.card_brand ? p.card_brand.toUpperCase() : 'Card';
  return p.card_last_four ? `${brand} •••• ${p.card_last_four}` : brand;
}

function formatExpiry(p: RecurringPaymentProfile): string {
  if (!p.card_exp_month || !p.card_exp_year) return '—';
  return `${String(p.card_exp_month).padStart(2, '0')}/${p.card_exp_year}`;
}

// ---------------------------------------------------------------------------
// RecurringPaymentProfileList component
// ---------------------------------------------------------------------------

export function RecurringPaymentProfileList() {
  const [page, setPage] = useState(1);

  const profilesQ = useQuery({
    queryKey: ['recurring-payment-profiles', page],
    queryFn: () => fetchProfiles(page),
  });

  const profiles = profilesQ.data?.data ?? [];
  const meta = profilesQ.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🔁 Recurring Payment Profiles</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {profilesQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : profilesQ.error ? (
          <p style={styles.msgError}>Failed to load recurring payment profiles.</p>
        ) : profiles.length === 0 ? (
          <p style={styles.msg}>No recurring payment profiles found.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Client', 'Gateway', 'Card', 'Expiry', 'Default', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>#{p.id}</td>
                      <td style={styles.td}>#{p.client_id}</td>
                      <td style={styles.td}>#{p.payment_gateway_id}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.8rem' }}>{formatCard(p)}</td>
                      <td style={styles.td}>{formatExpiry(p)}</td>
                      <td style={styles.td}>{p.is_default ? '⭐' : '—'}</td>
                      <td style={styles.td}><StatusBadge status={p.status} /></td>
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
                <button
                  style={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p style={{ ...styles.msg, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Card tokens are stored by the payment gateway and managed through the secure autopay flow.
      </p>
    </div>
  );
}
