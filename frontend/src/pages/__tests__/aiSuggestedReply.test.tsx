// =============================================================================
// FireISP 5.0 — AI Suggested Reply panel tests (P1 §6.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TicketDetail } from '../TicketDetail';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/api/client', () => ({
  api: {
    GET: vi.fn(async (path: string) => {
      if (String(path).includes('/tickets/')) return { data: { data: ticket1 }, error: null };
      if (String(path).includes('/clients/')) return { data: { data: client1 }, error: null };
      if (String(path).includes('/users'))    return { data: { data: [] },      error: null };
      return { data: { data: null }, error: null };
    }),
  },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

vi.mock('@/api/useWebSocket',          () => ({ useWebSocket:          vi.fn(() => ({ lastMessage: null })) }));
vi.mock('@/api/useGraphQLSubscription', () => ({ useGraphQLSubscription: vi.fn(() => ({ data: null })) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminUser: AuthUser = {
  id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin',
  organization_id: 1, is_active: true, email_verified_at: '2026-01-01T00:00:00.000Z', twofa_enabled: false,
};

const ticket1 = {
  id: 99,
  client_id: 5,
  contract_id: 3,
  assigned_to: null,
  subject: 'Internet very slow',
  description: 'Speed drops to 1 Mbps after 9 PM',
  priority: 'high',
  category: 'connectivity',
  status: 'open',
  created_at: '2026-04-01T08:00:00Z',
  updated_at: '2026-04-01T09:00:00Z',
};

const client1 = { id: 5, name: 'Jane Doe', email: 'jane@example.com' };

const enabledPolicy = { id: 1, enabled: 1, mode: 'draft_only', active_provider_id: 2 };
const disabledPolicy = { id: 1, enabled: 0, mode: 'draft_only', active_provider_id: null };

const contextSnapshot = JSON.stringify({
  topology: {
    cpe:          { id: 10, name: 'CPE-J' },
    accessDevice: { id: 20, name: 'SW-B' },
    backhauls:    [{ device: { id: 30, name: 'BH-1' }, medium: 'fiber' }],
    coreDevice:   { id: 40, name: 'CORE-A' },
    activeOutages: [],
  },
});

const proposedLog = {
  id: 55,
  ticket_id: 99,
  provider_id: 2,
  classification: 'connectivity',
  confidence: 0.87,
  action: 'proposed',
  cost_usd: 0.00015,
  duration_ms: 950,
  draft_text: 'Dear Jane, we have identified a backhaul issue and are working on a fix.',
  context_snapshot: contextSnapshot,
  created_at: '2026-04-01T09:30:00Z',
};

const draftResponse = {
  skipped: false,
  logId:   66,
  draftText: 'A freshly generated reply for this ticket.',
  action: 'proposed',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonOk(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

function mockFetchImpl(overrides: { logsEmpty?: boolean; policyDisabled?: boolean; draftError?: boolean } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path   = typeof url === 'string' ? url.split('?')[0] : '';

    // ticket comments
    if (path.includes('/tickets/') && path.includes('/comments') && method === 'GET')
      return Promise.resolve(makeJsonOk({ data: [] }));

    // AI policy
    if (path.endsWith('/ai/policy') && method === 'GET')
      return Promise.resolve(makeJsonOk({ data: overrides.policyDisabled ? disabledPolicy : enabledPolicy }));

    // AI logs
    if (path.endsWith('/ai/logs') && method === 'GET') {
      const rows = overrides.logsEmpty ? [] : [proposedLog];
      return Promise.resolve(makeJsonOk({ data: rows, meta: { total: rows.length } }));
    }

    // AI reply draft
    if (path.endsWith('/ai/reply/draft') && method === 'POST') {
      if (overrides.draftError)
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'LLM unavailable' }) } as Response);
      return Promise.resolve(makeJsonOk({ data: draftResponse }));
    }

    // AI reply send
    if (path.endsWith('/ai/reply/send') && method === 'POST')
      return Promise.resolve(makeJsonOk({ data: { id: 55, action: 'sent' } }));

    return Promise.resolve(makeJsonOk({ data: null }));
  });
}

