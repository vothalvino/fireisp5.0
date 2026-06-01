// =============================================================================
// FireISP 5.0 — DSAR (Data Subject Access Request) Tool
// =============================================================================
// Admin page at /dsar. Operators enter a client ID to assemble every piece of
// personal data held for that client (LFPDPPP / GDPR data-subject access
// request) via GET /dsar/clients/{id}, review a summary of what was collected,
// and download the full export as a JSON document for delivery to the data
// subject. This is a read/export tool, so there are no mutations.
// =============================================================================

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DsarExport {
  meta: {
    generatedAt: string;
    requestedBy?: string;
    clientId: number;
    organizationId: number;
    version: string;
  };
  data: {
    client: { id: number; name: string; email: string | null } & Record<string, unknown>;
    contacts: unknown[];
    mxProfile: unknown | null;
    contracts: unknown[];
    invoices: unknown[];
    payments: unknown[];
    tickets: unknown[];
    connectionLogs: unknown[];
    ipAssignments: unknown[];
    aiReplyLogs: unknown[];
  };
}

// Sections of the export shown in the summary table, in display order.
const SECTIONS: { key: keyof DsarExport['data']; label: string }[] = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'connectionLogs', label: 'Connection logs' },
  { key: 'ipAssignments', label: 'IP assignments' },
  { key: 'aiReplyLogs', label: 'AI reply logs' },
];

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchDsar(id: number): Promise<DsarExport> {
  const res = await api.GET('/dsar/clients/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to assemble DSAR export');
  return res.data as unknown as DsarExport;
}

function downloadJson(payload: DsarExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dsar-client-${payload.meta.clientId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// DsarTool component
// ---------------------------------------------------------------------------

export function DsarTool() {
  const [clientId, setClientId] = useState('');

  const mutation = useMutation({
    mutationFn: (id: number) => fetchDsar(id),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(clientId.trim());
    if (!Number.isInteger(id) || id <= 0) return;
    mutation.mutate(id);
  }

  const result = mutation.data;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>🔐 Data Subject Access Request</h1>
      </div>

      <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 720 }}>
        Enter a client ID to assemble every piece of personal data held for that client within your
        organization. Use the resulting JSON document to fulfil an LFPDPPP (MX) or GDPR (EU)
        data-subject access request.
      </p>

      <form onSubmit={handleSubmit} style={{ ...styles.filterRow, alignItems: 'flex-end' }}>
        <label style={{ ...styles.filterLabel, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          Client ID
          <input
            style={{ ...styles.filterSelect, width: 160, cursor: 'text' }}
            type="number"
            min={1}
            step={1}
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="e.g. 42"
          />
        </label>
        <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending || !clientId.trim()}>
          {mutation.isPending ? 'Assembling…' : 'Assemble export'}
        </button>
        {result && (
          <button type="button" style={styles.btnSecondary} onClick={() => downloadJson(result)}>
            ⬇ Download JSON
          </button>
        )}
      </form>

      {mutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Could not assemble the export. Check the client ID and try again.
        </p>
      )}

      {result && (
        <div style={styles.tableCard}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>
              {result.data.client.name} (#{result.data.client.id})
            </strong>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {result.data.client.email || 'No email on file'} · Generated {new Date(result.meta.generatedAt).toLocaleString()} · Schema v{result.meta.version}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Section</th>
                  <th style={styles.th}>Records</th>
                </tr>
              </thead>
              <tbody>
                <tr style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 500 }}>MX fiscal profile</td>
                  <td style={styles.td}>{result.data.mxProfile ? 'Present' : '—'}</td>
                </tr>
                {SECTIONS.map(s => (
                  <tr key={s.key} style={styles.tr}>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{s.label}</td>
                    <td style={styles.td}>{(result.data[s.key] as unknown[]).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
