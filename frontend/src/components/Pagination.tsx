// =============================================================================
// FireISP 5.0 — Shared Pagination Component
// =============================================================================
// Renders a "Rows per page" selector (default 25/50/100), optional total-row
// count, and — when totalPages > 1 — a Prev/Next bar with "Page X of Y".
//
// Usage:
//   <Pagination
//     page={page}
//     totalPages={meta?.totalPages ?? 1}
//     total={meta?.total}
//     pageSize={pageSize}
//     onPageChange={setPage}
//     onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
//   />
//
// Visual style matches ClientList's styles.pagination / pageBtn / pageInfo so
// it looks native on every list page.
// =============================================================================

import { useTranslation } from 'react-i18next';

export interface PaginationProps {
  /** Current 1-based page number. */
  page: number;
  /** Total number of pages (from server meta). */
  totalPages: number;
  /** Total row count (optional — shown in parentheses when provided). */
  total?: number;
  /** Currently active page size. */
  pageSize: number;
  /** Called when the user navigates to a different page. */
  onPageChange: (page: number) => void;
  /** Called when the user picks a new page size.
   *  Caller is responsible for resetting page to 1. */
  onPageSizeChange: (size: number) => void;
  /** Choices offered in the size select. Defaults to [25, 50, 100]. */
  pageSizeOptions?: number[];
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
  padding: '0.75rem 1rem',
  borderTop: '1px solid var(--border-subtle)',
  marginTop: 4,
};

const sizeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
};

const sizeSelectStyle: React.CSSProperties = {
  padding: '0.2rem 0.35rem',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  background: 'var(--bg-card)',
  fontSize: '0.82rem',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
};

const navRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginLeft: 'auto',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '0.35rem 0.85rem',
  border: '1px solid var(--border-strong)',
  borderRadius: 5,
  background: 'var(--bg-card)',
  cursor: 'pointer',
  fontSize: '0.82rem',
  color: 'var(--text-secondary)',
};

const pageInfoStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.82rem',
};

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationProps) {
  const { t } = useTranslation();

  return (
    <div style={containerStyle}>
      {/* Rows-per-page selector — always visible */}
      <div style={sizeRowStyle}>
        <label htmlFor="pg-size-select">{t('pagination.rowsPerPage')}</label>
        <select
          id="pg-size-select"
          style={sizeSelectStyle}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {total !== undefined && (
          <span style={{ marginLeft: '0.25rem' }}>
            ({total})
          </span>
        )}
      </div>

      {/* Prev / page-info / Next — only when there are multiple pages */}
      {totalPages > 1 && (
        <div style={navRowStyle}>
          <button
            type="button"
            style={pageBtnStyle}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            aria-label={t('pagination.prevPage')}
          >
            {t('pagination.prevPage')}
          </button>
          <span style={pageInfoStyle}>
            {t('pagination.pageInfo', { page, total: totalPages })}
          </span>
          <button
            type="button"
            style={pageBtnStyle}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            aria-label={t('pagination.nextPage')}
          >
            {t('pagination.nextPage')}
          </button>
        </div>
      )}
    </div>
  );
}
