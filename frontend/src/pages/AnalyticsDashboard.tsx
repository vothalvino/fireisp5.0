// =============================================================================
// FireISP 5.0 — Analytics Dashboard Page
// =============================================================================
// Route: /analytics-dashboard
// Renders a CSS grid of dashboard widgets fetched from GET /api/v1/dashboard-widgets.
// Each widget card fetches its own data from the appropriate reports endpoint.
// =============================================================================

import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface RevenueData {
  revenue: { invoiced: number };
}

interface GrowthData {
  months: { month: string; new_contracts: number; churned: number }[];
}

interface AgingData {
  total_outstanding: number;
  invoice_count: number;
}

interface CapacityForecastPoint {
  month: string;
  predicted_subscribers: number;
}

interface CapacityForecastData {
  forecast: CapacityForecastPoint[];
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = tokenStore.getAccess();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function currency(n: number, code = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Individual widget renderers
// ---------------------------------------------------------------------------

function RevenueChartWidget({ title }: { title: string }) {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: RevenueData }>({
    queryKey: ['widget', 'revenue-by-period'],
    queryFn: () => apiFetch('/reports/financial?period=monthly'),
    staleTime: 60_000,
  });

  return (
    <div style={widgetStyles.card}>
      <div style={widgetStyles.header}>{title}</div>
      {isFetching && <p style={widgetStyles.muted}>{t('analyticsDashboard.loading')}</p>}
      {error && <p style={widgetStyles.error}>{t('analyticsDashboard.error')}</p>}
      {data?.data && (
        <div>
          <div style={widgetStyles.kpiLabel}>{t('analyticsDashboard.totalRevenue')}</div>
          <div style={widgetStyles.kpiValue}>{currency(data.data.revenue?.invoiced ?? 0)}</div>
        </div>
      )}
    </div>
  );
}

function SubscriberGrowthWidget({ title }: { title: string }) {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: GrowthData }>({
    queryKey: ['widget', 'subscriber-growth'],
    queryFn: () => apiFetch('/reports/subscriber-growth?months=3'),
    staleTime: 60_000,
  });

  const months = data?.data?.months ?? [];
  const totalNew = months.reduce((a, m) => a + Number(m.new_contracts), 0);
  const totalChurn = months.reduce((a, m) => a + Number(m.churned), 0);
  const net = totalNew - totalChurn;

