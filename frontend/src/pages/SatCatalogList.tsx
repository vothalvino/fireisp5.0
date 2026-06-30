// =============================================================================
// FireISP 5.0 — SAT Catalog Viewer
// =============================================================================
// Read-only reference page at /sat-catalogs. Lets operators browse the SAT
// (Servicio de Administración Tributaria) reference catalogs used when issuing
// CFDI 4.0 documents — fiscal regimes, CFDI usage, payment forms/methods,
// voucher types, currencies, and the searchable product/service and unit code
// catalogs. These catalogs are immutable reference data, so the page is purely
// a lookup view with no mutations.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CatalogRow = Record<string, string | number | null>;

interface CatalogResponse {
  data: CatalogRow[];
}

interface CatalogOption {
  value: string;
  label: string;
  searchable: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATALOGS: CatalogOption[] = [
  { value: 'regimen-fiscal', label: 'Fiscal Regimes (Régimen Fiscal)', searchable: false },
  { value: 'uso-cfdi', label: 'CFDI Usage (Uso CFDI)', searchable: false },
  { value: 'forma-pago', label: 'Payment Forms (Forma de Pago)', searchable: false },
  { value: 'metodo-pago', label: 'Payment Methods (Método de Pago)', searchable: false },
  { value: 'tipo-comprobante', label: 'Voucher Types (Tipo de Comprobante)', searchable: false },
  { value: 'moneda', label: 'Currencies (Moneda)', searchable: false },
  { value: 'clave-prod-serv', label: 'Product / Service Codes (Clave Prod/Serv)', searchable: true },
  { value: 'clave-unidad', label: 'Unit Codes (Clave Unidad)', searchable: true },
];

// ---------------------------------------------------------------------------
// Fetch helper — switch keeps the typed client's literal paths intact
// ---------------------------------------------------------------------------

async function fetchCatalog(value: string, search: string): Promise<CatalogResponse> {
  const searchQuery = { params: { query: { search } as never } };
  let res;
  switch (value) {
    case 'regimen-fiscal': res = await api.GET('/sat-catalogs/regimen-fiscal', {}); break;
    case 'uso-cfdi': res = await api.GET('/sat-catalogs/uso-cfdi', {}); break;
    case 'forma-pago': res = await api.GET('/sat-catalogs/forma-pago', {}); break;
    case 'metodo-pago': res = await api.GET('/sat-catalogs/metodo-pago', {}); break;
    case 'tipo-comprobante': res = await api.GET('/sat-catalogs/tipo-comprobante', {}); break;
    case 'moneda': res = await api.GET('/sat-catalogs/moneda', {}); break;
    case 'clave-prod-serv': res = await api.GET('/sat-catalogs/clave-prod-serv', searchQuery); break;
    case 'clave-unidad': res = await api.GET('/sat-catalogs/clave-unidad', searchQuery); break;
    default: throw new Error('Unknown catalog');
  }
  if (res.error) throw new Error('Failed to load catalog');
  return res.data as unknown as CatalogResponse;
}

// ---------------------------------------------------------------------------
// SatCatalogList component
// ---------------------------------------------------------------------------

export function SatCatalogList() {
  const [catalog, setCatalog] = useState(CATALOGS[0].value);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Client-side pagination: SAT catalog endpoints return all rows at once.
  // Server-side pagination is not available on these read-only reference endpoints.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const selected = CATALOGS.find(c => c.value === catalog) ?? CATALOGS[0];
  // Searchable catalogs are huge, so only query once the operator submits a term.
  const enabled = !selected.searchable || search.trim().length > 0;

  const catalogQ = useQuery({
    queryKey: ['sat-catalogs', catalog, search],
    queryFn: () => fetchCatalog(catalog, search.trim()),
    enabled,
  });

  function onCatalogChange(value: string) {
    setCatalog(value);
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  const rows = catalogQ.data?.data ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  // Client-side page slice
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>📚 SAT Catalogs</h1>
        {enabled && catalogQ.data && rows.length > 0 && <span style={styles.countBadge}>{rows.length} rows</span>}
      </div>

      <div style={{ ...styles.filterRow, flexWrap: 'wrap' }}>
        <label style={styles.filterLabel}>Catalog:</label>
        <select
          style={styles.filterSelect}
          value={catalog}
          onChange={e => onCatalogChange(e.target.value)}
          aria-label="Select catalog"
        >
          {CATALOGS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {selected.searchable && (
          <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              style={{ ...styles.filterSelect, width: 200 }}
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search code or description"
              aria-label="Search catalog"
            />
            <button type="submit" style={styles.btnPrimary}>Search</button>
          </form>
        )}
      </div>

      <div style={styles.tableCard}>
        {selected.searchable && !enabled ? (
          <p style={styles.msg}>Enter a search term to look up {selected.label.toLowerCase()}.</p>
        ) : catalogQ.isLoading ? (
          <p style={styles.msg}>Loading…</p>
        ) : catalogQ.error ? (
          <p style={styles.msgError}>Failed to load catalog.</p>
        ) : rows.length === 0 ? (
          <p style={styles.msg}>No entries found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {columns.map(col => <th key={col} style={styles.th}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={i} style={styles.tr}>
                    {columns.map(col => (
                      <td key={col} style={styles.td}>{row[col] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Client-side pagination */}
            <Pagination
              page={page}
              totalPages={totalPages}
              total={rows.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
