// =============================================================================
// FireISP 5.0 — AnalyticsDashboard page tests (§15)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AnalyticsDashboard } from '../AnalyticsDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/api/client', () => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// Mock global fetch used by apiFetch helper in AnalyticsDashboard
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const widgetList = {
  data: [
    { id: 1, widget_type: 'revenue_chart', title: 'Revenue', position_x: 0, position_y: 0, width: 2, height: 2 },
    { id: 2, widget_type: 'subscriber_growth', title: 'Growth', position_x: 2, position_y: 0, width: 2, height: 2 },
    { id: 3, widget_type: 'custom', title: 'My Widget', position_x: 0, position_y: 2, width: 2, height: 2 },
    { id: 4, widget_type: 'capacity_forecast', title: 'Capacity Forecast', position_x: 2, position_y: 2, width: 2, height: 2 },
  ],
  meta: { total: 4, page: 1, limit: 25 },
};

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AnalyticsDashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/dashboard-widgets')) {
        return Promise.resolve(makeOkResponse(widgetList));
      }
      // Revenue widget data
      if (url.includes('/reports/financial')) {
        return Promise.resolve(makeOkResponse({ data: { revenue: { invoiced: 50000 } } }));
      }
      // Growth widget data
      if (url.includes('/reports/subscriber-growth')) {
        return Promise.resolve(makeOkResponse({
          data: { months: [{ month: '2026-05', new_contracts: 10, churned: 2 }] },
        }));
      }
      // Aging widget data
      if (url.includes('/reports/aging')) {
        return Promise.resolve(makeOkResponse({ data: { total_outstanding: 12000, invoice_count: 5 } }));
      }
      // Capacity forecast widget — backend returns data.forecast (not data.capacity_forecast)
      if (url.includes('/reports/capacity-forecast')) {
        return Promise.resolve(makeOkResponse({
          data: {
            generated_at: '2026-06-13T00:00:00.000Z',
            organization_id: 1,
            historical: [],
            forecast: [
              { month: '2026-07', predicted_subscribers: 150 },
              { month: '2026-08', predicted_subscribers: 160 },
            ],
          },
        }));
      }
      return Promise.resolve(makeOkResponse({ data: {} }));
    });
  });

  it('renders the page title', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('analyticsDashboard.title')).toBeInTheDocument(),
    );
  });

  it('renders widget cards after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Revenue')).toBeInTheDocument());
    expect(screen.getByText('Growth')).toBeInTheDocument();
    expect(screen.getByText('My Widget')).toBeInTheDocument();
  });

  it('shows the default widget badge for unknown widget_type', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('My Widget')).toBeInTheDocument());
    // The 'custom' type falls through to DefaultWidget which renders the widget_type as a badge
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('renders capacity forecast rows from data.forecast (not data.capacity_forecast)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Capacity Forecast')).toBeInTheDocument());
    // The month value from the forecast array should appear in the table
    await waitFor(() => expect(screen.getByText('2026-07')).toBeInTheDocument());
  });

  it('shows empty state when no widgets are returned', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/dashboard-widgets')) {
        return Promise.resolve(makeOkResponse({ data: [], meta: { total: 0, page: 1, limit: 25 } }));
      }
      return Promise.resolve(makeOkResponse({ data: {} }));
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('analyticsDashboard.noWidgets')).toBeInTheDocument(),
    );
  });

  it('shows error state when widget fetch fails', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'server error' }) } as unknown as Response),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('analyticsDashboard.error')).toBeInTheDocument(),
    );
  });
});
