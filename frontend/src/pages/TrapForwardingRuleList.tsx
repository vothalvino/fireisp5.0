// =============================================================================
// FireISP 5.0 — Trap Forwarding Rule Management
// =============================================================================
// Standalone page at /trap-forwarding-rules. Lists SNMP trap forwarding rules
// with a paginated table, "New Trap Forwarding Rule" create modal, and per-row
// Edit and Delete.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { styles, modalStyles, RequiredMark } from './crudStyles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrapForwardingRule {
  id: number;
  name: string;
  match_trap_type: string | null;
  match_source_ip: string | null;
  match_oid_prefix: string | null;
  forward_to_url: string | null;
  forward_to_email: string | null;
  is_active: number;
}

interface TrapForwardingRulesResponse {
  data: TrapForwardingRule[];
  meta: { total: number; page: number; limit: number };
}

interface TrapForwardingRuleBody {
  name: string;
  match_trap_type?: string;
  match_source_ip?: string;
  match_oid_prefix?: string;
  forward_to_url?: string;
  forward_to_email?: string;
  is_active?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Fetch / mutate helpers
// ---------------------------------------------------------------------------

async function fetchRules(page: number): Promise<TrapForwardingRulesResponse> {
  const query: Record<string, string | number> = { page, limit: PAGE_SIZE };
  const res = await api.GET('/trap-forwarding-rules' as never, { params: { query: query as never } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to load trap forwarding rules');
  return (res as { data: unknown }).data as unknown as TrapForwardingRulesResponse;
}

async function createRule(body: TrapForwardingRuleBody): Promise<void> {
  const res = await api.POST('/trap-forwarding-rules' as never, { body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to create trap forwarding rule');
}

async function updateRule(id: number, body: Partial<TrapForwardingRuleBody>): Promise<void> {
  const res = await api.PUT('/trap-forwarding-rules/{id}' as never, { params: { path: { id } }, body: body as never } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to update trap forwarding rule');
}

async function deleteRule(id: number): Promise<void> {
  const res = await api.DELETE('/trap-forwarding-rules/{id}' as never, { params: { path: { id } } } as never);
  if ((res as { error?: unknown }).error) throw new Error('Failed to delete trap forwarding rule');
}

// ---------------------------------------------------------------------------
// Active badge
// ---------------------------------------------------------------------------

function ActiveBadge({ isActive }: { isActive: number }) {
  const active = isActive === 1 || (isActive as unknown as boolean) === true;
  return (
    <span style={{
      background: active ? '#d1fae5' : '#f3f4f6',
      color: active ? '#065f46' : '#6b7280',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: '0.72rem',
      fontWeight: 600,
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trap forwarding rule form modal
// ---------------------------------------------------------------------------

interface RuleFormProps {
  initial: Partial<TrapForwardingRule>;
  onSave: (body: TrapForwardingRuleBody) => void;
  onClose: () => void;
  saving: boolean;
  editMode: boolean;
}

function RuleForm({ initial, onSave, onClose, saving, editMode }: RuleFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name ?? '');
  const [matchTrapType, setMatchTrapType] = useState(initial.match_trap_type ?? '');
  const [matchSourceIp, setMatchSourceIp] = useState(initial.match_source_ip ?? '');
  const [matchOidPrefix, setMatchOidPrefix] = useState(initial.match_oid_prefix ?? '');
  const [forwardToUrl, setForwardToUrl] = useState(initial.forward_to_url ?? '');
  const [forwardToEmail, setForwardToEmail] = useState(initial.forward_to_email ?? '');
  const [isActive, setIsActive] = useState<boolean>(
    initial.is_active !== undefined ? (initial.is_active === 1 || (initial.is_active as unknown as boolean) === true) : true
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: TrapForwardingRuleBody = { name, is_active: isActive ? 1 : 0 };
    if (matchTrapType) body.match_trap_type = matchTrapType;
    if (matchSourceIp) body.match_source_ip = matchSourceIp;
    if (matchOidPrefix) body.match_oid_prefix = matchOidPrefix;
    if (forwardToUrl) body.forward_to_url = forwardToUrl;
    if (forwardToEmail) body.forward_to_email = forwardToEmail;
    onSave(body);
  }

  const inp: React.CSSProperties = { ...modalStyles.input, width: '100%', boxSizing: 'border-box' as const };

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={{ ...modalStyles.panel, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{editMode ? t('trap_forwarding_rules.edit', 'Edit Trap Forwarding Rule') : t('trap_forwarding_rules.new', 'New Trap Forwarding Rule')}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('trap_forwarding_rules.name', 'Rule Name')}<RequiredMark /></label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={modalStyles.label}>{t('trap_forwarding_rules.match_trap_type', 'Match Trap Type')}</label>
              <input style={inp} value={matchTrapType} onChange={e => setMatchTrapType(e.target.value)} placeholder="e.g. linkDown" />
            </div>
            <div>
              <label style={modalStyles.label}>{t('trap_forwarding_rules.match_source_ip', 'Match Source IP')}</label>
              <input style={inp} value={matchSourceIp} onChange={e => setMatchSourceIp(e.target.value)} placeholder="192.168.1.1" />
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('trap_forwarding_rules.match_oid_prefix', 'Match OID Prefix')}</label>
            <input style={inp} value={matchOidPrefix} onChange={e => setMatchOidPrefix(e.target.value)} placeholder="1.3.6.1.4.1" />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('trap_forwarding_rules.forward_to_url', 'Forward to URL')}</label>
            <input style={inp} value={forwardToUrl} onChange={e => setForwardToUrl(e.target.value)} placeholder="https://webhook.example.com/traps" />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={modalStyles.label}>{t('trap_forwarding_rules.forward_to_email', 'Forward to Email')}</label>
            <input style={inp} type="email" value={forwardToEmail} onChange={e => setForwardToEmail(e.target.value)} placeholder="noc@example.com" />
          </div>

          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="trap-rule-is-active"
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <label htmlFor="trap-rule-is-active" style={{ ...modalStyles.label, marginBottom: 0 }}>{t('trap_forwarding_rules.is_active', 'Active')}</label>
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
// Main page component
// ---------------------------------------------------------------------------

export function TrapForwardingRuleList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TrapForwardingRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const rulesQ = useQuery({
    queryKey: ['trap-forwarding-rules', page],
    queryFn: () => fetchRules(page),
  });

  const rules = rulesQ.data?.data ?? [];
  const meta = rulesQ.data?.meta;

  function showMsg(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const createMut = useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trap-forwarding-rules'] });
      setShowForm(false);
      showMsg('ok', t('trap_forwarding_rules.create_success', 'Trap forwarding rule created.'));
    },
    onError: () => showMsg('err', t('trap_forwarding_rules.create_error', 'Failed to create trap forwarding rule.')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TrapForwardingRuleBody> }) => updateRule(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trap-forwarding-rules'] });
      setEditing(null);
      showMsg('ok', t('trap_forwarding_rules.update_success', 'Trap forwarding rule updated.'));
    },
    onError: () => showMsg('err', t('trap_forwarding_rules.update_error', 'Failed to update trap forwarding rule.')),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trap-forwarding-rules'] });
      setDeleteConfirm(null);
      showMsg('ok', t('trap_forwarding_rules.delete_success', 'Trap forwarding rule deleted.'));
    },
    onError: () => showMsg('err', t('trap_forwarding_rules.delete_error', 'Failed to delete trap forwarding rule.')),
  });

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.pageTitle}>{t('trap_forwarding_rules.title', 'Trap Forwarding Rules')}</h1>
        {meta && <span style={styles.countBadge}>{meta.total} total</span>}
        <button style={{ ...styles.btnPrimary, marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
          + {t('trap_forwarding_rules.new', 'New Trap Forwarding Rule')}
        </button>
      </div>

      {feedback && (
        <div style={{ padding: '0.6rem 1rem', borderRadius: 6, marginBottom: '1rem', background: feedback.type === 'ok' ? '#d1fae5' : '#fee2e2', color: feedback.type === 'ok' ? '#065f46' : '#991b1b', fontSize: '0.85rem' }}>
          {feedback.msg}
        </div>
      )}

      <div style={styles.tableCard}>
        {rulesQ.isLoading ? (
          <p style={styles.msg}>Loading...</p>
        ) : rulesQ.error ? (
          <p style={styles.msgError}>{t('trap_forwarding_rules.error', 'Failed to load trap forwarding rules.')}</p>
        ) : rules.length === 0 ? (
          <p style={styles.msg}>{t('trap_forwarding_rules.empty', 'No trap forwarding rules found.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Match Trap Type</th>
                  <th style={styles.th}>Match Source IP</th>
                  <th style={styles.th}>Match OID Prefix</th>
                  <th style={styles.th}>Forward To</th>
                  <th style={styles.th}>Active</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} style={styles.tr}>
                    <td style={styles.td}><strong>{r.name}</strong></td>
                    <td style={styles.tdMono}>{r.match_trap_type ?? '—'}</td>
                    <td style={styles.tdMono}>{r.match_source_ip ?? '—'}</td>
                    <td style={styles.tdMono}>{r.match_oid_prefix ?? '—'}</td>
                    <td style={styles.td}>
                      {r.forward_to_url && <div style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{r.forward_to_url}</div>}
                      {r.forward_to_email && <div style={{ fontSize: '0.8rem' }}>{r.forward_to_email}</div>}
                      {!r.forward_to_url && !r.forward_to_email && '—'}
                    </td>
                    <td style={styles.td}><ActiveBadge isActive={r.is_active} /></td>
                    <td style={styles.td}>
                      <button style={{ ...styles.btnSecondary, fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginRight: 4 }} onClick={() => setEditing(r)}>Edit</button>
                      <button style={{ ...styles.btnDanger, fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setDeleteConfirm(r.id)}>Delete</button>
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

      {showForm && (
        <RuleForm
          initial={{}}
          onSave={body => createMut.mutate(body)}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending}
          editMode={false}
        />
      )}

      {editing && (
        <RuleForm
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
            <p style={{ marginBottom: '1.5rem' }}>{t('trap_forwarding_rules.delete_confirm', 'Delete this forwarding rule?')}</p>
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
