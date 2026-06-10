// =============================================================================
// FireISP 5.0 — Tax Reports (§2.2B)
// =============================================================================
// Export billing records for a date range:
//   GET /billing/tax-reports?from=&to=&type=invoices|payments|credit_notes&format=csv|json
// =============================================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportType = 'invoices' | 'payments' | 'credit_notes';
type ReportFormat = 'csv' | 'json';

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function fetchTaxReport(
  from: string,
  to: string,
  type: ReportType,
  format: ReportFormat,
): Promise<{ blob: Blob; filename: string }> {
  const token = tokenStore.getAccess();
  const params = new URLSearchParams({ from, to, type, format });
  const res = await fetch(`${API}/billing/tax-reports?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);

  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `tax-report-${from}-to-${to}.${format}`;

  const blob = await res.blob();
  return { blob, filename };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '24px',
  maxWidth: 560,
};
const row: React.CSSProperties = { display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' };
const fieldGroup: React.CSSProperties = { flex: 1, minWidth: 160 };
const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box' as const,
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const exportBtn: React.CSSProperties = {
  padding: '9px 22px',
  background: '#1a5276',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaxReports() {
  const { t } = useTranslation();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = `${new Date().getFullYear()}-01-01`;

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [type, setType] = useState<ReportType>('invoices');
  const [format, setFormat] = useState<ReportFormat>('csv');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { blob, filename } = await fetchTaxReport(from, to, type, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taxReports.exportError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        {t('taxReports.title')}
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        {t('taxReports.description')}
      </p>

      <form onSubmit={handleExport} style={card}>
        {error && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 16,
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <div style={row}>
          <div style={fieldGroup}>
            <label style={labelStyle}>{t('taxReports.from')}</label>
            <input
              style={inputStyle}
              type="date"
              value={from}
              required
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>{t('taxReports.to')}</label>
            <input
              style={inputStyle}
              type="date"
              value={to}
              required
              onChange={e => setTo(e.target.value)}
            />
          </div>
        </div>

        <div style={row}>
          <div style={fieldGroup}>
            <label style={labelStyle}>{t('taxReports.type')}</label>
            <select
              style={selectStyle}
              value={type}
              onChange={e => setType(e.target.value as ReportType)}
            >
              <option value="invoices">{t('taxReports.typeInvoices')}</option>
              <option value="payments">{t('taxReports.typePayments')}</option>
              <option value="credit_notes">{t('taxReports.typeCreditNotes')}</option>
            </select>
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>{t('taxReports.format')}</label>
            <select
              style={selectStyle}
              value={format}
              onChange={e => setFormat(e.target.value as ReportFormat)}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>

        <button type="submit" style={exportBtn} disabled={loading}>
          {loading ? t('common.loading') : t('taxReports.export')}
        </button>
      </form>
    </div>
  );
}
