// =============================================================================
// FireISP 5.0 — IPv6 Transition Mechanisms
// =============================================================================
// Tabbed page with 4 tabs: 6rd, DS-Lite, MAP Rules, 464XLAT.
// Each tab provides a CRUD table + modal for its transition mechanism type.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SixRdConfig {
  id: number;
  name: string;
  border_relay_ip: string;
  ipv6_prefix: string;
  ipv4_mask_len: number | null;
  mtu: number | null;
  status: string;
  notes: string | null;
}

interface DsLiteConfig {
  id: number;
  name: string;
  aftr_address: string;
  b4_address_range: string | null;
  mtu: number | null;
  status: string;
  notes: string | null;
}

interface MapRule {
  id: number;
  name: string;
  rule_type: string;
  ipv6_prefix: string;
  ipv4_prefix: string;
  ea_bits_len: number | null;
  br_address: string;
  status: string;
  notes: string | null;
}

interface XlatConfig {
  id: number;
  name: string;
  plat_prefix: string;
  clat_prefix: string | null;
  dns64_prefix: string | null;
  status: string;
  notes: string | null;
}

interface MechResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const MAP_RULE_TYPES = ['map-e', 'map-t'];

// ---------------------------------------------------------------------------
// Generic fetch helper
// ---------------------------------------------------------------------------

