// =============================================================================
// FireISP 5.0 — CSV Data Import
// =============================================================================
// Standalone page at /data-import.
//
// Four of the five CSV importers had NO GUI at all — clients, contracts,
// invoices and payments were reachable only with curl or Postman, which is a
// problem because importing them is what a new ISP does on DAY ONE when moving
// off its old billing system. (Devices already had DeviceImport.tsx, in the
// Network section; it stays, and this page offers devices too so the migration
// story is in one place.)
//
// The backend already returns exactly what an import UI needs —
// { imported, total, errors: [{ row, error }] } — with per-row numbers, which
// is the hard part and was already done. All five importers share that shape,
// so one page covers them rather than four near-identical pages.
//
// ROW NUMBERS ARE 1-BASED INCLUDING THE HEADER: the controller pushes
// `row: i + 2`, so an error on `row: 3` is the third line of the file and the
// second data row. The results table says so explicitly, because "row 3" is
// useless if you cannot tell which counting it means.
// =============================================================================

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { readCsrfCookie } from '@/api/csrf';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';

interface ImportError { row: number; error: string }
interface ImportResult { imported: number; total: number; errors: ImportError[] }

interface EntitySpec {
  key: string;
  /** POST /import/<path> and /import/<path>/upload */
  path: string;
  /** Server-side guard, mirrored here so we never offer an import that 403s. */
  permission: string;
  required: string[];
  optional: string[];
  example: string;
}

// Columns are taken from src/controllers/importController.js — the required
// list is what each insert*Row() rejects on, not a guess. They were previously
// discoverable ONLY by reading that file.
const ENTITIES: EntitySpec[] = [
  {
    key: 'clients', path: 'clients', permission: 'clients.create',
    required: ['name'],
    optional: ['email', 'phone', 'city', 'state', 'country', 'status'],
    example: 'Juana Pérez,juana@example.mx,6641234567,Tijuana,BC,MX,active',
  },
  {
    key: 'contracts', path: 'contracts', permission: 'contracts.create',
    required: ['client_id', 'plan_id'],
    optional: ['connection_type', 'pppoe_username', 'pppoe_password'],
    example: '42,5,pppoe,juana.perez,s3cret',
  },
  {
    key: 'invoices', path: 'invoices', permission: 'invoices.create',
    required: ['client_id', 'invoice_number', 'issue_date', 'due_date'],
    optional: ['contract_id', 'subtotal', 'tax_rate', 'total', 'currency', 'notes', 'status'],
    example: '42,INV-000001,2026-07-01,2026-07-31,1000,0.16,1160,MXN,,sent',
  },
  {
    key: 'payments', path: 'payments', permission: 'payments.create',
    required: ['client_id', 'amount', 'payment_date'],
    optional: ['payment_method', 'reference', 'notes'],
    example: '42,1160,2026-07-05,transfer,TXN-001,',
  },
  {
    key: 'devices', path: 'devices', permission: 'devices.create',
    required: ['name', 'ip_address'],
    optional: ['type', 'mac_address', 'snmp_community', 'snmp_version', 'snmp_port', 'site_id'],
    example: 'core-router-01,192.168.1.1,router,AA:BB:CC:DD:EE:FF,public,v2c,161,',
  },
];

function headerLine(spec: EntitySpec): string {
  return [...spec.required, ...spec.optional].join(',');
}

