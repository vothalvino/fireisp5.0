// =============================================================================
// FireISP 5.0 — Suspension Operations Console
// =============================================================================
// The auto-suspension engine was fully built server-side and had ZERO frontend
// consumers. An operator could write "suspend after 15 days overdue" and then:
//   * could not PREVIEW who it would hit before enabling it,
//   * could not RUN it on demand, and
//   * had no record afterwards of who the engine suspended or why.
//
// It acted invisibly, on the feature most likely to anger a paying customer if
// it misfires. This page is the three answers: preview, run, history.
//
// SuspensionRuleList already exists for authoring the rules; this is the
// operations side of the same feature and links back to it.
// =============================================================================

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { styles } from './crudStyles';

interface EvaluatedContract {
  rule_id: number;
  rule_action: string;
  contract_id: number;
  client_id: number;
  invoice_id: number | null;
  days_overdue: number | null;
}

interface SuspensionLog {
  id: number;
  contract_id: number;
  client_id: number;
  client_name: string | null;
  rule_name: string | null;
  action: string;
  reason: string | null;
  triggered_by: string;
  performed_by_name: string | null;
  radius_coa_sent: number | boolean;
  related_invoice_id: number | null;
  suspended_at: string | null;
  restored_at: string | null;
}

async function evaluate(): Promise<EvaluatedContract[]> {
  const res = await api.POST('/suspension/evaluate', {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Evaluate failed');
  return ((res.data as unknown as { data: EvaluatedContract[] }).data) ?? [];
}

async function runAuto(): Promise<{ contracts_evaluated: number; contracts_suspended: number }> {
  const res = await api.POST('/suspension/run-auto', {} as never);
  if ((res as { error?: unknown }).error) throw new Error('Run failed');
  return (res.data as unknown as { data: { contracts_evaluated: number; contracts_suspended: number } }).data;
}

async function fetchLogs(): Promise<SuspensionLog[]> {
  const res = await api.GET('/suspension/logs', { params: { query: { limit: 100 } as never } });
  if (res.error) throw new Error('Failed to load history');
  return ((res.data as unknown as { data: SuspensionLog[] }).data) ?? [];
}

export function SuspensionConsole() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // evaluate is contracts.view; run-auto is contracts.update. A run button that
  // 403s on the engine that disconnects customers is not a button worth having.
  const canRun = can(user, 'contracts.update');
  const qc = useQueryClient();
  const [preview, setPreview] = useState<EvaluatedContract[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const logsQ = useQuery({ queryKey: ['suspension-logs'], queryFn: fetchLogs });

  const previewMut = useMutation({
    mutationFn: evaluate,
    onSuccess: (rows) => { setPreview(rows); setMsg(null); },
    onError: () => setMsg({ ok: false, text: t('suspensionConsole.previewError') }),
  });

  const runMut = useMutation({
    mutationFn: runAuto,
    onSuccess: (r) => {
      setMsg({ ok: true, text: t('suspensionConsole.ranSummary', { evaluated: r.contracts_evaluated, suspended: r.contracts_suspended }) });
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['suspension-logs'] });
    },
    onError: () => setMsg({ ok: false, text: t('suspensionConsole.runError') }),
  });

  // Only auto_suspend / soft_suspend / walled_garden rules actually act in a
  // run — an 'alert' rule shows in the preview but disconnects nobody, and
  // conflating the two is how a preview misleads.
  const ACTING = ['auto_suspend', 'soft_suspend', 'walled_garden'];
  const wouldAct = (preview ?? []).filter(p => ACTING.includes(p.rule_action));

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginBottom: 4 }}>{t('suspensionConsole.title')}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 18 }}>
        {t('suspensionConsole.description')}{' '}
        <Link to="/suspension-rules" style={{ color: 'var(--link)' }}>{t('suspensionConsole.manageRules')}</Link>
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <button
          style={styles.btnSecondary}
          onClick={() => { setConfirming(false); previewMut.mutate(); }}
          disabled={previewMut.isPending}
        >
          {previewMut.isPending ? t('suspensionConsole.previewing') : t('suspensionConsole.preview')}
        </button>
        {canRun && (
          confirming ? (
            <>
              <span style={{ fontSize: 13, color: '#b45309' }}>
                {t('suspensionConsole.confirmRun', { count: wouldAct.length })}
              </span>
              <button style={{ ...styles.btnPrimary, background: '#b91c1c' }} onClick={() => { setConfirming(false); runMut.mutate(); }} disabled={runMut.isPending}>
                {runMut.isPending ? t('suspensionConsole.running') : t('suspensionConsole.confirmRunYes')}
              </button>
              <button style={styles.btnSecondary} onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
            </>
          ) : (
            <button style={styles.btnPrimary} onClick={() => setConfirming(true)} disabled={runMut.isPending}>
              {t('suspensionConsole.run')}
            </button>
          )
        )}
        {msg && <span style={{ color: msg.ok ? '#065f46' : '#991b1b', fontSize: 13 }}>{msg.text}</span>}
      </div>

      {/* ---- Preview ---- */}
      {preview && (
        <section style={box}>
          <h2 style={h2}>{t('suspensionConsole.previewTitle')}</h2>
          {preview.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('suspensionConsole.previewEmpty')}</p>
          ) : (
            <>
              <p style={{ fontSize: 13, marginBottom: 10 }}>
                {t('suspensionConsole.previewSummary', { total: preview.length, acting: wouldAct.length })}
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead><tr>
                    <th style={th}>{t('suspensionConsole.contract')}</th>
                    <th style={th}>{t('suspensionConsole.client')}</th>
                    <th style={th}>{t('suspensionConsole.ruleAction')}</th>
                    <th style={th}>{t('suspensionConsole.daysOverdue')}</th>
                    <th style={th}>{t('suspensionConsole.invoice')}</th>
                  </tr></thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={`${p.contract_id}-${p.rule_id}-${i}`}>
                        <td style={td}><Link to={`/contracts/${p.contract_id}`} style={{ color: 'var(--link)' }}>#{p.contract_id}</Link></td>
                        <td style={td}><Link to={`/clients/${p.client_id}`} style={{ color: 'var(--link)' }}>#{p.client_id}</Link></td>
                        <td style={td}>
                          {p.rule_action}
                          {!ACTING.includes(p.rule_action) && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                              {t('suspensionConsole.noDisconnect')}
                            </span>
                          )}
                        </td>
                        <td style={td}>{p.days_overdue ?? '—'}</td>
                        <td style={td}>{p.invoice_id ? <Link to={`/invoices/${p.invoice_id}`} style={{ color: 'var(--link)' }}>#{p.invoice_id}</Link> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ---- History ---- */}
      <section style={box}>
        <h2 style={h2}>{t('suspensionConsole.historyTitle')}</h2>
        {logsQ.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : logsQ.isError ? (
          <p style={{ color: '#991b1b', fontSize: 13 }}>{t('suspensionConsole.historyError')}</p>
        ) : (logsQ.data ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('suspensionConsole.historyEmpty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead><tr>
                <th style={th}>{t('suspensionConsole.when')}</th>
                <th style={th}>{t('suspensionConsole.client')}</th>
                <th style={th}>{t('suspensionConsole.action')}</th>
                <th style={th}>{t('suspensionConsole.by')}</th>
                <th style={th}>{t('suspensionConsole.rule')}</th>
                <th style={th}>{t('suspensionConsole.coa')}</th>
                <th style={th}>{t('suspensionConsole.restored')}</th>
              </tr></thead>
              <tbody>
                {(logsQ.data ?? []).map(l => (
                  <tr key={l.id}>
                    <td style={td}>{l.suspended_at ? new Date(l.suspended_at).toLocaleString() : '—'}</td>
                    <td style={td}>
                      <Link to={`/clients/${l.client_id}`} style={{ color: 'var(--link)' }}>
                        {l.client_name ?? `#${l.client_id}`}
                      </Link>
                    </td>
                    <td style={td}>{l.action}</td>
                    <td style={td}>
                      {/* system vs manual is the question after a bad run:
                          did the ENGINE do this, or did somebody? */}
                      {l.triggered_by === 'system'
                        ? t('suspensionConsole.bySystem')
                        : (l.performed_by_name || t('suspensionConsole.byManual'))}
                    </td>
                    <td style={td}>{l.rule_name ?? '—'}</td>
                    <td style={td}>{l.radius_coa_sent ? t('common.yes') : t('common.no')}</td>
                    <td style={td}>{l.restored_at ? new Date(l.restored_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const box: React.CSSProperties = {
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 16, marginBottom: 18,
};
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 10 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', background: 'var(--bg-subtle, #f9fafb)',
  borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600,
};
const td: React.CSSProperties = { padding: '7px 12px', borderBottom: '1px solid var(--border, #f3f4f6)' };

export default SuspensionConsole;
