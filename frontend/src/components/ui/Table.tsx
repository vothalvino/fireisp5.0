// =============================================================================
// FireISP UI — Table
// =============================================================================
// Faithful TSX port of @fireisp/ui Table. Columns/rows; numeric columns get
// tabular mono. Rows are keyed by column.key with ReactNode cell values.
// =============================================================================

import type { CSSProperties, ReactNode } from 'react';

export interface TableColumn {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  numeric?: boolean;
}

export type TableRow = Record<string, ReactNode>;

export interface TableProps {
  columns: TableColumn[];
  rows: TableRow[];
  empty?: ReactNode;
  style?: CSSProperties;
}

export function Table({ columns, rows, empty = 'No data', style }: TableProps) {
  const wrapperStyle: CSSProperties = { width: '100%', overflowX: 'auto', ...style };
  const tableStyle: CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
  };
  const thStyle = (col: TableColumn): CSSProperties => ({
    padding: 'var(--sp-2) var(--sp-3)',
    textAlign: col.align ?? 'left',
    color: 'var(--text-muted)',
    fontSize: '0.72rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-subtle)',
  });
  const tdStyle = (col: TableColumn): CSSProperties => ({
    padding: 'var(--sp-2) var(--sp-3)',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border-subtle)',
    verticalAlign: 'middle',
    textAlign: col.align ?? 'left',
    fontFamily: col.numeric ? 'var(--font-mono)' : 'var(--font-sans)',
    fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined,
  });
  const emptyStyle: CSSProperties = {
    textAlign: 'center',
    color: 'var(--text-muted)',
    padding: 'var(--sp-5)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={wrapperStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={thStyle(col)}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={emptyStyle}>{empty}</td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col) => (
                  <td key={col.key} style={tdStyle(col)}>{row[col.key] ?? null}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
