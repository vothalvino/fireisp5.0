// =============================================================================
// FireISP 5.0 — RecordPaymentModal tests
// =============================================================================
// Covers the payment waterfall UX (PR brief "payment waterfall"):
//   - a locked client's open invoices load into a checklist, all checked,
//     amount auto-filled to the sum of their balance_due
//   - unchecking an invoice recomputes the amount
//   - editing the amount directly is preserved (doesn't uncheck anything)
//   - submit creates the payment then a single allocate-auto call with the
//     checked invoice_ids
//   - the InvoiceDetail entry point (lockedInvoiceId) pre-checks just that
//     invoice; other open invoices stay listed, unchecked
//   - zero pending invoices: no checklist, no allocate-auto call
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  authedFetch: vi.fn(),
  tokenStore: {
    getAccess: () => 'test-token', setAccess: vi.fn(),
    getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn(),
  },
}));

import { api, authedFetch } from '@/api/client';
import { RecordPaymentModal, type RecordPaymentModalProps } from '../RecordPaymentModal';

const OPEN_INVOICES = [
  { id: 10, invoice_number: 'INV-10', issue_date: '2024-01-01', total: '100.00', currency: 'MXN', status: 'issued', balance_due: '40.00' },
  { id: 11, invoice_number: 'INV-11', issue_date: '2024-02-01', total: '200.00', currency: 'MXN', status: 'overdue', balance_due: '200.00' },
];

function setupApi(invoices: typeof OPEN_INVOICES = OPEN_INVOICES) {
  (api.GET as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/clients/{id}/open-invoices') return Promise.resolve({ data: { data: invoices }, error: undefined });
    if (path === '/clients') return Promise.resolve({ data: { data: [{ id: 5, name: 'Acme Corp' }] }, error: undefined });
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.endsWith('/api/v1/payments')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 99 } }) });
    }
    if (url.includes('/allocate-auto')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            allocations: [
              { id: 1, invoice_id: 10, invoice_number: 'INV-10', amount: 40, fully_paid: true },
              { id: 2, invoice_id: 11, invoice_number: 'INV-11', amount: 200, fully_paid: true },
            ],
            remaining_credit: 0,
          },
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });
}

function renderModal(props: Partial<RecordPaymentModalProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onRecorded = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <RecordPaymentModal
        lockedClientId={5}
        lockedClientName="Acme Corp"
        onClose={onClose}
        onRecorded={onRecorded}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose, onRecorded };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApi();
});

describe('RecordPaymentModal', () => {
  it('loads the open invoices for a locked client, all checked, amount = sum of balances', async () => {
    renderModal();
    expect(await screen.findByText('INV-10')).toBeInTheDocument();
    expect(screen.getByText('INV-11')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'INV-10' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'INV-11' })).toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(240); // 40 + 200
  });

  it('unchecking an invoice recomputes the amount', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('INV-11');
    await user.click(screen.getByRole('checkbox', { name: 'INV-11' }));
    expect(screen.getByRole('checkbox', { name: 'INV-11' })).not.toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(40);
  });

  it('editing the amount directly is preserved and does not uncheck anything', async () => {
    renderModal();
    await screen.findByText('INV-10');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '999' } });
    expect(screen.getByRole('spinbutton')).toHaveValue(999);
    expect(screen.getByRole('checkbox', { name: 'INV-10' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'INV-11' })).toBeChecked();
    // Excess above the checked total is hinted as staying as client credit.
    expect(screen.getByText(/stays as client credit/i)).toBeInTheDocument();
  });

  it('submit creates the payment then makes ONE allocate-auto call with the checked invoice_ids', async () => {
    const user = userEvent.setup();
    const { onRecorded } = renderModal();
    await screen.findByText('INV-10');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => expect(authedFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/payments'),
      expect.objectContaining({ method: 'POST' }),
    ));
    const createCall = (authedFetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).endsWith('/api/v1/payments'));
    expect(createCall).toBeDefined();
    const createBody = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(createBody.client_id).toBe(5);
    expect(createBody.amount).toBe(240);

    const allocCall = (authedFetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes('/allocate-auto'));
    expect(allocCall).toBeDefined();
    expect(String(allocCall![0])).toBe('/api/v1/payments/99/allocate-auto');
    const allocBody = JSON.parse((allocCall![1] as RequestInit).body as string);
    expect(allocBody.invoice_ids.sort()).toEqual([10, 11]);

    // Success panel, then Done finishes the flow.
    expect(await screen.findByText('Payment Recorded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRecorded).toHaveBeenCalled();
  });

  it('lockedInvoiceId pre-checks only that invoice; the other stays listed, unchecked', async () => {
    renderModal({ lockedInvoiceId: 11 });
    await screen.findByText('INV-10');
    expect(screen.getByRole('checkbox', { name: 'INV-10' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'INV-11' })).toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(200);
  });

  it('zero pending invoices: no checklist, amount stays manual, no allocate-auto call', async () => {
    setupApi([]);
    const user = userEvent.setup();
    renderModal();
    expect(await screen.findByText(/no open invoices/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(null);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => expect(authedFetch).toHaveBeenCalled());
    const allocCall = (authedFetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes('/allocate-auto'));
    expect(allocCall).toBeUndefined();
    expect(await screen.findByText(/unallocated credit/i)).toBeInTheDocument();
  });

  // Regression: once the payment row exists (create succeeded, allocate
  // failed), its amount/details are persisted — the form must LOCK those
  // fields so a retry can't silently diverge from the saved payment, and the
  // retry must not create a second payment.
  it('locks the money fields after a failed allocation and retries without re-creating the payment', async () => {
    setupApi();
    let allocAttempts = 0;
    (authedFetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.endsWith('/api/v1/payments')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: 99 } }) });
      }
      if (url.includes('/allocate-auto')) {
        allocAttempts += 1;
        if (allocAttempts === 1) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { message: 'allocation failed' } }) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { allocations: [{ id: 1, invoice_id: 10, invoice_number: 'INV-10', amount: 40, fully_paid: true }], remaining_credit: 0 } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    renderModal();
    await screen.findByText('INV-10');
    fireEvent.click(screen.getByRole('button', { name: /Record Payment/i }));

    // First attempt: create ok, allocate fails — modal stays on the form,
    // money fields locked, submit relabeled to the retry action.
    await screen.findByText('allocation failed');
    const amountInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(amountInput).toBeDisabled();
    expect(await screen.findByText(/already recorded/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /Retry Applying Payment/i });

    fireEvent.click(retryBtn);
    await screen.findByText(/INV-10/); // success panel line

    const createCalls = (authedFetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).endsWith('/api/v1/payments'));
    expect(createCalls).toHaveLength(1); // payment created exactly once
    expect(allocAttempts).toBe(2);       // allocation retried
  });
});
