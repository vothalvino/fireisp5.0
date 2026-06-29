import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  api: { POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

import { api } from '@/api/client';
import { NewTicketModal } from '../NewTicketModal';

beforeEach(() => {
  vi.clearAllMocks();
  (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1 } }, error: undefined });
});

describe('NewTicketModal', () => {
  it('locks the client and POSTs /tickets with subject + locked client_id', async () => {
    const onCreated = vi.fn();
    render(<NewTicketModal lockedClientId={7} lockedClientName="Acme Corp" onClose={vi.fn()} onCreated={onCreated} />);

    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Brief description of the issue'), { target: { value: 'Internet down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith(
      '/tickets',
      expect.objectContaining({ body: expect.objectContaining({ subject: 'Internet down', client_id: 7 }) }),
    ));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('disables submit until a subject is entered', () => {
    render(<NewTicketModal lockedClientId={7} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create Ticket' })).toBeDisabled();
  });
});
