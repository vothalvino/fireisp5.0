// =============================================================================
// FireISP 5.0 — DrDrillStatus page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DrDrillStatus } from '../DrDrillStatus';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DrDrillStatus />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DrDrillStatus page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a passing, up-to-date drill', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dr-drill/status')
        return Promise.resolve({
          data: { data: { last_run_at: '2026-05-01T00:00:00.000Z', status: 'pass', days_since_drill: 10, overdue: false, last_error: null } },
          error: undefined,
        });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('🛟 Disaster-Recovery Drill')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Up to date')).toBeInTheDocument());
    expect(screen.getByText('Pass')).toBeInTheDocument();
  });

  it('shows guidance when no drill has run', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dr-drill/status')
        return Promise.resolve({
          data: { data: { last_run_at: null, status: null, days_since_drill: null, overdue: true, last_error: null } },
          error: undefined,
        });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No drill has been run yet/)).toBeInTheDocument());
  });
});
