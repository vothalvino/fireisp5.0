// =============================================================================
// FireISP 5.0 — AiSupportPage tests (§21 AI Customer Support)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AiSupportPage } from '../AiSupportPage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleConversation = {
  id: 1,
  organization_id: 1,
  client_id: 42,
  channel: 'web',
  status: 'open',
  intent: 'billing_inquiry',
  confidence: 0.92,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const sampleMessage = {
  id: 1,
  conversation_id: 1,
  role: 'user',
  content: 'Hello, I need help with my bill.',
  created_at: '2026-01-01T00:01:00Z',
};

const sampleArticle = {
  id: 1,
  organization_id: 1,
  title: 'How to pay your invoice',
  body: 'You can pay via credit card or bank transfer.',
  category: 'billing',
  locale: 'en',
  tags: ['billing', 'payment'],
  is_published: 1,
  created_at: '2026-01-01T00:00:00Z',
};

const sampleMetrics = {
  resolution_rate: 0.85,
  escalation_rate: 0.10,
  avg_handle_time_seconds: 180,
  csat: 4.5,
  total_conversations: 120,
  total_escalations: 12,
};

const sampleInsight = {
  id: 1,
  organization_id: 1,
  insight_type: 'shift-summary',
  alert_id: null,
  confidence: 0.88,
  summary: 'Network stable during last shift.',
  recommendation: 'Continue monitoring sector B.',
  created_at: '2026-01-01T06:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
  } as Response;
}

function setupFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = typeof url === 'string' ? url.replace(/\?.*/, '') : '';

    if (path.includes('/support/conversations') && !path.includes('/messages') && !path.includes('/escalate') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [sampleConversation] }));
    if (path.includes('/support/conversations') && path.includes('/messages') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [sampleMessage] }));
    if (path.includes('/support/conversations') && path.includes('/messages') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: sampleMessage }));
    if (path.includes('/support/conversations') && path.includes('/escalate') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...sampleConversation, status: 'escalated' } }));
    if (path.includes('/support/conversations') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...sampleConversation, id: 2 } }));
    if (path.includes('/support/kb/') && path.includes('/embed') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ success: true }));
    if (path.includes('/support/kb') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [sampleArticle] }));
    if (path.includes('/support/kb') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...sampleArticle, id: 2 } }));
    if (path.includes('/support/metrics'))
      return Promise.resolve(makeJsonResponse({ data: sampleMetrics }));
    if (path.includes('/noc-ai/insights') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [sampleInsight] }));
    if (path.includes('/noc-ai/insights/') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: sampleInsight }));

    return Promise.resolve(makeJsonResponse({ data: [] }));
  });
}

function renderPage() {
  setupFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AiSupportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiSupportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('orgId', '1');
    localStorage.setItem('token', 'test-token');
  });

  // ---- Page structure -------------------------------------------------------

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('AI Customer Support')).toBeInTheDocument();
  });

  it('renders all 4 tabs', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Knowledge Base' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NOC Insights' })).toBeInTheDocument();
  });

  // ---- Chat tab -------------------------------------------------------------

  it('Chat tab is active by default and shows chat content', async () => {
    renderPage();
    // The New Conversation button is visible on the Chat tab by default
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New Conversation' })).toBeInTheDocument(),
    );
  });

  it('Chat tab shows loaded conversations', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
  });

  it('Chat tab shows New Conversation button', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'New Conversation' })).toBeInTheDocument();
  });

  it('clicking New Conversation calls POST /support/conversations', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New Conversation' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'New Conversation' }));
    await waitFor(() => {
      const postCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) =>
          (url as string).includes('/support/conversations') &&
          (init?.method ?? '').toUpperCase() === 'POST' &&
          !(url as string).includes('/messages') &&
          !(url as string).includes('/escalate'),
      );
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  // ---- Knowledge Base tab ---------------------------------------------------

  it('clicking Knowledge Base tab shows KB content', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search articles')).toBeInTheDocument(),
    );
  });

  it('KB tab shows article list', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    await waitFor(() =>
      expect(screen.getByText('How to pay your invoice')).toBeInTheDocument(),
    );
  });

  it('KB tab shows New Article button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New Article' })).toBeInTheDocument(),
    );
  });

  it('clicking New Article shows create form with Title and Content fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New Article' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'New Article' }));
    expect(screen.getByText(/Title \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Content \*/i)).toBeInTheDocument();
  });

  it('KB create button is disabled when title or body is empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New Article' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'New Article' }));
    // There are multiple buttons with "New Article" text — the create submit button inside the form
    const createButtons = screen.getAllByRole('button', { name: 'New Article' });
    // The form's submit button (last one rendered inside the form) should be disabled
    const submitButton = createButtons[createButtons.length - 1];
    expect(submitButton).toBeDisabled();
  });

  // ---- Metrics tab ----------------------------------------------------------

  it('clicking Metrics tab shows metrics content', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    await waitFor(() =>
      expect(screen.getByText('Resolution Rate')).toBeInTheDocument(),
    );
  });

  it('Metrics tab shows Escalation Rate KPI label', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    await waitFor(() =>
      expect(screen.getByText('Escalation Rate')).toBeInTheDocument(),
    );
  });

  it('Metrics tab shows Total Conversations and Total Escalations KPIs', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    await waitFor(() => {
      expect(screen.getByText('Total Conversations')).toBeInTheDocument();
      expect(screen.getByText('Total Escalations')).toBeInTheDocument();
    });
  });

  it('Metrics tab shows computed KPI values from API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    await waitFor(() => {
      // resolution_rate: 0.85 => "85.0%"
      expect(screen.getByText('85.0%')).toBeInTheDocument();
      // total_conversations: 120
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });

  it('Metrics tab calls GET /support/metrics on mount', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    await waitFor(() => {
      const metricsCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url]) => (url as string).includes('/support/metrics'),
      );
      expect(metricsCalls.length).toBeGreaterThan(0);
    });
  });

  // ---- NOC Insights tab -----------------------------------------------------

  it('clicking NOC Insights tab shows NOC content', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Shift Summary' })).toBeInTheDocument(),
    );
  });

  it('NOC tab shows Capacity Warning action button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Capacity Warning' })).toBeInTheDocument(),
    );
  });

  it('NOC tab shows Interference Detection and Alignment Drift buttons', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Interference Detection' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Alignment Drift' })).toBeInTheDocument();
    });
  });

  it('NOC tab shows Alert ID input and Explain Alert button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Alert ID')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Explain Alert' })).toBeInTheDocument();
    });
  });

  it('NOC tab shows loaded insights in table', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() =>
      expect(screen.getByText('Network stable during last shift.')).toBeInTheDocument(),
    );
  });

  it('clicking Shift Summary calls POST /noc-ai/insights/shift-summary', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'NOC Insights' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Shift Summary' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Shift Summary' }));
    await waitFor(() => {
      const shiftCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) =>
          (url as string).includes('/noc-ai/insights/shift-summary') &&
          (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(shiftCalls.length).toBeGreaterThan(0);
    });
  });
});
