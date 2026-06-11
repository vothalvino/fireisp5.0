// =============================================================================
// FireISP 5.0 — Invoice Branding Settings (§2.2B)
// =============================================================================
// Admin/billing page for configuring per-org invoice branding:
// logo URL, header color, footer legal text, payment instructions.
// These are applied by pdfService.generateInvoicePdf at PDF render time.
// =============================================================================

import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvoiceSettingsData {
  id?: number;
  organization_id?: number;
  logo_url: string | null;
  header_color: string | null;
  footer_legal: string | null;
  payment_instructions: string | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function fetchSettings(): Promise<InvoiceSettingsData> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API}/invoice-settings`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to load invoice settings');
  return res.json();
}

async function saveSettings(body: Partial<InvoiceSettingsData>): Promise<InvoiceSettingsData> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API}/invoice-settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to save invoice settings');
  return res.json();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '24px',
  maxWidth: 640,
};
const fieldGroup: React.CSSProperties = { marginBottom: 16 };
const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, resize: 'vertical' };
const saveBtn: React.CSSProperties = {
  padding: '9px 20px',
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

export function InvoiceSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState<InvoiceSettingsData>({
    logo_url: '',
    header_color: '#1a5276',
    footer_legal: '',
    payment_instructions: '',
  });
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-settings'],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    if (data) {
      setForm({
        logo_url: data.logo_url || '',
        header_color: data.header_color || '#1a5276',
        footer_legal: data.footer_legal || '',
        payment_instructions: data.payment_instructions || '',
      });
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice-settings'] });
      setMsg({ type: 'success', text: t('invoiceSettings.saved') });
      setTimeout(() => setMsg(null), 3000);
    },
    onError: () => {
      setMsg({ type: 'error', text: t('invoiceSettings.saveError') });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  if (!user) return null;

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        {t('invoiceSettings.title')}
      </h1>

      {isLoading && <p>{t('common.loading')}</p>}

      <form onSubmit={handleSubmit} style={card}>
        {msg && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 16,
            background: msg.type === 'success' ? '#d1fae5' : '#fee2e2',
            color: msg.type === 'success' ? '#065f46' : '#991b1b',
            fontSize: 14,
          }}>
            {msg.text}
          </div>
        )}

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('invoiceSettings.logoUrl')}</label>
          <input
            style={inputStyle}
            type="url"
            placeholder={t('invoiceSettings.logoUrlPlaceholder')}
            value={form.logo_url || ''}
            onChange={e => setForm(f => ({ ...f, logo_url: e.target.value || null }))}
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('invoiceSettings.headerColor')}</label>
          <input
            style={{ ...inputStyle, width: 120 }}
            type="color"
            value={form.header_color || '#1a5276'}
            onChange={e => setForm(f => ({ ...f, header_color: e.target.value }))}
          />
          <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>
            {form.header_color || '#1a5276'}
          </span>
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('invoiceSettings.footerLegal')}</label>
          <textarea
            style={textareaStyle}
            placeholder={t('invoiceSettings.footerLegalPlaceholder')}
            value={form.footer_legal || ''}
            onChange={e => setForm(f => ({ ...f, footer_legal: e.target.value || null }))}
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('invoiceSettings.paymentInstructions')}</label>
          <textarea
            style={textareaStyle}
            placeholder={t('invoiceSettings.paymentInstructionsPlaceholder')}
            value={form.payment_instructions || ''}
            onChange={e => setForm(f => ({ ...f, payment_instructions: e.target.value || null }))}
          />
        </div>

        <button type="submit" style={saveBtn} disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </div>
  );
}