  return (
    <div style={widgetStyles.card}>
      <div style={widgetStyles.header}>{title}</div>
      {isFetching && <p style={widgetStyles.muted}>{t('analyticsDashboard.loading')}</p>}
      {error && <p style={widgetStyles.error}>{t('analyticsDashboard.error')}</p>}
      {months.length > 0 && (
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={widgetStyles.kpiLabel}>{t('analyticsDashboard.subscriberGrowth')}</div>
            <div style={{ ...widgetStyles.kpiValue, color: net >= 0 ? '#27ae60' : '#e74c3c' }}>
              {net > 0 ? `+${net}` : net}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgingSummaryWidget({ title }: { title: string }) {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: AgingData }>({
    queryKey: ['widget', 'aging'],
    queryFn: () => apiFetch('/reports/aging'),
    staleTime: 60_000,
  });

  return (
    <div style={widgetStyles.card}>
      <div style={widgetStyles.header}>{title}</div>
      {isFetching && <p style={widgetStyles.muted}>{t('analyticsDashboard.loading')}</p>}
      {error && <p style={widgetStyles.error}>{t('analyticsDashboard.error')}</p>}
      {data?.data && (
        <div>
          <div style={widgetStyles.kpiLabel}>{t('analyticsDashboard.totalOutstanding')}</div>
          <div style={{ ...widgetStyles.kpiValue, color: '#e74c3c' }}>
            {currency(data.data.total_outstanding ?? 0)}
          </div>
          <div style={widgetStyles.muted}>{data.data.invoice_count} invoices</div>
        </div>
      )}
    </div>
  );
}

function CapacityForecastWidget({ title }: { title: string }) {
  const { t } = useTranslation();
  const { data, isFetching, error } = useQuery<{ data: CapacityForecastData }>({
    queryKey: ['widget', 'capacity-forecast'],
    queryFn: () => apiFetch('/reports/capacity-forecast'),
    staleTime: 60_000,
  });

  const points = data?.data?.forecast ?? [];

  return (
    <div style={widgetStyles.card}>
      <div style={widgetStyles.header}>{title}</div>
      {isFetching && <p style={widgetStyles.muted}>{t('analyticsDashboard.loading')}</p>}
      {error && <p style={widgetStyles.error}>{t('analyticsDashboard.error')}</p>}
      {points.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={widgetStyles.table}>
            <thead>
              <tr>
                <th style={widgetStyles.th}>Month</th>
                <th style={widgetStyles.th}>{t('analyticsDashboard.predicted')}</th>
              </tr>
            </thead>
            <tbody>
              {points.slice(0, 6).map(p => (
                <tr key={p.month}>
                  <td style={widgetStyles.td}>{p.month}</td>
                  <td style={widgetStyles.td}>{p.predicted_subscribers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DefaultWidget({ widget }: { widget: DashboardWidget }) {
  return (
    <div style={widgetStyles.card}>
      <div style={widgetStyles.header}>{widget.title}</div>
      <div style={{ marginTop: 8 }}>
        <span style={widgetStyles.badge}>{widget.widget_type}</span>
      </div>
    </div>
  );
}

function WidgetCard({ widget }: { widget: DashboardWidget }) {
  switch (widget.widget_type) {
    case 'revenue_chart':
      return <RevenueChartWidget title={widget.title} />;
    case 'subscriber_growth':
      return <SubscriberGrowthWidget title={widget.title} />;
    case 'aging_summary':
      return <AgingSummaryWidget title={widget.title} />;
    case 'capacity_forecast':
      return <CapacityForecastWidget title={widget.title} />;
    default:
      return <DefaultWidget widget={widget} />;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AnalyticsDashboard() {
  const { t } = useTranslation();

  const { data, isFetching, error } = useQuery<DashboardWidgetListData>({
    queryKey: ['dashboard-widgets'],
    queryFn: () => apiFetch('/dashboard-widgets'),
    staleTime: 30_000,
  });

  const widgets = data?.data ?? [];

  return (
    <div style={pageStyles.page}>
      <h1 style={pageStyles.title}>{t('analyticsDashboard.title')}</h1>

      {isFetching && <p style={pageStyles.muted}>{t('analyticsDashboard.loading')}</p>}
      {error && <p style={pageStyles.error}>{t('analyticsDashboard.error')}</p>}

      {!isFetching && widgets.length === 0 && (
        <p style={pageStyles.muted}>{t('analyticsDashboard.noWidgets')}</p>
      )}

      {widgets.length > 0 && (
        <div style={pageStyles.grid}>
          {widgets.map(w => (
            <WidgetCard key={w.id} widget={w} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyles = {
  page: {
    padding: '1.5rem',
    fontFamily: 'var(--font-sans)',
    maxWidth: 1200,
  } as CSSProperties,
  title: {
    margin: '0 0 1.25rem',
    fontSize: '1.4rem',
    fontWeight: 700,
  } as CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1rem',
  } as CSSProperties,
  muted: {
    color: 'var(--text-faint)',
    fontSize: '0.85rem',
  } as CSSProperties,
  error: {
    color: '#e74c3c',
    fontSize: '0.85rem',
  } as CSSProperties,
};

const widgetStyles = {
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1rem',
    boxShadow: '0 1px 4px rgba(0,0,0,.06)',
    minHeight: 120,
  } as CSSProperties,
  header: {
    fontWeight: 600,
    fontSize: '0.95rem',
    marginBottom: 12,
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
    paddingBottom: 8,
  } as CSSProperties,
  kpiLabel: {
    fontSize: '0.75rem',
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 4,
  } as CSSProperties,
  kpiValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--accent)',
  } as CSSProperties,
  muted: {
    color: 'var(--text-faint)',
    fontSize: '0.8rem',
    marginTop: 4,
  } as CSSProperties,
  error: {
    color: '#e74c3c',
    fontSize: '0.8rem',
  } as CSSProperties,
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    background: '#4a90e2',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 600,
  } as CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '0.82rem',
  } as CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '5px 8px',
    background: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontSize: '0.78rem',
    textTransform: 'uppercase' as const,
  } as CSSProperties,
  td: {
    padding: '5px 8px',
    borderBottom: '1px solid #f0f0f0',
    color: 'var(--text-secondary)',
  } as CSSProperties,
};