function downloadTemplate(spec: EntitySpec): void {
  const csv = `${headerLine(spec)}\n${spec.example}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${spec.key}_import_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function uploadCsv(spec: EntitySpec, file: File): Promise<ImportResult> {
  const token = sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  const formData = new FormData();
  formData.append('file', file);
  const csrf = readCsrfCookie();
  // The versioned prefix on purpose: /api (unversioned) still works but emits a
  // Deprecation header with a 2027-06-01 sunset (src/app.js).
  const res = await fetch(`/api/v1/import/${spec.path}/upload`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    credentials: 'include',
    body: formData,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } }).error?.message || `Upload failed (HTTP ${res.status})`);
  }
  return (body as { data: ImportResult }).data;
}

export function DataImport() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Only offer what this user can actually import — an entity they lack the
  // permission for would 403 on submit with the file already chosen.
  const available = ENTITIES.filter(e => can(user, e.permission));
  const [entityKey, setEntityKey] = useState(available[0]?.key ?? 'invoices');
  const spec = available.find(e => e.key === entityKey) ?? available[0];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState('');

  const mutation = useMutation<ImportResult, Error, { spec: EntitySpec; file: File }>({
    mutationFn: ({ spec: s, file: f }) => uploadCsv(s, f),
  });

  function reset() {
    setFile(null);
    setValidationError('');
    mutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!spec) return;
    if (!file) { setValidationError(t('dataImport.noFile')); return; }
    setValidationError('');
    mutation.mutate({ spec, file });
  }

  if (!spec) {
    return (
      <div style={container}>
        <h1 style={h1}>{t('dataImport.title')}</h1>
        <p style={{ color: 'var(--text-muted)' }}>{t('dataImport.noPermission')}</p>
      </div>
    );
  }

  const result = mutation.data;
  const partial = result && result.errors.length > 0;

  return (
    <div style={container}>
      <h1 style={h1}>{t('dataImport.title')}</h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
        {t('dataImport.description')}
      </p>

      <div style={card}>
        <form onSubmit={submit}>
          <label style={label} htmlFor="import-entity">{t('dataImport.whatToImport')}</label>
          <select
            id="import-entity"
            style={{ ...input, marginBottom: 16 }}
            value={entityKey}
            onChange={e => { setEntityKey(e.target.value); reset(); }}
          >
            {available.map(e => (
              <option key={e.key} value={e.key}>{t(`dataImport.entities.${e.key}`)}</option>
            ))}
          </select>

          <div style={columnsBox}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('dataImport.expectedColumns')}</div>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('dataImport.required')}: </span>
              <code>{spec.required.join(', ')}</code>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{t('dataImport.optional')}: </span>
              <code>{spec.optional.join(', ')}</code>
            </div>
          </div>

          <label style={label} htmlFor="import-file">{t('dataImport.chooseFile')}</label>
          <input
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setValidationError(''); mutation.reset(); }}
            style={{ display: 'block', fontSize: 14, marginBottom: 4 }}
          />
          <p style={hint}>{t('dataImport.fileHint')}</p>

          {validationError && <p style={errText}>{validationError}</p>}
          {mutation.isError && <p style={errText}>{mutation.error.message}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="submit" style={{ ...primaryBtn, opacity: mutation.isPending ? 0.7 : 1 }} disabled={mutation.isPending}>
              {mutation.isPending ? t('dataImport.importing') : t('dataImport.importBtn')}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => downloadTemplate(spec)}>
              {t('dataImport.downloadTemplate')}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div style={partial ? errorCard : okCard}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('dataImport.resultTitle')}</h2>
          <div style={{ display: 'flex', gap: 24, marginBottom: 14, fontSize: 14, flexWrap: 'wrap' }}>
            <span><strong>{t('dataImport.imported')}:</strong> {result.imported}</span>
            <span><strong>{t('dataImport.totalRows')}:</strong> {result.total}</span>
            <span><strong>{t('dataImport.failed')}:</strong> {result.errors.length}</span>
          </div>

          {result.errors.length === 0 ? (
            <p style={{ fontSize: 13 }}>{t('dataImport.allImported')}</p>
          ) : (
            <>
              {/* Rows that imported are NOT rolled back — the importer commits
                  row by row. Saying so prevents a re-run that double-imports. */}
              <p style={{ ...hint, marginBottom: 10 }}>{t('dataImport.partialWarning')}</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>{t('dataImport.lineNumber')}</th>
                      <th style={th}>{t('dataImport.errorCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td style={{ ...td, width: 110 }}>{e.row}</td>
                        <td style={{ ...td, color: '#dc2626' }}>{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const container: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '24px 16px' };
const h1: React.CSSProperties = { fontSize: 22, fontWeight: 700, marginBottom: 4 };
const card: React.CSSProperties = {
  background: 'var(--bg-panel, #fff)', border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 8, padding: 24, marginBottom: 20,
};
const okCard: React.CSSProperties = { ...card, borderColor: '#a7f3d0' };
const errorCard: React.CSSProperties = { ...card, borderColor: '#fecaca' };
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 };
const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 6,
  border: '1px solid var(--border-strong, #d1d5db)', fontSize: 14,
};
const columnsBox: React.CSSProperties = {
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
  padding: '10px 12px', marginBottom: 16, fontSize: 12.5, overflowWrap: 'anywhere',
};
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted, #6b7280)' };
const errText: React.CSSProperties = { color: '#dc2626', fontSize: 13, marginTop: 10 };
const btn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500, border: 'none',
};
const primaryBtn: React.CSSProperties = { ...btn, background: '#2563eb', color: '#fff' };
const secondaryBtn: React.CSSProperties = {
  ...btn, background: 'transparent', color: 'var(--text-secondary, #374151)',
  border: '1px solid var(--border-strong, #d1d5db)',
};
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', background: 'var(--bg-subtle, #f9fafb)',
  borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600,
};
const td: React.CSSProperties = { padding: '7px 12px', borderBottom: '1px solid var(--border, #f3f4f6)' };

export default DataImport;
