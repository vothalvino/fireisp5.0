// =============================================================================
// FireISP 5.0 — New Contract Modal (client-scoped)
// =============================================================================
// A focused "create a contract for THIS client" modal used from the client
// detail page. The client is locked (passed in), so there is no client picker.
// Creating a PPPoE contract triggers backend RADIUS provisioning + IP checks.
// =============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn,
  extractApiError,
} from '@/components/ClientFormModal';

interface Plan { id: number; name: string; }

interface CreateContractBody {
  client_id: number;
  plan_id: number;
  connection_type: string;
  start_date: string;
  billing_day?: number;
  ip_address?: string;
  price_override?: number;
  facturar: boolean;
}

async function fetchPlans(): Promise<Plan[]> {
  const res = await api.GET('/plans', { params: { query: { limit: 200 } as never } });
  if (res.error) throw new Error('Failed to load plans');
  return (res.data as unknown as { data: Plan[] }).data ?? [];
}

async function createContract(body: CreateContractBody): Promise<void> {
  const { error } = await api.POST('/contracts', { body: body as never });
  if (error) throw new Error(extractApiError(error, 'Failed to create contract'));
}

export interface NewContractModalProps {
  lockedClientId: number;
  lockedClientName?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function NewContractModal({ lockedClientId, lockedClientName, onClose, onCreated }: NewContractModalProps) {
  const TODAY = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    plan_id: '', connection_type: 'pppoe', start_date: TODAY,
    billing_day: '1', ip_address: '', price_override: '', facturar: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data: plans = [], isError: plansError } = useQuery({ queryKey: ['plans-lookup'], queryFn: fetchPlans, staleTime: 60_000 });

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.plan_id || !form.start_date) { setError('Plan and Start Date are required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await createContract({
        client_id: lockedClientId,
        plan_id: Number(form.plan_id),
        connection_type: form.connection_type,
        start_date: form.start_date,
        billing_day: form.billing_day ? Math.min(28, Math.max(1, Number(form.billing_day))) : undefined,
        ip_address: form.ip_address || undefined,
        price_override: form.price_override ? Number(form.price_override) : undefined,
        facturar: form.facturar,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contract');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="New Contract">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>New Contract</h3>
        {error && <div style={errorBox}>{error}</div>}
        {plansError && <div style={errorBox}>Failed to load plans — reopen or check your permissions.</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client</label>
          <input style={{ ...inputStyle, background: 'var(--bg-body)', color: 'var(--text-muted)' }}
            value={lockedClientName ?? `Client #${lockedClientId}`} disabled />

          <label style={labelStyle}>Plan *</label>
          <select style={inputStyle} value={form.plan_id} onChange={e => setField('plan_id', e.target.value)} required>
            <option value="">{plans.length ? '— select plan —' : '— no plans available —'}</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Connection Type</label>
              <select style={inputStyle} value={form.connection_type} onChange={e => setField('connection_type', e.target.value)}>
                <option value="pppoe">PPPoE</option>
                <option value="pppoe_dual">PPPoE Dual</option>
                <option value="static">Static</option>
                <option value="dual">Dual</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Start Date *</label>
              <input type="date" style={inputStyle} value={form.start_date} onChange={e => setField('start_date', e.target.value)} required />
            </div>
            <div>
              <label style={labelStyle}>Billing Day (1–28)</label>
              <input type="number" min={1} max={28} style={inputStyle} value={form.billing_day}
                onChange={e => setField('billing_day', e.target.value)} placeholder="e.g. 1" />
            </div>
            <div>
              <label style={labelStyle}>IP Address</label>
              <input type="text" maxLength={45} style={inputStyle} value={form.ip_address}
                onChange={e => setField('ip_address', e.target.value)} placeholder="e.g. 192.168.1.100" />
            </div>
          </div>

          <label style={labelStyle}>Price Override (blank = plan default)</label>
          <input type="number" min={0} step="0.01" style={inputStyle} value={form.price_override}
            onChange={e => setField('price_override', e.target.value)} placeholder="e.g. 350.00" />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.facturar} onChange={e => setField('facturar', e.target.checked)} />
            Generate CFDI invoice automatically
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
