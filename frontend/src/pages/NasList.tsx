// =============================================================================
// FireISP 5.0 — NAS Management
// =============================================================================
// Standalone page at /nas. Lists RADIUS NAS / network access servers with a
// status filter, paginated table, and "New NAS" create modal plus per-row Edit
// and Delete (soft-delete). All mutations go through the typed `api` client +
// React Query, invalidating the ['nas'] query so the list refreshes
// automatically.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';
import { NasWireguardModal } from './NasWireguardModal';
import { Pagination } from '@/components/Pagination';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Nas {
  id: number;
  name: string;
  ip_address: string;
  ipv6_address: string | null;
  type: string | null;
  ports: number | null;
  coa_port: number | null;
  location: string | null;
  secondary_nas_id: number | null;
  health_status: string;
  last_health_check_at: string | null;
  description: string | null;
  status: string;
  api_port?: number | null;
  api_username?: string | null;
  api_use_tls?: boolean | null;
}

interface NasResponse {
  data: Nas[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface NasBody {
  name: string;
  ip_address: string;
  ipv6_address?: string;
  secret?: string;
  type?: string;
  ports?: number;
  coa_port?: number;
  location?: string;
  secondary_nas_id?: number;
  description?: string;
  status?: string;
  api_port?: number;
  api_username?: string;
  api_password?: string;
  api_use_tls?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES = ['active', 'inactive'];
const STATUS_FILTER_OPTIONS = ['', ...STATUSES];

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchNas(page: number, pageSize: number, statusFilter: string): Promise<NasResponse> {
  const query: Record<string, string | number> = { page, limit: pageSize };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/nas', { params: { query: query as never } });
  if (res.error) throw new Error('Failed to load NAS devices');
  return res.data as unknown as NasResponse;
}

async function createNas(body: NasBody): Promise<Nas | null> {
  const res = await api.POST('/nas', { body: body as never });
  if (res.error) throw new Error('Failed to create NAS');
  const d = res.data as { data?: Nas } | null;
  return d?.data ?? null;
}

async function updateNas(id: number, body: Partial<NasBody>): Promise<void> {
  const res = await api.PUT('/nas/{id}', { params: { path: { id } }, body: body as never });
  if (res.error) throw new Error('Failed to update NAS');
}

async function deleteNas(id: number): Promise<void> {
  const res = await api.DELETE('/nas/{id}', { params: { path: { id } } });
  if (res.error) throw new Error('Failed to delete NAS');
}

interface SeedBody {
  radiusAddress: string;
  authPort?: number;
  acctPort?: number;
  coaPort?: number;
  interimUpdate?: string;
  seedQueueTree?: boolean;
  queueParent?: string;
  totalDownloadMbps?: number;
  totalUploadMbps?: number;
  seedWalledGarden?: boolean;
  suspendedListName?: string;
  portalAddress?: string;
}

interface SeedStep {
  step: string;
  status: string;
  detail: string;
}

interface SeedResult {
  ok: boolean;
  host: string;
  port: number;
  tls: boolean;
  steps: SeedStep[];
}

async function seedNasDevice(id: number, body: SeedBody): Promise<SeedResult> {
  const res = (await api.POST('/nas/{id}/seed', {
    params: { path: { id } },
    body: body as never,
  })) as {
    data?: { data?: SeedResult };
    error?: { error?: { message?: string; details?: Array<{ field?: string; message?: string }> } };
  };
  if (res.error) {
    const err = res.error?.error;
    // Surface field-level validation feedback (422) instead of a bare
    // "Validation failed" so the admin knows which input the server rejected.
    const fieldMsgs = (err?.details ?? []).map((d) => d.message ?? d.field).filter(Boolean);
    const message = fieldMsgs.length
      ? `${err?.message ?? 'Validation failed'}: ${fieldMsgs.join('; ')}`
      : (err?.message ?? 'Router unreachable');
    throw new Error(message);
  }
  return res.data?.data as SeedResult;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Health badge
// ---------------------------------------------------------------------------

function HealthBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    up: { bg: '#d1fae5', color: '#065f46' },
    down: { bg: '#fee2e2', color: '#991b1b' },
    unknown: { bg: '#f3f4f6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NAS form modal (create + edit)
// ---------------------------------------------------------------------------

interface NasModalProps {
  nas: Nas | null;
  onClose: () => void;
  onSaved: () => void;
  /** Called after a successful *create* (not edit) with the newly created NAS. */
  onCreated?: (nas: Nas) => void;
}

function NasModal({ nas, onClose, onSaved, onCreated }: NasModalProps) {
  const isEdit = nas !== null;
  const [form, setForm] = useState({
    name: nas?.name ?? '',
    ip_address: nas?.ip_address ?? '',
    ipv6_address: nas?.ipv6_address ?? '',
    secret: '',
    type: nas?.type ?? '',
    ports: nas?.ports != null ? String(nas.ports) : '',
    coa_port: nas?.coa_port != null ? String(nas.coa_port) : '3799',
    location: nas?.location ?? '',
    secondary_nas_id: nas?.secondary_nas_id != null ? String(nas.secondary_nas_id) : '',
    description: nas?.description ?? '',
    status: nas?.status ?? 'active',
    api_port: nas?.api_port != null ? String(nas.api_port) : '8728',
    api_username: nas?.api_username ?? '',
    api_password: '',
    api_use_tls: nas?.api_use_tls ?? false,
  });
  const [error, setError] = useState('');

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: async (): Promise<Nas | null> => {
      const body: NasBody = {
        name: form.name.trim(),
        ip_address: form.ip_address.trim(),
        status: form.status,
      };
      if (form.ipv6_address) body.ipv6_address = form.ipv6_address.trim();
      if (form.secret) body.secret = form.secret;
      if (form.type) body.type = form.type.trim();
      if (form.ports) body.ports = Number(form.ports);
      if (form.coa_port) body.coa_port = Number(form.coa_port);
      if (form.location) body.location = form.location.trim();
      if (form.secondary_nas_id) body.secondary_nas_id = Number(form.secondary_nas_id);
      if (form.description) body.description = form.description;
      if (form.api_port) body.api_port = Number(form.api_port);
      if (form.api_username) body.api_username = form.api_username.trim();
      if (form.api_password) body.api_password = form.api_password;
      body.api_use_tls = form.api_use_tls;
      if (isEdit) { await updateNas(nas.id, body); return null; }
      return createNas(body);
    },
    onSuccess: (result) => {
      onSaved();
      onClose();
      if (result) onCreated?.(result);
    },
    onError: () => setError('Failed to save NAS. Check all fields and try again.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.ip_address.trim()) {
      setError('Name and IP address are required.');
      return;
    }
    if (!isEdit && !form.secret) {
      setError('RADIUS shared secret is required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit NAS ${nas.name}` : 'New NAS'}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{isEdit ? `Edit NAS #${nas.id}` : 'New NAS'}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <label style={modalStyles.label}>
            Name <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              required
            />
          </label>

          <label style={modalStyles.label}>
            IP Address (IPv4) <RequiredMark />
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.ip_address}
              onChange={e => setField('ip_address', e.target.value)}
              placeholder="e.g. 10.0.0.1"
              required
            />
          </label>

          <label style={modalStyles.label}>
            IPv6 Address
            <input
              style={modalStyles.input}
              type="text"
              maxLength={45}
              value={form.ipv6_address}
              onChange={e => setField('ipv6_address', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            RADIUS Shared Secret {!isEdit && <RequiredMark />}
            <input
              style={modalStyles.input}
              type="password"
              maxLength={255}
              value={form.secret}
              onChange={e => setField('secret', e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep current secret' : ''}
              autoComplete="new-password"
            />
          </label>

          <label style={modalStyles.label}>
            Type
            <input
              style={modalStyles.input}
              type="text"
              maxLength={50}
              value={form.type}
              onChange={e => setField('type', e.target.value)}
              placeholder="e.g. mikrotik, cisco, ubiquiti"
            />
          </label>

          <label style={modalStyles.label}>
            Ports
            <input
              style={modalStyles.input}
              type="number"
              min={0}
              value={form.ports}
              onChange={e => setField('ports', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            CoA Port
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              max={65535}
              value={form.coa_port}
              onChange={e => setField('coa_port', e.target.value)}
              aria-label="CoA Port"
            />
          </label>

          <label style={modalStyles.label}>
            Location
            <input
              style={modalStyles.input}
              type="text"
              maxLength={200}
              value={form.location}
              onChange={e => setField('location', e.target.value)}
              aria-label="Location"
            />
          </label>

          <label style={modalStyles.label}>
            Failover NAS ID
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              value={form.secondary_nas_id}
              onChange={e => setField('secondary_nas_id', e.target.value)}
              aria-label="Failover NAS ID"
            />
          </label>

          <label style={modalStyles.label}>
            Description
            <textarea
              style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
              maxLength={5000}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </label>

          <label style={modalStyles.label}>
            Status
            <select
              style={modalStyles.select}
              value={form.status}
              onChange={e => setField('status', e.target.value)}
            >
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </label>

          <label style={modalStyles.label}>
            RouterOS API Port
            <input
              style={modalStyles.input}
              type="number"
              min={1}
              max={65535}
              value={form.api_port}
              onChange={e => setField('api_port', e.target.value)}
              placeholder="8728"
              aria-label="RouterOS API Port"
            />
          </label>

          <label style={modalStyles.label}>
            RouterOS API Username
            <input
              style={modalStyles.input}
              type="text"
              maxLength={128}
              value={form.api_username}
              onChange={e => setField('api_username', e.target.value)}
              autoComplete="off"
            />
          </label>

          <label style={modalStyles.label}>
            RouterOS API Password
            <input
              style={modalStyles.input}
              type="password"
              maxLength={255}
              value={form.api_password}
              onChange={e => setField('api_password', e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
            />
          </label>

          <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.api_use_tls}
              onChange={e => {
                const on = e.target.checked;
                setField('api_use_tls', on);
                // Nudge the port to the api-ssl default (8729) when enabling TLS
                // if it's still on the plain-API default (8728).
                if (on && form.api_port === '8728') setField('api_port', '8729');
              }}
              aria-label="Use TLS for RouterOS API"
            />
            Use TLS for RouterOS API
          </label>

          {error && <p style={modalStyles.error}>{error}</p>}

          <div style={modalStyles.actions}>
            <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
              Cancel
            </button>
            <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create NAS'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div style={modalStyles.backdrop} onClick={onCancel}>
      <div
        style={{ ...modalStyles.panel, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm action"
      >
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{message}</p>
        <div style={modalStyles.actions}>
          <button onClick={onCancel} style={styles.btnSecondary}>No, go back</button>
          <button onClick={onConfirm} style={styles.btnDanger}>Yes, confirm</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seed modal — one-click RouterOS bootstrap (RADIUS + PPP AAA + CoA, optional
// queue tree + walled garden). Idempotent on the device, so safe to re-run.
// ---------------------------------------------------------------------------

const SEED_STEP_COLORS: Record<string, { bg: string; color: string }> = {
  created: { bg: '#d1fae5', color: '#065f46' },
  updated: { bg: '#dbeafe', color: '#1e40af' },
  unchanged: { bg: '#f3f4f6', color: '#374151' },
  skipped: { bg: '#f3f4f6', color: '#374151' },
  error: { bg: '#fee2e2', color: '#991b1b' },
};

interface SeedModalProps {
  nas: Nas;
  onClose: () => void;
}

function SeedModal({ nas, onClose }: SeedModalProps) {
  const [form, setForm] = useState({
    // The router must reach FireISP's RADIUS at a routable address. Default to the
    // host the admin is browsing — usually correct; editable for split DNS / NAT.
    radiusAddress: window.location.hostname,
    authPort: '1812',
    acctPort: '1813',
    coaPort: nas.coa_port != null ? String(nas.coa_port) : '3799',
    interimUpdate: '5m',
    seedQueueTree: false,
    queueParent: 'global',
    totalDownloadMbps: '',
    totalUploadMbps: '',
    seedWalledGarden: false,
    suspendedListName: 'fireisp-suspended',
    portalAddress: '',
  });
  const [error, setError] = useState('');
  const [result, setResult] = useState<SeedResult | null>(null);

  function setField(name: string, value: unknown) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: SeedBody = { radiusAddress: form.radiusAddress.trim() };
      if (form.authPort) body.authPort = Number(form.authPort);
      if (form.acctPort) body.acctPort = Number(form.acctPort);
      if (form.coaPort) body.coaPort = Number(form.coaPort);
      if (form.interimUpdate) body.interimUpdate = form.interimUpdate.trim();
      body.seedQueueTree = form.seedQueueTree;
      if (form.seedQueueTree) {
        if (form.queueParent) body.queueParent = form.queueParent.trim();
        if (form.totalDownloadMbps) body.totalDownloadMbps = Number(form.totalDownloadMbps);
        if (form.totalUploadMbps) body.totalUploadMbps = Number(form.totalUploadMbps);
      }
      body.seedWalledGarden = form.seedWalledGarden;
      if (form.seedWalledGarden) {
        if (form.suspendedListName) body.suspendedListName = form.suspendedListName.trim();
        if (form.portalAddress) body.portalAddress = form.portalAddress.trim();
      }
      return seedNasDevice(nas.id, body);
    },
    onSuccess: (res) => {
      setResult(res);
      setError('');
    },
    onError: (e: unknown) => {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Seeding failed. Check the API connection and try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.radiusAddress.trim()) {
      setError('FireISP RADIUS address is required.');
      return;
    }
    setError('');
    mutation.mutate();
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        style={modalStyles.panel}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Seed NAS ${nas.name}`}
      >
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>Seed NAS #{nas.id} — {nas.name}</h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {result ? (
          <div style={modalStyles.form}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: result.ok ? '#065f46' : '#991b1b' }}>
              {result.ok ? '✓ Seed completed' : '⚠ Seed completed with errors'} — {result.host}:{result.port}{result.tls ? ' (TLS)' : ''}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {result.steps.map((s, i) => {
                const c = SEED_STEP_COLORS[s.status] ?? SEED_STEP_COLORS.skipped;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.82rem' }}>
                    <span
                      style={{
                        background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12,
                        fontWeight: 600, fontSize: '0.7rem', textTransform: 'capitalize', whiteSpace: 'nowrap',
                        minWidth: 64, textAlign: 'center',
                      }}
                    >
                      {s.status}
                    </span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      <strong>{s.step}</strong> — {s.detail}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={modalStyles.actions}>
              <button type="button" onClick={() => setResult(null)} style={styles.btnSecondary}>
                Run again
              </button>
              <button type="button" onClick={onClose} style={styles.btnPrimary}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={modalStyles.form}>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Pushes the FireISP RADIUS client, PPP AAA and CoA listener to this MikroTik over its
              RouterOS API. Idempotent — safe to re-run. The NAS shared secret is used automatically.
            </p>

            <label style={modalStyles.label}>
              FireISP RADIUS Address <RequiredMark />
              <input
                style={modalStyles.input}
                type="text"
                maxLength={255}
                value={form.radiusAddress}
                onChange={e => setField('radiusAddress', e.target.value)}
                placeholder="e.g. radius.myisp.net or 203.0.113.10"
                required
              />
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...modalStyles.label, flex: 1 }}>
                Auth Port
                <input style={modalStyles.input} type="number" min={1} max={65535}
                  value={form.authPort} onChange={e => setField('authPort', e.target.value)} aria-label="Auth Port" />
              </label>
              <label style={{ ...modalStyles.label, flex: 1 }}>
                Acct Port
                <input style={modalStyles.input} type="number" min={1} max={65535}
                  value={form.acctPort} onChange={e => setField('acctPort', e.target.value)} aria-label="Accounting Port" />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...modalStyles.label, flex: 1 }}>
                CoA Port
                <input style={modalStyles.input} type="number" min={1} max={65535}
                  value={form.coaPort} onChange={e => setField('coaPort', e.target.value)} aria-label="CoA Port" />
              </label>
              <label style={{ ...modalStyles.label, flex: 1 }}>
                Interim-Update
                <input style={modalStyles.input} type="text" maxLength={16}
                  value={form.interimUpdate} onChange={e => setField('interimUpdate', e.target.value)}
                  placeholder="5m" aria-label="Interim Update" />
              </label>
            </div>

            <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.seedQueueTree}
                onChange={e => setField('seedQueueTree', e.target.checked)} aria-label="Seed queue tree" />
              Seed global queue-tree skeleton
            </label>
            {form.seedQueueTree && (
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  Parent
                  <input style={modalStyles.input} type="text" maxLength={64}
                    value={form.queueParent} onChange={e => setField('queueParent', e.target.value)}
                    placeholder="global" aria-label="Queue parent" />
                </label>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  Total Down (Mbps)
                  <input style={modalStyles.input} type="number" min={0}
                    value={form.totalDownloadMbps} onChange={e => setField('totalDownloadMbps', e.target.value)}
                    aria-label="Total download Mbps" />
                </label>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  Total Up (Mbps)
                  <input style={modalStyles.input} type="number" min={0}
                    value={form.totalUploadMbps} onChange={e => setField('totalUploadMbps', e.target.value)}
                    aria-label="Total upload Mbps" />
                </label>
              </div>
            )}

            <label style={{ ...modalStyles.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.seedWalledGarden}
                onChange={e => setField('seedWalledGarden', e.target.checked)} aria-label="Seed walled garden" />
              Seed suspended-user walled garden
            </label>
            {form.seedWalledGarden && (
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  Suspended Address-List
                  <input style={modalStyles.input} type="text" maxLength={64}
                    value={form.suspendedListName} onChange={e => setField('suspendedListName', e.target.value)}
                    placeholder="fireisp-suspended" aria-label="Suspended address list" />
                </label>
                <label style={{ ...modalStyles.label, flex: 1 }}>
                  Portal Address (optional)
                  <input style={modalStyles.input} type="text" maxLength={255}
                    value={form.portalAddress} onChange={e => setField('portalAddress', e.target.value)}
                    placeholder="redirect target (disabled rule)" aria-label="Portal address" />
                </label>
              </div>
            )}

            {error && <p style={modalStyles.error}>{error}</p>}

            <div style={modalStyles.actions}>
              <button type="button" onClick={onClose} style={styles.btnSecondary} disabled={mutation.isPending}>
                Cancel
              </button>
              <button type="submit" style={styles.btnPrimary} disabled={mutation.isPending}>
                {mutation.isPending ? 'Seeding...' : 'Seed Device'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NasList component
// ---------------------------------------------------------------------------

export function NasList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editNas, setEditNas] = useState<Nas | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [seedNasTarget, setSeedNasTarget] = useState<Nas | null>(null);
  const [wgNasTarget, setWgNasTarget] = useState<Nas | null>(null);

  const nasQ = useQuery({
    queryKey: ['nas', page, pageSize, statusFilter],
    queryFn: () => fetchNas(page, pageSize, statusFilter),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteNas(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nas'] }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['nas'] });
  }

  function handleFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  async function handleTestConnection(id: number) {
    setTestingId(id);
    try {
      const res = (await api.POST('/nas/{id}/test-connection', { params: { path: { id } } })) as {
        data?: { data?: Record<string, unknown> };
        error?: { error?: { message?: string } };
      };
      if (res.error) {
        alert(`Connection failed: ${res.error?.error?.message ?? 'Router unreachable'}`);
        return;
      }
      const data = res.data?.data ?? {};
      // Use `||` not `??`: the service returns '' (empty string, not null) for an
      // attribute it couldn't parse, and we want the dash for those too.
      const version = data.version || '—';
      const board = data.boardName || '—';
      const identity = data.identity || '—';
      alert(`Connection OK\nVersion: ${version}\nBoard: ${board}\nIdentity: ${identity}`);
    } catch {
      alert('Connection failed: request error.');
    } finally {
      setTestingId(null);
    }
  }

  const devices = nasQ.data?.data ?? [];
  const meta = nasQ.data?.meta;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>NAS Devices</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowNew(true)}>
          + New NAS
        </button>
      </div>

      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Status:</label>
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map(s => (
            <option key={s} value={s}>{s ? capitalize(s) : 'All'}</option>
          ))}
        </select>
        {statusFilter && (
          <button type="button" style={styles.btnSecondary} onClick={() => handleFilterChange('')}>
            Clear filter
          </button>
        )}
      </div>

      {deleteMutation.isError && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Action failed. Please try again.
        </p>
      )}

      <div style={styles.tableCard}>
        {nasQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : nasQ.error ? (
          <p style={styles.msgError}>Failed to load NAS devices.</p>
        ) : devices.length === 0 ? (
          <p style={styles.msg}>No NAS devices found{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['ID', 'Name', 'IP Address', 'Type', 'Ports', 'CoA Port', 'Health', 'Last Check', 'Status', 'Actions'].map(
                      h => <th key={h} style={styles.th}>{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(n => (
                    <tr key={n.id} style={styles.tr}>
                      <td style={styles.td}>#{n.id}</td>
                      <td style={{ ...styles.td, fontWeight: 500 }}>{n.name}</td>
                      <td style={styles.td}>{n.ip_address}</td>
                      <td style={styles.td}>{n.type ?? '—'}</td>
                      <td style={styles.td}>{n.ports ?? '—'}</td>
                      <td style={styles.td}>{n.coa_port ?? '—'}</td>
                      <td style={styles.td}><HealthBadge status={n.health_status} /></td>
                      <td style={styles.td}>
                        {n.last_health_check_at
                          ? new Date(n.last_health_check_at).toLocaleString()
                          : '—'}
                      </td>
                      <td style={styles.td}><StatusBadge status={n.status} /></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <button
                          style={styles.actionBtn}
                          onClick={() => handleTestConnection(n.id)}
                          disabled={testingId === n.id}
                          title="Test RouterOS API connection"
                        >
                          {testingId === n.id ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          style={styles.actionBtn}
                          onClick={() => setSeedNasTarget(n)}
                          title="Seed RADIUS, PPP AAA, CoA + optional QoS/walled-garden onto this MikroTik"
                        >
                          Seed
                        </button>
                        <button
                          style={styles.actionBtn}
                          onClick={() => setWgNasTarget(n)}
                          title="Configure WireGuard tunnel for this NAS"
                        >
                          WG
                        </button>
                        <Link to={`/nas/${n.id}`} style={{ ...styles.actionBtn, textDecoration: 'none', display: 'inline-block' }}>
                          View
                        </Link>
                        <button style={styles.actionBtn} onClick={() => setEditNas(n)} title="Edit this NAS">
                          Edit
                        </button>
                        <button
                          style={{ ...styles.actionBtn, color: '#991b1b' }}
                          onClick={() => setDeleteId(n.id)}
                          title="Delete this NAS"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={meta?.totalPages ?? 1}
              total={meta?.total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </>
        )}
      </div>

      {showNew && (
        <NasModal
          nas={null}
          onClose={() => setShowNew(false)}
          onSaved={invalidate}
          onCreated={(nas) => setWgNasTarget(nas)}
        />
      )}
      {editNas && <NasModal nas={editNas} onClose={() => setEditNas(null)} onSaved={invalidate} />}
      {seedNasTarget && <SeedModal nas={seedNasTarget} onClose={() => setSeedNasTarget(null)} />}
      {wgNasTarget && (
        <NasWireguardModal nas={wgNasTarget} onClose={() => setWgNasTarget(null)} />
      )}

      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this NAS? It will be soft-deleted and removed from the list."
          onConfirm={() => {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
