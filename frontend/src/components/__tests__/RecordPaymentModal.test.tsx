import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

import { api } from '@/api/client';
import { RecordPaymentModal } from '../RecordPaymentModal';

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onRecorded = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <RecordPaymentModal lockedClientId={5} lockedClientName="Acme Corp" onClose={onClose} onRecorded={onRecorded} />
    </QueryClientProvider>,
  );
  return { onClose, onRecorded };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] }, error: undefined });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { id: 99 } }) } as Response);
});

describe('RecordPaymentModal', () => {
  it('locks the client and POSTs /payments with the locked client_id', async () => {
    const { onRecorded } = renderModal();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } }); // amount
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).endsWith('/api/v1/payments'));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.client_id).toBe(5);
    expect(body.amount).toBe(100);
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  });
});
