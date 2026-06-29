import React from 'react';

/**
 * High-density data table matching FireISP's flat industrial aesthetic.
 * Header uses muted uppercase labels; numeric columns use tabular-nums
 * (JetBrains Mono). Shows an empty-state message when there are no rows.
 * Wrap in a Card for a bordered panel surface.
 */
export interface TableColumn {
  /** The key used to look up a value in each row object. */
  key: string;
  /** Column header label. */
  header: string;
  /** Text alignment for header and cells. @default 'left' */
  align?: 'left' | 'right' | 'center';
  /** Whether cells in this column render as monospace tabular numbers. */
  numeric?: boolean;
}

export interface TableProps {
  /** Column definitions (ordered). */
  columns: TableColumn[];
  /** Row data — each value can be any renderable React node. */
  rows: Record<string, React.ReactNode>[];
  /** Message to display when rows is empty. @default 'No data' */
  empty?: string;
  style?: React.CSSProperties;
}

export function Table({
  columns,
  rows,
  empty = 'No data',
  style,
}: TableProps): React.ReactElement {
  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    overflowX: 'auto',
    ...style,
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
  };

  const thStyle = (col: TableColumn): React.CSSProperties => ({
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

  const tdStyle = (col: TableColumn): React.CSSProperties => ({
    padding: 'var(--sp-2) var(--sp-3)',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border-subtle)',
    verticalAlign: 'middle',
    textAlign: col.align ?? 'left',
    fontFamily: col.numeric ? 'var(--font-mono)' : 'var(--font-sans)',
    fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined,
  });

  const emptyStyle: React.CSSProperties = {
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
              <th key={col.key} style={thStyle(col)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={emptyStyle}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col) => (
                  <td key={col.key} style={tdStyle(col)}>
                    {row[col.key] ?? null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
