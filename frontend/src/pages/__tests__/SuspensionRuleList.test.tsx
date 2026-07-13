// =============================================================================
// FireISP 5.0 — SuspensionRuleList page tests (full CRUD — §1.2)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SuspensionRuleList } from '../SuspensionRuleList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' } }),
}));

// `notify_before_days` is the real database/schema.sql column, and `SELECT *`
// returns it unaliased — this is what the backend actually sends.
const rule1 = {
  id: 1, name: 'Suspensión 30 días', days_past_due: 30, grace_period_days: 3,
  action: 'auto_suspend', notify_before_days: 5, is_active: 1,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuspensionRuleList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SuspensionRuleList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/suspension-rules')
        return Promise.resolve({ data: { data: [rule1], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('⛔ Suspension Rules')).toBeInTheDocument());
  });

  it('renders a rule row with its name', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Suspensión 30 días')).toBeInTheDocument());
  });

  it('shows the grace period value in the table', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('3 days')).toBeInTheDocument());
  });

  it('shows New Rule and Edit/Delete buttons for admin', async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText('+ New Rule')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('renders the notify_before_days backend field (real schema column, not notify_days_before)', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('5 days')).toBeInTheDocument());
  });

  it('shows empty message when no rules', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/suspension-rules')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No suspension rules configured/)).toBeInTheDocument());
  });

  it('creates a rule with the real backend field names (is_active, notify_before_days)', async () => {
    // The form used to send `is_enabled` / `notify_days_before`, neither of
    // which is a real column — the backend model's fillable list dropped/
    // rejected them. Assert the actual POST body uses the real names.
    // The form's <label> elements are not id/htmlFor-associated with their
    // inputs, so query by role within the dialog rather than by label text.
    mockApiPost.mockResolvedValue({ data: { id: 2 }, error: undefined });
    const user = userEvent.setup();

    renderList();
    await waitFor(() => expect(screen.getByText('+ New Rule')).toBeInTheDocument());
    await user.click(screen.getByText('+ New Rule'));

    const dialog = await screen.findByRole('dialog', { name: 'New Suspension Rule' });
    const nameInput = within(dialog).getByRole('textbox');
    await user.type(nameInput, 'New dunning rule');

    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled());
    const [path, options] = mockApiPost.mock.calls[0];
    expect(path).toBe('/suspension-rules');
    const body = (options as { body: Record<string, unknown> }).body;
    expect(body).toHaveProperty('is_active');
    expect(body).not.toHaveProperty('is_enabled');
    expect(body).not.toHaveProperty('notify_days_before');
  });
});

