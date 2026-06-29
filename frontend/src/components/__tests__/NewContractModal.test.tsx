import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

import { api } from '@/api/client';
import { NewContractModal } from '../NewContractModal';

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <NewContractModal lockedClientId={9} lockedClientName="Acme Corp" onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [{ id: 3, name: 'Gold 100Mbps' }] }, error: undefined });
  (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1 } }, error: undefined });
});

describe('NewContractModal', () => {
  it('locks the client, lists plans, and POSTs /contracts with client_id + plan_id', async () => {
    const { onCreated } = renderModal();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();

    const planOpt = await screen.findByRole('option', { name: 'Gold 100Mbps' }) as HTMLOptionElement;
    fireEvent.change(planOpt.closest('select')!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Contract' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith(
      '/contracts',
      expect.objectContaining({ body: expect.objectContaining({ client_id: 9, plan_id: 3, connection_type: 'pppoe' }) }),
    ));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});
