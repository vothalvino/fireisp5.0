// =============================================================================
// FireISP 5.0 — MacMoveEvents page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MacMoveEvents } from '../MacMoveEvents';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: {
    getAccess: () => 'tok',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

const event1 = {
  id: 1,
  organization_id: 10,
  username: 'jdoe',
  old_mac: 'AA:BB:CC:DD:EE:01',
  new_mac: 'AA:BB:CC:DD:EE:02',
  old_nas_id: 3,
  new_nas_id: 4,
  detected_at: '2026-06-01T12:00:00.000Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MacMoveEvents />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MacMoveEvents page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/radius/mac-move-events')
        return Promise.resolve({
          data: { data: [event1], meta: { total: 1, page: 1, limit: 25 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('shows loading state while fetching', () => {
    // Return a promise that never resolves so the loading state persists.
    mockApiGet.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no events are returned', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/radius/mac-move-events')
        return Promise.resolve({
          data: { data: [], meta: { total: 0, page: 1, limit: 25 } },
          error: undefined,
        });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('No MAC move events found.')).toBeInTheDocument(),
    );
  });

  it('renders table rows with mac move event data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('jdoe')).toBeInTheDocument());
    expect(screen.getByText('AA:BB:CC:DD:EE:01')).toBeInTheDocument();
    expect(screen.getByText('AA:BB:CC:DD:EE:02')).toBeInTheDocument();
    // old_nas_id and new_nas_id are rendered as plain numbers
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    mockApiGet.mockImplementation(() =>
      Promise.resolve({ data: undefined, error: { message: 'server error' } }),
    );
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Failed to load MAC move events.'),
      ).toBeInTheDocument(),
    );
  });
});
