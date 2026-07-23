// =============================================================================
// FireISP 5.0 — Client Detail extra tabs (Subscriber Profile §1.1)
// =============================================================================
// REST-backed tabs appended to ClientDetail:
//   • ProfileExtrasTab — credit score, risk rating, GPS coords, geocode action,
//     account-group assignment.
//   • CustomFieldsTab  — unlimited key/value custom fields.
//   • DocumentsTab     — ID document / photo upload (INE, passport, etc.).
//   • DuplicatesTab    — duplicate detection + account merge.
// =============================================================================

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore, authedFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { extractApiError, errorBox, inputStyle, labelStyle, submitBtn, cancelBtn, dangerBtn } from '@/components/ClientFormModal';

// ---------------------------------------------------------------------------
// Shared local styles
// ---------------------------------------------------------------------------
const cell: React.CSSProperties = { padding: '8px', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' };
const headCell: React.CSSProperties = { padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border-strong)', fontSize: '0.8rem', color: 'var(--text-secondary)' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const msg: React.CSSProperties = { padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' };
const smallBtn: React.CSSProperties = { ...cancelBtn, padding: '4px 10px' };

interface TabProps { clientId: number; canEdit: boolean; }

// ---------------------------------------------------------------------------
// Profile extras — credit score, risk, GPS, geocode, group, suspension exempt
// ---------------------------------------------------------------------------
interface ClientRaw {
  id: number;
  credit_score: number | null;
  risk_rating: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  client_group_id: number | null;
  suspension_exempt: boolean | number | null;
  suspension_exempt_reason: string | null;
  tax_exempt: boolean | number | null;
  tax_exempt_reason: string | null;
}
interface GroupRow { id: number; name: string; }

