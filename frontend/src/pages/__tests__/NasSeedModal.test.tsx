// =============================================================================
// FireISP 5.0 — SeedModal tests
// =============================================================================
// The Seed action moved from the NAS list to the NAS detail page; SeedModal is
// now a shared, exported component. These tests exercise it directly.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SeedModal, type Nas } from '../NasList';

const mockApiPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: (...args: unknown[]) => mockApiPost(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const nas: Nas = {
  id: 1, name: 'Core-Router', ip_address: '10.0.0.1', ipv6_address: null, type: 'mikrotik',
  ports: 16, coa_port: 3799, location: 'DC-A', secondary_nas_id: null, health_status: 'up',
  last_health_check_at: null, description: null, status: 'active',
};

function renderSeed(props: Partial<React.ComponentProps<typeof SeedModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeedModal nas={nas} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

const radiusInput = () => screen.getByRole('textbox', { name: /FireISP RADIUS Address/i });

describe('SeedModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens with an empty RADIUS address when no default is supplied', () => {
    renderSeed();
    expect(screen.getByRole('dialog', { name: /Seed NAS Core-Router/i })).toBeInTheDocument();
    expect(radiusInput()).toHaveValue('');
    expect(screen.getByText(/does not accept a hostname/i)).toBeInTheDocument();
  });

  it('prefills the RADIUS address with the hub tunnel IP when provided', () => {
    renderSeed({ defaultRadiusAddress: '10.255.0.1' });
    // Defaulting to the WG hub IP routes RADIUS over the tunnel (no public port needed).
    expect(radiusInput()).toHaveValue('10.255.0.1');
  });

  it('blocks submit when the RADIUS address is a hostname, before hitting the API', async () => {
    const user = userEvent.setup();
    renderSeed();
    await user.type(radiusInput(), 'radius.myisp.net');
    await user.click(screen.getByRole('button', { name: /Seed Device/i }));
    expect(screen.getByText(/must be an IP address, not a hostname/i)).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('submits a seed request and renders the per-step report', async () => {
    const user = userEvent.setup();
    mockApiPost.mockResolvedValue({
      data: { data: { ok: true, host: '10.0.0.1', port: 8728, tls: false, steps: [
        { step: 'radius-client', status: 'created', detail: 'RADIUS client → 10.255.0.1' },
        { step: 'ppp-aaa', status: 'updated', detail: 'use-radius=yes' },
      ] } },
      error: undefined,
    });
    renderSeed({ defaultRadiusAddress: '10.255.0.1' });
    await user.click(screen.getByRole('button', { name: /Seed Device/i }));

    await waitFor(() => expect(screen.getByText(/Seed completed/i)).toBeInTheDocument());
    expect(mockApiPost).toHaveBeenCalledWith(
      '/nas/{id}/seed',
      expect.objectContaining({ params: { path: { id: 1 } }, body: expect.objectContaining({ radiusAddress: '10.255.0.1' }) }),
    );
    expect(screen.getByText('radius-client')).toBeInTheDocument();
    expect(screen.getByText('ppp-aaa')).toBeInTheDocument();
  });

  it('surfaces a seed error returned by the API', async () => {
    const user = userEvent.setup();
    mockApiPost.mockResolvedValue({ error: { error: { message: 'RouterOS login failed: invalid user name or password (6)' } } });
    renderSeed({ defaultRadiusAddress: '203.0.113.10' });
    await user.click(screen.getByRole('button', { name: /Seed Device/i }));
    await waitFor(() => expect(screen.getByText(/RouterOS login failed/i)).toBeInTheDocument());
  });

  it('surfaces field-level 422 details instead of a bare message', async () => {
    const user = userEvent.setup();
    mockApiPost.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'Validation failed',
        details: [{ field: 'interimUpdate', message: 'interimUpdate must be at most 16 characters' }] } },
    });
    renderSeed({ defaultRadiusAddress: '203.0.113.10' });
    await user.click(screen.getByRole('button', { name: /Seed Device/i }));
    await waitFor(() => expect(screen.getByText(/interimUpdate must be at most 16 characters/i)).toBeInTheDocument());
  });

  it('reveals queue-tree fields only when the toggle is enabled', async () => {
    const user = userEvent.setup();
    renderSeed();
    expect(screen.queryByRole('spinbutton', { name: /Total download Mbps/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Seed queue tree/i }));
    expect(screen.getByRole('spinbutton', { name: /Total download Mbps/i })).toBeInTheDocument();
  });
});
