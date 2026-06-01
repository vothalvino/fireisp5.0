// =============================================================================
// FireISP 5.0 — Factura Pública Viewer
// =============================================================================
// Read-only page at /facturas-publicas. Lists the "facturas públicas" (venta al
// público en general) — periodic aggregations of non-invoiced sales emitted as
// a single CFDI 4.0 InformacionGlobal document. Stamping and invoice linkage
// happen in the secure CFDI / PAC flow, so this is a visibility/list view and
// exposes no create/edit actions.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FacturaPublica {
  id: number;
  periodicidad: string;
  meses: string | null;
  anio: number;
  subtotal: string | number | null;
  total_impuestos: string | number | null;
  total: string | number | null;
  status: string;
}

interface FacturaPublicaResponse {
  data: FacturaPublica[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

const DEFAULT_PAGE_SIZE = 50;

// SAT c_Periodicidad reference labels.
const PERIODICIDAD_LABELS: Record<string, string> = {
  '01': 'Daily',
  '02': 'Weekly',
  '03': 'Fortnightly',
  '04': 'Monthly',
  '05': 'Bimonthly',
};

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchFacturas(page: number): Promise<FacturaPublicaResponse> {
  const query = { page, limit: DEFAULT_PAGE_SIZE };
  const res = await api.GET('/facturas-publicas', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load facturas públicas');
  return res.data as unknown as FacturaPublicaResponse;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft: { bg: '#f3f4f6', color: '#374151' },
    stamped: { bg: '#d1fae5', color: '#065f46' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
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
// FacturaPublicaList component
// ---------------------------------------------------------------------------

export function FacturaPublicaList() {
  const [page, setPage] = useState(1);

  const facturasQ = useQuery({
    queryKey: ['facturas-publicas', page],
    queryFn: () => fetchFacturas(page),
  });

  const facturas = facturasQ.data?.data ?? [];
  const meta = facturasQ.data?.meta;
  const totalPages = meta?.totalPages ?? (meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1);

  const fmtMoney = (v: string | number | null) => {
    if (v == null) return '—';
    const n = typeof v === 'string' ? Number(v) : v;
    if (Number.isNaN(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🧾 Facturas Públicas</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
      </div>

      <div style={styles.tableCard}>
        {facturasQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : facturasQ.error ? (
          <p style={styles.msgError}>Failed to load facturas públicas.</p>
        ) : facturas.length === 0 ? (
          <p style={styles.msg}>No facturas públicas recorded.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Year', 'Months', 'Periodicity', 'Subtotal', 'Taxes', 'Total', 'Status'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {facturas.map(f => (
                    <tr key={f.id} style={styles.tr}>
                      <td style={styles.td}>#{f.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{f.anio}</td>
                      <td style={styles.td}>{f.meses ?? '—'}</td>
                      <td style={styles.td}>{PERIODICIDAD_LABELS[f.periodicidad] ?? f.periodicidad}</td>
                      <td style={styles.td}>{fmtMoney(f.subtotal)}</td>
                      <td style={styles.td}>{fmtMoney(f.total_impuestos)}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{fmtMoney(f.total)}</td>
                      <td style={styles.td}><StatusBadge status={f.status} /></td>
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
    </div>
  );
}