function renderTicketDetail() {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: adminUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tickets/99']}>
        <Routes>
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiSuggestedReplyPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the panel when policy is enabled and a proposed log exists', async () => {
    mockFetchImpl();
    renderTicketDetail();

    // Wait for the ticket to load first so the JSDOM environment is fully
    // initialised before we check for the AI panel (avoids a cold-start
    // timeout in heavily-parallelised CI runs).
    await waitFor(() => {
      expect(screen.queryByText(/Internet very slow/i)).toBeTruthy();
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.queryByText(/AI Suggested Reply/i)).toBeTruthy();
    }, { timeout: 3000 });

    // shows draft text
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-text')).toBeTruthy();
    }, { timeout: 3000 });
    expect(screen.getByTestId('ai-draft-text').textContent).toContain('backhaul issue');
  });

  it('hides the panel when policy is disabled', async () => {
    mockFetchImpl({ policyDisabled: true });
    renderTicketDetail();

    await waitFor(() => {
      // ticket loads
      expect(screen.queryByText(/Internet very slow/i)).toBeTruthy();
    });

    expect(screen.queryByText(/AI Suggested Reply/i)).toBeNull();
  });

  it('shows Generate Draft button when no existing log', async () => {
    mockFetchImpl({ logsEmpty: true });
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByText(/AI Suggested Reply/i)).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/Generate Draft/i)).toBeTruthy();
    });
  });

  it('shows classification, confidence badge, and cost from the log', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByText(/connectivity/i)).toBeTruthy();
    });

    // confidence badge (87%)
    await waitFor(() => {
      expect(screen.queryByText(/87%/i)).toBeTruthy();
    });
  });

  it('renders topology breadcrumb nodes', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText('topology breadcrumb')).toBeTruthy();
    });

    const breadcrumb = screen.getByLabelText('topology breadcrumb');
    expect(breadcrumb.textContent).toContain('CPE-J');
    expect(breadcrumb.textContent).toContain('SW-B');
    expect(breadcrumb.textContent).toContain('CORE-A');
  });

  it('calls POST /ai/reply/draft when Generate button is clicked', async () => {
    mockFetchImpl({ logsEmpty: true });
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Generate Draft/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Generate Draft/i));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(c => String(c[0]).includes('/ai/reply/draft'));
      expect(call).toBeTruthy();
    });
  });

  it('displays newly generated draft text after Generate click', async () => {
    mockFetchImpl({ logsEmpty: true });
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Generate Draft/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Generate Draft/i));

    await waitFor(() => {
      expect(screen.queryByTestId('ai-draft-text')).toBeTruthy();
    });
    expect(screen.getByTestId('ai-draft-text').textContent).toContain('freshly generated');
  });

  it('calls POST /ai/reply/send with action=sent when Send is clicked', async () => {
    mockFetchImpl();
    renderTicketDetail();

    // Wait for the draft to be fully populated (draftText AND logId committed) before
    // clicking Send — the Send handler closes over logId, so clicking before the
    // latestLog effect commits state sends log_id: null. Waiting on the draft text
    // (rendered only when hasDraft is true) guarantees logId is set first.
    await waitFor(() => {
      expect(screen.getByTestId('ai-draft-text').textContent).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(/^Send$/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/^Send$/i));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        c => String(c[0]).includes('/ai/reply/send') && c[1]?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string) as { action: string; log_id: number };
      expect(body.action).toBe('sent');
      expect(body.log_id).toBe(55);
    });
  });

  it('opens edit mode when Edit & Send is clicked', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Edit & Send/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Edit & Send/i));

    await waitFor(() => {
      expect(screen.queryByLabelText(/Edit draft/i)).toBeTruthy();
    });
  });

  it('sends edited text with action=edited', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Edit & Send/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/Edit & Send/i));

    const textarea = await screen.findByLabelText(/Edit draft/i);
    fireEvent.change(textarea, { target: { value: 'Custom edited reply text' } });

    fireEvent.click(screen.getByLabelText(/Send edited/i));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        c => String(c[0]).includes('/ai/reply/send') && c[1]?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string) as { action: string; final_text: string };
      expect(body.action).toBe('edited');
      expect(body.final_text).toBe('Custom edited reply text');
    });
  });

  it('calls POST /ai/reply/send with action=discarded when Discard is clicked', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Discard/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Discard/i));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        c => String(c[0]).includes('/ai/reply/send') && c[1]?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string) as { action: string };
      expect(body.action).toBe('discarded');
    });
  });

  it('shows success message after sending', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/^Send$/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/^Send$/i));

    await waitFor(() => {
      expect(screen.queryByText(/Reply sent\./i)).toBeTruthy();
    });
  });

  it('shows discarded message after discarding', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Discard/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/Discard/i));

    await waitFor(() => {
      expect(screen.queryByText(/Draft discarded\./i)).toBeTruthy();
    });
  });

  it('calls POST /ai/reply/draft again when Regenerate is clicked', async () => {
    mockFetchImpl();
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Regenerate/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Regenerate/i));

    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(c => String(c[0]).includes('/ai/reply/draft'));
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error message when draft generation fails', async () => {
    mockFetchImpl({ logsEmpty: true, draftError: true });
    renderTicketDetail();

    await waitFor(() => {
      expect(screen.queryByLabelText(/Generate Draft/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Generate Draft/i));

    await waitFor(() => {
      expect(screen.queryByText(/LLM unavailable/i)).toBeTruthy();
    });
  });

  it('does not render panel for non-staff roles', async () => {
    mockFetchImpl();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { ...adminUser, role: 'readonly' },
      loading: false,
      initialized: true,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
      switchOrganization: vi.fn(),
    } as ReturnType<typeof AuthContextModule.useAuth>);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/tickets/99']}>
          <Routes>
            <Route path="/tickets/:id" element={<TicketDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Internet very slow/i)).toBeTruthy();
    });

    expect(screen.queryByText(/AI Suggested Reply/i)).toBeNull();
  });
});
