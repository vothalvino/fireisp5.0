// =============================================================================
// FireISP 5.0 — Reports Page
// =============================================================================
// Page at /reports. Provides four report tabs:
//
//   1. Revenue     — financial summary (invoiced, collected, outstanding, net
//                    income) for a configurable date range; bar chart of
//                    revenue vs. expenses
//   2. Subscriber Growth — new vs. churned contracts per month (last 12 months);
//                    line chart + monthly table
//   3. AR Aging    — accounts-receivable aging buckets (current, 1-30, 31-60,
//                    61-90, 90+ days); bar chart + overdue invoice list
//   4. IFT Statistical — paginated list of IFT regulatory reports with
//                    status badge, period, subscriber totals, and create/view
//                    detail modal
//
// All data is fetched from:
//   GET /api/v1/reports/financial
//   GET /api/v1/reports/subscriber-growth
//   GET /api/v1/reports/aging
//   GET /api/v1/ift-statistical-reports
// =============================================================================

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'revenue' | 'growth' | 'aging' | 'ift' | 'technicians' | 'exports' | 'network' | 'compliance' | 'scheduled' | 'custom' | 'widgets';

// Revenue
interface FinancialData {
  generated_at: string;
  period: { from: string; to: string };
  revenue: {
    invoiced: number;
    collected: number;
    outstanding: number;
    invoice_count: number;
  };
  payments: { total: number; count: number };
  expenses: { total: number; count: number };
  net_income: number;
}

// Subscriber growth
interface GrowthMonth {
  month: string;
  new_contracts: number;
  churned: number;
}
interface GrowthData {
  generated_at: string;
  months: GrowthMonth[];
}

// AR aging
interface AgingBucket {
  current: number;
  '1-30': number;
  '31-60': number;
  '61-90': number;
  '90+': number;
}
interface AgingInvoice {
  client_id: number;
  name: string;
  email: string;
  invoice_id: number;
  invoice_number: string;
  total: number;
  currency: string;
  due_date: string;
  days_overdue: number;
  aging_bucket: string;
}
interface AgingData {
  generated_at: string;
  summary: AgingBucket;
  total_outstanding: number;
  invoice_count: number;
  details: AgingInvoice[];
}

// Technician productivity
interface TechnicianRow {
  user_id: number;
  first_name: string;
  last_name: string;
  total_jobs: number;
  completed: number;
  cancelled: number;
  in_progress: number;
  avg_completion_hours: number | null;
}
interface TechnicianData {
  generated_at: string;
  period: { from: string; to: string };
  technicians: TechnicianRow[];
}

