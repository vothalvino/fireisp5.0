// =============================================================================
// FireISP 5.0 — UndoInstallButton tests (Inventory follow-up, migration 392)
// =============================================================================
// Shared confirm-with-notes action for reversing a mistaken install, used by
// ServiceOrderList.tsx's Equipment modal and ClientDetail.tsx's Assigned
// Equipment section.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  api: { POST: vi.fn() },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

import { api } from '@/api/client';
import { UndoInstallButton } from '../UndoInstallButton';

function renderButton(props: Partial<React.ComponentProps<typeof UndoInstallButton>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <UndoInstallButton
        deviceId={50}
        serialNumber="SN-1"
        itemName="MikroTik hAP ac3"
        lifecycleState="assigned"
        onDone={onDone}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UndoInstallButton', () => {
  it('renders nothing for a unit that is not assigned/active', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <UndoInstallButton deviceId={1} serialNumber="SN-1" lifecycleState="in_stock" onDone={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('confirm posts to the uninstall endpoint and calls onDone on success', async () => {
    (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { id: 50, lifecycle_state: 'in_stock' }, warnings: [] },
      error: undefined,
    });
    const { onDone } = renderButton();

    fireEvent.click(screen.getByText('Undo install'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Confirmation shows the item name + serial.
    expect(screen.getByText(/MikroTik hAP ac3/)).toBeInTheDocument();
    expect(screen.getByText(/SN-1/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'wrong model installed' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo install' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledWith(
      '/cpe-management/devices/{id}/uninstall',
      expect.objectContaining({
        params: { path: { id: 50 } },
        body: { notes: 'wrong model installed' },
      }),
    ));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Modal closes automatically when there are no warnings to show.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces the backend error message verbatim on failure', async () => {
    (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: undefined,
      error: { error: { message: 'The equipment sale invoice has a payment applied — resolve the payment (credit note or refund) before undoing this install.' } },
    });
    renderButton();

    fireEvent.click(screen.getByText('Undo install'));
    await screen.findByRole('dialog');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo install' }));

    expect(await screen.findByText(/resolve the payment/)).toBeInTheDocument();
    // The dialog stays open on failure so the user can see the error.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the modal open showing a warning instead of auto-closing', async () => {
    (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: { id: 50, lifecycle_state: 'in_stock' },
        warnings: ['This unit was installed before sale-invoice tracking existed — if a sale invoice was issued for it, void it manually.'],
      },
      error: undefined,
    });
    const { onDone } = renderButton();

    fireEvent.click(screen.getByText('Undo install'));
    await screen.findByRole('dialog');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo install' }));

    expect(await screen.findByText(/void it manually/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    // Still open — the warning needs to be seen, not silently dismissed.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancel closes the dialog without posting', async () => {
    renderButton();
    fireEvent.click(screen.getByText('Undo install'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });
});
