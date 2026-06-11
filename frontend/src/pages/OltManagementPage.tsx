// =============================================================================
// FireISP 5.0 — OLT Management (§7.1)
// =============================================================================
// Tabbed page covering:
//   1. OLT Ports   — list/create/edit OLT PON and uplink ports
//   2. Splitters    — splitter inventory CRUD
// OLT devices themselves are managed on the existing /devices page (type=olt).
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OltPort {
  id: number;
  olt_device_id: number;
  olt_name?: string;
  port_index: number;
  port_name: string;
  port_type: string;
  slot_no: number | null;
  port_no: number | null;
  admin_status: string;
  oper_status: string;
  onu_count: number;
  max_onus: number;
  tx_power_dbm: number | null;
  rx_power_dbm: number | null;
}

interface OltPortsResponse {
  data: OltPort[];
  meta: { total: number; page: number; limit: number };
}

interface OltPortBody {
  olt_device_id: number;
  port_index: number;
  port_name: string;
  port_type?: string;
  admin_status?: string;
  max_onus?: number;
  notes?: string;
}

interface OltSplitter {
  id: number;
  name: string;
  ratio: string;
  splitter_type: string;
  status: string;
  location_detail: string | null;
  installed_at: string | null;
}

interface SplittersResponse {
  data: OltSplitter[];
  meta: { total: number; page: number; limit: number };
}

interface SplitterBody {
  name: string;
  olt_port_id?: number;
  ratio?: string;
  splitter_type?: string;
  location_detail?: string;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const PORT_TYPES = ['gpon', 'epon', 'xgspon', 'uplink', 'cascade', 'other'];
const OPER_STATUSES = ['up', 'down', 'testing', 'unknown', 'notPresent', 'lowerLayerDown'];
const RATIOS = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128'];
const SPLITTER_STATUSES = ['active', 'inactive', 'damaged', 'removed'];

// ---------------------------------------------------------------------------
// Tab button style
// ---------------------------------------------------------------------------

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  border: 'none',
  borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--primary)' : 'var(--text-secondary)',
});

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPorts(page: number, portType: string, operStatus: string): Promise<OltPortsResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (portType) query.port_type = portType;
  if (operStatus) query.oper_status = operStatus;
  const res = await api.GET('/olt-management/ports' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load OLT ports');
  return (res as { data: unknown }).data as unknown as OltPortsResponse;
}

