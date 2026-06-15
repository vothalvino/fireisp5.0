// =============================================================================
// FireISP 5.0 — IPv6 Management
// =============================================================================
// Tabbed page with 3 tabs:
//   1. RA Guard Policies — CRUD table
//   2. Subnet Planner — form + results table
//   3. Pool Conflicts — conflict detection table
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark, capitalize } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RaGuardPolicy {
  id: number;
  name: string;
  switch_id: number | null;
  port_pattern: string | null;
  policy_type: string;
  status: string;
  notes: string | null;
}

interface RaGuardResponse {
  data: RaGuardPolicy[];
  meta: { total: number; page: number; limit: number };
}

interface RaGuardBody {
  name: string;
  switch_id?: number;
  port_pattern?: string;
  policy_type?: string;
  status?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const STATUSES = ['active', 'inactive'];
const POLICY_TYPES = ['strict', 'loose'];

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
// RA Guard API helpers
// ---------------------------------------------------------------------------

async function fetchRaGuard(page: number, statusFilter: string): Promise<RaGuardResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  if (statusFilter) query.status = statusFilter;
  const res = await api.GET('/ipv6/ra-guard' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load RA Guard policies');
  return (res as { data: unknown }).data as unknown as RaGuardResponse;
}

async function createRaGuard(body: RaGuardBody): Promise<void> {
  const res = await api.POST('/ipv6/ra-guard' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create RA Guard policy');
}

async function updateRaGuard(id: number, body: Partial<RaGuardBody>): Promise<void> {
  const res = await api.PUT('/ipv6/ra-guard/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update RA Guard policy');
}

async function deleteRaGuard(id: number): Promise<void> {
  const res = await api.DELETE('/ipv6/ra-guard/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete RA Guard policy');
}

// ---------------------------------------------------------------------------
// RA Guard form modal
// ---------------------------------------------------------------------------

interface RaGuardFormProps {
  initial: Partial<RaGuardPolicy>;
  onSave: (body: RaGuardBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function RaGuardForm({ initial, onSave, onClose, saving, editMode }: RaGuardFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [switchId, setSwitchId] = useState<string>(
    initial.switch_id !== null && initial.switch_id !== undefined ? String(initial.switch_id) : '',
  );
  const [portPattern, setPortPattern] = useState(initial.port_pattern ?? '');
  const [policyType, setPolicyType] = useState(initial.policy_type ?? 'strict');
  const [status, setStatus] = useState(initial.status ?? 'active');
  const [notes, setNotes] = useState(initial.notes ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: RaGuardBody = { name, status };
    if (switchId) body.switch_id = Number(switchId);
    if (portPattern) body.port_pattern = portPattern;
    if (policyType) body.policy_type = policyType;
    if (notes) body.notes = notes;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('ipv6_management.edit_ra_guard', 'Edit RA Guard Policy') : t('ipv6_management.new_ra_guard', 'New RA Guard Policy')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('ipv6_management.name', 'Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('ipv6_management.switch_id', 'Switch ID')}</label>
              <input style={inp} type="number" min={1} value={switchId} onChange={e => setSwitchId(e.target.value)} />
            </div>
            <div>
              <label style={modalStyles.label}>{t('ipv6_management.port_pattern', 'Port Pattern')}</label>
              <input style={inp} value={portPattern} onChange={e => setPortPattern(e.target.value)} placeholder="ether1-10" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('ipv6_management.policy_type', 'Policy Type')}</label>
            <select style={inp} value={policyType} onChange={e => setPolicyType(e.target.value)}>
              {POLICY_TYPES.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('ipv6_management.status', 'Status')}</label>
            <select style={inp} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={modalStyles.label}>{t('ipv6_management.notes', 'Notes')}</label>
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

// ---------------------------------------------------------------------------
// RA Guard Tab
// ---------------------------------------------------------------------------

function RaGuardTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [raPage, setRaPage] = useState(1);
  const [raStatusFilter, setRaStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RaGuardPolicy | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const raQ = useQuery({
    queryKey: ['ra-guard', raPage, raStatusFilter],
    queryFn: () => fetchRaGuard(raPage, raStatusFilter),
  });

  const policies = raQ.data?.data ?? [];
  const meta = raQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createRaGuard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-guard'] });
      setShowForm(false);
      showMsg('ok', t('ipv6_management.ra_guard_create_success', 'RA Guard policy created.'));
    },
    onError: () => showMsg('err', 'Failed to create RA Guard policy.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<RaGuardBody> }) => updateRaGuard(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-guard'] });
      setEditing(null);
      showMsg('ok', 'RA Guard policy updated.');
    },
    onError: () => showMsg('err', 'Failed to update RA Guard policy.'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRaGuard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ra-guard'] });
      setDeleteConfirm(null);
      showMsg('ok', 'RA Guard policy deleted.');
    },
    onError: () => showMsg('err', 'Failed to delete RA Guard policy.'),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div>
      <div style={styles.header}>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('ipv6_management.new_ra_guard', 'New RA Guard Policy')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Status:</span>
        <select style={styles.filterSelect} value={raStatusFilter} onChange={e => { setRaStatusFilter(e.target.value); setRaPage(1); }}>
          <option value="">All</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      <div style={styles.tableCard}>
        {raQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : raQ.error ? (
          <p style={styles.msgError}>{t('ipv6_management.ra_guard_error', 'Failed to load RA Guard policies.')}</p>
        ) : policies.length === 0 ? (
          <p style={styles.msg}>{t('ipv6_management.ra_guard_empty', 'No RA Guard policies found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Switch ID</th>
                  <th style={styles.th}>Port Pattern</th>
                  <th style={styles.th}>Policy Type</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map(p => (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}><strong>{p.name}</strong></td>
                    <td style={styles.td}>{p.switch_id ?? '—'}</td>
                    <td style={styles.tdMono}>{p.port_pattern ?? '—'}</td>
                    <td style={styles.td}>{capitalize(p.policy_type)}</td>
                    <td style={styles.td}><StatusBadge status={p.status} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(p)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(p.id)}>Delete</button>
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
          <button style={styles.pageBtn} disabled={raPage <= 1} onClick={() => setRaPage(p => p - 1)}>&larr; Prev</button>
          <span style={styles.pageInfo}>Page {raPage} of {totalPages}</span>
          <button style={styles.pageBtn} disabled={raPage >= totalPages} onClick={() => setRaPage(p => p + 1)}>Next &rarr;</button>
        </div>
      )}

      {showForm && (
        <RaGuardForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <RaGuardForm
          initial={editing}
          onSave={body => updateMut.mutate({ id: editing.id, body })}
          onClose={() => setEditing(null)}
          saving={updateMut.isPending}
          editMode={true}
        />
      )}

      {deleteConfirm !== null && (
        <div style={modalStyles.backdrop} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...modalStyles.panel, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.5rem' }}>{t('ipv6_management.ra_guard_delete_confirm', 'Delete this RA Guard policy?')}</p>
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
// Subnet Planner Tab
// ---------------------------------------------------------------------------

function SubnetPlannerTab() {
  const { t } = useTranslation();
  const [spNetwork, setSpNetwork] = useState('');
  const [spPrefixLen, setSpPrefixLen] = useState('');
  const [spSubPrefixLen, setSpSubPrefixLen] = useState('');
  const [spResults, setSpResults] = useState<string[]>([]);
  const [spError, setSpError] = useState<string | null>(null);
  const [spLoading, setSpLoading] = useState(false);

  async function runSubnetPlan() {
    // Only `network` is required. The parent prefix can be read from the CIDR
    // suffix (e.g. 2001:db8::/32) and the subnet prefix has a server-side
    // default, so those two fields are optional — send them only when filled.
    if (!spNetwork) return;
    setSpLoading(true);
    setSpError(null);
    try {
      const query: Record<string, string | number> = { network: spNetwork };
      if (spPrefixLen) query.prefix_len = Number(spPrefixLen);
      if (spSubPrefixLen) query.sub_prefix_len = Number(spSubPrefixLen);
      const res = await api.GET('/ipv6/subnet-plan' as never, {
        params: { query: query as never },
      } as never);
      if (res.error) throw new Error('Failed to plan subnets');
      const data = res.data as unknown as { data: string[] };
      setSpResults(data.data ?? []);
    } catch (e) {
      setSpError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSpLoading(false);
    }
  }

  const inp: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.875rem', background: 'var(--input-bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' as const };
  const lbl: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div>
          <label style={lbl}>{t('ipv6_management.subnet_plan_network', 'Network (CIDR)')}</label>
          <input style={inp} value={spNetwork} onChange={e => setSpNetwork(e.target.value)} placeholder="2001:db8::/32" />
        </div>
        <div>
          <label style={lbl}>{t('ipv6_management.subnet_plan_prefix', 'Network Prefix Length')}</label>
          <input style={inp} type="number" min={0} max={128} value={spPrefixLen} onChange={e => setSpPrefixLen(e.target.value)} placeholder="32" />
        </div>
        <div>
          <label style={lbl}>{t('ipv6_management.subnet_plan_sub', 'Subnet Prefix Length')}</label>
          <input style={inp} type="number" min={0} max={128} value={spSubPrefixLen} onChange={e => setSpSubPrefixLen(e.target.value)} placeholder="48" />
        </div>
        <div>
          <button style={{ ...styles.btnPrimary, whiteSpace: 'nowrap' as const }} onClick={runSubnetPlan} disabled={spLoading || !spNetwork}>
            {spLoading ? 'Planning...' : t('ipv6_management.subnet_plan_run', 'Plan Subnets')}
          </button>
        </div>
      </div>

      {spError && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: '#fee2e2', color: '#991b1b', fontSize: '0.85rem' }}>
          {spError}
        </div>
      )}

      {spResults.length > 0 && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th>
                <th style={styles.th}>{t('ipv6_management.subnet_plan_result', 'Subnets')}</th>
              </tr>
            </thead>
            <tbody>
              {spResults.map((subnet, i) => (
                <tr key={subnet} style={styles.tr}>
                  <td style={styles.td}>{i + 1}</td>
                  <td style={styles.tdMono}>{subnet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pool Conflicts Tab
// ---------------------------------------------------------------------------

interface ConflictEntry {
  pool_a: string;
  pool_b: string;
  overlapping_networks: string;
}

function ConflictsTab({ active }: { active: boolean }) {
  const { t } = useTranslation();

  const conflictsQ = useQuery({
    queryKey: ['pool-conflicts'],
    queryFn: async () => {
      const res = await api.GET('/ipv6/pool-conflicts' as never, {} as never);
      if (res.error) throw new Error('Failed to check conflicts');
      return (res.data as unknown as { data: unknown[] }).data ?? [];
    },
    enabled: active,
  });

  const conflicts = conflictsQ.data as ConflictEntry[] | undefined;

  return (
    <div style={styles.tableCard}>
      {conflictsQ.isLoading ? (
        <p style={styles.msg}>Loading...</p>
      ) : conflictsQ.error ? (
        <p style={styles.msgError}>{t('ipv6_management.conflicts_error', 'Failed to check conflicts.')}</p>
      ) : !conflicts || conflicts.length === 0 ? (
        <p style={styles.msg}>{t('ipv6_management.conflicts_empty', 'No overlapping pools detected.')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Pool A</th>
                <th style={styles.th}>Pool B</th>
                <th style={styles.th}>Overlapping Networks</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>{c.pool_a}</td>
                  <td style={styles.td}>{c.pool_b}</td>
                  <td style={styles.tdMono}>{c.overlapping_networks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function Ipv6ManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'ra_guard' | 'subnet_planner' | 'conflicts'>('ra_guard');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('ipv6_management.title', 'IPv6 Management')}</h1>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <button style={tabBtn(tab === 'ra_guard')} onClick={() => setTab('ra_guard')}>
          {t('ipv6_management.ra_guard_tab', 'RA Guard Policies')}
        </button>
        <button style={tabBtn(tab === 'subnet_planner')} onClick={() => setTab('subnet_planner')}>
          {t('ipv6_management.subnet_planner_tab', 'Subnet Planner')}
        </button>
        <button style={tabBtn(tab === 'conflicts')} onClick={() => setTab('conflicts')}>
          {t('ipv6_management.conflicts_tab', 'Pool Conflicts')}
        </button>
      </div>

      {tab === 'ra_guard' && <RaGuardTab />}
      {tab === 'subnet_planner' && <SubnetPlannerTab />}
      {tab === 'conflicts' && <ConflictsTab active={tab === 'conflicts'} />}
    </div>
  );
}
