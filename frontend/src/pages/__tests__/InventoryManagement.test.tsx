// =============================================================================
// FireISP 5.0 — InventoryManagement page tests (§14.2 — Inventory Phase 1)
// =============================================================================
// Regression coverage for two crash/silent-hide bugs fixed in this PR:
//   1. The Purchase Orders tab read item.total_amount (schema column is
//      `total`) — formatCurrency(undefined) threw a TypeError, crashing the
//      whole tab render for any org with a real PO.
//   2. The Assets tab read item.warranty_expires (schema column is
//      `warranty_expires_at`) — didn't crash, but silently always rendered
//      '—' instead of the real warranty date.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryManagement } from '../InventoryManagement';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const realPo = {
  id: 1, po_number: 'PO-2026-0001', vendor_id: 1, order_date: '2026-01-01',
  expected_date: '2026-01-15', total: '1160.00', status: 'received',
};
const realAsset = {
  id: 1, asset_tag: 'AST-001', serial_number: 'SN12345', name: 'MikroTik hAP',
  category: 'router', lifecycle_status: 'active', warranty_expires_at: '2027-06-01',
  assigned_to_client_id: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InventoryManagement />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/purchase-orders')
      return Promise.resolve({ data: { data: [realPo], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
    if (path === '/assets')
      return Promise.resolve({ data: { data: [realAsset], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }, error: undefined });
    return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 25 } }, error: undefined });
  });
});

describe('InventoryManagement page — Purchase Orders tab crash fix', () => {
  it('renders a real PO row with a formatted total instead of crashing', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Purchase Orders/ }));

    await waitFor(() => expect(screen.getByText('PO-2026-0001')).toBeInTheDocument());
    // Was undefined.toLocaleString() -> TypeError before the total_amount ->
    // total column-name fix; now renders the formatted DECIMAL string.
    expect(screen.getByText('1,160.00')).toBeInTheDocument();
  });
});

describe('InventoryManagement page — Assets tab warranty column fix', () => {
  it('renders the real warranty_expires_at date instead of always showing —', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));

    await waitFor(() => expect(screen.getByText('MikroTik hAP')).toBeInTheDocument());
    expect(screen.getByText('2027-06-01')).toBeInTheDocument();
  });
});
