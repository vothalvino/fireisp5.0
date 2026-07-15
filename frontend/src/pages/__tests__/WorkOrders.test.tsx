// =============================================================================
// FireISP 5.0 — WorkOrders page tests (§12 / Inventory Phase 3, migration 391)
// =============================================================================
// Focused on the pickup-checklist disposition UI: a work_type='pickup' order
// shows the outstanding rented-equipment checklist instead of the materials
// panel when expanded, and resolving a unit posts the disposition endpoint.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkOrders } from '../WorkOrders';

const mockApiGet = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a) },
  authedFetch: (...a: unknown[]) => mockAuthedFetch(...a),
}));

const pickupOrder = {
  id: 700, ticket_id: null, assigned_to: null, status: 'in_progress', priority: 'medium',
  title: 'Equipment pickup', description: null, scheduled_at: null, completed_at: null,
  organization_id: 42, created_at: '2026-01-01',
  client_id: 100, site_id: null, device_id: null, contract_id: 900, service_order_id: null,
  work_type: 'pickup', client_name: 'Acme Corp', site_name: null, device_name: null,
  assigned_first: null, assigned_last: null,
};

const pickupUnit = { id: 50, serial_number: 'SN-RENT-1', item_name: 'ONU-X', sku: 'ONU-X-1', lifecycle_state: 'assigned' };

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkOrders />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/work-orders') {
      return Promise.resolve({
        data: { data: [pickupOrder], meta: { total: 1, page: 1, limit: 25 } },
        error: undefined,
      });
    }
    if (path === '/work-orders/assignable-users') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/sites' || path === '/devices') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/work-orders/{id}/pickup-items') {
      return Promise.resolve({
        data: { data: [pickupUnit], meta: { work_order_id: 700, contract_id: 900, status: 'in_progress' } },
        error: undefined,
      });
    }
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockAuthedFetch.mockResolvedValue(jsonResponse({ data: {} }));
});

describe('WorkOrders — pickup checklist', () => {
  it('labels a pickup order with the Pickup work type and hides the generic Complete button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    // in_progress pickup orders can still be Cancelled, but never blindly Completed.
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('expanding the row shows the outstanding rented-equipment checklist, not materials', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));

    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());
    expect(screen.getByText('ONU-X')).toBeInTheDocument();
    expect(screen.queryByText('Add Material')).not.toBeInTheDocument();
  });

  it('resolving a unit as returned posts the disposition endpoint', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Returned to Stock'));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/700/pickup-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cpe_device_id: 50, disposition: 'returned' }),
      }),
    ));
  });

  it('resolving a unit as damaged posts an rma disposition', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());

    const row = screen.getByText('SN-RENT-1').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByText('Damaged / RMA'));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/700/pickup-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cpe_device_id: 50, disposition: 'rma' }),
      }),
    ));
  });

  it('shows "no outstanding equipment" once the checklist is empty', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [pickupOrder], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      if (path === '/work-orders/{id}/pickup-items') {
        return Promise.resolve({ data: { data: [], meta: { work_order_id: 700, contract_id: 900, status: 'completed' } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('No outstanding equipment.')).toBeInTheDocument());
  });
});
