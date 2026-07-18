// =============================================================================
// FireISP 5.0 — OrganizationDetail page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { OrganizationDetail } from '../OrganizationDetail';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockGet(...a),
    PUT: (...a: unknown[]) => mockPut(...a),
    POST: (...a: unknown[]) => mockPost(...a),
  },
  tokenStore: { getAccess: () => 'tok' },
}));

const ORG = {
  id: 1, name: 'Demo ISP', legal_name: 'Demo SA', email: 'a@demo.mx', phone: null, website: null,
  address: null, city: null, state: null, zip_code: null, country: null, currency: 'MXN',
  locale: 'global', tax_id: null, logo_url: null, status: 'active',
};

const IDENTITIES = [
  { organization_id: 1, email_function: 'general', enabled: true, smtp_host: 'g.smtp', smtp_port: 587, smtp_secure: false, smtp_user: 'gu', from_email: 'general@demo.mx', from_name: 'Demo', configured: true, has_password: true, last_test_at: null, last_test_status: null, last_test_error: null },
  { organization_id: 1, email_function: 'support', enabled: false, smtp_host: null, smtp_port: 587, smtp_secure: false, smtp_user: null, from_email: null, from_name: null, configured: false, has_password: false, last_test_at: null, last_test_status: null, last_test_error: null },
  { organization_id: 1, email_function: 'billing', enabled: true, smtp_host: 'b.smtp', smtp_port: 587, smtp_secure: false, smtp_user: 'bu', from_email: 'billing@demo.mx', from_name: 'Billing', configured: true, has_password: true, last_test_at: null, last_test_status: null, last_test_error: null },
  { organization_id: 1, email_function: 'noc', enabled: false, smtp_host: null, smtp_port: 587, smtp_secure: false, smtp_user: null, from_email: null, from_name: null, configured: false, has_password: false, last_test_at: null, last_test_status: null, last_test_error: null },
];

function installGet() {
  mockGet.mockImplementation((path: string) => {
    if (path === '/organizations/{id}') return Promise.resolve({ data: { data: ORG }, error: undefined });
    if (path === '/organizations/{id}/email-settings') return Promise.resolve({ data: { data: IDENTITIES }, error: undefined });
    if (path === '/organizations/{id}/settings') return Promise.resolve({ data: { data: { invoice_prefix: 'INV-' } }, error: undefined });
    if (path === '/organizations/{id}/quota') return Promise.resolve({ data: { data: { limits: null, usage: { clients: 3, devices: 1, storage_mb: 0, scheduled_tasks: 5 } } }, error: undefined });
    return Promise.resolve({ data: {}, error: undefined });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/1']}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrganizationDetail page', () => {
  beforeEach(() => { vi.clearAllMocks(); installGet(); });

  it('renders the org name and the four tabs, Edit first', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('🏢 Demo ISP')).toBeInTheDocument());
    for (const tab of ['Edit', 'Settings', 'Quota', 'Mail']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    // Edit tab shows the org's current values.
    expect(await screen.findByDisplayValue('Demo ISP')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MXN')).toBeInTheDocument();
  });

  it('Mail tab lists all four function identities with their status', async () => {
    renderPage();
    await screen.findByText('🏢 Demo ISP');
    fireEvent.click(screen.getByRole('button', { name: 'Mail' }));

    await waitFor(() => expect(screen.getByText('billing@demo.mx')).toBeInTheDocument());
    // Configured+enabled billing/general show "Configured"; support/noc "Inherits general/global".
    expect(screen.getAllByText('Configured').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Inherits general/global').length).toBeGreaterThanOrEqual(2);
  });

  it('saves a function identity, omitting the blank password (write-only)', async () => {
    mockPut.mockResolvedValue({ data: { data: IDENTITIES[2] }, error: undefined });
    renderPage();
    await screen.findByText('🏢 Demo ISP');
    fireEvent.click(screen.getByRole('button', { name: 'Mail' }));

    // Expand the Support identity and save without typing a password.
    const supportToggle = await screen.findByText('Support');
    fireEvent.click(supportToggle);
    fireEvent.change(await screen.findByPlaceholderText('support@isp.example'), { target: { value: 'support@demo.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
    const [path, opts] = mockPut.mock.calls[0];
    expect(path).toBe('/organizations/{id}/email-settings/{function}');
    expect((opts as { params: { path: { function: string } } }).params.path.function).toBe('support');
    const body = (opts as { body: Record<string, unknown> }).body;
    expect(body.from_email).toBe('support@demo.mx');
    expect(body).not.toHaveProperty('smtp_password');
  });

  it('sends a test email through the addressed function', async () => {
    mockPost.mockResolvedValue({ data: { data: { success: true } }, error: undefined });
    renderPage();
    await screen.findByText('🏢 Demo ISP');
    fireEvent.click(screen.getByRole('button', { name: 'Mail' }));
    fireEvent.click(await screen.findByText('Billing'));

    fireEvent.change(await screen.findByPlaceholderText('Send test to…'), { target: { value: 'me@demo.mx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    const [path, opts] = mockPost.mock.calls[0];
    expect(path).toBe('/organizations/{id}/email-settings/{function}/test');
    expect((opts as { params: { path: { function: string } } }).params.path.function).toBe('billing');
    expect((opts as { body: { to: string } }).body.to).toBe('me@demo.mx');
    await waitFor(() => expect(screen.getByText('Test email sent.')).toBeInTheDocument());
  });
});
