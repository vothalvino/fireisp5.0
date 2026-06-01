// =============================================================================
// FireISP 5.0 — Shared CRUD page styles
// =============================================================================
// Common page + modal style objects reused by the billing/sales list pages
// (Plans, Quotes, Credit Notes, Expenses) to keep look-and-feel and
// accessibility consistent. Mirrors the inline styles used by ContractList.
// =============================================================================

export const styles = {
  page: {
    padding: '1.5rem',
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
    background: 'var(--badge-bg)',
    color: 'var(--badge-fg)',
    padding: '2px 10px',
    borderRadius: 9999,
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
    color: 'var(--accent-fg)',
    border: '1px solid var(--accent)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  btnSecondary: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  btnDanger: {
    padding: '0.5rem 1rem',
    background: 'var(--danger)',
    color: '#fff',
    border: '1px solid var(--danger)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  tableCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    border: '1px solid var(--border)',
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
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap' as const,
  },
  /** Right-aligned header for numeric columns. */
  thNum: {
    padding: '0.6rem 0.75rem',
    textAlign: 'right' as const,
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap' as const,
  },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  /** Monospace, right-aligned cell for IDs / money / counts / system values. */
  tdNum: {
    padding: '0.65rem 0.75rem',
    color: 'var(--text-secondary)',
    verticalAlign: 'middle' as const,
    textAlign: 'right' as const,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  /** Monospace, left-aligned cell for IDs / codes / system values. */
  tdMono: {
    padding: '0.65rem 0.75rem',
    color: 'var(--text-secondary)',
    verticalAlign: 'middle' as const,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
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
  msg: { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: 'var(--danger)', margin: 0 },
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

export const modalStyles = {
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
    border: '1px solid var(--border)',
    boxShadow: '0 10px 30px rgba(0,0,0,.18)',
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
    color: 'var(--danger)',
    fontSize: '0.82rem',
    margin: 0,
    padding: '0.4rem 0.75rem',
    background: 'var(--danger-soft)',
    borderRadius: 4,
    border: '1px solid var(--danger-border)',
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

const REQUIRED_MARK_COLOR = 'var(--danger)';

export function RequiredMark() {
  return <span style={{ color: REQUIRED_MARK_COLOR }}>*</span>;
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function fmtMoney(
  amount: string | number | null | undefined,
  currency = 'USD',
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(num)) return '—';
  return `${num.toFixed(2)} ${currency}`;
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