async function fetchMechanisms<T>(type: string, page: number): Promise<MechResponse<T>> {
  const res = await api.GET(`/transition-mechanisms/${type}` as never, { params: { query: { page, limit: PAGE_SIZE } as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load');
  return (res as { data: unknown }).data as unknown as MechResponse<T>;
}

// ---------------------------------------------------------------------------
// Tab button style helper
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
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    active: { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#fef3c7', color: '#92400e' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 6rd Tab
// ---------------------------------------------------------------------------

interface SixRdBody {
  name: string;
  border_relay_ip: string;
  ipv6_prefix: string;
  ipv4_mask_len?: number;
  mtu?: number;
  status?: string;
  notes?: string;
}

interface SixRdFormProps {
  initial: Partial<SixRdConfig>;
  onSave: (body: SixRdBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function SixRdForm({ initial, onSave, onClose, saving, editMode }: SixRdFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [borderRelayIp, setBorderRelayIp] = useState(initial.border_relay_ip ?? '');
  const [ipv6Prefix, setIpv6Prefix] = useState(initial.ipv6_prefix ?? '');
  const [ipv4MaskLen, setIpv4MaskLen] = useState<string>(
    initial.ipv4_mask_len !== null && initial.ipv4_mask_len !== undefined ? String(initial.ipv4_mask_len) : '',
  );
  const [mtu, setMtu] = useState<string>(
    initial.mtu !== null && initial.mtu !== undefined ? String(initial.mtu) : '',
  );
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: SixRdBody = { name, border_relay_ip: borderRelayIp, ipv6_prefix: ipv6Prefix, status };
    if (ipv4MaskLen) body.ipv4_mask_len = Number(ipv4MaskLen);
    if (mtu) body.mtu = Number(mtu);
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('transition_mechanisms.name', 'Edit 6rd Config') : t('transition_mechanisms.new_6rd', 'New 6rd Config')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.border_relay_ip', 'Border Relay IP')}<RequiredMark /></label>
            <input style={inp} value={borderRelayIp} onChange={e => setBorderRelayIp(e.target.value)} required placeholder="192.0.2.1" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.ipv6_prefix', 'IPv6 Prefix')}<RequiredMark /></label>
            <input style={inp} value={ipv6Prefix} onChange={e => setIpv6Prefix(e.target.value)} required placeholder="2001:db8::/32" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.ipv4_mask_len', 'IPv4 Mask Length')}</label>
              <input style={inp} type="number" min={0} max={32} value={ipv4MaskLen} onChange={e => setIpv4MaskLen(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.mtu', 'MTU')}</label>
              <input style={inp} type="number" min={1280} max={9000} value={mtu} onChange={e => setMtu(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SixRdTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SixRdConfig | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const q = useQuery({
    queryKey: ['transition-6rd', page],
    queryFn: () => fetchMechanisms<SixRdConfig>('6rd', page),
  });

  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: async (body: SixRdBody) => {
      const res = await api.POST('/transition-mechanisms/6rd' as never, { body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to create');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-6rd'] }); setShowForm(false); showMsg('ok', t('transition_mechanisms.create_success', 'Configuration created.')); },
    onError: () => showMsg('err', t('transition_mechanisms.create_error', 'Failed to create configuration.')),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<SixRdBody> }) => {
      const res = await api.PUT('/transition-mechanisms/6rd/{id}' as never, { params: { path: { id } }, body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to update');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-6rd'] }); setEditing(null); showMsg('ok', t('transition_mechanisms.update_success', 'Configuration updated.')); },
    onError: () => showMsg('err', t('transition_mechanisms.update_error', 'Failed to update configuration.')),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.DELETE('/transition-mechanisms/6rd/{id}' as never, { params: { path: { id } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to delete');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-6rd'] }); setDeleteConfirm(null); showMsg('ok', t('transition_mechanisms.delete_success', 'Configuration deleted.')); },
    onError: () => showMsg('err', t('transition_mechanisms.delete_error', 'Failed to delete configuration.')),
  });

  return (
    <div>
      <div style={styles.header}>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('transition_mechanisms.new_6rd', 'New 6rd Config')}
        </button>
      </div>
      {feedback && <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>{feedback.msg}</div>}
      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>Loading...</p>
          : q.error ? <p style={styles.msgError}>{t('transition_mechanisms.error', 'Failed to load configurations.')}</p>
          : items.length === 0 ? <p style={styles.msg}>{t('transition_mechanisms.empty', 'No configurations found.')}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Border Relay IP</th>
                  <th style={styles.th}>IPv6 Prefix</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={styles.tr}>
                      <td style={styles.td}><strong>{item.name}</strong></td>
                      <td style={styles.tdMono}>{item.border_relay_ip}</td>
                      <td style={styles.tdMono}>{item.ipv6_prefix}</td>
                      <td style={styles.td}><StatusBadge status={item.status} /></td>
                      <td style={styles.td}>
                        <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(item)}>Edit</button>
                        <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}
      {showForm && <SixRdForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <SixRdForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('transition_mechanisms.delete_confirm', 'Delete this configuration?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DS-Lite Tab
// ---------------------------------------------------------------------------

interface DsLiteBody {
  name: string;
  aftr_address: string;
  b4_address_range?: string;
  mtu?: number;
  status?: string;
  notes?: string;
}

interface DsLiteFormProps {
  initial: Partial<DsLiteConfig>;
  onSave: (body: DsLiteBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function DsLiteForm({ initial, onSave, onClose, saving, editMode }: DsLiteFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [aftrAddress, setAftrAddress] = useState(initial.aftr_address ?? '');
  const [b4AddressRange, setB4AddressRange] = useState(initial.b4_address_range ?? '');
  const [mtu, setMtu] = useState<string>(initial.mtu !== null && initial.mtu !== undefined ? String(initial.mtu) : '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: DsLiteBody = { name, aftr_address: aftrAddress, status };
    if (b4AddressRange) body.b4_address_range = b4AddressRange;
    if (mtu) body.mtu = Number(mtu);
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? 'Edit DS-Lite Config' : t('transition_mechanisms.new_dslite', 'New DS-Lite Config')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.aftr_address', 'AFTR Address')}<RequiredMark /></label>
            <input style={inp} value={aftrAddress} onChange={e => setAftrAddress(e.target.value)} required placeholder="2001:db8::1" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.b4_address_range', 'B4 Address Range')}</label>
            <input style={inp} value={b4AddressRange} onChange={e => setB4AddressRange(e.target.value)} placeholder="192.0.0.0/29" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.mtu', 'MTU')}</label>
            <input style={inp} type="number" min={1280} max={9000} value={mtu} onChange={e => setMtu(e.target.value)} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DsLiteTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DsLiteConfig | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const q = useQuery({
    queryKey: ['transition-ds-lite', page],
    queryFn: () => fetchMechanisms<DsLiteConfig>('ds-lite', page),
  });

  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: async (body: DsLiteBody) => {
      const res = await api.POST('/transition-mechanisms/ds-lite' as never, { body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to create');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-ds-lite'] }); setShowForm(false); showMsg('ok', t('transition_mechanisms.create_success', 'Configuration created.')); },
    onError: () => showMsg('err', t('transition_mechanisms.create_error', 'Failed to create configuration.')),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<DsLiteBody> }) => {
      const res = await api.PUT('/transition-mechanisms/ds-lite/{id}' as never, { params: { path: { id } }, body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to update');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-ds-lite'] }); setEditing(null); showMsg('ok', t('transition_mechanisms.update_success', 'Configuration updated.')); },
    onError: () => showMsg('err', t('transition_mechanisms.update_error', 'Failed to update configuration.')),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.DELETE('/transition-mechanisms/ds-lite/{id}' as never, { params: { path: { id } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to delete');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-ds-lite'] }); setDeleteConfirm(null); showMsg('ok', t('transition_mechanisms.delete_success', 'Configuration deleted.')); },
    onError: () => showMsg('err', t('transition_mechanisms.delete_error', 'Failed to delete configuration.')),
  });

  return (
    <div>
      <div style={styles.header}>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('transition_mechanisms.new_dslite', 'New DS-Lite Config')}
        </button>
      </div>
      {feedback && <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>{feedback.msg}</div>}
      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>Loading...</p>
          : q.error ? <p style={styles.msgError}>{t('transition_mechanisms.error', 'Failed to load configurations.')}</p>
          : items.length === 0 ? <p style={styles.msg}>{t('transition_mechanisms.empty', 'No configurations found.')}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>AFTR Address</th>
                  <th style={styles.th}>B4 Range</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={styles.tr}>
                      <td style={styles.td}><strong>{item.name}</strong></td>
                      <td style={styles.tdMono}>{item.aftr_address}</td>
                      <td style={styles.tdMono}>{item.b4_address_range ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={item.status} /></td>
                      <td style={styles.td}>
                        <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(item)}>Edit</button>
                        <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}
      {showForm && <DsLiteForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <DsLiteForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('transition_mechanisms.delete_confirm', 'Delete this configuration?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAP Rules Tab
// ---------------------------------------------------------------------------

interface MapRuleBody {
  name: string;
  rule_type?: string;
  ipv6_prefix: string;
  ipv4_prefix: string;
  ea_bits_len?: number;
  br_address: string;
  status?: string;
  notes?: string;
}

interface MapRuleFormProps {
  initial: Partial<MapRule>;
  onSave: (body: MapRuleBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function MapRuleForm({ initial, onSave, onClose, saving, editMode }: MapRuleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [ruleType, setRuleType] = useState(initial.rule_type ?? 'map-e');
  const [ipv6Prefix, setIpv6Prefix] = useState(initial.ipv6_prefix ?? '');
  const [ipv4Prefix, setIpv4Prefix] = useState(initial.ipv4_prefix ?? '');
  const [eaBitsLen, setEaBitsLen] = useState<string>(initial.ea_bits_len !== null && initial.ea_bits_len !== undefined ? String(initial.ea_bits_len) : '');
  const [brAddress, setBrAddress] = useState(initial.br_address ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: MapRuleBody = { name, ipv6_prefix: ipv6Prefix, ipv4_prefix: ipv4Prefix, br_address: brAddress, status };
    if (ruleType) body.rule_type = ruleType;
    if (eaBitsLen) body.ea_bits_len = Number(eaBitsLen);
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? 'Edit MAP Rule' : t('transition_mechanisms.new_map', 'New MAP Rule')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.rule_type', 'Rule Type')}</label>
            <select style={inp} value={ruleType} onChange={e => setRuleType(e.target.value)}>
              {MAP_RULE_TYPES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.ipv6_prefix', 'IPv6 Prefix')}<RequiredMark /></label>
              <input style={inp} value={ipv6Prefix} onChange={e => setIpv6Prefix(e.target.value)} required placeholder="2001:db8::/32" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.ipv4_prefix', 'IPv4 Prefix')}<RequiredMark /></label>
              <input style={inp} value={ipv4Prefix} onChange={e => setIpv4Prefix(e.target.value)} required placeholder="192.0.2.0/24" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.ea_bits_len', 'EA Bits Length')}</label>
              <input style={inp} type="number" min={0} max={128} value={eaBitsLen} onChange={e => setEaBitsLen(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('transition_mechanisms.br_address', 'BR Address')}<RequiredMark /></label>
              <input style={inp} value={brAddress} onChange={e => setBrAddress(e.target.value)} required placeholder="2001:db8::1" />
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MapRulesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MapRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const q = useQuery({
    queryKey: ['transition-map-rules', page],
    queryFn: () => fetchMechanisms<MapRule>('map-rules', page),
  });

  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: async (body: MapRuleBody) => {
      const res = await api.POST('/transition-mechanisms/map-rules' as never, { body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to create');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-map-rules'] }); setShowForm(false); showMsg('ok', t('transition_mechanisms.create_success', 'Configuration created.')); },
    onError: () => showMsg('err', t('transition_mechanisms.create_error', 'Failed to create configuration.')),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<MapRuleBody> }) => {
      const res = await api.PUT('/transition-mechanisms/map-rules/{id}' as never, { params: { path: { id } }, body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to update');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-map-rules'] }); setEditing(null); showMsg('ok', t('transition_mechanisms.update_success', 'Configuration updated.')); },
    onError: () => showMsg('err', t('transition_mechanisms.update_error', 'Failed to update configuration.')),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.DELETE('/transition-mechanisms/map-rules/{id}' as never, { params: { path: { id } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to delete');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-map-rules'] }); setDeleteConfirm(null); showMsg('ok', t('transition_mechanisms.delete_success', 'Configuration deleted.')); },
    onError: () => showMsg('err', t('transition_mechanisms.delete_error', 'Failed to delete configuration.')),
  });

  return (
    <div>
      <div style={styles.header}>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('transition_mechanisms.new_map', 'New MAP Rule')}
        </button>
      </div>
      {feedback && <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>{feedback.msg}</div>}
      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>Loading...</p>
          : q.error ? <p style={styles.msgError}>{t('transition_mechanisms.error', 'Failed to load configurations.')}</p>
          : items.length === 0 ? <p style={styles.msg}>{t('transition_mechanisms.empty', 'No configurations found.')}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Rule Type</th>
                  <th style={styles.th}>IPv6 Prefix</th>
                  <th style={styles.th}>IPv4 Prefix</th>
                  <th style={styles.th}>BR Address</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={styles.tr}>
                      <td style={styles.td}><strong>{item.name}</strong></td>
                      <td style={styles.td}>{item.rule_type.toUpperCase()}</td>
                      <td style={styles.tdMono}>{item.ipv6_prefix}</td>
                      <td style={styles.tdMono}>{item.ipv4_prefix}</td>
                      <td style={styles.tdMono}>{item.br_address}</td>
                      <td style={styles.td}><StatusBadge status={item.status} /></td>
                      <td style={styles.td}>
                        <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(item)}>Edit</button>
                        <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}
      {showForm && <MapRuleForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <MapRuleForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('transition_mechanisms.delete_confirm', 'Delete this configuration?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 464XLAT Tab
// ---------------------------------------------------------------------------

interface XlatBody {
  name: string;
  plat_prefix: string;
  clat_prefix?: string;
  dns64_prefix?: string;
  status?: string;
  notes?: string;
}

interface XlatFormProps {
  initial: Partial<XlatConfig>;
  onSave: (body: XlatBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function XlatForm({ initial, onSave, onClose, saving, editMode }: XlatFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [platPrefix, setPlatPrefix] = useState(initial.plat_prefix ?? '');
  const [clatPrefix, setClatPrefix] = useState(initial.clat_prefix ?? '');
  const [dns64Prefix, setDns64Prefix] = useState(initial.dns64_prefix ?? '');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: XlatBody = { name, plat_prefix: platPrefix, status };
    if (clatPrefix) body.clat_prefix = clatPrefix;
    if (dns64Prefix) body.dns64_prefix = dns64Prefix;
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? 'Edit 464XLAT Config' : t('transition_mechanisms.new_464xlat', 'New 464XLAT Config')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.plat_prefix', 'PLAT Prefix')}<RequiredMark /></label>
            <input style={inp} value={platPrefix} onChange={e => setPlatPrefix(e.target.value)} required placeholder="64:ff9b::/96" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.clat_prefix', 'CLAT Prefix')}</label>
            <input style={inp} value={clatPrefix} onChange={e => setClatPrefix(e.target.value)} placeholder="2001:db8:1::/48" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.dns64_prefix', 'DNS64 Prefix')}</label>
            <input style={inp} value={dns64Prefix} onChange={e => setDns64Prefix(e.target.value)} placeholder="64:ff9b::/96" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('transition_mechanisms.notes', 'Notes')}</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' as const }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={styles.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function XlatTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<XlatConfig | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const q = useQuery({
    queryKey: ['transition-464xlat', page],
    queryFn: () => fetchMechanisms<XlatConfig>('464xlat', page),
  });

  const items = q.data?.data ?? [];
  const meta = q.data?.meta;
  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: async (body: XlatBody) => {
      const res = await api.POST('/transition-mechanisms/464xlat' as never, { body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to create');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-464xlat'] }); setShowForm(false); showMsg('ok', t('transition_mechanisms.create_success', 'Configuration created.')); },
    onError: () => showMsg('err', t('transition_mechanisms.create_error', 'Failed to create configuration.')),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<XlatBody> }) => {
      const res = await api.PUT('/transition-mechanisms/464xlat/{id}' as never, { params: { path: { id } }, body: body as never } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to update');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-464xlat'] }); setEditing(null); showMsg('ok', t('transition_mechanisms.update_success', 'Configuration updated.')); },
    onError: () => showMsg('err', t('transition_mechanisms.update_error', 'Failed to update configuration.')),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.DELETE('/transition-mechanisms/464xlat/{id}' as never, { params: { path: { id } } } as never);
      if ((res as { error?: unknown }).error) throw new Error('Failed to delete');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transition-464xlat'] }); setDeleteConfirm(null); showMsg('ok', t('transition_mechanisms.delete_success', 'Configuration deleted.')); },
    onError: () => showMsg('err', t('transition_mechanisms.delete_error', 'Failed to delete configuration.')),
  });

  return (
    <div>
      <div style={styles.header}>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('transition_mechanisms.new_464xlat', 'New 464XLAT Config')}
        </button>
      </div>
      {feedback && <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>{feedback.msg}</div>}
      <div style={styles.tableCard}>
        {q.isLoading ? <p style={styles.msg}>Loading...</p>
          : q.error ? <p style={styles.msgError}>{t('transition_mechanisms.error', 'Failed to load configurations.')}</p>
          : items.length === 0 ? <p style={styles.msg}>{t('transition_mechanisms.empty', 'No configurations found.')}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>PLAT Prefix</th>
                  <th style={styles.th}>CLAT Prefix</th>
                  <th style={styles.th}>DNS64 Prefix</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={styles.tr}>
                      <td style={styles.td}><strong>{item.name}</strong></td>
                      <td style={styles.tdMono}>{item.plat_prefix}</td>
                      <td style={styles.tdMono}>{item.clat_prefix ?? '—'}</td>
                      <td style={styles.tdMono}>{item.dns64_prefix ?? '—'}</td>
                      <td style={styles.td}><StatusBadge status={item.status} /></td>
                      <td style={styles.td}>
                        <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(item)}>Edit</button>
                        <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}
      {showForm && <XlatForm initial={{}} onSave={body => createMut.mutate(body)} onClose={() => setShowForm(false)} saving={createMut.isPending} editMode={false} />}
      {editing && <XlatForm initial={editing} onSave={body => updateMut.mutate({ id: editing.id, body })} onClose={() => setEditing(null)} saving={updateMut.isPending} editMode={true} />}
      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('transition_mechanisms.delete_confirm', 'Delete this configuration?')}</p>
            <div style={modalStyles.actions}>
              <button style={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.btnDanger} onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function TransitionMechanismsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'6rd' | 'dslite' | 'map' | 'xlat'>('6rd');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('transition_mechanisms.title', 'IPv6 Transition Mechanisms')}</h1>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <button style={tabBtn(tab === '6rd')} onClick={() => setTab('6rd')}>
          {t('transition_mechanisms.tab_6rd', '6rd Tunnels')}
        </button>
        <button style={tabBtn(tab === 'dslite')} onClick={() => setTab('dslite')}>
          {t('transition_mechanisms.tab_dslite', 'DS-Lite')}
        </button>
        <button style={tabBtn(tab === 'map')} onClick={() => setTab('map')}>
          {t('transition_mechanisms.tab_map', 'MAP Rules')}
        </button>
        <button style={tabBtn(tab === 'xlat')} onClick={() => setTab('xlat')}>
          {t('transition_mechanisms.tab_464xlat', '464XLAT')}
        </button>
      </div>

      {tab === '6rd' && <SixRdTab />}
      {tab === 'dslite' && <DsLiteTab />}
      {tab === 'map' && <MapRulesTab />}
      {tab === 'xlat' && <XlatTab />}
    </div>
  );
}
