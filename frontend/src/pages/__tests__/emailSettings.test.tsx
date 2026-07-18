// =============================================================================
// FireISP 5.0 — Settings page / Email Settings tab tests (migration 386)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';

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
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface EmailSettingsFixture {
  organization_id: number;
  enabled: boolean;
  smtp_host: string | null;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  from_email: string | null;
  from_name: string | null;
  configured: boolean;
  has_password: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
}

const notConfigured: EmailSettingsFixture = {
  organization_id: 1, enabled: false, smtp_host: null, smtp_port: 587, smtp_secure: false,
  smtp_user: null, from_email: null, from_name: null, configured: false, has_password: false,
  last_test_at: null, last_test_status: null, last_test_error: null,
};

const configured: EmailSettingsFixture = {
  organization_id: 1, enabled: true, smtp_host: 'smtp.example.com', smtp_port: 587, smtp_secure: true,
  smtp_user: 'user@example.com', from_email: 'noreply@example.com', from_name: 'Example ISP',
  configured: true, has_password: true, last_test_at: '2026-01-01T00:00:00Z', last_test_status: 'success', last_test_error: null,
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

function setup(emailSettingsData = notConfigured) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = typeof url === 'string' ? url.replace(/\?.*/, '') : '';

    if (path.endsWith('/settings') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [] }));
    if (path.endsWith('/email-settings') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: emailSettingsData }));
    if (path.endsWith('/email-settings') && method === 'PUT')
      return Promise.resolve(makeJsonResponse({ data: { ...emailSettingsData, configured: true } }));
    if (path.endsWith('/email-settings/test') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { success: true } }));
    return Promise.resolve(makeJsonResponse({ data: [] }));
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function goToEmailTab() {
  setup();
  fireEvent.click(screen.getByText(/📧 Email/i));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings page — Email Settings tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Email tab button', () => {
    setup();
    expect(screen.getByText(/📧 Email/i)).toBeInTheDocument();
  });

  it('shows "not configured" copy and an empty password placeholder when no config exists', async () => {
    goToEmailTab();
    await waitFor(() => expect(screen.getByText(/using the global email relay/i)).toBeInTheDocument());
    const passwordInput = screen.getByLabelText(/SMTP Password/i) as HTMLInputElement;
    expect(passwordInput.placeholder).toBe('');
  });

  it('shows "configured" copy and a dot placeholder once a config exists', async () => {
    setup(configured);
    fireEvent.click(screen.getByText(/📧 Email/i));
    // Wait for the actual fetched row (not the pre-load default) — "Configured"
    // is a substring of the default "Not configured…" copy too, so gate on an
    // unambiguous loaded value instead of the label text.
    await waitFor(() => expect((screen.getByLabelText(/SMTP Host/i) as HTMLInputElement).value).toBe('smtp.example.com'));
    expect(screen.getByText('✓ Configured')).toBeInTheDocument();
    const passwordInput = screen.getByLabelText(/SMTP Password/i) as HTMLInputElement;
    expect(passwordInput.placeholder).toBe('••••••••');
  });

  it('does not include smtp_password in the PUT body when the field is left blank', async () => {
    setup(configured);
    fireEvent.click(screen.getByText(/📧 Email/i));
    await waitFor(() => expect((screen.getByLabelText(/SMTP Host/i) as HTMLInputElement).value).toBe('smtp.example.com'));

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const calls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) => url.endsWith('/email-settings') && (init?.method ?? '').toUpperCase() === 'PUT',
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse(calls[0][1].body as string);
      expect(body).not.toHaveProperty('smtp_password');
    });
  });

  it('includes smtp_password in the PUT body when the operator types a new one', async () => {
    setup(notConfigured);
    fireEvent.click(screen.getByText(/📧 Email/i));
    // Wait for the initial fetch to settle before typing — the form is reset
    // from the fetched row once it arrives, which would otherwise wipe an
    // in-progress edit made during the (typically sub-frame, but real) load window.
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/SMTP Password/i), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const calls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) => url.endsWith('/email-settings') && (init?.method ?? '').toUpperCase() === 'PUT',
      );
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse(calls[0][1].body as string);
      expect(body.smtp_password).toBe('hunter2');
    });
  });

  it('sends a test email and shows a success message inline', async () => {
    setup(configured);
    fireEvent.click(screen.getByText(/📧 Email/i));
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Test Email/i }));

    await waitFor(() => expect(screen.getByText(/Test email sent successfully/i)).toBeInTheDocument());

    const testCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
      ([url, init]) => url.endsWith('/email-settings/test') && (init?.method ?? '').toUpperCase() === 'POST',
    );
    expect(testCalls.length).toBe(1);
    expect(JSON.parse(testCalls[0][1].body as string)).toEqual({ to: 'me@example.com' });
  });

  it('shows an inline failure message without navigating away when the test send fails', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = typeof url === 'string' ? url.replace(/\?.*/, '') : '';
      if (path.endsWith('/settings') && method === 'GET') return Promise.resolve(makeJsonResponse({ data: [] }));
      if (path.endsWith('/email-settings') && method === 'GET') return Promise.resolve(makeJsonResponse({ data: configured }));
      if (path.endsWith('/email-settings/test') && method === 'POST')
        return Promise.resolve(makeJsonResponse({ data: { success: false, error: 'Connection refused' } }));
      return Promise.resolve(makeJsonResponse({ data: [] }));
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText(/📧 Email/i));
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Test Email/i }));

    await waitFor(() => expect(screen.getByText(/Connection refused/i)).toBeInTheDocument());
    // Still on the Email tab, not a blank/crashed page.
    expect(screen.getByText(/Outbound Email/i)).toBeInTheDocument();
  });
});
