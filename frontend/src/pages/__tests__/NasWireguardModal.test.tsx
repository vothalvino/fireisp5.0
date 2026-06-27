// =============================================================================
// FireISP 5.0 — NasWireguardModal tests
// =============================================================================
// Covers the discover → select → manual-add → confirm+bootstrap flow, and in
// particular the regression where the modal read `subnets` instead of the
// backend's `proposed` field (so the list was always empty).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NasWireguardModal, isValidCidr } from '../NasWireguardModal';

const mockPost = vi.fn();
const mockPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: vi.fn(),
    POST: (...args: unknown[]) => mockPost(...args),
    PUT: (...args: unknown[]) => mockPut(...args),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NasWireguardModal nas={{ id: 3, name: 'RouterOS Demo' }} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('isValidCidr', () => {
  it('accepts valid IPv4 CIDRs', () => {
    expect(isValidCidr('10.199.0.0/24')).toBe(true);
    expect(isValidCidr('192.168.1.0/24')).toBe(true);
    expect(isValidCidr('0.0.0.0/0')).toBe(true);
  });
  it('rejects malformed or out-of-range CIDRs', () => {
    expect(isValidCidr('not-a-cidr')).toBe(false);
    expect(isValidCidr('10.0.0.0')).toBe(false);          // no mask
    expect(isValidCidr('10.0.0.0/33')).toBe(false);       // mask too big
    expect(isValidCidr('999.0.0.1/24')).toBe(false);      // octet > 255
  });
});

describe('NasWireguardModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockImplementation((path: string) => {
      if (path === '/nas/{id}/wg/discover') {
        return Promise.resolve({
          data: { data: { proposed: ['10.199.0.0/24'], topology: { addresses: [{ address: '10.199.0.1/24', interface: 'bridge-lan-test' }] } } },
          error: undefined,
        });
      }
      if (path === '/nas/{id}/wg/bootstrap') {
        return Promise.resolve({
          data: { data: { ok: true, method: 'api', state: 'active', steps: [{ step: 'wg-interface', status: 'created', detail: 'ok' }] } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: {} }, error: undefined });
    });
    mockPut.mockResolvedValue({ data: { data: {} }, error: undefined });
  });

  it('renders the intro and a Discover button', () => {
    renderModal();
    expect(screen.getByText('Discover Subnets')).toBeInTheDocument();
  });

  it('shows the proposed subnet (reads `proposed`, not `subnets`) and router address reference', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Discover Subnets' }));
    await waitFor(() => expect(screen.getByText('10.199.0.0/24')).toBeInTheDocument());
    // device interface address shown for reference
    expect(screen.getByText(/bridge-lan-test/)).toBeInTheDocument();
  });

  it('rejects an invalid manual CIDR and accepts a valid one', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Discover Subnets' }));
    await screen.findByText('10.199.0.0/24');

    const input = screen.getByPlaceholderText(/e\.g\. 10\.199\.0\.0\/24/i);
    await user.type(input, 'nonsense');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/valid IPv4 CIDR/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '172.16.5.0/24');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('172.16.5.0/24')).toBeInTheDocument());
  });

  it('PUTs the selected + manual subnets then bootstraps', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Discover Subnets' }));
    await screen.findByText('10.199.0.0/24');

    const input = screen.getByPlaceholderText(/e\.g\./i);
    await user.type(input, '172.16.5.0/24');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('172.16.5.0/24');

    await user.click(screen.getByRole('button', { name: 'Confirm & Bootstrap' }));

    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    const putBody = (mockPut.mock.calls[0][1] as { body: { subnets: string[] } }).body;
    expect(putBody.subnets).toEqual(expect.arrayContaining(['10.199.0.0/24', '172.16.5.0/24']));

    await waitFor(() => expect(screen.getByText(/configured on the router via API/i)).toBeInTheDocument());
  });
});
