// =============================================================================
// FireISP 5.0 — DsarTool page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DsarTool } from '../DsarTool';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const dsar = {
  meta: { generatedAt: '2026-01-01T00:00:00.000Z', clientId: 42, organizationId: 1, version: '1.1' },
  data: {
    client: { id: 42, name: 'Jane Doe', email: 'jane@example.com' },
    contacts: [{}, {}],
    mxProfile: { rfc: 'XAXX010101000' },
    contracts: [{}],
    invoices: [],
    payments: [],
    tickets: [{}],
    connectionLogs: [],
    ipAssignments: [],
    aiReplyLogs: [],
  },
};

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DsarTool />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DsarTool page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dsar/clients/{id}')
        return Promise.resolve({ data: dsar, error: undefined });
      return Promise.resolve({ data: {}, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderTool();
    await waitFor(() => expect(screen.getByText('🔐 Data Subject Access Request')).toBeInTheDocument());
  });

  it('assembles the export and shows the client summary', async () => {
    renderTool();
    fireEvent.change(screen.getByPlaceholderText('e.g. 42'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Assemble export'));
    await waitFor(() => expect(screen.getByText(/Jane Doe/)).toBeInTheDocument());
    // mxProfile present + a download button appears
    await waitFor(() => expect(screen.getByText('⬇ Download JSON')).toBeInTheDocument());
  });
});
