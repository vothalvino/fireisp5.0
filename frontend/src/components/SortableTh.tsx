// =============================================================================
// FireISP 5.0 — Sortable table header
// =============================================================================
// A reusable clickable column header + the hook that backs it. Sorting is done
// SERVER-SIDE: the hook exposes `order_by` / `order` that callers thread into
// their list query (so it works across pagination, not just the current page).
// Click a header to sort ascending; click again to flip to descending. The DB
// orders by the column's native type, so numbers sort low→high and text A→Z.
// =============================================================================

import type React from 'react';
import { useState } from 'react';

export type SortDir = 'ASC' | 'DESC';

export interface TableSort {
  sortBy: string;
  sortDir: SortDir;
  toggle: (col: string) => void;
  /** Query params to forward to the list endpoint. */
  order_by: string;
  order: SortDir;
}

/**
 * Manage server-side sort state for a list table.
 * @param defaultBy  initial sort column (must be in the model's `sortable` list)
 * @param defaultDir initial direction
 */
export function useTableSort(defaultBy = 'id', defaultDir: SortDir = 'ASC'): TableSort {
  const [sortBy, setSortBy] = useState(defaultBy);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggle(col: string) {
    if (col === sortBy) {
      setSortDir(d => (d === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(col);
      setSortDir('ASC');
    }
  }

  return { sortBy, sortDir, toggle, order_by: sortBy, order: sortDir };
}

export function SortableTh({
  label,
  col,
  sort,
  style,
  align = 'left',
}: {
  label: React.ReactNode;
  /** The backend column name to sort by (must be in the model's `sortable`). */
  col: string;
  sort: TableSort;
  style?: React.CSSProperties;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sort.sortBy === col;
  const arrow = active ? (sort.sortDir === 'ASC' ? '▲' : '▼') : '↕';
  return (
    <th
      onClick={() => sort.toggle(col)}
      aria-sort={active ? (sort.sortDir === 'ASC' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${typeof label === 'string' ? label : col}`}
      style={{
        padding: '10px 14px', textAlign: align, fontWeight: 600, color: '#374151',
        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', ...style,
      }}
    >
      {label}
      <span style={{ marginLeft: 6, opacity: active ? 1 : 0.35, fontSize: '0.75em' }}>{arrow}</span>
    </th>
  );
}
