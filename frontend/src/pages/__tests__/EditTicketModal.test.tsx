// =============================================================================
// FireISP 5.0 — EditTicketModal tests
// =============================================================================
// Ticket editing from the detail page: PATCHes only the dirty fields
// (subject / description / category / priority / notes) and gates Save on a
// non-empty subject + actual changes.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

import { EditTicketModal } from '../TicketDetail';

const ticket = {
  id: 7,
  client_id: 37,
  contract_id: null,
  assigned_to: null,
  subject: 'No internet',
  description: 'Modem lights off',
  priority: 'medium',
  category: 'technical',
  status: 'open',
  notes: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

function renderModal(onSaved = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditTicketModal ticket={ticket} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved, onClose };
}

describe('EditTicketModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthedFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  it('disables Save until something changes, and blocks an empty subject', () => {
    renderModal();
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();
    const subject = screen.getByDisplayValue('No internet');
    fireEvent.change(subject, { target: { value: '' } });
    expect(save).toBeDisabled();
    fireEvent.change(subject, { target: { value: 'No internet — fiber cut' } });
    expect(save).toBeEnabled();
  });

  it('PATCHes only the dirty fields including category and notes', async () => {
    const { onSaved, onClose } = renderModal();
    fireEvent.change(screen.getByDisplayValue('technical'), { target: { value: 'installation' } });
    fireEvent.change(screen.getByPlaceholderText('Operator notes for this ticket'), { target: { value: 'ladder required' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalled());
    const [url, opts] = mockAuthedFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toMatch(/\/tickets\/7$/);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ category: 'installation', notes: 'ladder required' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the API error and stays open on failure', async () => {
    mockAuthedFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Validation failed' }) });
    const { onClose } = renderModal();
    fireEvent.change(screen.getByDisplayValue('medium'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByText('Validation failed')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
