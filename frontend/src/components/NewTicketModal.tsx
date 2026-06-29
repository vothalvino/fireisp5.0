// =============================================================================
// FireISP 5.0 — New Ticket Modal (client-scoped)
// =============================================================================
// A focused "open a ticket for THIS client" modal used from the client detail
// page. The client is locked (passed in), so there is no client picker.
// Assignment is left to the ticket page; this is a quick-create.
// =============================================================================

import { useState } from 'react';
import { api } from '@/api/client';
import {
  overlay, modalBox, errorBox, labelStyle, inputStyle, submitBtn, cancelBtn,
  extractApiError,
} from '@/components/ClientFormModal';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

interface CreateTicketBody {
  subject: string;
  client_id: number;
  description?: string;
  priority?: string;
  category?: string;
  status?: string;
}

async function createTicket(body: CreateTicketBody): Promise<void> {
  const { error } = await api.POST('/tickets', { body: body as never });
  if (error) throw new Error(extractApiError(error, 'Failed to create ticket'));
}

export interface NewTicketModalProps {
  lockedClientId: number;
  lockedClientName?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function NewTicketModal({ lockedClientId, lockedClientName, onClose, onCreated }: NewTicketModalProps) {
  const [form, setForm] = useState({
    subject: '', description: '', priority: 'medium', category: '', status: 'open',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) { setError('Subject is required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const body: CreateTicketBody = { subject: form.subject.trim(), client_id: lockedClientId };
      if (form.description.trim()) body.description = form.description.trim();
      if (form.priority) body.priority = form.priority;
      if (form.category.trim()) body.category = form.category.trim();
      if (form.status) body.status = form.status;
      await createTicket(body);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="New Ticket">
      <div style={{ ...modalBox, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>New Ticket</h3>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Client</label>
          <input style={{ ...inputStyle, background: 'var(--bg-body)', color: 'var(--text-muted)' }}
            value={lockedClientName ?? `Client #${lockedClientId}`} disabled />

          <label style={labelStyle}>Subject *</label>
          <input style={inputStyle} value={form.subject} onChange={set('subject')}
            placeholder="Brief description of the issue" required />

          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            value={form.description} onChange={set('description')} placeholder="Detailed description (optional)" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={set('status')}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
              </select>
            </div>
          </div>

          <label style={labelStyle}>Category</label>
          <input style={inputStyle} value={form.category} onChange={set('category')}
            placeholder="e.g. connectivity, billing, hardware" />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={submitBtn} disabled={submitting || !form.subject.trim()}>
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
