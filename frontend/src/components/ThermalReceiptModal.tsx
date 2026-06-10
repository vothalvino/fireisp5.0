// =============================================================================
// FireISP 5.0 — ThermalReceiptModal (§2.2B)
// =============================================================================
// Modal that fetches and displays a plain-text thermal receipt for an invoice
// or payment. Supports 58mm (32-char) and 80mm (48-char) width toggle plus a
// browser print action.
// Usage:
//   <ThermalReceiptModal
//     resourceType="invoice"   // "invoice" | "payment"
//     resourceId={123}
//     onClose={() => ...}
//   />
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResourceType = 'invoice' | 'payment';
type ReceiptWidth = 32 | 48;

interface Props {
  resourceType: ResourceType;
  resourceId: number;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function fetchReceipt(type: ResourceType, id: number, width: ReceiptWidth): Promise<string> {
  const token = tokenStore.getAccess();
  const endpoint = type === 'invoice' ? `invoices/${id}/receipt` : `payments/${id}/receipt`;
  const res = await fetch(`${API}/${endpoint}?width=${width}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to load receipt (${res.status})`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '24px',
  width: 520, maxWidth: '95vw', maxHeight: '90vh',
  display: 'flex', flexDirection: 'column', gap: 16,
};
const toolbar: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const widthToggle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' };
const toggleBtn = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px',
  background: active ? '#1a5276' : '#f3f4f6',
  color: active ? '#fff' : '#374151',
  border: 'none', borderRadius: 4, fontSize: 12,
  cursor: 'pointer', fontWeight: 600,
});
const receiptPre: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 12, lineHeight: 1.4,
  whiteSpace: 'pre', overflow: 'auto',
  border: '1px dashed #d1d5db', borderRadius: 4,
  padding: '12px', background: '#fafafa',
  flex: 1,
};
const actionRow: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 10 };
const closeBtn: React.CSSProperties = {
  padding: '8px 18px', background: '#e5e7eb', border: 'none',
  borderRadius: 6, fontSize: 13, cursor: 'pointer',
};
const printBtn: React.CSSProperties = {
  padding: '8px 18px', background: '#1a5276', color: '#fff', border: 'none',
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThermalReceiptModal({ resourceType, resourceId, onClose }: Props) {
  const { t } = useTranslation();
  const printRef = useRef<HTMLPreElement>(null);

  const [width, setWidth] = useState<ReceiptWidth>(48);
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReceipt(resourceType, resourceId, width)
      .then(t => { if (!cancelled) { setText(t); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [resourceType, resourceId, width]);

  const handlePrint = () => {
    if (!printRef.current) return;
    const content = printRef.current.innerText;
    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) return;
    win.document.write(`<html><head><title>Receipt</title><style>
      body { margin: 0; padding: 8px; font-family: monospace; font-size: 12px; }
      pre { white-space: pre; }
    </style></head><body><pre>${content.replace(/</g, '&lt;')}</pre></body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={toolbar}>
          <strong style={{ fontSize: 15 }}>
            {resourceType === 'invoice' ? t('thermalReceipt.invoiceTitle') : t('thermalReceipt.paymentTitle')}
          </strong>
          <div style={widthToggle}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{t('thermalReceipt.width')}</span>
            <button style={toggleBtn(width === 32)} onClick={() => setWidth(32)}>58mm</button>
            <button style={toggleBtn(width === 48)} onClick={() => setWidth(48)}>80mm</button>
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
            {t('common.loading')}
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <pre ref={printRef} style={receiptPre}>{text}</pre>
        )}

        <div style={actionRow}>
          <button style={closeBtn} onClick={onClose}>{t('common.close')}</button>
          {!loading && !error && (
            <button style={printBtn} onClick={handlePrint}>{t('thermalReceipt.print')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
