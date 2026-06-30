// =============================================================================
// FireISP 5.0 — Payment Reminder Settings (§2.2B)
// =============================================================================
// Billing-only page to configure automated payment reminder schedules:
//   - days before due: e.g. [7, 3, 1]
//   - send on due date
//   - days after due: e.g. [1, 3, 7, 14]
//   - enabled toggle
// =============================================================================

import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authedFetch, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReminderSettings {
  id?: number;
  organization_id?: number;
  days_before_due: number[] | null;
  send_on_due: boolean | number;
  days_after_due: number[] | null;
  enabled: boolean | number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/v1';

async function fetchSettings(): Promise<ReminderSettings> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API}/payment-reminder-settings`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

async function saveSettings(body: object): Promise<ReminderSettings> {
  const res = await authedFetch(`${API}/payment-reminder-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a comma-separated string like "7,3,1" into a sorted number array. */
function parseNumbers(str: string): number[] {
  return str.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => b - a);
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
const fieldGroup: React.CSSProperties = { marginBottom: 16 };
const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box' as const,
};
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

export function PaymentReminderSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [daysBefore, setDaysBefore] = useState('7,3,1');
  const [sendOnDue, setSendOnDue] = useState(true);
  const [daysAfter, setDaysAfter] = useState('1,3,7,14');
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['payment-reminder-settings'],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    if (data && data.id) {
      const before = Array.isArray(data.days_before_due) ? data.days_before_due : [];
      const after = Array.isArray(data.days_after_due) ? data.days_after_due : [];
      setDaysBefore(before.join(','));
      setSendOnDue(Boolean(data.send_on_due));
      setDaysAfter(after.join(','));
      setEnabled(Boolean(data.enabled));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-reminder-settings'] });
      setMsg({ type: 'success', text: t('paymentReminders.saved') });
      setTimeout(() => setMsg(null), 3000);
    },
    onError: () => setMsg({ type: 'error', text: t('paymentReminders.saveError') }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      days_before_due: parseNumbers(daysBefore),
      send_on_due: sendOnDue,
      days_after_due: parseNumbers(daysAfter),
      enabled,
    });
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        {t('paymentReminders.title')}
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

        <div style={{ ...fieldGroup, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label htmlFor="enabled" style={{ fontWeight: 600, fontSize: 14 }}>{t('paymentReminders.enabled')}</label>
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('paymentReminders.daysBefore')}</label>
          <input
            style={inputStyle}
            type="text"
            placeholder="7,3,1"
            value={daysBefore}
            onChange={e => setDaysBefore(e.target.value)}
          />
        </div>

        <div style={{ ...fieldGroup, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="send_on_due" checked={sendOnDue} onChange={e => setSendOnDue(e.target.checked)} />
          <label htmlFor="send_on_due" style={{ fontWeight: 600, fontSize: 14 }}>{t('paymentReminders.sendOnDue')}</label>
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>{t('paymentReminders.daysAfter')}</label>
          <input
            style={inputStyle}
            type="text"
            placeholder="1,3,7,14"
            value={daysAfter}
            onChange={e => setDaysAfter(e.target.value)}
          />
        </div>

        <button type="submit" style={saveBtn} disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </div>
  );
}