// IFT statistical
interface IftReport {
  id: number;
  report_period: string;
  status: string;
  avg_download_speed: number | null;
  avg_upload_speed: number | null;
  subscribers_by_speed_tier: Record<string, number> | null;
  subscribers_by_state: Record<string, number> | null;
  subscribers_by_technology: Record<string, number> | null;
  coverage_municipalities: number | null;
  revenue: number | null;
  created_at: string;
}
interface IftListData {
  data: IftReport[];
  meta: { total: number; page: number; limit: number };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...opts.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// Download a CSV export through the typed client (auth + silent-refresh aware)
// and trigger a browser file download.
type ExportPath = '/export/clients' | '/export/contracts' | '/export/invoices' | '/export/payments';

async function downloadCsv(path: ExportPath, filename: string): Promise<void> {
  const { data, error } = await api.GET(path, { parseAs: 'blob' });
  if (error) throw new Error('Failed to generate export');
  const blob = data as unknown as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Small helpers / formatters
// ---------------------------------------------------------------------------

function currency(n: number, code = 'MXN') {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(n);
}

function pct(a: number, b: number) {
  if (b === 0) return '—';
  return ((a / b) * 100).toFixed(1) + '%';
}

// ---------------------------------------------------------------------------
// SVG bar chart — generic horizontal bar per label
// ---------------------------------------------------------------------------

interface BarChartProps {
  rows: { label: string; value: number; color: string }[];
  width?: number;
  height?: number;
}

function BarChart({ rows, width = 480, height = 200 }: BarChartProps) {
  const max = Math.max(...rows.map(r => r.value), 1);
  const barH = Math.floor((height - 20) / rows.length) - 6;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, display: 'block' }}>
      {rows.map((r, i) => {
        const bw = Math.max((r.value / max) * (width - 160), 2);
        const y = i * (barH + 6) + 10;
        return (
          <g key={r.label}>
            <text x={0} y={y + barH - 4} fontSize={11} fill="#555" style={{ fontFamily: 'var(--font-sans)' }}>
              {r.label}
            </text>
            <rect x={100} y={y} width={bw} height={barH} fill={r.color} rx={3} />
            <text x={106 + bw} y={y + barH - 4} fontSize={11} fill="#333" style={{ fontFamily: 'var(--font-sans)' }}>
              {currency(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG line chart — multi-series
// ---------------------------------------------------------------------------

interface LineChartProps {
  labels: string[];
  series: { label: string; values: number[]; color: string }[];
  width?: number;
  height?: number;
}

function LineChart({ labels, series, width = 520, height = 180 }: LineChartProps) {
  const pad = { top: 10, right: 20, bottom: 30, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const allVals = series.flatMap(s => s.values);
  const maxV = Math.max(...allVals, 1);
  const n = labels.length;

  function x(i: number) { return pad.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w); }
  function y(v: number) { return pad.top + h - (v / maxV) * h; }
  function polyline(values: number[]) {
    return values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  }

  // x-axis label step to avoid crowding
  const step = Math.ceil(n / 8);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, display: 'block' }}>
      {/* axes */}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + h} stroke="#ddd" />
      <line x1={pad.left} y1={pad.top + h} x2={pad.left + w} y2={pad.top + h} stroke="#ddd" />
      {/* y gridlines */}
      {[0.25, 0.5, 0.75, 1].map(t => (
        <g key={t}>
          <line x1={pad.left} y1={pad.top + h - t * h} x2={pad.left + w} y2={pad.top + h - t * h} stroke="#eee" strokeDasharray="3 3" />
          <text x={pad.left - 4} y={pad.top + h - t * h + 4} fontSize={9} textAnchor="end" fill="#999">{Math.round(maxV * t)}</text>
        </g>
      ))}
      {/* x labels */}
      {labels.map((l, i) => i % step === 0 && (
        <text key={i} x={x(i)} y={height - 4} fontSize={9} textAnchor="middle" fill="#999">{l}</text>
      ))}
      {/* series */}
      {series.map(s => (
        <g key={s.label}>
          <polyline points={polyline(s.values)} fill="none" stroke={s.color} strokeWidth={2} />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />
          ))}
        </g>
      ))}
      {/* legend */}
      {series.map((s, si) => (
        <g key={s.label} transform={`translate(${pad.left + si * 120}, ${height - 6})`}>
          <rect width={10} height={10} y={-10} fill={s.color} rx={2} />
          <text x={14} y={0} fontSize={10} fill="#555">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tab: Revenue
// ---------------------------------------------------------------------------

function RevenueTab() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: firstOfMonth, to: today });

  const { data, isFetching, error } = useQuery<{ data: FinancialData }>({
    queryKey: ['reports', 'financial', applied],
    queryFn: () => apiFetch(`/reports/financial?from=${applied.from}&to=${applied.to}`),
  });

  function handleApply(e: FormEvent) {
    e.preventDefault();
    setApplied({ from, to });
  }

  const d = data?.data;

  return (
    <div style={styles.tabContent}>
      <form onSubmit={handleApply} style={styles.filterRow}>
        <label style={styles.label}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={styles.input} />
        <label style={styles.label}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={styles.input} />
        <button type="submit" style={styles.btn}>Apply</button>
      </form>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {d && (
        <>
          <div style={styles.kpiRow}>
            <KpiCard label="Invoiced" value={currency(d.revenue.invoiced)} sub={`${d.revenue.invoice_count} invoices`} color="#4a90e2" />
            <KpiCard label="Collected" value={currency(d.revenue.collected)} sub={pct(d.revenue.collected, d.revenue.invoiced) + ' collection rate'} color="#27ae60" />
            <KpiCard label="Outstanding" value={currency(d.revenue.outstanding)} sub="Unpaid invoices" color="#e67e22" />
            <KpiCard label="Net Income" value={currency(d.net_income)} sub={`Expenses: ${currency(d.expenses.total)}`} color={d.net_income >= 0 ? '#27ae60' : '#e74c3c'} />
          </div>

          <h3 style={styles.sectionTitle}>Revenue vs. Expenses</h3>
          <BarChart rows={[
            { label: 'Invoiced', value: d.revenue.invoiced, color: '#4a90e2' },
            { label: 'Collected', value: d.revenue.collected, color: '#27ae60' },
            { label: 'Expenses', value: d.expenses.total, color: '#e74c3c' },
            { label: 'Net Income', value: Math.max(d.net_income, 0), color: '#9b59b6' },
          ]} />

          <p style={styles.muted}>Generated {new Date(d.generated_at).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Subscriber Growth (Churn)
// ---------------------------------------------------------------------------

function GrowthTab() {
  const [months, setMonths] = useState(12);
  const [applied, setApplied] = useState(12);

  const { data, isFetching, error } = useQuery<{ data: GrowthData }>({
    queryKey: ['reports', 'subscriber-growth', applied],
    queryFn: () => apiFetch(`/reports/subscriber-growth?months=${applied}`),
  });

  const rows = [...(data?.data?.months ?? [])].reverse();
  const labels = rows.map(r => r.month);
  const newVals = rows.map(r => Number(r.new_contracts));
  const churnVals = rows.map(r => Number(r.churned));
  const netVals = rows.map((_, i) => newVals[i] - churnVals[i]);

  const totalNew = newVals.reduce((a, b) => a + b, 0);
  const totalChurn = churnVals.reduce((a, b) => a + b, 0);
  const churnRatio = totalNew > 0 ? ((totalChurn / totalNew) * 100).toFixed(1) : '—';

  return (
    <div style={styles.tabContent}>
      <div style={styles.filterRow}>
        <label style={styles.label}>Period (months)</label>
        <select value={months} onChange={e => setMonths(Number(e.target.value))} style={{ ...styles.input, width: 100 }}>
          {[3, 6, 12, 24].map(m => <option key={m} value={m}>{m} months</option>)}
        </select>
        <button onClick={() => setApplied(months)} style={styles.btn}>Apply</button>
      </div>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {rows.length > 0 && (
        <>
          <div style={styles.kpiRow}>
            <KpiCard label="New Contracts" value={String(totalNew)} sub={`${applied}-month total`} color="#27ae60" />
            <KpiCard label="Churned" value={String(totalChurn)} sub={`${applied}-month total`} color="#e74c3c" />
            <KpiCard label="Net Growth" value={String(totalNew - totalChurn)} sub="New − Churned" color={totalNew - totalChurn >= 0 ? '#27ae60' : '#e74c3c'} />
            <KpiCard label="Churn Ratio" value={churnRatio === '—' ? '—' : `${churnRatio}%`} sub="Churned ÷ New" color="#e67e22" />
          </div>

          <h3 style={styles.sectionTitle}>Monthly Subscriber Trend</h3>
          <LineChart
            labels={labels}
            series={[
              { label: 'New', values: newVals, color: '#27ae60' },
              { label: 'Churned', values: churnVals, color: '#e74c3c' },
              { label: 'Net', values: netVals, color: '#4a90e2' },
            ]}
          />

          <h3 style={styles.sectionTitle}>Monthly Detail</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Month', 'New', 'Churned', 'Net'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map(r => {
                const net = Number(r.new_contracts) - Number(r.churned);
                return (
                  <tr key={r.month}>
                    <td style={styles.td}>{r.month}</td>
                    <td style={{ ...styles.td, color: '#27ae60' }}>{r.new_contracts}</td>
                    <td style={{ ...styles.td, color: '#e74c3c' }}>{r.churned}</td>
                    <td style={{ ...styles.td, color: net >= 0 ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>{net > 0 ? `+${net}` : net}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: AR Aging
// ---------------------------------------------------------------------------

const AGING_BUCKETS: { key: keyof AgingBucket; label: string; color: string }[] = [
  { key: 'current', label: 'Current', color: '#27ae60' },
  { key: '1-30', label: '1-30 days', color: '#f1c40f' },
  { key: '31-60', label: '31-60 days', color: '#e67e22' },
  { key: '61-90', label: '61-90 days', color: '#e74c3c' },
  { key: '90+', label: '90+ days', color: '#8e44ad' },
];

function AgingTab() {
  const { data, isFetching, error } = useQuery<{ data: AgingData }>({
    queryKey: ['reports', 'aging'],
    queryFn: () => apiFetch('/reports/aging'),
  });

  const d = data?.data;
  const [search, setSearch] = useState('');

  const filtered = (d?.details ?? []).filter(inv => {
    const q = search.toLowerCase();
    return !q
      || (inv.name ?? '').toLowerCase().includes(q)
      || inv.invoice_number.toLowerCase().includes(q)
      || inv.email.toLowerCase().includes(q);
  });

  return (
    <div style={styles.tabContent}>
      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {d && (
        <>
          <div style={styles.kpiRow}>
            <KpiCard label="Total Outstanding" value={currency(d.total_outstanding)} sub={`${d.invoice_count} invoices`} color="#e74c3c" />
            {AGING_BUCKETS.slice(1).map(b => (
              <KpiCard key={b.key} label={b.label} value={currency(d.summary[b.key])} sub={pct(d.summary[b.key], d.total_outstanding)} color={b.color} />
            ))}
          </div>

          <h3 style={styles.sectionTitle}>Aging Breakdown</h3>
          <BarChart rows={AGING_BUCKETS.map(b => ({ label: b.label, value: d.summary[b.key], color: b.color }))} />

          <div style={{ ...styles.filterRow, marginTop: 20 }}>
            <input
              placeholder="Search client or invoice…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...styles.input, width: 260 }}
            />
          </div>

          <h3 style={styles.sectionTitle}>Overdue Invoices ({filtered.length})</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Invoice', 'Client', 'Total', 'Due Date', 'Days Overdue', 'Bucket'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const bucket = AGING_BUCKETS.find(b => b.key === inv.aging_bucket);
                return (
                  <tr key={inv.invoice_id}>
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{inv.name}</td>
                    <td style={styles.td}>{currency(inv.total, inv.currency)}</td>
                    <td style={styles.td}>{inv.due_date?.slice(0, 10)}</td>
                    <td style={{ ...styles.td, color: inv.days_overdue > 60 ? '#e74c3c' : '#555' }}>
                      {inv.days_overdue <= 0 ? '—' : `${inv.days_overdue}d`}
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: bucket?.color ?? '#999' }}>
                        {bucket?.label ?? inv.aging_bucket}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>No overdue invoices</td></tr>
              )}
            </tbody>
          </table>
          <p style={styles.muted}>Generated {new Date(d.generated_at).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: IFT Statistical
// ---------------------------------------------------------------------------

const IFT_STATUSES: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#95a5a6' },
  submitted: { label: 'Submitted', color: '#3498db' },
  approved: { label: 'Approved', color: '#27ae60' },
  rejected: { label: 'Rejected', color: '#e74c3c' },
};

interface IftFormState {
  report_period: string;
  avg_download_speed: string;
  avg_upload_speed: string;
  coverage_municipalities: string;
  revenue: string;
  status: string;
}

function IftTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<IftReport | null>(null);
  const [form, setForm] = useState<IftFormState>({
    report_period: '',
    avg_download_speed: '',
    avg_upload_speed: '',
    coverage_municipalities: '',
    revenue: '',
    status: 'draft',
  });
  const [createError, setCreateError] = useState('');

  const { data, isFetching, error } = useQuery<IftListData>({
    queryKey: ['ift-statistical-reports', page],
    queryFn: () => apiFetch(`/ift-statistical-reports?page=${page}&limit=20`),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/ift-statistical-reports', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ift-statistical-reports'] });
      setShowCreate(false);
      setForm({ report_period: '', avg_download_speed: '', avg_upload_speed: '', coverage_municipalities: '', revenue: '', status: 'draft' });
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMut.mutate({
      report_period: form.report_period || undefined,
      avg_download_speed: form.avg_download_speed ? Number(form.avg_download_speed) : undefined,
      avg_upload_speed: form.avg_upload_speed ? Number(form.avg_upload_speed) : undefined,
      coverage_municipalities: form.coverage_municipalities ? Number(form.coverage_municipalities) : undefined,
      revenue: form.revenue ? Number(form.revenue) : undefined,
      status: form.status,
    });
  }

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>IFT Statistical Reports</h3>
        <button onClick={() => setShowCreate(true)} style={styles.btnPrimary}>+ New Report</button>
      </div>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            {['Period', 'Status', 'Avg ↓ Mbps', 'Avg ↑ Mbps', 'Municipalities', 'Revenue', 'Created'].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const st = IFT_STATUSES[r.status] ?? { label: r.status, color: '#999' };
            return (
              <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}>
                <td style={styles.td}>{r.report_period ?? '—'}</td>
                <td style={styles.td}><span style={{ ...styles.badge, background: st.color }}>{st.label}</span></td>
                <td style={styles.td}>{r.avg_download_speed ?? '—'}</td>
                <td style={styles.td}>{r.avg_upload_speed ?? '—'}</td>
                <td style={styles.td}>{r.coverage_municipalities ?? '—'}</td>
                <td style={styles.td}>{r.revenue != null ? currency(r.revenue) : '—'}</td>
                <td style={styles.td}>{r.created_at?.slice(0, 10)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && !isFetching && (
            <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>No IFT reports yet</td></tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {meta && meta.total > meta.limit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={styles.btnSm}>← Prev</button>
          <span style={styles.muted}>Page {page} of {Math.ceil(meta.total / meta.limit)}</span>
          <button disabled={page * meta.limit >= meta.total} onClick={() => setPage(p => p + 1)} style={styles.btnSm}>Next →</button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <Modal title={`IFT Report — ${selected.report_period ?? selected.id}`} onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: '0.9rem' }}>
            {[
              ['Period', selected.report_period],
              ['Status', <span key="s" style={{ ...styles.badge, background: IFT_STATUSES[selected.status]?.color ?? '#999' }}>{IFT_STATUSES[selected.status]?.label ?? selected.status}</span>],
              ['Avg ↓ Mbps', selected.avg_download_speed ?? '—'],
              ['Avg ↑ Mbps', selected.avg_upload_speed ?? '—'],
              ['Municipalities', selected.coverage_municipalities ?? '—'],
              ['Revenue', selected.revenue != null ? currency(selected.revenue) : '—'],
              ['Created', selected.created_at?.slice(0, 10)],
            ].map(([k, v]) => (
              <div key={String(k)} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: '#999', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>

          {selected.subscribers_by_technology && (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 6, fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subscribers by Technology</h4>
              <table style={{ ...styles.table, marginBottom: 0 }}>
                <thead><tr><th style={styles.th}>Technology</th><th style={styles.th}>Subscribers</th></tr></thead>
                <tbody>
                  {Object.entries(selected.subscribers_by_technology).map(([tech, cnt]) => (
                    <tr key={tech}><td style={styles.td}>{tech}</td><td style={styles.td}>{cnt}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="New IFT Statistical Report" onClose={() => { setShowCreate(false); setCreateError(''); }}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Report Period (e.g. 2025-Q1)">
              <input required value={form.report_period} onChange={e => setForm(f => ({ ...f, report_period: e.target.value }))} style={styles.input} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={styles.input}>
                {Object.entries(IFT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Avg Download (Mbps)">
                <input type="number" step="0.1" value={form.avg_download_speed} onChange={e => setForm(f => ({ ...f, avg_download_speed: e.target.value }))} style={styles.input} />
              </Field>
              <Field label="Avg Upload (Mbps)">
                <input type="number" step="0.1" value={form.avg_upload_speed} onChange={e => setForm(f => ({ ...f, avg_upload_speed: e.target.value }))} style={styles.input} />
              </Field>
              <Field label="Coverage Municipalities">
                <input type="number" value={form.coverage_municipalities} onChange={e => setForm(f => ({ ...f, coverage_municipalities: e.target.value }))} style={styles.input} />
              </Field>
              <Field label="Revenue (MXN)">
                <input type="number" step="0.01" value={form.revenue} onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} style={styles.input} />
              </Field>
            </div>
            {createError && <p style={styles.error}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={() => { setShowCreate(false); setCreateError(''); }} style={styles.btnSm}>Cancel</button>
              <button type="submit" disabled={createMut.isPending} style={styles.btnPrimary}>
                {createMut.isPending ? 'Creating…' : 'Create Report'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Technician Productivity
// ---------------------------------------------------------------------------

function TechnicianTab() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: firstOfMonth, to: today });

  const { data, isFetching, error } = useQuery<{ data: TechnicianData }>({
    queryKey: ['reports', 'technicians', applied],
    queryFn: () => apiFetch(`/reports/technicians?from=${applied.from}&to=${applied.to}`),
  });

  function handleApply(e: FormEvent) {
    e.preventDefault();
    setApplied({ from, to });
  }

  const techs = data?.data?.technicians ?? [];
  const totalCompleted = techs.reduce((a, t) => a + Number(t.completed), 0);
  const totalJobs = techs.reduce((a, t) => a + Number(t.total_jobs), 0);
  const avgHours = techs.length > 0
    ? (techs.reduce((a, t) => a + (t.avg_completion_hours ?? 0), 0) / techs.length).toFixed(1)
    : '—';

  return (
    <div style={styles.tabContent}>
      <form onSubmit={handleApply} style={styles.filterRow}>
        <label style={styles.label}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={styles.input} />
        <label style={styles.label}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={styles.input} />
        <button type="submit" style={styles.btn}>Apply</button>
      </form>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {data && (
        <>
          <div style={styles.kpiRow}>
            <KpiCard label="Total Jobs" value={String(totalJobs)} sub={`${applied.from} – ${applied.to}`} color="#4a90e2" />
            <KpiCard label="Completed" value={String(totalCompleted)} sub={totalJobs > 0 ? pct(totalCompleted, totalJobs) + ' completion' : '—'} color="#27ae60" />
            <KpiCard label="Avg Completion" value={avgHours === '—' ? '—' : `${avgHours}h`} sub="Across technicians" color="#9b59b6" />
            <KpiCard label="Technicians" value={String(techs.length)} sub="With assigned jobs" color="#e67e22" />
          </div>

          <h3 style={styles.sectionTitle}>Per-Technician Breakdown</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Technician', 'Total', 'Completed', 'In Progress', 'Cancelled', 'Avg Completion'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {techs.map(t => (
                <tr key={t.user_id}>
                  <td style={styles.td}>{t.first_name} {t.last_name}</td>
                  <td style={styles.td}>{t.total_jobs}</td>
                  <td style={{ ...styles.td, color: '#27ae60', fontWeight: 600 }}>{t.completed}</td>
                  <td style={styles.td}>{t.in_progress}</td>
                  <td style={{ ...styles.td, color: '#e74c3c' }}>{t.cancelled}</td>
                  <td style={styles.td}>{t.avg_completion_hours != null ? `${t.avg_completion_hours}h` : '—'}</td>
                </tr>
              ))}
              {techs.length === 0 && (
                <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>No data for this period</td></tr>
              )}
            </tbody>
          </table>
          {data.data && <p style={styles.muted}>Generated {new Date(data.data.generated_at).toLocaleString()}</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ ...styles.kpiCard, borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types for §15 new tabs
// ---------------------------------------------------------------------------

// Network report
interface NetworkReportData {
  device_reboots: number;
  capacity_forecast: { month: string; predicted_subscribers: number }[];
  pon_utilization: { olt_id: number; olt_name?: string; utilization_pct: number }[];
}

// Compliance report
interface RetentionRow {
  table_name: string;
  old_record_count: number;
}
interface InterceptionReadiness {
  has_nas: boolean;
  ready: boolean;
}
interface ComplianceReportData {
  data_retention: RetentionRow[];
  interception_readiness: InterceptionReadiness;
}

// Scheduled reports
interface ScheduledReport {
  id: number;
  report_def_name: string;
  format: string;
  cron_expression: string;
  is_enabled: number | boolean;
  last_run_at: string | null;
  recipients?: string | null;
}
interface ScheduledReportListData {
  data: ScheduledReport[];
  meta: { total: number; page: number; limit: number };
}

// Custom reports
interface CustomReport {
  id: number;
  name: string;
  query_type: string;
  is_public: number | boolean;
  sql_query?: string;
}
interface CustomReportListData {
  data: CustomReport[];
  meta: { total: number; page: number; limit: number };
}
interface CustomReportResult {
  rows: Record<string, unknown>[];
  fields: string[];
}

// Dashboard widgets
interface DashboardWidget {
  id: number;
  widget_type: string;
  title: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}
interface DashboardWidgetListData {
  data: DashboardWidget[];
  meta: { total: number; page: number; limit: number };
}

const WIDGET_TYPES = [
  'revenue_chart',
  'subscriber_growth',
  'aging_summary',
  'capacity_forecast',
  'custom',
] as const;

// ---------------------------------------------------------------------------
// Tab: Network
// ---------------------------------------------------------------------------

function NetworkTab() {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: NetworkReportData }>({
    queryKey: ['reports', 'network'],
    queryFn: () => apiFetch('/reports/network'),
  });

  const d = data?.data;

  return (
    <div style={styles.tabContent}>
      <h2 style={styles.sectionTitle}>{t('reports.networkReports')}</h2>
      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {d && (
        <>
          <div style={styles.kpiRow}>
            <KpiCard
              label={t('reports.deviceReboots')}
              value={String(d.device_reboots ?? 0)}
              sub=""
              color="#e67e22"
            />
          </div>

          {d.capacity_forecast && d.capacity_forecast.length > 0 && (
            <>
              <h3 style={styles.sectionTitle}>{t('reports.capacityForecast')}</h3>
              <LineChart
                labels={d.capacity_forecast.map(r => r.month)}
                series={[
                  {
                    label: 'Predicted Subscribers',
                    values: d.capacity_forecast.map(r => Number(r.predicted_subscribers)),
                    color: '#4a90e2',
                  },
                ]}
              />
            </>
          )}

          {d.pon_utilization && d.pon_utilization.length > 0 && (
            <>
              <h3 style={styles.sectionTitle}>{t('reports.ponUtilization')}</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>OLT ID</th>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Utilization %</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pon_utilization.map(row => (
                    <tr key={row.olt_id}>
                      <td style={styles.td}>{row.olt_id}</td>
                      <td style={styles.td}>{row.olt_name ?? '—'}</td>
                      <td style={styles.td}>{Number(row.utilization_pct).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Compliance
// ---------------------------------------------------------------------------

function ComplianceTab() {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: ComplianceReportData }>({
    queryKey: ['reports', 'compliance'],
    queryFn: () => apiFetch('/reports/compliance'),
  });

  const d = data?.data;
  const readiness = d?.interception_readiness;

  return (
    <div style={styles.tabContent}>
      <h2 style={styles.sectionTitle}>{t('reports.complianceReports')}</h2>
      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}
      {d && (
        <>
          {/* Interception readiness card */}
          <h3 style={styles.sectionTitle}>{t('reports.interceptionReadiness')}</h3>
          {readiness && (
            <div style={{ ...styles.kpiCard, maxWidth: 320, marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: 4 }}>Has NAS</div>
                  <span style={{
                    ...styles.badge,
                    background: readiness.has_nas ? '#27ae60' : '#e74c3c',
                  }}>
                    {readiness.has_nas ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: 4 }}>Status</div>
                  <span style={{
                    ...styles.badge,
                    background: readiness.ready ? '#27ae60' : '#e67e22',
                  }}>
                    {readiness.ready ? 'Ready' : 'Not Ready'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Data retention table */}
          {d.data_retention && d.data_retention.length > 0 && (
            <>
              <h3 style={styles.sectionTitle}>{t('reports.dataRetention')}</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Table</th>
                    <th style={styles.th}>Old Record Count</th>
                  </tr>
                </thead>
                <tbody>
                  {d.data_retention.map(row => (
                    <tr key={row.table_name}>
                      <td style={styles.td}>{row.table_name}</td>
                      <td style={styles.td}>{row.old_record_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Scheduled Reports
// ---------------------------------------------------------------------------

interface ScheduledReportForm {
  report_def_name: string;
  format: string;
  cron_expression: string;
  recipients: string;
}

function ScheduledTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ScheduledReportForm>({
    report_def_name: '',
    format: 'csv',
    cron_expression: '0 8 * * 1',
    recipients: '',
  });
  const [createError, setCreateError] = useState('');

  const { data, isFetching, error } = useQuery<ScheduledReportListData>({
    queryKey: ['scheduled-reports'],
    queryFn: () => apiFetch('/scheduled-reports'),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/scheduled-reports', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-reports'] });
      setShowCreate(false);
      setForm({ report_def_name: '', format: 'csv', cron_expression: '0 8 * * 1', recipients: '' });
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/scheduled-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-reports'] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMut.mutate({
      report_def_name: form.report_def_name,
      format: form.format,
      cron_expression: form.cron_expression,
      recipients: form.recipients ? form.recipients.split(',').map(s => s.trim()) : [],
    });
  }

  const rows = data?.data ?? [];

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>{t('reports.scheduledReports')}</h3>
        <button onClick={() => setShowCreate(true)} style={styles.btnPrimary}>
          + {t('reports.createScheduledReport')}
        </button>
      </div>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>{t('reports.reportDefName')}</th>
            <th style={styles.th}>{t('reports.format')}</th>
            <th style={styles.th}>{t('reports.cronExpression')}</th>
            <th style={styles.th}>Enabled</th>
            <th style={styles.th}>Last Run</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={styles.td}>{r.id}</td>
              <td style={styles.td}>{r.report_def_name}</td>
              <td style={styles.td}>{r.format}</td>
              <td style={styles.td}><code>{r.cron_expression}</code></td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, background: r.is_enabled ? '#27ae60' : '#95a5a6' }}>
                  {r.is_enabled ? 'Yes' : 'No'}
                </span>
              </td>
              <td style={styles.td}>{r.last_run_at ? r.last_run_at.slice(0, 16).replace('T', ' ') : '—'}</td>
              <td style={styles.td}>
                <button
                  onClick={() => deleteMut.mutate(r.id)}
                  disabled={deleteMut.isPending}
                  style={{ ...styles.btnSm, color: '#e74c3c' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !isFetching && (
            <tr>
              <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                No scheduled reports
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showCreate && (
        <Modal
          title={t('reports.createScheduledReport')}
          onClose={() => { setShowCreate(false); setCreateError(''); }}
        >
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label={t('reports.reportDefName')}>
              <input
                required
                value={form.report_def_name}
                onChange={e => setForm(f => ({ ...f, report_def_name: e.target.value }))}
                style={styles.input}
              />
            </Field>
            <Field label={t('reports.format')}>
              <select
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
                style={styles.input}
              >
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
                <option value="xlsx">XLSX</option>
                <option value="json">JSON</option>
              </select>
            </Field>
            <Field label={t('reports.cronExpression')}>
              <input
                required
                value={form.cron_expression}
                onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))}
                style={styles.input}
                placeholder="0 8 * * 1"
              />
            </Field>
            <Field label={t('reports.recipients')}>
              <input
                value={form.recipients}
                onChange={e => setForm(f => ({ ...f, recipients: e.target.value }))}
                style={styles.input}
                placeholder="email1@example.com, email2@example.com"
              />
            </Field>
            {createError && <p style={styles.error}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(''); }}
                style={styles.btnSm}
              >
                Cancel
              </button>
              <button type="submit" disabled={createMut.isPending} style={styles.btnPrimary}>
                {createMut.isPending ? 'Creating…' : t('reports.createScheduledReport')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Custom Reports
// ---------------------------------------------------------------------------

interface CustomReportForm {
  name: string;
  query_type: string;
  sql_query: string;
}

function CustomTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CustomReportForm>({ name: '', query_type: 'sql', sql_query: '' });
  const [createError, setCreateError] = useState('');
  const [execResult, setExecResult] = useState<CustomReportResult | null>(null);
  const [execError, setExecError] = useState('');

  const { data, isFetching, error } = useQuery<CustomReportListData>({
    queryKey: ['custom-reports'],
    queryFn: () => apiFetch('/custom-reports'),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/custom-reports', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-reports'] });
      setShowCreate(false);
      setForm({ name: '', query_type: 'sql', sql_query: '' });
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/custom-reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-reports'] }),
  });

  const execMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch<CustomReportResult>(`/custom-reports/${id}/execute`, { method: 'POST' }),
    onSuccess: (result) => {
      setExecResult(result);
      setExecError('');
    },
    onError: (err: Error) => setExecError(err.message),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMut.mutate({
      name: form.name,
      query_type: form.query_type,
      sql_query: form.sql_query,
    });
  }

  const rows = data?.data ?? [];

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>{t('reports.customReports')}</h3>
        <button onClick={() => setShowCreate(true)} style={styles.btnPrimary}>
          + {t('reports.createCustomReport')}
        </button>
      </div>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>{t('reports.queryType')}</th>
            <th style={styles.th}>Public</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={styles.td}>{r.id}</td>
              <td style={styles.td}>{r.name}</td>
              <td style={styles.td}>{r.query_type}</td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, background: r.is_public ? '#27ae60' : '#95a5a6' }}>
                  {r.is_public ? 'Yes' : 'No'}
                </span>
              </td>
              <td style={{ ...styles.td, display: 'flex', gap: 6 }}>
                <button
                  onClick={() => execMut.mutate(r.id)}
                  disabled={execMut.isPending}
                  style={styles.btnSm}
                >
                  {t('reports.execute')}
                </button>
                <button
                  onClick={() => deleteMut.mutate(r.id)}
                  disabled={deleteMut.isPending}
                  style={{ ...styles.btnSm, color: '#e74c3c' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !isFetching && (
            <tr>
              <td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                No custom reports
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {execError && <p style={{ ...styles.error, marginTop: 8 }}>{execError}</p>}

      {execResult && (
        <>
          <h3 style={styles.sectionTitle}>{t('reports.executeResult')}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {execResult.fields.map(f => (
                    <th key={f} style={styles.th}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {execResult.rows.map((row, i) => (
                  <tr key={i}>
                    {execResult.fields.map(f => (
                      <td key={f} style={styles.td}>{String(row[f] ?? '—')}</td>
                    ))}
                  </tr>
                ))}
                {execResult.rows.length === 0 && (
                  <tr>
                    <td colSpan={execResult.fields.length} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                      No rows returned
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCreate && (
        <Modal
          title={t('reports.createCustomReport')}
          onClose={() => { setShowCreate(false); setCreateError(''); }}
        >
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Name">
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={styles.input}
              />
            </Field>
            <Field label={t('reports.queryType')}>
              <select
                value={form.query_type}
                onChange={e => setForm(f => ({ ...f, query_type: e.target.value }))}
                style={styles.input}
              >
                <option value="sql">SQL</option>
              </select>
            </Field>
            <Field label={t('reports.sqlQuery')}>
              <textarea
                required
                value={form.sql_query}
                onChange={e => setForm(f => ({ ...f, sql_query: e.target.value }))}
                style={{ ...styles.input, height: 120, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }}
                placeholder="SELECT * FROM clients LIMIT 10"
              />
            </Field>
            {createError && <p style={styles.error}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(''); }}
                style={styles.btnSm}
              >
                Cancel
              </button>
              <button type="submit" disabled={createMut.isPending} style={styles.btnPrimary}>
                {createMut.isPending ? 'Creating…' : t('reports.createCustomReport')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Dashboard Widgets
// ---------------------------------------------------------------------------

interface WidgetForm {
  widget_type: string;
  title: string;
}

function WidgetsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<WidgetForm>({ widget_type: 'revenue_chart', title: '' });
  const [createError, setCreateError] = useState('');

  const { data, isFetching, error } = useQuery<DashboardWidgetListData>({
    queryKey: ['dashboard-widgets'],
    queryFn: () => apiFetch('/dashboard-widgets'),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/dashboard-widgets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-widgets'] });
      setShowCreate(false);
      setForm({ widget_type: 'revenue_chart', title: '' });
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/dashboard-widgets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-widgets'] }),
  });

  const savePositionsMut = useMutation({
    mutationFn: (widgets: DashboardWidget[]) =>
      apiFetch('/dashboard-widgets/batch', {
        method: 'PUT',
        body: JSON.stringify({
          widgets: widgets.map(w => ({
            id: w.id,
            position_x: w.position_x,
            position_y: w.position_y,
            width: w.width,
            height: w.height,
          })),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-widgets'] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMut.mutate({ widget_type: form.widget_type, title: form.title });
  }

  const rows = data?.data ?? [];

  return (
    <div style={styles.tabContent}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>{t('reports.dashboardWidgets')}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => savePositionsMut.mutate(rows)}
            disabled={savePositionsMut.isPending || rows.length === 0}
            style={styles.btn}
          >
            {savePositionsMut.isPending ? 'Saving…' : t('reports.savePositions')}
          </button>
          <button onClick={() => setShowCreate(true)} style={styles.btnPrimary}>
            + {t('reports.createWidget')}
          </button>
        </div>
      </div>

      {isFetching && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{String(error)}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>{t('reports.widgetType')}</th>
            <th style={styles.th}>{t('reports.title')}</th>
            <th style={styles.th}>X</th>
            <th style={styles.th}>Y</th>
            <th style={styles.th}>W</th>
            <th style={styles.th}>H</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={styles.td}>{r.id}</td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, background: '#4a90e2' }}>{r.widget_type}</span>
              </td>
              <td style={styles.td}>{r.title}</td>
              <td style={styles.td}>{r.position_x}</td>
              <td style={styles.td}>{r.position_y}</td>
              <td style={styles.td}>{r.width}</td>
              <td style={styles.td}>{r.height}</td>
              <td style={styles.td}>
                <button
                  onClick={() => deleteMut.mutate(r.id)}
                  disabled={deleteMut.isPending}
                  style={{ ...styles.btnSm, color: '#e74c3c' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !isFetching && (
            <tr>
              <td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                No widgets configured
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showCreate && (
        <Modal
          title={t('reports.createWidget')}
          onClose={() => { setShowCreate(false); setCreateError(''); }}
        >
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label={t('reports.widgetType')}>
              <select
                value={form.widget_type}
                onChange={e => setForm(f => ({ ...f, widget_type: e.target.value }))}
                style={styles.input}
              >
                {WIDGET_TYPES.map(wt => (
                  <option key={wt} value={wt}>{wt}</option>
                ))}
              </select>
            </Field>
            <Field label={t('reports.title')}>
              <input
                required
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                style={styles.input}
              />
            </Field>
            {createError && <p style={styles.error}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(''); }}
                style={styles.btnSm}
              >
                Cancel
              </button>
              <button type="submit" disabled={createMut.isPending} style={styles.btnPrimary}>
                {createMut.isPending ? 'Creating…' : t('reports.createWidget')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ReportsTabBar({ tab, onTabChange }: { tab: Tab; onTabChange: (t: Tab) => void }) {
  const { t } = useTranslation();
  const TABS: { key: Tab; label: string }[] = [
    { key: 'revenue', label: '💰 Revenue' },
    { key: 'growth', label: '📈 Subscriber Growth' },
    { key: 'aging', label: '⏳ AR Aging' },
    { key: 'ift', label: '🏛️ IFT Statistical' },
    { key: 'technicians', label: '🔧 Technicians' },
    { key: 'exports', label: '⬇ Export' },
    { key: 'network', label: t('reports.networkTab') },
    { key: 'compliance', label: t('reports.complianceTab') },
    { key: 'scheduled', label: t('reports.scheduledTab') },
    { key: 'custom', label: t('reports.customTab') },
    { key: 'widgets', label: t('reports.widgetsTab') },
  ];
  return (
    <div style={styles.tabs}>
      {TABS.map(tabDef => (
        <button
          key={tabDef.key}
          onClick={() => onTabChange(tabDef.key)}
          style={{ ...styles.tabBtn, ...(tab === tabDef.key ? styles.tabBtnActive : {}) }}
        >
          {tabDef.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export panel — CSV downloads for core datasets
// ---------------------------------------------------------------------------

const EXPORTS: { path: ExportPath; filename: string; label: string }[] = [
  { path: '/export/clients', filename: 'clients.csv', label: 'Clients' },
  { path: '/export/contracts', filename: 'contracts.csv', label: 'Contracts' },
  { path: '/export/invoices', filename: 'invoices.csv', label: 'Invoices' },
  { path: '/export/payments', filename: 'payments.csv', label: 'Payments' },
];

function ExportPanel() {
  const [busy, setBusy] = useState<ExportPath | null>(null);
  const [error, setError] = useState('');

  async function handleExport(path: ExportPath, filename: string) {
    setBusy(path);
    setError('');
    try {
      await downloadCsv(path, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate export');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={styles.tabContent}>
      <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>Export data (CSV)</h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Download a CSV snapshot of your organization&apos;s records.
      </p>
      {error && <div style={styles.exportError}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {EXPORTS.map(e => (
          <button
            key={e.path}
            style={styles.btnPrimary}
            onClick={() => handleExport(e.path, e.filename)}
            disabled={busy !== null}
          >
            {busy === e.path ? 'Exporting…' : `⬇ ${e.label}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Reports() {
  const [tab, setTab] = useState<Tab>('revenue');

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Reports</h1>

      <ReportsTabBar tab={tab} onTabChange={setTab} />

      {tab === 'revenue' && <RevenueTab />}
      {tab === 'growth' && <GrowthTab />}
      {tab === 'aging' && <AgingTab />}
      {tab === 'ift' && <IftTab />}
      {tab === 'technicians' && <TechnicianTab />}
      {tab === 'exports' && <ExportPanel />}
      {tab === 'network' && <NetworkTab />}
      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'scheduled' && <ScheduledTab />}
      {tab === 'custom' && <CustomTab />}
      {tab === 'widgets' && <WidgetsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    padding: '1.5rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1000,
  } as CSSProperties,
  pageTitle: {
    margin: '0 0 1rem',
    fontSize: '1.4rem',
    fontWeight: 700,
  } as CSSProperties,
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '2px solid var(--border)',
    marginBottom: 20,
  } as CSSProperties,
  tabBtn: {
    padding: '8px 18px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    borderRadius: '4px 4px 0 0',
    transition: 'background 0.1s',
  } as CSSProperties,
  tabBtnActive: {
    background: 'var(--bg-card)',
    color: 'var(--accent)',
    fontWeight: 600,
    borderBottom: '2px solid var(--accent)',
    marginBottom: -2,
  } as CSSProperties,
  tabContent: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    padding: '1.25rem',
    boxShadow: '0 0 0 1px var(--border)',
  } as CSSProperties,
  filterRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap' as const,
  } as CSSProperties,
  label: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
  } as CSSProperties,
  input: {
    padding: '6px 10px',
    border: '1px solid var(--input-border)',
    borderRadius: 4,
    fontSize: '0.9rem',
    fontFamily: 'var(--font-sans)',
  } as CSSProperties,
  btn: {
    padding: '6px 14px',
    background: '#f0f0f0',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
  } as CSSProperties,
  btnPrimary: {
    padding: '7px 16px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
  } as CSSProperties,
  btnSm: {
    padding: '5px 12px',
    background: '#f5f5f5',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem',
  } as CSSProperties,
  exportError: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '8px 12px',
    borderRadius: 6,
    marginBottom: 12,
    fontSize: '0.85rem',
  } as CSSProperties,
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: 12,
    marginBottom: 20,
  } as CSSProperties,
  kpiCard: {
    background: 'var(--bg-muted)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '12px 14px',
  } as CSSProperties,
  sectionTitle: {
    margin: '16px 0 10px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '0.88rem',
  } as CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    background: '#f5f5f5',
    borderBottom: '2px solid #e0e0e0',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontSize: '0.82rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap' as const,
  } as CSSProperties,
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #f0f0f0',
    color: 'var(--text-secondary)',
    verticalAlign: 'middle' as const,
  } as CSSProperties,
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 600,
  } as CSSProperties,
  muted: {
    color: 'var(--text-faint)',
    fontSize: '0.85rem',
  } as CSSProperties,
  error: {
    color: '#e74c3c',
    fontSize: '0.85rem',
    marginBottom: 8,
  } as CSSProperties,
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as CSSProperties,
  modal: {
    background: 'var(--bg-card)',
    borderRadius: 8,
    width: 560,
    maxWidth: '95vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,.18)',
  } as CSSProperties,
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
  } as CSSProperties,
  modalBody: {
    padding: '16px 18px',
    overflowY: 'auto' as const,
    flex: 1,
  } as CSSProperties,
  closeBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: '1rem',
    cursor: 'pointer',
    color: 'var(--text-faint)',
  } as CSSProperties,
};
