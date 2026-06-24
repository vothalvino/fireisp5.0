// =============================================================================
// FireISP 5.0 — NocDashboard tests
// =============================================================================
// Guards the response-shape contract that previously broke the whole page:
// /noc/health and /noc/sla-compliance reply { data: { …inner } } and the page
// reads the nested `devices` object + compliance_pct.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NocDashboard } from '../NocDashboard';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

// envelope = the HTTP body { data: <inner> } that api.GET surfaces as res.data
const envelope = (inner: unknown) => Promise.resolve({ data: { data: inner }, error: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    switch (path) {
      case '/noc/health':
        return envelope({ devices: { total_devices: 15, up: 8, down: 7, warning: 0 }, uptime_pct: 53, active_alerts: [] });
      case '/noc/alarms':
        return envelope([{ severity: 'critical', count: 2 }]);
      case '/noc/outages':
        return envelope([]);
      case '/noc/ticket-queue':
        return envelope([{ status: 'open', count: 3 }]);
      case '/noc/events':
        return envelope([]);
      case '/noc/sla-compliance':
        return envelope({ total: 10, compliant: 9, non_compliant: 1, compliance_pct: 90 });
      default:
        return envelope(null);
    }
  });
});

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NocDashboard />
    </QueryClientProvider>,
  );
}

describe('NocDashboard', () => {
  it('renders network-health numbers from the nested devices object', async () => {
    renderDash();
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());  // devices up
    expect(screen.getByText('7')).toBeInTheDocument();                      // devices down
  });

  it('renders the SLA compliance percentage', async () => {
    renderDash();
    await waitFor(() => expect(screen.getByText('90.0%')).toBeInTheDocument());
  });

  it('renders the ticket-queue counts', async () => {
    renderDash();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });
});