export function ProfileExtrasTab({ clientId, canEdit }: TabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data: client, isLoading } = useQuery({
    queryKey: ['client-raw', clientId],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}', { params: { path: { id: clientId } } });
      if (res.error) throw new Error('Failed to load client');
      return (res.data as { data: ClientRaw }).data;
    },
  });

  const { data: groups } = useQuery({
    queryKey: ['client-groups-options'],
    queryFn: async () => {
      const res = await api.GET('/client-groups', { params: { query: { limit: 200 } as never } });
      if (res.error) throw new Error('Failed to load groups');
      return (res.data as { data: GroupRow[] }).data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['client-raw', clientId] });
    qc.invalidateQueries({ queryKey: ['client-detail-gql', String(clientId)] });
  };

  const geocode = useMutation({
    mutationFn: async () => {
      const { error: e } = await api.POST('/clients/{id}/geocode', { params: { path: { id: clientId } }, body: {} as never });
      if (e) throw new Error(extractApiError(e, 'Geocoding failed'));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Geocoding failed'),
  });

  const assignGroup = useMutation({
    mutationFn: async (groupId: number | null) => {
      const { error: e } = await api.PUT('/clients/{id}', {
        params: { path: { id: clientId } },
        body: { client_group_id: groupId } as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to update group'));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to update group'),
  });

  const updateExemption = useMutation({
    mutationFn: async (body: { suspension_exempt: boolean; suspension_exempt_reason?: string }) => {
      const { error: e } = await api.PUT('/clients/{id}', {
        params: { path: { id: clientId } },
        body: body as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to update suspension exemption'));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to update suspension exemption'),
  });

  const updateTaxExemption = useMutation({
    mutationFn: async (body: { tax_exempt: boolean; tax_exempt_reason?: string }) => {
      const { error: e } = await api.PUT('/clients/{id}', {
        params: { path: { id: clientId } },
        body: body as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to update IVA exemption'));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to update IVA exemption'),
  });

  const [exemptReason, setExemptReason] = useState<string | null>(null);
  const [taxExemptReason, setTaxExemptReason] = useState<string | null>(null);

  if (isLoading) return <p style={msg}>Loading…</p>;
  if (!client) return <p style={msg}>No profile data.</p>;

  // Initialise exemption reasons from client data on first render
  const currentExemptReason = exemptReason ?? (client.suspension_exempt_reason || '');
  const currentTaxExemptReason = taxExemptReason ?? (client.tax_exempt_reason || '');

  const lat = client.latitude != null ? Number(client.latitude) : null;
  const lng = client.longitude != null ? Number(client.longitude) : null;
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <div style={{ padding: '0.75rem' }}>
      {error && <div style={errorBox}>{error}</div>}
      <table style={tableStyle}>
        <tbody>
          <tr>
            <td style={{ ...cell, width: 220, color: 'var(--text-secondary)' }}>Credit score</td>
            <td style={cell}>{client.credit_score ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ ...cell, color: 'var(--text-secondary)' }}>Risk rating</td>
            <td style={{ ...cell, textTransform: 'capitalize' }}>{client.risk_rating ?? 'unrated'}</td>
          </tr>
          <tr>
            <td style={{ ...cell, color: 'var(--text-secondary)' }}>GPS coordinates</td>
            <td style={cell}>
              {hasCoords ? (
                <>
                  <span style={{ fontFamily: 'monospace' }}>{lat!.toFixed(6)}, {lng!.toFixed(6)}</span>{' '}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', marginLeft: 8 }}
                  >📍 View map pin</a>
                </>
              ) : '—'}
              {canEdit && (
                <button type="button" style={{ ...smallBtn, marginLeft: 12 }} disabled={geocode.isPending}
                  onClick={() => geocode.mutate()}>
                  {geocode.isPending ? 'Geocoding…' : 'Geocode address'}
                </button>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ ...cell, color: 'var(--text-secondary)' }}>Account group</td>
            <td style={cell}>
              {canEdit ? (
                <select
                  style={{ ...inputStyle, maxWidth: 280 }}
                  value={client.client_group_id ?? ''}
                  onChange={e => assignGroup.mutate(e.target.value ? Number(e.target.value) : null)}
                  disabled={assignGroup.isPending}
                >
                  <option value="">— None —</option>
                  {(groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              ) : (
                (groups ?? []).find(g => g.id === client.client_group_id)?.name ?? '—'
              )}
            </td>
          </tr>

          {isAdmin && canEdit && (
            <>
              <tr>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>Exempt from automatic suspension (VIP)</td>
                <td style={cell}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(client.suspension_exempt)}
                      disabled={updateExemption.isPending}
                      onChange={e => updateExemption.mutate({
                        suspension_exempt: e.target.checked,
                        suspension_exempt_reason: currentExemptReason || undefined,
                      })}
                    />
                    {Boolean(client.suspension_exempt) ? 'Exempt' : 'Not exempt'}
                  </label>
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>Exemption reason</td>
                <td style={cell}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      style={{ ...inputStyle, maxWidth: 320 }}
                      type="text"
                      value={currentExemptReason}
                      placeholder="Reason for VIP exemption"
                      onChange={e => setExemptReason(e.target.value)}
                      disabled={updateExemption.isPending}
                    />
                    <button
                      type="button"
                      style={submitBtn}
                      disabled={updateExemption.isPending}
                      onClick={() => updateExemption.mutate({
                        suspension_exempt: Boolean(client.suspension_exempt),
                        suspension_exempt_reason: currentExemptReason || undefined,
                      })}
                    >
                      {updateExemption.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>IVA exempt (0% tax on invoices)</td>
                <td style={cell}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(client.tax_exempt)}
                      disabled={updateTaxExemption.isPending}
                      onChange={e => updateTaxExemption.mutate({
                        tax_exempt: e.target.checked,
                        tax_exempt_reason: currentTaxExemptReason || undefined,
                      })}
                    />
                    {Boolean(client.tax_exempt) ? 'Exempt — invoices carry 0% / Exento' : 'Taxed at the org default IVA'}
                  </label>
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, color: 'var(--text-secondary)' }}>IVA exemption reason</td>
                <td style={cell}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      style={{ ...inputStyle, maxWidth: 320 }}
                      type="text"
                      value={currentTaxExemptReason}
                      placeholder="Legal basis for the IVA exemption"
                      onChange={e => setTaxExemptReason(e.target.value)}
                      disabled={updateTaxExemption.isPending}
                    />
                    <button
                      type="button"
                      style={submitBtn}
                      disabled={updateTaxExemption.isPending}
                      onClick={() => updateTaxExemption.mutate({
                        tax_exempt: Boolean(client.tax_exempt),
                        tax_exempt_reason: currentTaxExemptReason || undefined,
                      })}
                    >
                      {updateTaxExemption.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </td>
              </tr>
            </>
          )}

          {isAdmin && !canEdit && Boolean(client.suspension_exempt) && (
            <tr>
              <td style={{ ...cell, color: 'var(--text-secondary)' }}>Suspension exemption</td>
              <td style={cell}>
                <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
                  Exempt (VIP)
                </span>
                {client.suspension_exempt_reason && (
                  <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {client.suspension_exempt_reason}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------
interface CustomField { id: number; field_key: string; field_value: string | null; }

export function CustomFieldsTab({ clientId, canEdit }: TabProps) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['client-custom-fields', clientId],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}/custom-fields', { params: { path: { id: clientId } } });
      if (res.error) throw new Error('Failed to load custom fields');
      return (res.data as { data: CustomField[] }).data;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['client-custom-fields', clientId] });

  const save = useMutation({
    mutationFn: async (vars: { field_key: string; field_value: string }) => {
      const { error: e } = await api.PUT('/clients/{id}/custom-fields', {
        params: { path: { id: clientId } },
        body: vars as never,
      });
      if (e) throw new Error(extractApiError(e, 'Failed to save field'));
    },
    onSuccess: () => { setError(''); setKey(''); setValue(''); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to save field'),
  });

  const remove = useMutation({
    mutationFn: async (k: string) => {
      const { error: e } = await api.DELETE('/clients/{id}/custom-fields/{key}', {
        params: { path: { id: clientId, key: k } },
      });
      if (e) throw new Error(extractApiError(e, 'Failed to delete field'));
    },
    onSuccess: () => refresh(),
  });

  return (
    <div style={{ padding: '0.75rem' }}>
      {error && <div style={errorBox}>{error}</div>}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 220px' }}>
            <label style={labelStyle}>Field name</label>
            <input style={inputStyle} value={key} onChange={e => setKey(e.target.value)} placeholder="e.g. gate_code" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Value</label>
            <input style={inputStyle} value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <button type="button" style={submitBtn} disabled={!key.trim() || save.isPending}
            onClick={() => save.mutate({ field_key: key.trim(), field_value: value })}>
            {save.isPending ? 'Saving…' : 'Add / Update'}
          </button>
        </div>
      )}

      {isLoading ? <p style={msg}>Loading…</p> : (
        <table style={tableStyle}>
          <thead>
            <tr><th style={headCell}>Field</th><th style={headCell}>Value</th>{canEdit && <th style={headCell} />}</tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 && (
              <tr><td style={cell} colSpan={canEdit ? 3 : 2}>No custom fields.</td></tr>
            )}
            {(data ?? []).map(f => (
              <tr key={f.id}>
                <td style={{ ...cell, fontWeight: 600 }}>{f.field_key}</td>
                <td style={cell}>{f.field_value || '—'}</td>
                {canEdit && (
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button type="button" style={{ ...dangerBtn, padding: '3px 8px' }}
                      onClick={() => remove.mutate(f.field_key)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents (ID / photo upload)
// ---------------------------------------------------------------------------
interface ClientDocument { id: number; category: string; file_name: string; file_size: number | null; mime_type: string | null; created_at: string; }

function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsTab({ clientId, canEdit }: TabProps) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['client-documents', clientId],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}/documents', { params: { path: { id: clientId } } });
      if (res.error) throw new Error('Failed to load documents');
      return (res.data as { data: ClientDocument[] }).data;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['client-documents', clientId] });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', 'client_file');
      const res = await authedFetch(`/api/v1/clients/${clientId}/documents`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        let m = 'Upload failed';
        try { const j = await res.json(); m = j?.error?.message || m; } catch { /* ignore */ }
        throw new Error(m);
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function download(doc: ClientDocument) {
    setError('');
    try {
      const token = tokenStore.getAccess();
      const res = await fetch(`/api/v1/clients/${clientId}/documents/${doc.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  const remove = useMutation({
    mutationFn: async (fileId: number) => {
      const { error: e } = await api.DELETE('/clients/{id}/documents/{fileId}', {
        params: { path: { id: clientId, fileId } },
      });
      if (e) throw new Error(extractApiError(e, 'Failed to delete document'));
    },
    onSuccess: () => refresh(),
  });

  return (
    <div style={{ padding: '0.75rem' }}>
      {error && <div style={errorBox}>{error}</div>}
      {canEdit && (
        <div style={{ marginBottom: 12 }}>
          <input ref={fileRef} type="file" onChange={handleUpload} disabled={uploading}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" />
          {uploading && <span style={{ marginLeft: 8, fontSize: '0.85rem' }}>Uploading…</span>}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Upload an ID document or photo (INE, passport, etc.). Max 20&nbsp;MB.
          </p>
        </div>
      )}

      {isLoading ? <p style={msg}>Loading…</p> : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headCell}>File</th><th style={headCell}>Type</th>
              <th style={headCell}>Size</th><th style={headCell}>Uploaded</th><th style={headCell} />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 && (
              <tr><td style={cell} colSpan={5}>No documents.</td></tr>
            )}
            {(data ?? []).map(d => (
              <tr key={d.id}>
                <td style={{ ...cell, fontWeight: 600 }}>{d.file_name}</td>
                <td style={cell}>{d.mime_type || '—'}</td>
                <td style={cell}>{formatBytes(d.file_size)}</td>
                <td style={cell}>{new Date(d.created_at).toLocaleDateString()}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...smallBtn, marginRight: 6 }} onClick={() => download(d)}>Download</button>
                  {canEdit && (
                    <button type="button" style={{ ...dangerBtn, padding: '3px 8px' }}
                      onClick={() => remove.mutate(d.id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duplicates + merge
// ---------------------------------------------------------------------------
interface DuplicateClient { id: number; name: string; email: string | null; phone: string | null; tax_id: string | null; status: string; }

export function DuplicatesTab({ clientId, canEdit }: TabProps) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [confirmMerge, setConfirmMerge] = useState<DuplicateClient | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['client-duplicates', clientId],
    queryFn: async () => {
      const res = await api.GET('/clients/{id}/duplicates', { params: { path: { id: clientId } } });
      if (res.error) throw new Error('Failed to load duplicates');
      return (res.data as { data: DuplicateClient[] }).data;
    },
  });

  const merge = useMutation({
    mutationFn: async (sourceId: number) => {
      const { error: e } = await api.POST('/clients/{id}/merge', {
        params: { path: { id: clientId } },
        body: { source_id: sourceId } as never,
      });
      if (e) throw new Error(extractApiError(e, 'Merge failed'));
    },
    onSuccess: () => {
      setError('');
      setConfirmMerge(null);
      qc.invalidateQueries({ queryKey: ['client-duplicates', clientId] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Merge failed'),
  });

  return (
    <div style={{ padding: '0.75rem' }}>
      {error && <div style={errorBox}>{error}</div>}
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0 }}>
        Other clients that share this client&apos;s email, phone, or tax ID. Merging folds the duplicate&apos;s
        contracts, invoices, payments and other records into this client, then archives the duplicate.
      </p>
      {isLoading ? <p style={msg}>Loading…</p> : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headCell}>ID</th><th style={headCell}>Name</th><th style={headCell}>Email</th>
              <th style={headCell}>Phone</th><th style={headCell}>Tax ID</th>{canEdit && <th style={headCell} />}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 && (
              <tr><td style={cell} colSpan={canEdit ? 6 : 5}>No potential duplicates found.</td></tr>
            )}
            {(data ?? []).map(d => (
              <tr key={d.id}>
                <td style={{ ...cell, fontFamily: 'monospace' }}>#{d.id}</td>
                <td style={{ ...cell, fontWeight: 600 }}>{d.name}</td>
                <td style={cell}>{d.email || '—'}</td>
                <td style={cell}>{d.phone || '—'}</td>
                <td style={{ ...cell, fontFamily: 'monospace' }}>{d.tax_id || '—'}</td>
                {canEdit && (
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button type="button" style={{ ...smallBtn }} onClick={() => setConfirmMerge(d)}>
                      Merge into this client
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmMerge && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          role="dialog" aria-modal="true" aria-label="Confirm merge">
          <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '1.5rem', width: 440, maxWidth: '92vw' }}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Merge clients?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              <strong>{confirmMerge.name}</strong> (#{confirmMerge.id}) will be merged into this client and then
              archived. This cannot be undone automatically.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button type="button" style={cancelBtn} onClick={() => setConfirmMerge(null)}>Cancel</button>
              <button type="button" style={dangerBtn} disabled={merge.isPending}
                onClick={() => merge.mutate(confirmMerge.id)}>
                {merge.isPending ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
