// =============================================================================
// FireISP 5.0 — Portal Account Settings (§11.3)
// =============================================================================
// Self-service actions: plan upgrade, Wi-Fi password, PPPoE password,
// static IP request, cancellation, visit schedule.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalTokenStore } from '@/auth/PortalAuthContext';

const API_BASE = '/api/v1/portal';

interface ServiceRequest {
  id: number;
  request_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  notes: string | null;
  proration_net: string | null;
  created_at: string;
}

async function portalFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = portalTokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message || 'Request failed');
  }
  return res.json() as Promise<T>;
}

type RequestType = 'plan_upgrade' | 'wifi_password_change' | 'pppoe_password_change'
  | 'static_ip_request' | 'cancellation' | 'visit_schedule';

const REQUEST_LABELS: Record<RequestType, string> = {
  plan_upgrade: 'Plan Upgrade',
  wifi_password_change: 'Change Wi-Fi Password',
  pppoe_password_change: 'Change PPPoE Password',
  static_ip_request: 'Request Static IP',
  cancellation: 'Request Cancellation',
  visit_schedule: 'Schedule a Visit',
};

export function PortalAccount() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'requests' | 'new'>('requests');
  const [reqType, setReqType] = useState<RequestType>('plan_upgrade');
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const { data: reqData, isLoading } = useQuery({
    queryKey: ['portal-service-requests'],
    queryFn: () => portalFetch<{ data: ServiceRequest[] }>('/service-requests?limit=50'),
  });

  const createMutation = useMutation({
    mutationFn: (body: { request_type: string; payload: Record<string, unknown> }) =>
      portalFetch<{ data: ServiceRequest }>('/service-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setMsg('Request submitted successfully.');
      setErrMsg('');
      setPayload({});
      setActiveTab('requests');
      qc.invalidateQueries({ queryKey: ['portal-service-requests'] });
    },
    onError: (e: Error) => { setErrMsg(e.message); setMsg(''); },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) =>
      portalFetch(`/service-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-service-requests'] }),
    onError: (e: Error) => {
      setErrMsg(e.message || 'Failed to cancel request. Please try again.');
      setMsg('');
    },
  });

  function handleSubmit() {
    setMsg(''); setErrMsg('');

    // Client-side required-field validation per request type
    if (reqType === 'plan_upgrade' && !payload.new_plan_id?.trim()) {
      setErrMsg('Please enter a plan ID to upgrade to.');
      return;
    }
    if ((reqType === 'wifi_password_change' || reqType === 'pppoe_password_change') && !payload.new_password?.trim()) {
      setErrMsg('Please enter a new password.');
      return;
    }
    if (reqType === 'cancellation' && !payload.reason?.trim()) {
      setErrMsg('Please provide a cancellation reason.');
      return;
    }
    if (reqType === 'visit_schedule') {
      if (!payload.preferred_date?.trim()) {
        setErrMsg('Please select a preferred date.');
        return;
      }
      if (!payload.preferred_slot?.trim()) {
        setErrMsg('Please select a preferred time slot.');
        return;
      }
    }

    createMutation.mutate({ request_type: reqType, payload: { ...payload } });
  }

  const requests = reqData?.data ?? [];

  return (
    <div>
      <h1 style={styles.heading}>Account Settings</h1>

      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'requests' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('requests')}
        >
          My Requests
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'new' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('new')}
        >
          New Request
        </button>
      </div>

      {activeTab === 'requests' && (
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>My Service Requests</h2>
          {isLoading && <p style={styles.muted}>Loading…</p>}
          {!isLoading && requests.length === 0 && (
            <p style={styles.muted}>No service requests yet.</p>
          )}
          {requests.length > 0 && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Submitted</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td style={styles.td}>{REQUEST_LABELS[r.request_type as RequestType] ?? r.request_type}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, ...badgeColor(r.status) }}>{r.status}</span>
                    </td>
                    <td style={styles.td}>{r.created_at.slice(0, 10)}</td>
                    <td style={styles.td}>
                      {r.status === 'pending' && (
                        <button
                          style={styles.cancelBtn}
                          onClick={() => cancelMutation.mutate(r.id)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {activeTab === 'new' && (
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Submit a Request</h2>

          <div style={styles.formGroup}>
            <label style={styles.label}>Request Type</label>
            <select
              value={reqType}
              onChange={e => { setReqType(e.target.value as RequestType); setPayload({}); }}
              style={styles.select}
            >
              {(Object.keys(REQUEST_LABELS) as RequestType[]).map(k => (
                <option key={k} value={k}>{REQUEST_LABELS[k]}</option>
              ))}
            </select>
          </div>

          {/* Dynamic payload fields per request type */}
          {reqType === 'plan_upgrade' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>New Plan ID</label>
              <input
                type="number"
                value={payload.new_plan_id ?? ''}
                onChange={e => setPayload(p => ({ ...p, new_plan_id: e.target.value }))}
                style={styles.input}
                placeholder="Enter plan ID to upgrade to"
              />
            </div>
          )}

          {(reqType === 'wifi_password_change' || reqType === 'pppoe_password_change') && (
            <div style={styles.formGroup}>
              <label style={styles.label}>New Password</label>
              <input
                type="password"
                value={payload.new_password ?? ''}
                onChange={e => setPayload(p => ({ ...p, new_password: e.target.value }))}
                style={styles.input}
                placeholder="Enter new password (min. 8 characters)"
                minLength={8}
              />
            </div>
          )}

          {reqType === 'static_ip_request' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Notes / Reason</label>
              <textarea
                value={payload.notes ?? ''}
                onChange={e => setPayload(p => ({ ...p, notes: e.target.value }))}
                style={styles.textarea}
                placeholder="Please describe why you need a static IP"
              />
            </div>
          )}

          {reqType === 'cancellation' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Cancellation Reason</label>
              <textarea
                value={payload.reason ?? ''}
                onChange={e => setPayload(p => ({ ...p, reason: e.target.value }))}
                style={styles.textarea}
                placeholder="Please let us know why you'd like to cancel"
              />
            </div>
          )}

          {reqType === 'visit_schedule' && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Preferred Date</label>
                <input
                  type="date"
                  value={payload.preferred_date ?? ''}
                  onChange={e => setPayload(p => ({ ...p, preferred_date: e.target.value }))}
                  style={styles.input}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Preferred Time Slot</label>
                <select
                  value={payload.preferred_slot ?? ''}
                  onChange={e => setPayload(p => ({ ...p, preferred_slot: e.target.value }))}
                  style={styles.select}
                >
                  <option value="">Select a time slot</option>
                  <option value="morning">Morning (8am – 12pm)</option>
                  <option value="afternoon">Afternoon (12pm – 5pm)</option>
                  <option value="evening">Evening (5pm – 8pm)</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Notes</label>
                <textarea
                  value={payload.notes ?? ''}
                  onChange={e => setPayload(p => ({ ...p, notes: e.target.value }))}
                  style={styles.textarea}
                  placeholder="Describe the reason for the visit"
                />
              </div>
            </>
          )}

          {msg && <p style={styles.success}>{msg}</p>}
          {errMsg && <p style={styles.error}>{errMsg}</p>}

          <button
            style={styles.submitBtn}
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </section>
      )}
    </div>
  );
}

function badgeColor(status: string): React.CSSProperties {
  switch (status) {
    case 'pending': return { background: '#fef3c7', color: '#92400e' };
    case 'approved': return { background: '#d1fae5', color: '#065f46' };
    case 'rejected': return { background: '#fee2e2', color: '#991b1b' };
    case 'completed': return { background: '#dbeafe', color: '#1e40af' };
    case 'cancelled': return { background: '#f3f4f6', color: '#6b7280' };
    default: return { background: '#f3f4f6', color: '#374151' };
  }
}

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 1rem', fontSize: '1.4rem', color: 'var(--text-primary)' },
  tabs: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' },
  tab: {
    padding: '0.4rem 0.9rem',
    border: '1px solid var(--border-strong)',
    borderRadius: 4,
    background: 'var(--bg-card)',
    cursor: 'pointer',
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
  },
  tabActive: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  card: { background: 'var(--bg-card)', borderRadius: 8, padding: '1.25rem', boxShadow: '0 0 0 1px var(--border)' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)', fontSize: '0.9rem' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.875rem' },
  th: { textAlign: 'left' as const, padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '2px solid var(--border-subtle)' },
  td: { padding: '0.5rem', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' },
  badge: { display: 'inline-block', padding: '0.15rem 0.4rem', borderRadius: 10, fontSize: '0.78rem', fontWeight: 600 },
  cancelBtn: { padding: '0.2rem 0.5rem', fontSize: '0.78rem', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 4, cursor: 'pointer', background: 'transparent' },
  formGroup: { marginBottom: '0.875rem' },
  label: { display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: 'var(--text-muted)' },
  input: { width: '100%', boxSizing: 'border-box' as const, padding: '0.45rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', background: 'var(--bg-input)', color: 'var(--text-primary)' },
  select: { width: '100%', boxSizing: 'border-box' as const, padding: '0.45rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', background: 'var(--bg-input)', color: 'var(--text-primary)' },
  textarea: { width: '100%', boxSizing: 'border-box' as const, padding: '0.45rem 0.6rem', border: '1px solid var(--input-border)', borderRadius: 4, fontSize: '0.9rem', minHeight: 80, background: 'var(--bg-input)', color: 'var(--text-primary)' },
  submitBtn: { padding: '0.5rem 1.25rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  success: { color: '#16a34a', fontSize: '0.875rem', marginBottom: '0.5rem' },
  error: { color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.5rem' },
};