async function createPort(body: OltPortBody): Promise<void> {
  const res = await api.POST('/olt-management/{id}/ports' as never, {
    params: { path: { id: body.olt_device_id } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create OLT port');
}

async function updatePort(portId: number, body: Partial<OltPortBody>): Promise<void> {
  const res = await api.PUT('/olt-management/ports/{portId}' as never, {
    params: { path: { portId } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update OLT port');
}

async function deletePort(portId: number): Promise<void> {
  const res = await api.DELETE('/olt-management/ports/{portId}' as never, {
    params: { path: { portId } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete OLT port');
}

async function fetchSplitters(page: number, status: string): Promise<SplittersResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (status) query.status = status;
  const res = await api.GET('/olt-management/splitters' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load splitters');
  return (res as { data: unknown }).data as unknown as SplittersResponse;
}

async function createSplitter(body: SplitterBody): Promise<void> {
  const res = await api.POST('/olt-management/splitters' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create splitter');
}

async function updateSplitter(splitterId: number, body: Partial<SplitterBody>): Promise<void> {
  const res = await api.PUT('/olt-management/splitters/{splitterId}' as never, {
    params: { path: { splitterId } },
    body: body as never,
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update splitter');
}

async function deleteSplitter(splitterId: number): Promise<void> {
  const res = await api.DELETE('/olt-management/splitters/{splitterId}' as never, {
    params: { path: { splitterId } },
  } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete splitter');
}

// ---------------------------------------------------------------------------
// Oper status badge
// ---------------------------------------------------------------------------

function OperStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    up:             { bg: '#d1fae5', color: '#065f46' },
    down:           { bg: '#fee2e2', color: '#991b1b' },
    unknown:        { bg: '#f3f4f6', color: '#374151' },
    testing:        { bg: '#fef3c7', color: '#92400e' },
    notPresent:     { bg: '#f3f4f6', color: '#6b7280' },
    lowerLayerDown: { bg: '#fed7aa', color: '#9a3412' },
  };
  const s = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 12,
      fontSize: '0.72rem', fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// OLT Ports Tab
// ---------------------------------------------------------------------------

function OltPortsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [portType, setPortType] = useState('');
  const [operStatus, setOperStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OltPort | null>(null);
  const [form, setForm] = useState<Partial<OltPortBody>>({});
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['oltPorts', page, portType, operStatus],
    queryFn: () => fetchPorts(page, portType, operStatus),
  });

  const createMut = useMutation({
    mutationFn: createPort,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oltPorts'] }); close_(); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<OltPortBody> }) => updatePort(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oltPorts'] }); close_(); },
  });
  const deleteMut = useMutation({
    mutationFn: deletePort,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oltPorts'] }),
  });

  function openCreate() { setEditing(null); setForm({}); setErr(''); setOpen(true); }
  function openEdit(p: OltPort) {
    setEditing(p);
    setForm({ port_name: p.port_name, port_type: p.port_type, admin_status: p.admin_status, max_onus: p.max_onus });
    setErr('');
    setOpen(true);
  }
  function close_() { setOpen(false); setEditing(null); setForm({}); setErr(''); }

  function submit() {
    if (!form.port_name) { setErr(t('oltManagement.ports.nameRequired')); return; }
    if (editing) {
      updateMut.mutate({ id: editing.id, body: form });
    } else {
      if (!form.olt_device_id || form.port_index === undefined) {
        setErr(t('oltManagement.ports.fieldsRequired'));
        return;
      }
      createMut.mutate(form as OltPortBody);
    }
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);
  const busy = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div style={styles.filterRow}>
        <select
          value={portType}
          onChange={e => { setPortType(e.target.value); setPage(1); }}
          style={styles.filterSelect}
        >
          <option value="">{t('oltManagement.ports.allTypes')}</option>
          {PORT_TYPES.map(pt => <option key={pt} value={pt}>{pt.toUpperCase()}</option>)}
        </select>
        <select
          value={operStatus}
          onChange={e => { setOperStatus(e.target.value); setPage(1); }}
          style={styles.filterSelect}
        >
          <option value="">{t('oltManagement.ports.allStatuses')}</option>
          {OPER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('oltManagement.ports.newPort')}</button>
      </div>

      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('oltManagement.ports.olt')}</th>
                  <th style={styles.th}>{t('oltManagement.ports.port')}</th>
                  <th style={styles.th}>{t('oltManagement.ports.type')}</th>
                  <th style={styles.th}>{t('oltManagement.ports.operStatus')}</th>
                  <th style={styles.thNum}>{t('oltManagement.ports.onus')}</th>
                  <th style={styles.thNum}>{t('oltManagement.ports.txPower')}</th>
                  <th style={styles.thNum}>{t('oltManagement.ports.rxPower')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && (
                  <tr><td colSpan={8} style={styles.msg}>{t('common.noResults')}</td></tr>
                )}
                {data?.data.map(port => (
                  <tr key={port.id} style={styles.tr}>
                    <td style={styles.td}>{port.olt_name ?? `OLT #${port.olt_device_id}`}</td>
                    <td style={styles.tdMono}>{port.port_name}</td>
                    <td style={styles.td}>
                      <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 600 }}>
                        {port.port_type}
                      </span>
                    </td>
                    <td style={styles.td}><OperStatusBadge status={port.oper_status} /></td>
                    <td style={styles.tdNum}>{port.onu_count} / {port.max_onus}</td>
                    <td style={styles.tdNum}>{port.tx_power_dbm != null ? `${port.tx_power_dbm} dBm` : '—'}</td>
                    <td style={styles.tdNum}>{port.rx_power_dbm != null ? `${port.rx_power_dbm} dBm` : '—'}</td>
                    <td style={styles.td}>
                      <button style={styles.actionBtn} onClick={() => openEdit(port)}>{t('common.edit')}</button>
                      <button
                        style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                        onClick={() => {
                          if (window.confirm(t('oltManagement.ports.confirmDelete'))) deleteMut.mutate(port.id);
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>
                {editing ? t('oltManagement.ports.editTitle') : t('oltManagement.ports.createTitle')}
              </h3>
              <button style={modalStyles.closeBtn} onClick={close_}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              {!editing && (
                <>
                  <label style={modalStyles.label}>
                    {t('oltManagement.ports.oltDeviceId')}<RequiredMark />
                    <input
                      style={modalStyles.input}
                      type="number"
                      value={form.olt_device_id ?? ''}
                      onChange={e => setForm(f => ({ ...f, olt_device_id: Number(e.target.value) }))}
                    />
                  </label>
                  <label style={modalStyles.label}>
                    {t('oltManagement.ports.portIndex')}<RequiredMark />
                    <input
                      style={modalStyles.input}
                      type="number"
                      value={form.port_index ?? ''}
                      onChange={e => setForm(f => ({ ...f, port_index: Number(e.target.value) }))}
                    />
                  </label>
                </>
              )}
              <label style={modalStyles.label}>
                {t('oltManagement.ports.portName')}<RequiredMark />
                <input
                  style={modalStyles.input}
                  value={form.port_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, port_name: e.target.value }))}
                  placeholder="GPON 0/1/3"
                />
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.ports.portType')}
                <select
                  style={modalStyles.select}
                  value={form.port_type ?? 'gpon'}
                  onChange={e => setForm(f => ({ ...f, port_type: e.target.value }))}
                >
                  {PORT_TYPES.map(pt => <option key={pt} value={pt}>{capitalize(pt)}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.ports.adminStatus')}
                <select
                  style={modalStyles.select}
                  value={form.admin_status ?? 'up'}
                  onChange={e => setForm(f => ({ ...f, admin_status: e.target.value }))}
                >
                  <option value="up">{t('oltManagement.ports.up')}</option>
                  <option value="down">{t('oltManagement.ports.down')}</option>
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.ports.maxOnus')}
                <input
                  style={modalStyles.input}
                  type="number"
                  value={form.max_onus ?? 128}
                  onChange={e => setForm(f => ({ ...f, max_onus: Number(e.target.value) }))}
                />
              </label>
              <div style={modalStyles.actions}>
                <button onClick={close_} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={busy} style={styles.btnPrimary}>
                  {busy ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Splitters Tab
// ---------------------------------------------------------------------------

function SplittersTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OltSplitter | null>(null);
  const [form, setForm] = useState<Partial<SplitterBody>>({});
  const [err, setErr] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['oltSplitters', page, status],
    queryFn: () => fetchSplitters(page, status),
  });

  const createMut = useMutation({
    mutationFn: createSplitter,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oltSplitters'] }); close_(); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<SplitterBody> }) => updateSplitter(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oltSplitters'] }); close_(); },
  });
  const deleteMut = useMutation({
    mutationFn: deleteSplitter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oltSplitters'] }),
  });

  function openCreate() { setEditing(null); setForm({}); setErr(''); setOpen(true); }
  function openEdit(sp: OltSplitter) {
    setEditing(sp);
    setForm({ name: sp.name, ratio: sp.ratio, splitter_type: sp.splitter_type, status: sp.status, location_detail: sp.location_detail ?? '' });
    setErr('');
    setOpen(true);
  }
  function close_() { setOpen(false); setEditing(null); setForm({}); setErr(''); }

  function submit() {
    if (!form.name) { setErr(t('oltManagement.splitters.nameRequired')); return; }
    if (editing) {
      updateMut.mutate({ id: editing.id, body: form });
    } else {
      createMut.mutate(form as SplitterBody);
    }
  }

  const totalPages = Math.ceil((data?.meta?.total ?? 0) / PAGE_SIZE);
  const busy = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div style={styles.filterRow}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={styles.filterSelect}>
          <option value="">{t('oltManagement.splitters.allStatuses')}</option>
          {SPLITTER_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('oltManagement.splitters.newSplitter')}</button>
      </div>

      <div style={styles.tableCard}>
        {isLoading && <p style={styles.msg}>{t('common.loading')}</p>}
        {isError && <p style={styles.msgError}>{t('common.loadError')}</p>}
        {!isLoading && !isError && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('oltManagement.splitters.name')}</th>
                  <th style={styles.th}>{t('oltManagement.splitters.ratio')}</th>
                  <th style={styles.th}>{t('oltManagement.splitters.type')}</th>
                  <th style={styles.th}>{t('oltManagement.splitters.status')}</th>
                  <th style={styles.th}>{t('oltManagement.splitters.location')}</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && (
                  <tr><td colSpan={6} style={styles.msg}>{t('common.noResults')}</td></tr>
                )}
                {data?.data.map(sp => (
                  <tr key={sp.id} style={styles.tr}>
                    <td style={styles.td}>{sp.name}</td>
                    <td style={styles.tdMono}><strong>{sp.ratio}</strong></td>
                    <td style={styles.td}>{capitalize(sp.splitter_type)}</td>
                    <td style={styles.td}>{capitalize(sp.status)}</td>
                    <td style={styles.td}>{sp.location_detail ?? '—'}</td>
                    <td style={styles.td}>
                      <button style={styles.actionBtn} onClick={() => openEdit(sp)}>{t('common.edit')}</button>
                      <button
                        style={{ ...styles.actionBtn, color: 'var(--danger)' }}
                        onClick={() => {
                          if (window.confirm(t('oltManagement.splitters.confirmDelete'))) deleteMut.mutate(sp.id);
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>{t('common.prev')}</button>
            <span style={styles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>{t('common.next')}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={modalStyles.backdrop}>
          <div style={modalStyles.panel}>
            <div style={modalStyles.header}>
              <h3 style={modalStyles.title}>
                {editing ? t('oltManagement.splitters.editTitle') : t('oltManagement.splitters.createTitle')}
              </h3>
              <button style={modalStyles.closeBtn} onClick={close_}>&#x2715;</button>
            </div>
            <div style={modalStyles.form}>
              {err && <p style={modalStyles.error}>{err}</p>}
              <label style={modalStyles.label}>
                {t('oltManagement.splitters.name')}<RequiredMark />
                <input
                  style={modalStyles.input}
                  value={form.name ?? ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.splitters.ratio')}
                <select
                  style={modalStyles.select}
                  value={form.ratio ?? '1:32'}
                  onChange={e => setForm(f => ({ ...f, ratio: e.target.value }))}
                >
                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.splitters.location')}
                <input
                  style={modalStyles.input}
                  value={form.location_detail ?? ''}
                  onChange={e => setForm(f => ({ ...f, location_detail: e.target.value }))}
                  placeholder={t('oltManagement.splitters.locationPlaceholder')}
                />
              </label>
              <label style={modalStyles.label}>
                {t('oltManagement.splitters.status')}
                <select
                  style={modalStyles.select}
                  value={form.status ?? 'active'}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  {SPLITTER_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
                </select>
              </label>
              <div style={modalStyles.actions}>
                <button onClick={close_} style={styles.btnSecondary}>{t('common.cancel')}</button>
                <button onClick={submit} disabled={busy} style={styles.btnPrimary}>
                  {busy ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = 'ports' | 'splitters';

export function OltManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('ports');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>{t('oltManagement.title')}</h2>
      </div>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 1.25rem', fontSize: '0.9rem' }}>
        {t('oltManagement.subtitle')}
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
        <button style={tabBtn(tab === 'ports')} onClick={() => setTab('ports')}>{t('oltManagement.tabs.ports')}</button>
        <button style={tabBtn(tab === 'splitters')} onClick={() => setTab('splitters')}>{t('oltManagement.tabs.splitters')}</button>
      </div>

      {tab === 'ports' && <OltPortsTab />}
      {tab === 'splitters' && <SplittersTab />}
    </div>
  );
}
