// =============================================================================
// FireISP 5.0 — Device Bulk Import
// =============================================================================
// Standalone page at /device-import.
// Provides a CSV file upload form that posts to POST /import/devices/upload.
// Displays per-row import results (successes and errors) after submission.
// §6.1 feature: "Bulk device import via CSV"
// =============================================================================

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportError {
  row: number;
  error: string;
}

interface ImportResult {
  imported: number;
  total: number;
  errors: ImportError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMPLATE_HEADERS = 'name,ip_address,type,mac_address,snmp_community,snmp_version,snmp_port,site_id';
const TEMPLATE_EXAMPLE = 'core-router-01,192.168.1.1,router,AA:BB:CC:DD:EE:FF,public,v2c,161,';

function downloadTemplate(): void {
  const csv = `${TEMPLATE_HEADERS}\n${TEMPLATE_EXAMPLE}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'device_import_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function uploadDeviceCsv(file: File): Promise<ImportResult> {
  const orgId = sessionStorage.getItem('orgId') || localStorage.getItem('orgId') || '';
  const token = sessionStorage.getItem('token') || localStorage.getItem('token') || '';

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/import/devices/upload', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': orgId } : {}),
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } }).error?.message || 'Upload failed');
  }

  const json = await res.json() as { data: ImportResult };
  return json.data;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '24px 16px',
  fontFamily: 'system-ui, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 24,
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  marginTop: 4,
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const primaryBtn: React.CSSProperties = {
  ...btnStyle,
  background: '#2563eb',
  color: '#fff',
};

const secondaryBtn: React.CSSProperties = {
  ...btnStyle,
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
};

const resultCardStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: '#d1fae5',
  background: '#f0fdf4',
};

const errorCardStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: '#fee2e2',
  background: '#fef2f2',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  fontWeight: 600,
  color: '#374151',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 12px',
  borderBottom: '1px solid #f3f4f6',
  color: '#374151',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeviceImport() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string>('');

  const mutation = useMutation<ImportResult, Error, File>({
    mutationFn: uploadDeviceCsv,
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setValidationError('');
    mutation.reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setValidationError(t('device_import.no_file'));
      return;
    }
    mutation.mutate(selectedFile);
  }

  const result = mutation.data;
  const hasErrors = result && result.errors.length > 0;

  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
        {t('device_import.title')}
      </h1>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
        {t('device_import.description')}
      </p>

      <div style={cardStyle}>
        <form onSubmit={handleSubmit}>
          {/* File input */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle} htmlFor="csv-file">
              {t('device_import.upload_label')}
            </label>
            <input
              id="csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              style={{ display: 'block', fontSize: 14, color: '#374151' }}
            />
            <p style={hintStyle}>{t('device_import.upload_hint')}</p>
            <p style={{ ...hintStyle, marginTop: 6 }}>{t('device_import.columns_hint')}</p>
          </div>

          {/* Validation error */}
          {validationError && (
            <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{validationError}</p>
          )}

          {/* Mutation error */}
          {mutation.isError && (
            <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
              {t('device_import.upload_error')}: {mutation.error.message}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="submit"
              style={{ ...primaryBtn, opacity: mutation.isPending ? 0.7 : 1 }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t('device_import.importing') : t('device_import.import_btn')}
            </button>
            <button type="button" style={secondaryBtn} onClick={downloadTemplate}>
              {t('device_import.download_template')}
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      {result && (
        <div style={hasErrors && result.imported < result.total ? errorCardStyle : resultCardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#111827' }}>
            {t('device_import.result_title')}
          </h2>

          {/* Summary row */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontSize: 14 }}>
            <span>
              <strong>{t('device_import.imported')}:</strong> {result.imported}
            </span>
            <span>
              <strong>{t('device_import.total')}:</strong> {result.total}
            </span>
            <span>
              <strong>{t('device_import.errors')}:</strong> {result.errors.length}
            </span>
          </div>

          {result.errors.length === 0 ? (
            <p style={{ fontSize: 13, color: '#166534' }}>{t('device_import.no_errors')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('device_import.row')}</th>
                    <th style={thStyle}>{t('device_import.error_col')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((err, idx) => (
                    <tr key={idx}>
                      <td style={{ ...tdStyle, width: 80 }}>{err.row}</td>
                      <td style={{ ...tdStyle, color: '#dc2626' }}>{err.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
