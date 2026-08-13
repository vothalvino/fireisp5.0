// =============================================================================
// FireISP 5.0 — Contract Detail
// =============================================================================
// Shows a single contract with tabbed sub-sections:
//   Invoices | Devices | Add-ons
//
// Mirrors ClientDetail's structure: single GraphQL query, loading/not-found
// states, breadcrumb, header with StatusBadge, info card, and tab bar.
// Action buttons (Renew / Suspend / Unsuspend / Terminate) call the existing
// REST endpoints via postContractAction (same helper as ContractList).
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { gql } from '@/api/graphql';
import { api, authedFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { MarkdownView } from '@/components/MarkdownView';
import {
  CommunicationOptInFields,
  type CommunicationContacts,
  type CommunicationOptIns,
  type SigningPrivacyNotice,
} from '@/components/CommunicationOptInFields';
import {
  overlay, modalBox, cancelBtn, dangerBtn, inputStyle, labelStyle, submitBtn,
} from '@/components/ClientFormModal';
import {
  MxContractEnvironmentBadge,
  MxSandboxDocumentBanner,
  type MxContractEnvironment,
} from '@/components/MxContractEnvironment';

// ---------------------------------------------------------------------------
// GraphQL query — fetches the contract + all sub-resources in one request
// ---------------------------------------------------------------------------

const CONTRACT_DETAIL_QUERY = /* GraphQL */ `
  query ContractDetail($id: ID!) {
    contract(id: $id) {
      id
      clientId
      planId
      connectionType
      startDate
      endDate
      billingDay
      status
      ipAddress
      priceOverride
      mxContractEnvironment
      notes
      createdAt
      client {
        id
        name
        status
      }
      invoices {
        id
        invoiceNumber
        total
        currency
        dueDate
        paidAt
        status
      }
      devices {
        id
        name
        type
        manufacturer
        model
        macAddress
        ipAddress
        status
      }
      addons {
        id
        addonName
        addonType
        quantity
        unitPrice
        startDate
        endDate
        status
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContractClient {
  id: string;
  name: string;
  status: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string | null;
  paidAt: string | null;
  status: string;
}

interface Device {
  id: string;
  name: string;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  status: string;
}

interface ContractAddon {
  id: string;
  addonName: string | null;
  addonType: string | null;
  quantity: string | null;
  unitPrice: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

interface Contract {
  id: string;
  clientId: string;
  planId: string | null;
  connectionType: string | null;
  startDate: string | null;
  endDate: string | null;
  billingDay: number | null;
  status: string;
  ipAddress: string | null;
  priceOverride: string | null;
  mxContractEnvironment?: MxContractEnvironment | null;
  notes: string | null;
  createdAt: string;
  client: ContractClient | null;
  invoices: Invoice[];
  devices: Device[];
  addons: ContractAddon[];
}

// ---------------------------------------------------------------------------
// Fetch helper (single GraphQL query)
// ---------------------------------------------------------------------------

async function fetchContractDetail(id: string): Promise<Contract> {
  const data = await gql<{ contract: Contract | null }>(CONTRACT_DETAIL_QUERY, { id });
  if (!data.contract) throw new Error('Contract not found');
  return data.contract;
}

// ---------------------------------------------------------------------------
// REST action helper (mirrors ContractList.postContractAction)
// ---------------------------------------------------------------------------

const API_BASE = '/api/v1';

interface ContractActionResult {
  status?: string;
  activation_required?: boolean;
  network_activation?: {
    nas_pushed?: boolean;
    nas_push_error?: string | null;
  } | null;
}

async function postContractAction(
  id: string,
  action: 'suspend' | 'unsuspend' | 'renew' | 'terminate',
): Promise<ContractActionResult> {
  const res = await authedFetch(`${API_BASE}/contracts/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to ${action} contract`);
  const payload = await res.json().catch(() => ({})) as {
    data?: ContractActionResult;
    network_activation?: ContractActionResult['network_activation'];
  };
  return { ...(payload.data ?? {}), network_activation: payload.network_activation ?? null };
}

// ---------------------------------------------------------------------------
// PPPoE credential helpers
// ---------------------------------------------------------------------------

// The base endpoint (GET /radius/contract/{contractId}, requires devices.view)
// never includes `password` — it is layered on separately from the
// /credentials endpoint (requires radius.credentials.view) so staff who
// provision routers keep seeing it, while a pure view-only role does not.
interface RadiusAccount {
  id: number;
  username: string;
  password?: string;
  status: string | null;
}

async function fetchRadiusAccounts(contractId: string): Promise<RadiusAccount[]> {
  const res = await api.GET('/radius/contract/{contractId}' as never, {
    params: { path: { contractId: Number(contractId) } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load PPPoE account');
  const d = (res as { data: unknown }).data as { data?: RadiusAccount[] } | RadiusAccount[];
  return Array.isArray(d) ? d : d.data ?? [];
}

// Sentinel thrown by fetchRadiusCredentials so the UI can replace just the
// password field with an "insufficient permission" note instead of hiding
// the whole account (which fetchRadiusAccounts above already made visible).
const RADIUS_CREDENTIALS_FORBIDDEN = 'radius_credentials_forbidden';

async function fetchRadiusCredentials(contractId: string): Promise<RadiusAccount[]> {
  const res = await api.GET('/radius/contract/{contractId}/credentials' as never, {
    params: { path: { contractId: Number(contractId) } },
  } as never);
  const { error, response } = res as unknown as { error: unknown; response: { status: number } };
  if (error) {
    if (response?.status === 401 || response?.status === 403) {
      throw new Error(RADIUS_CREDENTIALS_FORBIDDEN);
    }
    throw new Error('Failed to load PPPoE credentials');
  }
  const d = (res as { data: unknown }).data as { data?: RadiusAccount[] } | RadiusAccount[];
  return Array.isArray(d) ? d : d.data ?? [];
}

async function regeneratePppoe(id: string): Promise<{ username: string; password: string; pushed: boolean }> {
  const res = await authedFetch(`${API_BASE}/contracts/${id}/regenerate-pppoe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let msg = 'Failed to regenerate PPPoE credentials';
    try { const j = await res.json(); msg = j?.error?.message ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return { username: j.data.username, password: j.data.password, pushed: Boolean(j.pushed) };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  // GraphQL serialises DATETIME columns via Date.valueOf() to an epoch-millis
  // STRING (e.g. "1779165933000"); REST returns ISO. Handle both, then guard an
  // unparseable value (which previously rendered the literal "Invalid Date").
  const s = String(dateStr).trim();
  const n = Number(s);
  const d = /^\d{10,}$/.test(s) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtMoney(amount: string | null, currency = 'MXN'): string {
  if (!amount) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(parseFloat(amount));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:     { bg: '#d1fae5', color: '#065f46' },
    paid:       { bg: '#d1fae5', color: '#065f46' },
    pending:    { bg: '#ede9fe', color: '#5b21b6' },
    suspended:  { bg: '#fef3c7', color: '#92400e' },
    overdue:    { bg: '#fee2e2', color: '#991b1b' },
    cancelled:  { bg: '#fee2e2', color: '#991b1b' },
    terminated: { bg: '#f3f4f6', color: '#6b7280' },
    expired:    { bg: '#fde68a', color: '#78350f' },
    failed:     { bg: '#fee2e2', color: '#991b1b' },
    draft:      { bg: '#f3f4f6', color: '#6b7280' },
    inactive:   { bg: '#f3f4f6', color: '#6b7280' },
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
// Tab types
// ---------------------------------------------------------------------------

type TabId = 'pppoe' | 'invoices' | 'devices' | 'addons';

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'devices',  label: 'Devices' },
  { id: 'addons',   label: 'Add-ons' },
];

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function InvoicesTab({ invoices }: { invoices: Invoice[] }) {
  if (!invoices.length) return <p style={styles.msg}>No invoices found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Invoice #', 'Total', 'Due Date', 'Paid At', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={styles.tr}>
              <td style={styles.td}>
                <Link to={`/invoices/${inv.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(inv.total, inv.currency)}
              </td>
              <td style={styles.td}>{fmt(inv.dueDate)}</td>
              <td style={styles.td}>{fmt(inv.paidAt)}</td>
              <td style={styles.td}><StatusBadge status={inv.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Devices are linked to a contract via devices.contract_id (PUT /devices/:id).
// This tab both lists the linked devices AND lets a devices.update user assign/
// unassign them — previously it was display-only and there was NO UI anywhere
// that could set contract_id, so "add device to contract" was impossible.
interface OrgDevice {
  id: number;
  name: string;
  type: string | null;
  contract_id: number | null;
  client_id: number | null;
}

// Serialized units installed on this contract (cpe_devices, inventory Phase 3 /
// TR-069). The install flow and the ACS both set contract_id, so this section
// populates AUTOMATICALLY as equipment moves through the subscriber flow —
// no manual device bookkeeping required to see the router on the contract.
interface InstalledUnit {
  id: number;
  serial_number: string;
  manufacturer: string | null;
  product_class: string | null;
  ownership: string | null;
  lifecycle_state: string | null;
  last_inform_at: string | null;
  item_name: string | null;
  item_sku: string | null;
}

const DEVICE_TYPES = ['outdoor_cpe', 'indoor_cpe', 'ptp', 'ptmp_ap', 'olt', 'router', 'switch', 'onu', 'other'];

// ---------------------------------------------------------------------------
// Install equipment — the INVENTORY-connected path, same drawdown flow as the
// service-order Equipment panel (POST /cpe-management/devices/install): stock
// decrements, the ledger records the movement, a sold unit raises its sale
// invoice, and the unit's TR-069 identity converges on the serial. Distinct
// from "+ New network device", which only creates a monitoring/topology row.
// ---------------------------------------------------------------------------
interface CatalogItem { id: number; name: string; sku: string | null }
interface InStockUnit { id: number; serial_number: string }

function InstallEquipmentModal({ contractId, onClose, onInstalled }: {
  contractId: string; onClose: () => void; onInstalled: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [serialMode, setSerialMode] = useState<'existing' | 'new'>('existing');
  const [cpeDeviceId, setCpeDeviceId] = useState('');
  const [newSerial, setNewSerial] = useState('');
  const [ownership, setOwnership] = useState<'rented' | 'sold'>('rented');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const itemsQ = useQuery({
    queryKey: ['inventory-items-lookup-contract'],
    queryFn: async () => {
      const res = await api.GET('/inventory/items' as never, { params: { query: { limit: 200, status: 'active' } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('load failed');
      return (((res as { data: { data: CatalogItem[] } }).data?.data) ?? []);
    },
  });

  const unitsQ = useQuery({
    queryKey: ['contract-in-stock-units', itemId],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { inventory_item_id: Number(itemId), lifecycle_state: 'in_stock', limit: 200 } },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('load failed');
      return (((res as { data: { data: InStockUnit[] } }).data?.data) ?? []);
    },
    enabled: itemId !== '' && serialMode === 'existing',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const body: Record<string, unknown> = { contract_id: Number(contractId), ownership };
    if (serialMode === 'existing') {
      if (!cpeDeviceId) { setErr('Select a serial.'); return; }
      body.cpe_device_id = Number(cpeDeviceId);
    } else {
      if (!itemId) { setErr('Select a product.'); return; }
      if (!newSerial.trim()) { setErr('Enter a serial number.'); return; }
      body.new_serial = newSerial.trim();
      body.inventory_item_id = Number(itemId);
    }
    setBusy(true);
    try {
      const res = await api.POST('/cpe-management/devices/install' as never, { body: body as never } as never);
      const e2 = (res as { error?: { error?: { message?: string } } }).error;
      if (e2) throw new Error(e2.error?.message || 'Failed to install equipment');
      onInstalled();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed to install equipment');
    } finally {
      setBusy(false);
    }
  }

  const selStyle = { display: 'block', width: '100%', marginTop: 2, padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit' } as const;

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Install equipment">
      <div style={{ ...modalBox, width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Install equipment — contract #{contractId}</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Draws the unit from inventory: stock and ledger update, a sold unit raises its invoice, and TR-069 links by serial.
        </p>
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem' }}>
            Product
            <select style={selStyle} value={itemId} onChange={e => { setItemId(e.target.value); setCpeDeviceId(''); }}>
              <option value="">{itemsQ.isLoading ? 'Loading…' : '— select product —'}</option>
              {(itemsQ.data ?? []).map(i => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: '0.85rem' }}>
            <label><input type="radio" checked={serialMode === 'existing'} onChange={() => setSerialMode('existing')} /> Pick in-stock serial</label>
            <label><input type="radio" checked={serialMode === 'new'} onChange={() => setSerialMode('new')} /> Type a new serial</label>
          </div>
          {serialMode === 'existing' ? (
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem' }}>
              Serial
              <select style={selStyle} value={cpeDeviceId} onChange={e => setCpeDeviceId(e.target.value)} disabled={!itemId}>
                <option value="">{!itemId ? '— select a product first —' : unitsQ.isLoading ? 'Loading…' : (unitsQ.data ?? []).length ? '— select serial —' : 'No in-stock serials for this product'}</option>
                {(unitsQ.data ?? []).map(u => <option key={u.id} value={u.id}>{u.serial_number}</option>)}
              </select>
            </label>
          ) : (
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem' }}>
              New serial number
              <input style={selStyle} value={newSerial} placeholder="Read from the box"
                onChange={e => setNewSerial(e.target.value)} />
            </label>
          )}
          <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: '0.85rem' }}>
            <label><input type="radio" checked={ownership === 'rented'} onChange={() => setOwnership('rented')} /> Rented (no invoice)</label>
            <label><input type="radio" checked={ownership === 'sold'} onChange={() => setOwnership('sold')} /> Sold (raises an invoice)</label>
          </div>
          {err && <p style={{ color: '#991b1b', fontSize: '0.82rem', margin: '4px 0' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" style={cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy}
              style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: 'var(--accent, #ea580c)', color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Installing…' : 'Install equipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// "+ New device" — create a devices-table row already linked to this contract
// (and its client), instead of sending the user to the global Devices page to
// create it there and come back to assign it.
function NewDeviceModal({ contractId, clientId, onClose, onCreated }: {
  contractId: string; clientId: string | null; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: '', type: 'indoor_cpe', manufacturer: '', model: '', serial_number: '', mac_address: '', ip_address: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        contract_id: Number(contractId),
      };
      if (clientId) body.client_id = Number(clientId);
      (['manufacturer', 'model', 'serial_number', 'mac_address', 'ip_address'] as const).forEach(k => {
        const v = form[k].trim();
        if (v) body[k] = v;
      });
      const res = await api.POST('/devices' as never, { body: body as never } as never);
      const e2 = (res as { error?: { error?: { message?: string } } }).error;
      if (e2) throw new Error(e2.error?.message || 'Could not create the device');
      onCreated();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not create the device');
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof typeof form, placeholder = '') => (
    <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem' }}>
      {label}
      <input
        style={{ display: 'block', width: '100%', marginTop: 2, padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit' }}
        value={form[key]} placeholder={placeholder}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="New device">
      <div style={{ ...modalBox, width: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 1rem' }}>New device — contract #{contractId}</h3>
        <form onSubmit={submit}>
          {field('Name *', 'name', 'RGEW1300G — living room')}
          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem' }}>
            Type *
            <select
              style={{ display: 'block', width: '100%', marginTop: 2, padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit' }}
              value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
            >
              {DEVICE_TYPES.map(tp => <option key={tp} value={tp}>{tp.replace('_', ' ')}</option>)}
            </select>
          </label>
          {field('Manufacturer', 'manufacturer', 'Ruijie')}
          {field('Model', 'model', 'RG-EW1300G')}
          {field('Serial number', 'serial_number')}
          {field('MAC address', 'mac_address', 'AA:BB:CC:DD:EE:FF')}
          {field('IP address', 'ip_address')}
          {err && <p style={{ color: '#991b1b', fontSize: '0.82rem', margin: '4px 0' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" style={cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy}
              style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: 'var(--accent, #ea580c)', color: '#fff', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Creating…' : 'Create device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DevicesTab({ devices, contractId, clientId, canManage, canCreate, onChanged }: {
  devices: Device[]; contractId: string; clientId: string | null; canManage: boolean; canCreate: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showInstall, setShowInstall] = useState(false);

  // Installed equipment (cpe_devices) — populated by the install flow and the
  // ACS, never entered here by hand. Fail-soft: a caller without
  // cpe_devices.view simply doesn't get the section (no error, no 403 toast).
  const equipmentQ = useQuery({
    queryKey: ['contract-equipment', contractId],
    queryFn: async () => {
      const res = await api.GET('/cpe-management/devices' as never, {
        params: { query: { contract_id: Number(contractId), limit: 100 } },
      } as never);
      if ((res as { error?: unknown }).error) throw new Error('equipment unavailable');
      return (((res as { data: { data: InstalledUnit[] } }).data?.data) ?? []);
    },
    retry: false,
  });

  // All org devices for the picker (only loaded when the user can manage).
  const orgDevicesQ = useQuery({
    queryKey: ['org-devices-for-assign'],
    queryFn: async () => {
      const res = await api.GET('/devices' as never, { params: { query: { limit: 200 } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('load failed');
      return (((res as { data: { data: OrgDevice[] } }).data?.data) ?? []);
    },
    enabled: canManage,
  });

  async function setContract(deviceId: number, contract_id: number | null) {
    setBusy(true); setErr('');
    try {
      const res = await api.PUT('/devices/{id}' as never, {
        params: { path: { id: deviceId } }, body: { contract_id } as never,
      } as never);
      const e = (res as { error?: { error?: { message?: string } } }).error;
      if (e) throw new Error(e.error?.message || 'Could not update the device');
      setPickId('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the device');
    } finally {
      setBusy(false);
    }
  }

  const linkedIds = new Set(devices.map(d => Number(d.id)));
  const candidates = (orgDevicesQ.data ?? []).filter(d => !linkedIds.has(d.id));
  const equipment = equipmentQ.data ?? [];

  return (
    <div>
      {/* ── Installed equipment — flows in from inventory installs + TR-069 ── */}
      {!equipmentQ.isError && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Installed equipment</h3>
            <button
              type="button"
              onClick={() => setShowInstall(true)}
              style={{ padding: '4px 12px', border: 'none', borderRadius: 6, background: 'var(--accent, #ea580c)', color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
            >
              + Install equipment
            </button>
          </div>
          {equipmentQ.isLoading ? (
            <p style={styles.msg}>Loading…</p>
          ) : !equipment.length ? (
            <p style={styles.msg}>No equipment installed on this contract yet — units assigned through the service-order Equipment flow appear here automatically.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>{['Serial', 'Product', 'Manufacturer / Model', 'Ownership', 'State', 'Last TR-069 contact'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {equipment.map(u => (
                    <tr key={u.id} style={styles.tr}>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600 }}>{u.serial_number}</td>
                      <td style={styles.td}>{u.item_name ? `${u.item_name}${u.item_sku ? ` (${u.item_sku})` : ''}` : '—'}</td>
                      <td style={styles.td}>{[u.manufacturer, u.product_class].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{u.ownership || '—'}</td>
                      <td style={{ ...styles.td, textTransform: 'capitalize' }}>{(u.lifecycle_state || '—').replace('_', ' ')}</td>
                      <td style={styles.td}>{u.last_inform_at ? u.last_inform_at.slice(0, 16).replace('T', ' ') : 'never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem' }}>Network devices</h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        Monitoring/topology records (SNMP, maps). For stock-tracked routers and ONUs use Install equipment above — it draws from inventory.
      </p>
      {canCreate && (
        <div style={{ marginBottom: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: 'var(--accent, #ea580c)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
          >
            + New network device
          </button>
        </div>
      )}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <select
            value={pickId}
            onChange={e => setPickId(e.target.value)}
            disabled={busy || orgDevicesQ.isLoading}
            style={{ padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: 6, background: 'var(--bg-primary, #fff)', color: 'inherit', fontSize: '0.85rem', minWidth: 260 }}
          >
            <option value="">{orgDevicesQ.isLoading ? 'Loading devices…' : 'Select a device to assign…'}</option>
            {candidates.map(d => (
              <option key={d.id} value={d.id}>
                #{d.id} {d.name}{d.type ? ` (${d.type})` : ''}{d.contract_id ? ` — on contract #${d.contract_id}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pickId || busy}
            onClick={() => setContract(Number(pickId), Number(contractId))}
            style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: 'var(--accent, #ea580c)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: pickId && !busy ? 'pointer' : 'not-allowed', opacity: pickId && !busy ? 1 : 0.6 }}
          >
            {busy ? 'Saving…' : '+ Assign device'}
          </button>
          {err && <span style={{ color: '#991b1b', fontSize: '0.8rem' }}>{err}</span>}
        </div>
      )}

      {!devices.length ? (
        <p style={styles.msg}>No devices linked to this contract{canManage ? ' — assign one above.' : '.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>{['Name', 'Type', 'Manufacturer / Model', 'MAC', 'IP', 'Status', ...(canManage ? [''] : [])].map((h, i) => (
                <th key={`${h}-${i}`} style={styles.th}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    <Link to={`/devices/${d.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{d.name}</Link>
                  </td>
                  <td style={{ ...styles.td, textTransform: 'capitalize' }}>{d.type || '—'}</td>
                  <td style={styles.td}>
                    {[d.manufacturer, d.model].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.macAddress || '—'}</td>
                  <td style={{ ...styles.td, fontFamily: 'monospace' }}>{d.ipAddress || '—'}</td>
                  <td style={styles.td}><StatusBadge status={d.status} /></td>
                  {canManage && (
                    <td style={styles.td}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setContract(Number(d.id), null)}
                        style={{ padding: '3px 10px', border: '1px solid #fca5a5', borderRadius: 6, background: 'transparent', color: '#991b1b', fontSize: '0.78rem', cursor: busy ? 'not-allowed' : 'pointer' }}
                        title="Unlink this device from the contract"
                      >
                        Unassign
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewDeviceModal
          contractId={contractId}
          clientId={clientId}
          onClose={() => setShowNew(false)}
          onCreated={onChanged}
        />
      )}

      {showInstall && (
        <InstallEquipmentModal
          contractId={contractId}
          onClose={() => setShowInstall(false)}
          onInstalled={() => {
            void qc.invalidateQueries({ queryKey: ['contract-equipment', contractId] });
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AddonsTab({ addons }: { addons: ContractAddon[] }) {
  if (!addons.length) return <p style={styles.msg}>No add-ons found.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>{['Name', 'Type', 'Qty', 'Unit Price', 'Start', 'End', 'Status'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {addons.map(a => (
            <tr key={a.id} style={styles.tr}>
              <td style={{ ...styles.td, fontWeight: 600 }}>{a.addonName || '—'}</td>
              <td style={{ ...styles.td, textTransform: 'capitalize' }}>{a.addonType || '—'}</td>
              <td style={styles.td}>{a.quantity ?? '—'}</td>
              <td style={{ ...styles.td, fontVariantNumeric: 'tabular-nums' }}>
                {a.unitPrice ? fmtMoney(a.unitPrice) : '—'}
              </td>
              <td style={styles.td}>{fmt(a.startDate)}</td>
              <td style={styles.td}>{fmt(a.endDate)}</td>
              <td style={styles.td}><StatusBadge status={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PPPoE credentials tab
// ---------------------------------------------------------------------------

function CredField({
  label,
  value,
  secret,
  reveal,
  onToggle,
}: {
  label: string;
  value: string;
  secret?: boolean;
  reveal?: boolean;
  onToggle?: () => void;
}) {
  const shown = secret && !reveal ? '••••••••••' : value;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, fontFamily: 'monospace' }}>{shown}</span>
      {secret && (
        <button type="button" style={styles.linkBtn} onClick={onToggle}>
          {reveal ? 'Hide' : 'Show'}
        </button>
      )}
      <button
        type="button"
        style={styles.linkBtn}
        onClick={() => { void navigator.clipboard?.writeText(value); }}
      >
        Copy
      </button>
    </div>
  );
}

function PppoeTab({ contractId, canEdit }: { contractId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<{ password: string; pushed: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ['contract-radius', contractId],
    queryFn: () => fetchRadiusAccounts(contractId),
  });

  const account = accounts?.[0];

  // Layered on top of the base (password-free) fetch above: only requested
  // once we know an account exists, so a caller without
  // radius.credentials.view doesn't take a guaranteed-403 round trip for
  // nothing when there's no account at all.
  const credentialsQ = useQuery({
    queryKey: ['contract-radius-credentials', contractId],
    queryFn: () => fetchRadiusCredentials(contractId),
    enabled: !!account,
  });
  const credentialsForbidden = credentialsQ.error instanceof Error && credentialsQ.error.message === RADIUS_CREDENTIALS_FORBIDDEN;

  if (isLoading) return <p style={styles.msg}>Loading PPPoE account…</p>;
  if (error) return <p style={styles.msg}>Unable to load PPPoE credentials (no account, or insufficient permission).</p>;

  if (!account) {
    return <p style={styles.msg}>No PPPoE account for this contract. Use “Renew” to provision one.</p>;
  }

  // A freshly-regenerated password (from POST .../regenerate-pppoe, gated by
  // contracts.update — a separate write permission) is shown regardless of
  // radius.credentials.view, since the API already returned it to this
  // caller directly. Otherwise the password comes from the credentials
  // fetch above, which IS gated by radius.credentials.view.
  const password = regenerated?.password ?? credentialsQ.data?.[0]?.password;

  async function handleRegenerate() {
    setConfirmOpen(false);
    setRegenError(null);
    setRegenerating(true);
    try {
      const r = await regeneratePppoe(contractId);
      setRegenerated({ password: r.password, pushed: r.pushed });
      setReveal(true);
      qc.invalidateQueries({ queryKey: ['contract-radius', contractId] });
      qc.invalidateQueries({ queryKey: ['contract-radius-credentials', contractId] });
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : 'Failed to regenerate credentials');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div style={{ padding: '1.25rem' }}>
      <div style={styles.infoGrid}>
        <CredField label="Username" value={account.username} />
        {!regenerated && credentialsForbidden ? (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Password</span>
            <span style={{ ...styles.infoValue, color: 'var(--text-dimmed)' }}>
              Insufficient permission to view the password (requires radius.credentials.view).
            </span>
          </div>
        ) : password === undefined ? (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Password</span>
            <span style={styles.infoValue}>Loading…</span>
          </div>
        ) : (
          <CredField label="Password" value={password} secret reveal={reveal} onToggle={() => setReveal(v => !v)} />
        )}
      </div>

      {canEdit && (
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={styles.actionBtn} onClick={() => setConfirmOpen(true)} disabled={regenerating}>
            {regenerating ? 'Regenerating…' : 'Regenerate password'}
          </button>
          {regenerated && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              New password generated{regenerated.pushed ? ' and pushed to the NAS' : ' — reconfigure the CPE'}.
            </span>
          )}
        </div>
      )}

      {regenError && <div style={{ ...styles.errorBanner, marginTop: '1rem' }}>{regenError}</div>}

      <p style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', marginTop: '1rem' }}>
        Rotating the password requires reconfiguring the subscriber’s CPE with the new credentials.
      </p>

      {confirmOpen && (
        <div style={overlay} role="dialog" aria-modal="true" aria-label="Confirm password regeneration">
          <div style={modalBox}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Regenerate PPPoE password?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 0 }}>
              This generates a new password for <strong>{account.username}</strong> and invalidates the
              current one. The subscriber will be offline until their CPE is reconfigured with the new
              credentials. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button type="button" style={cancelBtn} onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button type="button" style={dangerBtn} onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? 'Regenerating…' : 'Regenerate password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract Info Card
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span
        style={{
          ...styles.infoValue,
          ...(capitalize ? { textTransform: 'capitalize' as const } : {}),
          ...(mono ? { fontFamily: 'monospace' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ContractInfoCard({ contract }: { contract: Contract }) {
  return (
    <div style={styles.infoCard}>
      <div style={styles.infoGrid}>
        {contract.client && (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Client</span>
            <Link to={`/clients/${contract.client.id}`} style={styles.infoLink}>
              {contract.client.name}
            </Link>
          </div>
        )}
        <InfoRow label="Plan"        value={contract.planId ? `Plan #${contract.planId}` : null} />
        <InfoRow label="Type"        value={contract.connectionType} capitalize />
        <InfoRow label="Start Date"  value={fmt(contract.startDate)} />
        <InfoRow label="End Date"    value={fmt(contract.endDate)} />
        <InfoRow label="Billing Day" value={contract.billingDay != null ? String(contract.billingDay) : null} />
        <InfoRow label="IP Address"  value={contract.ipAddress} mono />
        <InfoRow label="Created"     value={fmt(contract.createdAt)} />
        {contract.priceOverride && (
          <InfoRow label="Price Override" value={fmtMoney(contract.priceOverride)} />
        )}
      </div>
      {contract.notes && (
        <div style={styles.notesRow}>
          <span style={styles.noteLabel}>Notes: </span>
          {contract.notes}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guided first activation
// ---------------------------------------------------------------------------

interface ActivationServiceOrder {
  id: number;
  order_number: string;
  status: string;
  assigned_to: number | null;
  started_at: string | null;
}

interface ActivationWorkOrder {
  id: number;
  status: string;
  assigned_to: number | null;
  acceptance: Record<string, unknown> | null;
}

interface ActivationDocument {
  id: number;
  template_type: string;
  title: string;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
}

interface ActivationDocumentDetail extends ActivationDocument {
  rendered_body: string;
  mx_contract_environment?: MxContractEnvironment | null;
  communication_contacts?: CommunicationContacts;
  privacy_notice?: SigningPrivacyNotice | null;
  communication_choices_recorded?: boolean;
}

function capturesCommunicationChoices(templateType: string): boolean {
  return templateType === 'activation_contract' || templateType === 'service_acknowledgment';
}

function needsCommunicationChoices(document: ActivationDocumentDetail): boolean {
  return capturesCommunicationChoices(document.template_type) && document.communication_choices_recorded !== true;
}

interface ActivationSpeedTest {
  download_mbps: number | string;
  upload_mbps: number | string;
  latency_ms?: number | string | null;
  jitter_ms?: number | string | null;
  packet_loss_pct?: number | string | null;
  server_location?: string | null;
  notes?: string | null;
  tested_at?: string | null;
}

interface ContractActivationState {
  contract_id: number;
  client_id: number;
  status: string;
  contract_environment?: MxContractEnvironment | null;
  connection_type: string | null;
  test_window_expires_at: string | null;
  test_window_cleanup_pending?: boolean;
  radius_status: string | null;
  service_order_prepared?: boolean;
  service_order: ActivationServiceOrder | null;
  work_order_prepared?: boolean;
  work_order: ActivationWorkOrder | null;
  documents: ActivationDocument[];
  arrival_authorization_pending?: boolean;
  document_sync_required?: boolean;
  speed_test: ActivationSpeedTest | null;
  speed_test_recorded?: boolean;
  can_activate: boolean;
  blockers: string[];
  network_retry_available?: boolean;
}

interface AssignableUser {
  id: number;
  first_name: string;
  last_name: string;
}

async function activationError(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json() as { error?: string | { message?: string } };
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch { /* empty/non-JSON response */ }
  return fallback;
}

async function fetchActivationState(contractId: string): Promise<ContractActivationState> {
  const response = await authedFetch(`${API_BASE}/contracts/${contractId}/activation`);
  if (!response.ok) throw new Error(await activationError(response, 'Failed to load activation status'));
  const json = await response.json() as { data: ContractActivationState };
  return json.data;
}

async function fetchActivationAssignableUsers(fallback: string): Promise<AssignableUser[]> {
  const response = await (api.GET as unknown as (
    path: string,
    options: unknown,
  ) => Promise<{ data?: unknown; error?: unknown }>)('/work-orders/assignable-users', {
    params: { query: { commissioning: true } },
  });
  if (response.error) {
    const apiError = response.error as {
      error?: string | { message?: string };
      message?: string;
    };
    const message = typeof apiError.error === 'string'
      ? apiError.error
      : apiError.error?.message ?? apiError.message ?? fallback;
    throw new Error(message);
  }
  return ((response.data as { data?: AssignableUser[] } | undefined)?.data) ?? [];
}

async function postActivationState(
  url: string,
  body: Record<string, unknown> | undefined,
  fallback: string,
): Promise<ContractActivationState | null> {
  const response = await authedFetch(url, {
    method: 'POST',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new Error(await activationError(response, fallback));
  const json = await response.json().catch(() => null) as { data?: ContractActivationState } | null;
  return json?.data ?? null;
}

function ActivationSignatureCanvas({ onChange }: { onChange: (value: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (rect.width ? event.currentTarget.width / rect.width : 1),
      y: (event.clientY - rect.top) * (rect.height ? event.currentTarget.height / rect.height : 1),
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#111';
    context.lineTo(x, y);
    context.stroke();
    dirty.current = true;
  }

  function end() {
    drawing.current = false;
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  }

  const { t } = useTranslation();
  return (
    <div>
      <canvas
        ref={canvasRef}
        width={420}
        height={140}
        data-testid="activation-signature-canvas"
        style={{ border: '1px dashed var(--border-strong, #9ca3af)', borderRadius: 8, background: '#fff', touchAction: 'none', width: '100%', maxWidth: 420 }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <button type="button" style={{ ...cancelBtn, marginTop: 4, padding: '3px 10px' }} onClick={clear}>
        {t('contractActivation.clearSignature')}
      </button>
    </div>
  );
}

function ActivationSignModal({ documentId, onClose, onSigned }: {
  documentId: number;
  onClose: () => void;
  onSigned: () => void;
}) {
  const { t } = useTranslation();
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [communicationOptIns, setCommunicationOptIns] = useState<CommunicationOptIns>({
    email: false,
    sms: false,
    whatsapp: false,
  });
  const [communicationChoicesConfirmed, setCommunicationChoicesConfirmed] = useState(false);
  const [error, setError] = useState('');

  const documentQ = useQuery({
    queryKey: ['activation-document', documentId],
    queryFn: async () => {
      const response = await (api.GET as unknown as (
        path: string,
        options: unknown,
      ) => Promise<{ data?: unknown; error?: unknown }>)('/signed-documents/{id}', {
        params: { path: { id: documentId } },
      });
      if (response.error) throw new Error(t('contractActivation.documentLoadFailed'));
      return (response.data as { data: ActivationDocumentDetail }).data;
    },
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!signerName.trim()) throw new Error(t('contractActivation.signerRequired'));
      if (!signature) throw new Error(t('contractActivation.signatureRequired'));
      const captureChoices = Boolean(documentQ.data && needsCommunicationChoices(documentQ.data));
      const privacyNotice = documentQ.data?.privacy_notice;
      if (captureChoices && !privacyNotice) {
        throw new Error(t('communicationOptIn.privacyUnavailable'));
      }
      if (captureChoices && !communicationChoicesConfirmed) {
        throw new Error(t('communicationOptIn.reviewRequired'));
      }
      const body: Record<string, unknown> = {
        signer_name: signerName.trim(),
        signature_image: signature,
      };
      if (captureChoices && privacyNotice) {
        body.communication_opt_ins = communicationOptIns;
        body.communication_choices_confirmed = true;
        body.privacy_notice_version = privacyNotice.version;
        body.privacy_notice_hash = privacyNotice.hash;
      }
      const response = await (api.POST as unknown as (
        path: string,
        options: unknown,
      ) => Promise<{ error?: { error?: { message?: string } } }>)('/signed-documents/{id}/sign', {
        params: { path: { id: documentId } },
        body,
      });
      if (response.error) throw new Error(response.error.error?.message || t('contractActivation.signFailed'));
    },
    onSuccess: () => { onSigned(); onClose(); },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t('contractActivation.signDocument')} onClick={onClose}>
      <div style={{ ...modalBox, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={event => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: '0 0 0.75rem' }}>
            {documentQ.data?.title ?? t('contractActivation.signDocument')}
          </h3>
          <button type="button" style={cancelBtn} onClick={onClose} aria-label={t('common.close', 'Close')}>✕</button>
        </div>
        {documentQ.isLoading && <p>{t('common.loading')}</p>}
        {documentQ.isError && <p style={{ color: '#991b1b' }}>{t('contractActivation.documentLoadFailed')}</p>}
        {documentQ.data && (
          <>
            <MxSandboxDocumentBanner environment={documentQ.data.mx_contract_environment} />
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', background: 'var(--bg-subtle)' }}>
              <MarkdownView markdown={documentQ.data.rendered_body} />
            </div>
            {documentQ.data.status === 'signed' ? (
              <p>{t('contractActivation.signedBy', { name: documentQ.data.signer_name ?? '' })}</p>
            ) : (
              <>
                <label style={labelStyle}>
                  {t('contractActivation.signerName')}
                  <input style={inputStyle} value={signerName} onChange={event => setSignerName(event.target.value)} maxLength={200} />
                </label>
                <label style={labelStyle}>{t('contractActivation.signature')}</label>
                <ActivationSignatureCanvas onChange={setSignature} />
                {needsCommunicationChoices(documentQ.data) ? (
                  <CommunicationOptInFields
                    contacts={documentQ.data.communication_contacts ?? { email: false, phone: false }}
                    privacyNotice={documentQ.data.privacy_notice ?? null}
                    value={communicationOptIns}
                    onChange={setCommunicationOptIns}
                    confirmed={communicationChoicesConfirmed}
                    onConfirmedChange={setCommunicationChoicesConfirmed}
                    disabled={signMutation.isPending}
                  />
                ) : capturesCommunicationChoices(documentQ.data.template_type) ? (
                  <p data-testid="communication-choices-recorded" style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                    {t('communicationOptIn.alreadyRecorded')}
                  </p>
                ) : null}
                {error && <p style={{ color: '#991b1b', fontSize: '0.84rem' }}>{error}</p>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
                  <button type="button" style={cancelBtn} onClick={onClose}>{t('common.cancel')}</button>
                  <button
                    type="button"
                    style={submitBtn}
                    disabled={signMutation.isPending || (
                      needsCommunicationChoices(documentQ.data)
                      && (!communicationChoicesConfirmed || !documentQ.data.privacy_notice)
                    )}
                    onClick={() => { setError(''); signMutation.mutate(); }}
                  >
                    {signMutation.isPending ? t('common.saving') : t('contractActivation.signDocument')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function countdown(expiresAt: string, now: number): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function humanizeBlocker(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character: string) => character.toUpperCase());
}

function ActivationDocumentRow({ document, canSign, onSign }: {
  document: ActivationDocument;
  canSign: boolean;
  onSign: (documentId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={activationStyles.documentRow}>
      <span style={{ flex: 1 }}>{document.title}</span>
      {document.status === 'signed' ? (
        <span style={{ color: '#166534' }}>{t('contractActivation.signedBy', { name: document.signer_name ?? '' })}</span>
      ) : document.status === 'pending' ? (
        <>
          <span style={{ color: '#92400e' }}>{t('contractActivation.pendingSignature')}</span>
          {canSign ? (
            <button type="button" style={styles.actionBtn} onClick={() => onSign(document.id)}>
              {t('contractActivation.readAndSign')}
            </button>
          ) : (
            <span style={{ color: 'var(--text-dimmed)', fontSize: '0.76rem' }}>
              {t('contractActivation.signPermissionRequired')}
            </span>
          )}
        </>
      ) : (
        <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{humanizeBlocker(document.status)}</span>
      )}
    </div>
  );
}

function ActivationCard({ contractId, isMxOrg, canEdit, canStartInstallation, canCreateInvoices, canUpdateWorkOrders, canCreateSpeedTests, canViewSignedDocuments, canSignDocuments, operatorUserId, canSuperviseCommissioning, onActivated, onCancelled }: {
  contractId: string;
  isMxOrg: boolean;
  canEdit: boolean;
  canStartInstallation: boolean;
  canCreateInvoices: boolean;
  canUpdateWorkOrders: boolean;
  canCreateSpeedTests: boolean;
  canViewSignedDocuments: boolean;
  canSignDocuments: boolean;
  operatorUserId: number | null;
  canSuperviseCommissioning: boolean;
  onActivated: (networkWarning?: string) => void;
  onCancelled: (cleanupPending: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [technicianId, setTechnicianId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [signingId, setSigningId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [speed, setSpeed] = useState({ download: '', upload: '', latency: '', jitter: '', loss: '', server: '', notes: '' });
  const [acceptance, setAcceptance] = useState({ signal: '', link: '', rx: '', waived: false, notes: '' });
  const [billing, setBilling] = useState<'already_paid' | 'create_invoice'>('already_paid');
  const [fee, setFee] = useState('');
  const [description, setDescription] = useState('');
  const [networkWarning, setNetworkWarning] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const activationQ = useQuery({
    queryKey: ['contract-activation', contractId],
    queryFn: () => fetchActivationState(contractId),
    retry: false,
    refetchInterval: query => {
      const current = query.state.data as ContractActivationState | undefined;
      if (current?.blockers.includes('test_window_cleanup_pending')) return 5_000;
      return current?.test_window_expires_at ? 30_000 : false;
    },
  });

  const state = activationQ.data;
  const workOrder = state?.work_order ?? null;
  const serviceOrderPrepared = state?.service_order_prepared ?? Boolean(state?.service_order);
  const workOrderPrepared = state?.work_order_prepared ?? Boolean(workOrder);
  const expiresAt = state?.test_window_expires_at ?? null;
  const needsDocumentSync = Boolean(
    state?.document_sync_required
    ?? (canViewSignedDocuments
      && state?.blockers.includes('signature_missing')
      && !state.documents.some(document => (
        capturesCommunicationChoices(document.template_type) && document.status === 'pending'
      ))),
  );

  useEffect(() => {
    if (!expiresAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const usersQ = useQuery({
    queryKey: ['activation-assignable-users'],
    queryFn: () => fetchActivationAssignableUsers(t('contractActivation.techniciansLoadFailed')),
    enabled: canEdit && canStartInstallation
      && (!workOrder || workOrder.assigned_to == null || reassigning),
    retry: false,
  });

  function installState(next: ContractActivationState | null) {
    if (next) queryClient.setQueryData(['contract-activation', contractId], next);
    else void queryClient.invalidateQueries({ queryKey: ['contract-activation', contractId] });
  }

  function refreshActivation() {
    void queryClient.invalidateQueries({ queryKey: ['contract-activation', contractId] });
  }

  const prepareMutation = useMutation({
    mutationFn: () => postActivationState(
      `${API_BASE}/contracts/${contractId}/activation/prepare`,
      technicianId ? { assigned_to: Number(technicianId) } : {},
      t('contractActivation.prepareFailed'),
    ),
    onSuccess: result => {
      installState(result);
      setReassigning(false);
      setTechnicianId('');
    },
  });

  const windowMutation = useMutation({
    mutationFn: (action: 'start' | 'end') => {
      if (!workOrder) throw new Error(t('contractActivation.prepareFirst'));
      return postActivationState(
        `${API_BASE}/work-orders/${workOrder.id}/test-window/${action}`,
        undefined,
        t('contractActivation.testActionFailed'),
      );
    },
    // Window commands return their own compact command result, not the full
    // activation projection. Refetch the projection instead of caching that
    // response under the activation query key.
    onSuccess: result => {
      const outcome = result as unknown as {
        nas_disable_warning?: string | null;
        disconnect_warning?: string | null;
      } | null;
      setNetworkWarning(
        [outcome?.nas_disable_warning, outcome?.disconnect_warning].filter(Boolean).join(' · '),
      );
      refreshActivation();
    },
  });

  const speedMutation = useMutation({
    mutationFn: () => {
      if (!workOrder) throw new Error(t('contractActivation.prepareFirst'));
      const download = Number(speed.download);
      const upload = Number(speed.upload);
      if (!Number.isFinite(download) || download <= 0 || !Number.isFinite(upload) || upload <= 0) {
        throw new Error(t('contractActivation.speedRequired'));
      }
      const body: Record<string, unknown> = { download_mbps: download, upload_mbps: upload };
      if (speed.latency !== '') body.latency_ms = Number(speed.latency);
      if (speed.jitter !== '') body.jitter_ms = Number(speed.jitter);
      if (speed.loss !== '') body.packet_loss_pct = Number(speed.loss);
      if (speed.server.trim()) body.server_location = speed.server.trim();
      if (speed.notes.trim()) body.notes = speed.notes.trim();
      const systemControlled = state?.connection_type === 'pppoe' || state?.connection_type === 'pppoe_dual';
      if (systemControlled) {
        return postActivationState(
          `${API_BASE}/work-orders/${workOrder.id}/test-window/complete`,
          body,
          t('contractActivation.speedFailed'),
        );
      }
      // Static/dual lines do not have a RADIUS account, so there is no safe
      // system-controlled test window to toggle. The dedicated commissioning
      // command still verifies the assigned technician and derives every
      // ownership field from the linked installation work order.
      return postActivationState(
        `${API_BASE}/work-orders/${workOrder.id}/commissioning-test`,
        body,
        t('contractActivation.speedFailed'),
      );
    },
    onSuccess: result => {
      const outcome = result as unknown as {
        nas_disable_warning?: string | null;
        disconnect_warning?: string | null;
      } | null;
      setNetworkWarning(
        [outcome?.nas_disable_warning, outcome?.disconnect_warning].filter(Boolean).join(' · '),
      );
      refreshActivation();
    },
  });

  const acceptanceMutation = useMutation({
    mutationFn: async () => {
      if (!workOrder) throw new Error(t('contractActivation.prepareFirst'));
      const body: Record<string, unknown> = { status: 'completed' };
      if (acceptance.signal !== '') body.acceptance_signal_dbm = Number(acceptance.signal);
      if (acceptance.link !== '') body.acceptance_link_mbps = Number(acceptance.link);
      if (acceptance.rx !== '') body.acceptance_rx_dbm = Number(acceptance.rx);
      const hasReading = acceptance.signal !== '' || acceptance.link !== '' || acceptance.rx !== '';
      if (!hasReading && !acceptance.waived) throw new Error(t('contractActivation.acceptanceRequired'));
      if (acceptance.waived) {
        if (!acceptance.notes.trim()) throw new Error(t('contractActivation.waiverNotesRequired'));
        body.acceptance_waived = true;
      }
      if (acceptance.notes.trim()) body.acceptance_notes = acceptance.notes.trim();
      const response = await authedFetch(`${API_BASE}/work-orders/${workOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await activationError(response, t('contractActivation.handoffFailed')));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contract-activation', contractId] }),
  });

  const activateMutation = useMutation({
    mutationFn: () => {
      const feeNumber = Number(fee);
      if (billing === 'create_invoice' && (!Number.isFinite(feeNumber) || feeNumber <= 0)) {
        throw new Error(t('contractActivation.feeRequired'));
      }
      const body: Record<string, unknown> = { billing };
      if (billing === 'create_invoice') {
        body.installation_fee = feeNumber;
        body.description = description.trim() || t('contractActivation.installationFeeDefault');
      }
      return postActivationState(
        `${API_BASE}/contracts/${contractId}/activate`,
        body,
        t('contractActivation.activateFailed'),
      );
    },
    onSuccess: result => {
      const warning = (result as unknown as {
        network_activation?: { nas_push_error?: string | null };
      } | null)?.network_activation?.nas_push_error;
      onActivated(warning ?? undefined);
    },
  });

  const cancelActivationMutation = useMutation({
    mutationFn: () => postActivationState(
      `${API_BASE}/contracts/${contractId}/activation/cancel`,
      undefined,
      t('contractActivation.cancelActivationFailed'),
    ),
    onSuccess: result => onCancelled(Boolean(result?.test_window_cleanup_pending)),
  });

  if (activationQ.isLoading) {
    return <section style={activationStyles.card}><p style={{ margin: 0 }}>{t('contractActivation.loading')}</p></section>;
  }
  if (activationQ.isError || !state) {
    return (
      <section style={activationStyles.card}>
        <h2 style={activationStyles.title}>{t('contractActivation.title')}</h2>
        <p style={{ color: '#991b1b' }}>{activationQ.error instanceof Error ? activationQ.error.message : t('contractActivation.loadFailed')}</p>
        <button type="button" style={styles.actionBtn} onClick={() => void activationQ.refetch()}>{t('contractActivation.retry')}</button>
      </section>
    );
  }

  const windowOpen = Boolean(expiresAt && new Date(expiresAt).getTime() > now);
  const windowTracked = Boolean(expiresAt);
  const cleanupPending = Boolean(
    state.test_window_cleanup_pending || state.blockers.includes('test_window_cleanup_pending'),
  );
  const systemControlledLine = state.connection_type === 'pppoe' || state.connection_type === 'pppoe_dual';
  const availableDocuments = state.documents ?? [];
  const documents = canViewSignedDocuments ? availableDocuments : [];
  const arrivalDocuments = documents.filter(document => document.template_type === 'installation_authorization');
  const handoffDocuments = documents.filter(document => document.template_type !== 'installation_authorization');
  // The start button still respects the authorization gate even when this
  // user may not view document metadata; no title/signer information leaks.
  const arrivalAuthorizationPending = state.arrival_authorization_pending
    ?? availableDocuments.some(
      document => document.template_type === 'installation_authorization' && document.status === 'pending',
    );
  const activationTemplateMissing = isMxOrg && state.blockers.includes('activation_template_missing');
  const signatureBlocked = (
    state.blockers.includes('signature_missing') || activationTemplateMissing
  );
  const visitCompleted = workOrder?.status === 'completed';
  const needsRecommission = Boolean(
    state.blockers.includes('service_order_not_in_process')
    || (visitCompleted
      && (state.blockers.includes('speed_test_missing') || state.blockers.includes('acceptance_missing'))),
  );
  const workOrderReadyForTest = Boolean(
    workOrder?.assigned_to && ['assigned', 'in_progress'].includes(workOrder.status),
  );
  const isAssignedOperator = operatorUserId !== null && workOrder?.assigned_to != null
    && Number(workOrder.assigned_to) === Number(operatorUserId);
  const canOperateCommissioning = canUpdateWorkOrders && (canSuperviseCommissioning || isAssignedOperator);
  const canCompleteInstallation = canUpdateWorkOrders
    && (canSuperviseCommissioning || isAssignedOperator);
  const speedTestRecorded = state.speed_test_recorded ?? Boolean(state.speed_test);
  const canSubmitAcceptance = speedTestRecorded && !signatureBlocked;
  const canRecordSpeed = canOperateCommissioning && canCreateSpeedTests;
  const feeValid = billing === 'already_paid' || (fee.trim() !== '' && Number(fee) > 0);
  const blockerLabels: Record<string, string> = {
    service_order_missing: t('contractActivation.blockers.serviceOrderMissing'),
    service_order_not_in_process: t('contractActivation.blockers.serviceOrderNotInProcess'),
    work_order_missing: t('contractActivation.blockers.workOrderMissing'),
    work_order_not_completed: t('contractActivation.blockers.workOrderNotCompleted'),
    acceptance_missing: t('contractActivation.blockers.acceptanceMissing'),
    test_window_open: t('contractActivation.blockers.testWindowOpen'),
    test_window_cleanup_pending: t('contractActivation.blockers.testWindowCleanupPending'),
    speed_test_missing: t('contractActivation.blockers.speedTestMissing'),
    activation_template_missing: t('contractActivation.blockers.activationTemplateMissing'),
    signature_missing: t(isMxOrg
      ? 'contractActivation.blockers.mxSignatureMissing'
      : 'contractActivation.blockers.globalSignatureMissing'),
  };
  const actionError = prepareMutation.error || windowMutation.error || speedMutation.error
    || acceptanceMutation.error || activateMutation.error || cancelActivationMutation.error;

  return (
    <section style={activationStyles.card} aria-labelledby="contract-activation-title">
      <div style={activationStyles.header}>
        <div>
          <h2 id="contract-activation-title" style={activationStyles.title}>{t('contractActivation.title')}</h2>
          <p style={activationStyles.intro}>{t('contractActivation.intro')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {state.contract_environment && (
            <MxContractEnvironmentBadge environment={state.contract_environment} />
          )}
          <div style={{ ...activationStyles.lineState, ...(windowOpen ? activationStyles.lineOn : activationStyles.lineOff) }}>
            {!systemControlledLine
              ? t('contractActivation.manualLineControl')
              : cleanupPending
                ? t('contractActivation.lineShutdownPending')
              : windowOpen && expiresAt
                ? t('contractActivation.lineOn', { remaining: countdown(expiresAt, now) })
                : t('contractActivation.lineOff')}
          </div>
        </div>
      </div>

      {actionError && (
        <div style={styles.errorBanner} role="alert">
          {actionError instanceof Error ? actionError.message : t('contractActivation.actionFailed')}
        </div>
      )}
      {networkWarning && (
        <div style={{ ...activationStyles.autoOffWarning, margin: '0.75rem 1.25rem' }} role="alert">
          {t('contractActivation.networkDisableWarning', { warning: networkWarning })}
        </div>
      )}

      <div style={activationStyles.step}>
        <h3 style={activationStyles.stepTitle}>1. {t('contractActivation.installationVisit')}</h3>
        <p style={activationStyles.help}>{t('contractActivation.installationVisitHelp')}</p>
        {state.service_order && (
          <p style={activationStyles.summary}>
            {t('contractActivation.serviceOrder')}: <strong>{state.service_order.order_number}</strong> · {state.service_order.status}
          </p>
        )}
        {workOrder && (
          <p style={activationStyles.summary}>
            {t('contractActivation.workOrder')}: <strong>#{workOrder.id}</strong> · {workOrder.status}
          </p>
        )}
        {!state.service_order && !workOrder && (serviceOrderPrepared || workOrderPrepared) && (
          <p style={activationStyles.summary}>{t('contractActivation.visitPreparedRestricted')}</p>
        )}
        {canViewSignedDocuments && workOrder && arrivalDocuments.length > 0 && (
          <div style={{ margin: '0.75rem 0' }}>
            <strong style={{ fontSize: '0.84rem' }}>{t('contractActivation.arrivalAuthorization')}</strong>
            <p style={activationStyles.help}>{t('contractActivation.arrivalAuthorizationHelp')}</p>
            {arrivalDocuments.map(document => (
              <ActivationDocumentRow key={document.id} document={document} canSign={canSignDocuments} onSign={setSigningId} />
            ))}
          </div>
        )}
        {workOrder?.assigned_to != null && !visitCompleted && canEdit && canStartInstallation && !reassigning && (
          <button type="button" style={styles.actionBtn} onClick={() => setReassigning(true)}>
            {t('contractActivation.reassignTechnician')}
          </button>
        )}
        {canEdit && canStartInstallation
          && (!workOrder || workOrder.assigned_to == null || reassigning || needsDocumentSync || needsRecommission) && (
          <div style={activationStyles.row}>
            {(!workOrder || workOrder.assigned_to == null || reassigning) && (
              <label style={{ ...labelStyle, margin: 0, minWidth: 230 }}>
                {t('contractActivation.technician')}
                <select style={inputStyle} value={technicianId} onChange={event => setTechnicianId(event.target.value)}>
                  <option value="">{t('contractActivation.unassigned')}</option>
                  {(usersQ.data ?? []).map(option => (
                    <option key={option.id} value={option.id}>{`${option.first_name} ${option.last_name}`.trim()}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              style={submitBtn}
              disabled={prepareMutation.isPending || activationTemplateMissing || (reassigning && !technicianId)}
              onClick={() => prepareMutation.mutate()}
            >
              {prepareMutation.isPending
                ? t('contractActivation.preparing')
                : needsRecommission
                  ? t('contractActivation.recommissionVisit')
                : needsDocumentSync && workOrder?.assigned_to != null
                  ? t('contractActivation.syncDocuments')
                  : workOrder && reassigning
                    ? t('contractActivation.reassignTechnician')
                    : workOrder ? t('contractActivation.assignTechnician') : t('contractActivation.prepareVisit')}
            </button>
            {reassigning && (
              <button type="button" style={cancelBtn} onClick={() => { setReassigning(false); setTechnicianId(''); }}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        )}
        {needsRecommission && (
          <p style={activationStyles.autoOffWarning}>{t('contractActivation.recommissionVisitHelp')}</p>
        )}
        {usersQ.isError && (
          <div style={styles.errorBanner} role="alert">
            {usersQ.error instanceof Error ? usersQ.error.message : t('contractActivation.techniciansLoadFailed')}
            {' '}
            <button type="button" style={styles.actionBtn} onClick={() => void usersQ.refetch()}>
              {t('contractActivation.retry')}
            </button>
          </div>
        )}
        {!workOrderPrepared && !canEdit && <p style={activationStyles.help}>{t('contractActivation.waitingForPreparation')}</p>}
        {canEdit && !canStartInstallation
          && (!workOrder || workOrder.assigned_to == null || needsDocumentSync || needsRecommission) && (
          <p style={activationStyles.autoOffWarning}>
            {t('contractActivation.installationStartPermissionRequired')}
          </p>
        )}
        {workOrder && <Link to="/work-orders" style={styles.infoLink}>{t('contractActivation.openWorkOrders')}</Link>}
      </div>

      {canEdit && (
        <div style={{ ...activationStyles.step, borderBottom: 0 }}>
          {confirmCancel ? (
            <div style={activationStyles.row}>
              <span style={activationStyles.help}>{t('contractActivation.cancelActivationConfirm')}</span>
              <button
                type="button"
                style={cancelBtn}
                disabled={cancelActivationMutation.isPending}
                onClick={() => cancelActivationMutation.mutate()}
              >
                {cancelActivationMutation.isPending
                  ? t('contractActivation.cancellingActivation')
                  : t('contractActivation.cancelActivation')}
              </button>
              <button type="button" style={styles.actionBtn} onClick={() => setConfirmCancel(false)}>
                {t('contractActivation.keepActivation')}
              </button>
            </div>
          ) : (
            <button type="button" style={cancelBtn} onClick={() => setConfirmCancel(true)}>
              {t('contractActivation.cancelActivation')}
            </button>
          )}
        </div>
      )}

      <div style={activationStyles.step}>
        <h3 style={activationStyles.stepTitle}>2. {t('contractActivation.connectionTest')}</h3>
        <p style={activationStyles.help}>{t('contractActivation.connectionTestHelp')}</p>
        {!workOrder ? (
          <p style={activationStyles.help}>
            {workOrderPrepared
              ? t('contractActivation.commissioningDetailsRestricted')
              : t('contractActivation.prepareFirst')}
          </p>
        ) : (
          <>
            {systemControlledLine && canUpdateWorkOrders && (windowTracked || canOperateCommissioning) && (
              <div style={activationStyles.row}>
                {windowTracked ? (
                  <button type="button" style={cancelBtn} disabled={windowMutation.isPending} onClick={() => windowMutation.mutate('end')}>
                    {t('contractActivation.endTestWindow')}
                  </button>
                ) : (
                  <button type="button" style={submitBtn} disabled={windowMutation.isPending || arrivalAuthorizationPending || !workOrderReadyForTest} onClick={() => windowMutation.mutate('start')}>
                    {t('contractActivation.startTestWindow')}
                  </button>
                )}
                <span style={activationStyles.help}>
                  {windowOpen
                    ? t('contractActivation.temporaryInternetOn')
                    : cleanupPending
                      ? t('contractActivation.temporaryInternetShutdownPending')
                      : t('contractActivation.temporaryInternetOff')}
                </span>
              </div>
            )}
            {arrivalAuthorizationPending && (
              <p style={activationStyles.autoOffWarning}>{t('contractActivation.authorizationBeforeTest')}</p>
            )}
            {!workOrderReadyForTest && (
              <p style={activationStyles.autoOffWarning}>{t('contractActivation.assignBeforeTest')}</p>
            )}
            {!systemControlledLine && (
              <p style={activationStyles.autoOffWarning}>{t('contractActivation.manualShutdownHelp')}</p>
            )}

            {speedTestRecorded && (
              <div style={activationStyles.result}>
                <strong>{t('contractActivation.speedRecorded')}</strong>{' '}
                {state.speed_test && t('contractActivation.speedSummary', {
                  download: state.speed_test.download_mbps,
                  upload: state.speed_test.upload_mbps,
                })}
                <div>
                  {systemControlledLine
                    ? cleanupPending
                      ? t('contractActivation.lineShutdownPendingAfterTest')
                      : t('contractActivation.lineClosedAfterTest')
                    : t('contractActivation.recordManualOff')}
                </div>
              </div>
            )}

            {((systemControlledLine && windowOpen) || (!systemControlledLine && workOrderReadyForTest)) && canRecordSpeed && (
              <div style={activationStyles.formGrid}>
                <label style={labelStyle}>{t('contractActivation.downloadMbps')} *
                  <input aria-label={t('contractActivation.downloadMbps')} style={inputStyle} type="number" min="0.01" step="0.01" value={speed.download} onChange={event => setSpeed(previous => ({ ...previous, download: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.uploadMbps')} *
                  <input aria-label={t('contractActivation.uploadMbps')} style={inputStyle} type="number" min="0.01" step="0.01" value={speed.upload} onChange={event => setSpeed(previous => ({ ...previous, upload: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.latencyMs')}
                  <input style={inputStyle} type="number" min="0" step="0.01" value={speed.latency} onChange={event => setSpeed(previous => ({ ...previous, latency: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.jitterMs')}
                  <input style={inputStyle} type="number" min="0" step="0.01" value={speed.jitter} onChange={event => setSpeed(previous => ({ ...previous, jitter: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.packetLoss')}
                  <input style={inputStyle} type="number" min="0" max="100" step="0.01" value={speed.loss} onChange={event => setSpeed(previous => ({ ...previous, loss: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.server')}
                  <input style={inputStyle} value={speed.server} onChange={event => setSpeed(previous => ({ ...previous, server: event.target.value }))} />
                </label>
                <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>{t('contractActivation.testNotes')}
                  <input style={inputStyle} value={speed.notes} onChange={event => setSpeed(previous => ({ ...previous, notes: event.target.value }))} />
                </label>
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={activationStyles.autoOffWarning}>
                    {systemControlledLine ? t('contractActivation.recordAutoOff') : t('contractActivation.recordManualOff')}
                  </p>
                  <button type="button" style={submitBtn} disabled={speedMutation.isPending} onClick={() => speedMutation.mutate()}>
                    {speedMutation.isPending
                      ? t('contractActivation.recordingTest')
                      : systemControlledLine ? t('contractActivation.recordTest') : t('contractActivation.recordStaticTest')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {canViewSignedDocuments && (
        <div style={activationStyles.step} data-testid="activation-documents">
          <h3 style={activationStyles.stepTitle}>
            3. {t(isMxOrg ? 'contractActivation.mxClientSignature' : 'contractActivation.globalClientSignature')}
          </h3>
          <p style={activationStyles.help}>
            {t(isMxOrg ? 'contractActivation.mxClientSignatureHelp' : 'contractActivation.globalClientSignatureHelp')}
          </p>
          {!handoffDocuments.length ? (
            <p style={activationStyles.help}>
              {t(isMxOrg ? 'contractActivation.noMxDocuments' : 'contractActivation.noGlobalDocuments')}
            </p>
          ) : handoffDocuments.map(document => (
            <ActivationDocumentRow key={document.id} document={document} canSign={canSignDocuments} onSign={setSigningId} />
          ))}
        </div>
      )}

      <div style={activationStyles.step}>
        <h3 style={activationStyles.stepTitle}>4. {t('contractActivation.installationHandoff')}</h3>
        <p style={activationStyles.help}>{t('contractActivation.installationHandoffHelp')}</p>
        {visitCompleted ? (
          <p style={activationStyles.done}>{t('contractActivation.visitCompleted')}</p>
        ) : !workOrder ? (
          <p style={activationStyles.help}>{t('contractActivation.prepareFirst')}</p>
        ) : (
          <>
            {signatureBlocked && (
              <p style={activationStyles.autoOffWarning}>
                {t(isMxOrg ? 'contractActivation.mxSignBeforeHandoff' : 'contractActivation.globalSignBeforeHandoff')}
              </p>
            )}
            {!speedTestRecorded && <p style={activationStyles.help}>{t('contractActivation.testBeforeHandoff')}</p>}
            {canCompleteInstallation && (
              <div style={activationStyles.formGrid}>
                <label style={labelStyle}>{t('contractActivation.signalDbm')}
                  <input style={inputStyle} type="number" step="0.01" value={acceptance.signal} onChange={event => setAcceptance(previous => ({ ...previous, signal: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.linkMbps')}
                  <input style={inputStyle} type="number" min="0" step="0.01" value={acceptance.link} onChange={event => setAcceptance(previous => ({ ...previous, link: event.target.value }))} />
                </label>
                <label style={labelStyle}>{t('contractActivation.opticalRxDbm')}
                  <input style={inputStyle} type="number" step="0.01" value={acceptance.rx} onChange={event => setAcceptance(previous => ({ ...previous, rx: event.target.value }))} />
                </label>
                <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'end', paddingBottom: 10 }}>
                  <input type="checkbox" checked={acceptance.waived} onChange={event => setAcceptance(previous => ({ ...previous, waived: event.target.checked }))} />
                  {t('contractActivation.waiveReadings')}
                </label>
                <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>{t('contractActivation.acceptanceNotes')}
                  <input style={inputStyle} value={acceptance.notes} onChange={event => setAcceptance(previous => ({ ...previous, notes: event.target.value }))} />
                </label>
                <div style={{ gridColumn: '1 / -1' }}>
                  <button type="button" style={submitBtn} disabled={!canSubmitAcceptance || acceptanceMutation.isPending} onClick={() => acceptanceMutation.mutate()}>
                    {acceptanceMutation.isPending ? t('contractActivation.completingVisit') : t('contractActivation.completeVisit')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ ...activationStyles.step, borderBottom: 0 }}>
        <h3 style={activationStyles.stepTitle}>5. {t('contractActivation.permanentActivation')}</h3>
        <p style={activationStyles.help}>{t('contractActivation.permanentActivationHelp')}</p>
        <MxSandboxDocumentBanner environment={state.contract_environment} />
        {state.blockers.length > 0 && (
          <div style={activationStyles.blockers}>
            <strong>{t('contractActivation.blockersTitle')}</strong>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem' }}>
              {state.blockers.map(code => <li key={code}>{blockerLabels[code] ?? humanizeBlocker(code)}</li>)}
            </ul>
          </div>
        )}
        {canEdit ? (
          <div>
            <label style={activationStyles.radioLabel}>
              <input type="radio" name="activation-billing" checked={billing === 'already_paid'} onChange={() => setBilling('already_paid')} />
              {t('contractActivation.installationAlreadyPaid')}
            </label>
            {canCreateInvoices && (
              <label style={activationStyles.radioLabel}>
                <input type="radio" name="activation-billing" checked={billing === 'create_invoice'} onChange={() => setBilling('create_invoice')} />
                {t('contractActivation.createInstallationInvoice')}
              </label>
            )}
            {billing === 'create_invoice' && (
              <div style={activationStyles.formGrid}>
                <label style={labelStyle}>{t('contractActivation.installationFee')} *
                  <input style={inputStyle} type="number" min="0.01" step="0.01" value={fee} onChange={event => setFee(event.target.value)} />
                </label>
                <label style={labelStyle}>{t('contractActivation.invoiceDescription')}
                  <input style={inputStyle} value={description} placeholder={t('contractActivation.installationFeeDefault')} onChange={event => setDescription(event.target.value)} />
                </label>
              </div>
            )}
            <button
              type="button"
              style={{ ...submitBtn, marginTop: '0.75rem' }}
              disabled={!state.can_activate || !feeValid || activateMutation.isPending}
              onClick={() => activateMutation.mutate()}
            >
              {activateMutation.isPending ? t('contractActivation.activating') : t('contractActivation.activatePermanently')}
            </button>
          </div>
        ) : (
          <p style={activationStyles.help}>{t('contractActivation.activationPermissionRequired')}</p>
        )}
      </div>

      {signingId !== null && canViewSignedDocuments && canSignDocuments && (
        <ActivationSignModal
          documentId={signingId}
          onClose={() => setSigningId(null)}
          onSigned={() => void queryClient.invalidateQueries({ queryKey: ['contract-activation', contractId] })}
        />
      )}
    </section>
  );
}

interface NetworkRetryResult {
  contract_id: number;
  service_order_id: number | null;
  radius_id: number;
  nas_id: number;
  success: boolean;
  error?: string;
}

function NetworkActivationRecovery({ contractId, canRetry, immediateWarning, onRecovered }: {
  contractId: string;
  canRetry: boolean;
  immediateWarning: string | null;
  onRecovered: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [retryError, setRetryError] = useState('');
  const [retrySuccess, setRetrySuccess] = useState(false);

  const activationQ = useQuery({
    queryKey: ['contract-activation', contractId],
    queryFn: () => fetchActivationState(contractId),
    retry: false,
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const response = await authedFetch(`${API_BASE}/contracts/${contractId}/activation/retry-network`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await activationError(response, t('contractActivation.networkRetryFailed')));
      }
      const json = await response.json() as { data: NetworkRetryResult };
      return json.data;
    },
    onSuccess: result => {
      if (!result.success) {
        setRetrySuccess(false);
        setRetryError(result.error || t('contractActivation.networkRetryFailed'));
        return;
      }
      setRetryError('');
      setRetrySuccess(true);
      onRecovered();
      void queryClient.invalidateQueries({ queryKey: ['contract-activation', contractId] });
      void queryClient.invalidateQueries({ queryKey: ['contract-radius', contractId] });
    },
    onError: (cause: Error) => {
      setRetrySuccess(false);
      setRetryError(cause.message);
    },
  });

  const available = Boolean(activationQ.data?.network_retry_available);
  const visibleWarning = retryError || immediateWarning;
  if (!available && !visibleWarning && !retrySuccess) return null;

  return (
    <section style={{ ...activationStyles.card, borderColor: visibleWarning ? '#f59e0b' : 'var(--border-strong)' }} aria-labelledby="network-activation-recovery-title">
      <div style={{ padding: '0.9rem 1.1rem' }}>
        <h2 id="network-activation-recovery-title" style={{ ...activationStyles.title, fontSize: '1rem' }}>
          {t('contractActivation.networkRecoveryTitle')}
        </h2>
        {visibleWarning ? (
          <p style={{ ...activationStyles.autoOffWarning, margin: '0.6rem 0' }} role="alert">
            {t('contractActivation.networkActivationWarning', { warning: visibleWarning })}
          </p>
        ) : retrySuccess ? (
          <p style={{ ...activationStyles.done, margin: '0.6rem 0' }}>{t('contractActivation.networkRetrySucceeded')}</p>
        ) : (
          <p style={activationStyles.help}>{t('contractActivation.networkRecoveryHelp')}</p>
        )}
        {canRetry ? (
          <button
            type="button"
            style={submitBtn}
            disabled={retryMutation.isPending}
            onClick={() => { setRetryError(''); setRetrySuccess(false); retryMutation.mutate(); }}
          >
            {retryMutation.isPending ? t('contractActivation.retryingNetwork') : t('contractActivation.retryNetworkActivation')}
          </button>
        ) : (
          <p style={activationStyles.help}>{t('contractActivation.networkRetryPermissionRequired')}</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('invoices');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [renewRequiresActivation, setRenewRequiresActivation] = useState(false);
  const [activationNetworkWarning, setActivationNetworkWarning] = useState<string | null>(null);

  const canEdit = can(user, 'contracts.update');
  const canStartInstallation = can(user, 'installations.start');
  const canCreateInvoices = can(user, 'invoices.create');
  const canUpdateWorkOrders = can(user, 'work_orders.update');
  const canCreateSpeedTests = can(user, 'speed_tests.create');
  const canViewSignedDocuments = can(user, 'signed_documents.view');
  const canSignDocuments = can(user, 'signed_documents.sign');
  const isMxOrg = user?.organization_locale === 'MX';
  // Assigning/unassigning devices writes devices.contract_id → devices.update.
  const canManageDevices = can(user, 'devices.update');
  const canCreateDevices = can(user, 'devices.create');

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ['contract-detail-gql', id],
    queryFn: () => fetchContractDetail(id!),
    enabled: Boolean(id),
  });

  const refetchContract = () =>
    queryClient.invalidateQueries({ queryKey: ['contract-detail-gql', id] });

  const isPppoe =
    contract?.connectionType === 'pppoe' || contract?.connectionType === 'pppoe_dual';
  const TABS = isPppoe ? [{ id: 'pppoe' as TabId, label: 'PPPoE' }, ...BASE_TABS] : BASE_TABS;

  async function handleAction(action: 'suspend' | 'unsuspend' | 'renew' | 'terminate') {
    if (!id) return;
    setActionError(null);
    setActionSuccess(null);
    setActionWarning(null);
    if (action !== 'renew') setRenewRequiresActivation(false);
    try {
      const result = await postContractAction(id, action);
      await refetchContract();
      // A renew may (re)provision the PPPoE account — surface the credentials.
      if (action === 'renew' && result.activation_required) {
        setRenewRequiresActivation(true);
        setActivationNetworkWarning(null);
        void queryClient.invalidateQueries({ queryKey: ['contract-activation', id] });
      } else if (action === 'renew' && isPppoe) {
        setRenewRequiresActivation(false);
        setActivationNetworkWarning(result.network_activation?.nas_push_error ?? null);
        queryClient.invalidateQueries({ queryKey: ['contract-radius', id] });
        setActiveTab('pppoe');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} contract`);
    }
  }

  if (isLoading) {
    return (
      <div style={styles.page}>
        <p style={styles.msg}>Loading contract…</p>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div style={styles.page}>
        <p style={styles.msgError}>Contract not found.</p>
        <Link to="/contracts" style={styles.backLink}>Back to Contracts</Link>
      </div>
    );
  }

  const status = contract.status;
  const canSuspend   = status === 'active';
  const canUnsuspend = status === 'suspended';
  const canTerminate = status === 'active' || status === 'suspended';
  const canRenew     = status === 'suspended' || status === 'cancelled' || status === 'expired' || status === 'terminated';

  return (
    <div style={styles.page}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/contracts" style={styles.breadcrumbLink}>Contracts</Link>
        <span style={styles.breadcrumbSep}>›</span>
        {contract.client && (
          <>
            <Link to={`/clients/${contract.client.id}`} style={styles.breadcrumbLink}>
              {contract.client.name}
            </Link>
            <span style={styles.breadcrumbSep}>›</span>
          </>
        )}
        <span style={styles.breadcrumbCurrent}>Contract #{contract.id}</span>
      </div>

      {/* Contract header */}
      <div style={styles.contractHeader}>
        <div>
          <h1 style={styles.contractTitle}>Contract #{contract.id}</h1>
          <div style={styles.headerMeta}>
            <StatusBadge status={contract.status} />
            {contract.mxContractEnvironment && (
              <MxContractEnvironmentBadge environment={contract.mxContractEnvironment} />
            )}
            {contract.connectionType && (
              <span style={styles.metaChip}>{contract.connectionType}</span>
            )}
            {contract.planId && (
              <span style={styles.metaChip}>Plan #{contract.planId}</span>
            )}
          </div>
        </div>
        {canEdit && (
          <div style={styles.headerActions}>
            {canRenew && (
              <button
                type="button"
                style={styles.actionBtn}
                onClick={() => handleAction('renew')}
              >
                Renew
              </button>
            )}
            {canSuspend && (
              <button
                type="button"
                style={{ ...styles.actionBtn, color: '#92400e' }}
                onClick={() => handleAction('suspend')}
              >
                Suspend
              </button>
            )}
            {canUnsuspend && (
              <button
                type="button"
                style={styles.actionBtn}
                onClick={() => handleAction('unsuspend')}
              >
                Unsuspend
              </button>
            )}
            {canTerminate && (
              <button
                type="button"
                style={{ ...styles.actionBtn, color: '#991b1b' }}
                onClick={() => handleAction('terminate')}
              >
                Terminate
              </button>
            )}
          </div>
        )}
      </div>

      <MxSandboxDocumentBanner environment={contract.mxContractEnvironment} />

      {/* Action error */}
      {actionError && (
        <div style={styles.errorBanner}>{actionError}</div>
      )}
      {actionWarning && (
        <div style={activationStyles.autoOffWarning} role="alert">{actionWarning}</div>
      )}
      {renewRequiresActivation && (
        <div style={activationStyles.autoOffWarning}>
          {t('contractActivation.lineOff')}. {t('contractActivation.intro')}
        </div>
      )}
      {actionSuccess && (
        <div style={activationStyles.successBanner}>{actionSuccess}</div>
      )}

      {((status === 'active' && isPppoe) || activationNetworkWarning) && id && (
        <NetworkActivationRecovery
          contractId={id}
          canRetry={canEdit}
          immediateWarning={activationNetworkWarning}
          onRecovered={() => {
            setActivationNetworkWarning(null);
          }}
        />
      )}

      {status === 'pending' && !actionSuccess && id && (
        <ActivationCard
          contractId={id}
          isMxOrg={isMxOrg}
          canEdit={canEdit}
          canStartInstallation={canStartInstallation}
          canCreateInvoices={canCreateInvoices}
          canUpdateWorkOrders={canUpdateWorkOrders}
          canCreateSpeedTests={canCreateSpeedTests}
          canViewSignedDocuments={canViewSignedDocuments}
          canSignDocuments={canSignDocuments}
          operatorUserId={user?.id == null ? null : Number(user.id)}
          canSuperviseCommissioning={canEdit}
          onActivated={(networkWarning) => {
            setRenewRequiresActivation(false);
            setActionWarning(null);
            setActionSuccess(t(isPppoe ? 'contractActivation.activated' : 'contractActivation.activatedManual'));
            setActivationNetworkWarning(networkWarning ?? null);
            void queryClient.invalidateQueries({ queryKey: ['contract-detail-gql', id] });
            void queryClient.invalidateQueries({ queryKey: ['contract-activation', id] });
            void queryClient.invalidateQueries({ queryKey: ['contract-radius', id] });
          }}
          onCancelled={(cleanupPending) => {
            setRenewRequiresActivation(false);
            setActionSuccess(t('contractActivation.activationCancelled'));
            setActionWarning(cleanupPending ? t('contractActivation.activationCancelCleanupPending') : null);
            void queryClient.invalidateQueries({ queryKey: ['contract-detail-gql', id] });
            void queryClient.invalidateQueries({ queryKey: ['contract-activation', id] });
            void queryClient.invalidateQueries({ queryKey: ['contracts'] });
          }}
        />
      )}

      {/* Info card */}
      <ContractInfoCard contract={contract} />

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.tabContent}>
        {activeTab === 'pppoe'    && isPppoe && id && <PppoeTab contractId={id} canEdit={canEdit} />}
        {activeTab === 'invoices' && <InvoicesTab invoices={contract.invoices} />}
        {activeTab === 'devices'  && id && (
          <DevicesTab devices={contract.devices} contractId={id} clientId={contract.clientId ?? null} canManage={canManageDevices} canCreate={canCreateDevices} onChanged={refetchContract} />
        )}
        {activeTab === 'addons'   && <AddonsTab   addons={contract.addons}     />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '2rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1100,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '1.25rem',
    fontSize: '0.85rem',
  },
  breadcrumbLink:    { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  breadcrumbSep:     { color: 'var(--text-dimmed)' },
  breadcrumbCurrent: { color: 'var(--text-secondary)' },
  backLink:          { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },

  contractHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  contractTitle: {
    margin: '0 0 0.35rem',
    color: 'var(--text-primary)',
    fontSize: '1.6rem',
    fontWeight: 700,
  },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const },
  metaChip: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '1px 8px',
    textTransform: 'capitalize' as const,
  },
  headerActions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const },
  actionBtn: {
    padding: '0.45rem 0.85rem',
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },

  errorBanner: {
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 6,
    padding: '0.6rem 1rem',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    border: '1px solid #fecaca',
  },

  infoCard: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    boxShadow: '0 0 0 1px var(--border)',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  infoGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '0.5rem 1.5rem',
  },
  infoRow:   { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem' },
  infoLabel: { color: 'var(--text-dimmed)', fontSize: '0.75rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em', minWidth: 80 },
  infoValue: { color: 'var(--text-secondary)' },
  infoLink:  { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' },
  linkBtn:   { background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0 0.25rem' },
  notesRow:  { marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' },
  noteLabel: { fontWeight: 600, color: 'var(--text-secondary)' },

  tabBar: {
    display: 'flex',
    gap: '0.25rem',
    borderBottom: '2px solid var(--border)',
    marginBottom: '0',
  },
  tabBtn: {
    padding: '0.6rem 1rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    fontFamily: 'var(--font-sans)',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    transition: 'color .15s',
  },
  tabBtnActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
    fontWeight: 600,
  },
  tabContent: {
    background: 'var(--bg-card)',
    borderRadius: '0 0 8px 8px',
    boxShadow: '0 0 0 1px var(--border)',
    minHeight: 200,
  },

  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th: {
    padding: '0.6rem 0.75rem',
    textAlign: 'left' as const,
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '2px solid var(--border-subtle)',
    whiteSpace: 'nowrap' as const,
  },
  tr:       { borderBottom: '1px solid var(--border-subtle)' },
  td:       { padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', verticalAlign: 'middle' as const },
  msg:      { padding: '2rem 1.5rem', color: 'var(--text-muted)', fontStyle: 'italic' as const, margin: 0 },
  msgError: { padding: '2rem 1.5rem', color: '#ef4444', margin: 0 },
};

const activationStyles = {
  card: {
    background: 'var(--bg-card)',
    border: '2px solid var(--accent)',
    borderRadius: 10,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
    marginBottom: '1.5rem',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '1rem 1.25rem',
    background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-card))',
    flexWrap: 'wrap' as const,
  },
  title: { margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem' },
  intro: { margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: 680 },
  lineState: {
    borderRadius: 999,
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
  },
  lineOn: { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' },
  lineOff: { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' },
  step: { padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' },
  stepTitle: { margin: 0, color: 'var(--text-primary)', fontSize: '1rem' },
  help: { margin: '0.35rem 0 0.6rem', color: 'var(--text-secondary)', fontSize: '0.82rem' },
  summary: { margin: '0.25rem 0', color: 'var(--text-secondary)', fontSize: '0.84rem' },
  row: { display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' as const, margin: '0.75rem 0' },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '0.35rem 0.85rem',
    marginTop: '0.75rem',
  },
  result: {
    marginTop: '0.75rem',
    padding: '0.65rem 0.8rem',
    borderRadius: 7,
    background: '#dcfce7',
    color: '#166534',
    fontSize: '0.83rem',
  },
  autoOffWarning: {
    margin: '0 0 0.5rem',
    padding: '0.55rem 0.7rem',
    borderRadius: 7,
    background: '#fef3c7',
    color: '#92400e',
    fontSize: '0.8rem',
  },
  documentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    padding: '0.6rem 0.7rem',
    borderRadius: 7,
    background: 'var(--bg-subtle)',
    fontSize: '0.83rem',
    flexWrap: 'wrap' as const,
  },
  done: { color: '#166534', fontWeight: 600, fontSize: '0.85rem', margin: '0.5rem 0 0' },
  blockers: {
    padding: '0.65rem 0.8rem',
    margin: '0.75rem 0',
    borderRadius: 7,
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: '0.82rem',
  },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 7, marginTop: '0.55rem', fontSize: '0.85rem', cursor: 'pointer' },
  successBanner: {
    background: '#dcfce7',
    color: '#166534',
    border: '1px solid #86efac',
    borderRadius: 7,
    padding: '0.65rem 0.9rem',
    marginBottom: '1rem',
    fontSize: '0.85rem',
  },
};
