// =============================================================================
// FireISP 5.0 — SubscriberCertificateList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SubscriberCertificateList } from '../SubscriberCertificateList';

// ---------------------------------------------------------------------------
// Mock apiFetch via tokenStore (the component uses raw fetch via tokenStore)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

const cert1 = {
  id: 1,
  organization_id: 10,
  radius_account_id: 5,
  client_id: 3,
  common_name: 'client3@isp.net',
  serial_number: '0ABCDEF123',
  fingerprint_sha256: 'a'.repeat(64),
  valid_from: '2025-01-01T00:00:00Z',
  valid_until: '2027-01-01T00:00:00Z',
  status: 'active',
  revoked_at: null,
  revocation_reason: null,
  created_at: '2025-01-01T00:00:00Z',
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SubscriberCertificateList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SubscriberCertificateList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [cert1],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      }),
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Subscriber Certificates')).toBeInTheDocument());
  });

  it('renders a certificate row with its CN and serial', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('client3@isp.net')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('0ABCDEF123')).toBeInTheDocument());
  });

  it('shows "Register Certificate" button', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('+ Register Certificate')).toBeInTheDocument());
  });

  it('shows empty message when no certificates', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
      }),
    });
    renderList();
    await waitFor(() =>
      expect(screen.getByText(/No subscriber certificates registered/)).toBeInTheDocument(),
    );
  });

  it('shows Revoke button for active certificate', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Revoke')).toBeInTheDocument());
  });

  it('does not show Revoke button for revoked certificate', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ ...cert1, status: 'revoked', revoked_at: '2025-06-01T00:00:00Z', revocation_reason: 'Key compromised' }],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      }),
    });
    renderList();
    await waitFor(() => expect(screen.queryByText('Revoke')).not.toBeInTheDocument());
  });
});
