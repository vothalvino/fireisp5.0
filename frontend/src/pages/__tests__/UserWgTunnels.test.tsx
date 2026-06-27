// =============================================================================
// FireISP 5.0 — UserWgTunnels page tests
// =============================================================================
// Covers the self-service WireGuard tunnel page, in particular:
//   - AddPeerModal: full_tunnel checkbox renders checked by default
//   - AddPeerModal: unchecking the checkbox POSTs full_tunnel=false
//   - AddPeerModal: leaving the checkbox checked POSTs full_tunnel=true
// Uses msw/vitest global fetch mock via vi.stubGlobal('fetch', ...) so no
// real HTTP requests are made.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserWgTunnels } from '../UserWgTunnels';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// tokenStore mock — returns a stable bearer token so authHeaders() fires
vi.mock('@/api/client', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  tokenStore: {
    getAccess:  () => 'test-access-token',
    setAccess:  vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear:      vi.fn(),
  },
}));

// react-i18next: return the key as the translation (avoids loading locale files)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn(), language: 'en' },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_PEERS_RESPONSE = { data: [] };

const CREATED_PEER_RESPONSE = {
  data: {
    id: 42,
    name: 'Laptop',
    tunnel_address: '10.99.0.42',
    allowed_ips_snapshot: [],
    last_handshake_at: null,
    server_peer_synced: 0,
    revoked_at: null,
    created_at: new Date().toISOString(),
  },
  config: '[Interface]\nPrivateKey = K\n',
  config_base64: btoa('[Interface]\nPrivateKey = K\n'),
  qr_svg: '<svg><rect/></svg>',
};

function makeFetchMock(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    // GET /api/v1/wg-peers → empty peer list
    if (method === 'GET' && String(url).includes('/wg-peers')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overrides.peers ?? EMPTY_PEERS_RESPONSE),
        text: () => Promise.resolve(''),
        status: 200,
      });
    }

    // POST /api/v1/wg-peers → created peer
    if (method === 'POST' && String(url).includes('/wg-peers')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...CREATED_PEER_RESPONSE, _requestBody: body }),
        text: () => Promise.resolve(''),
        status: 201,
      });
    }

    // Default fallback
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      status: 404,
    });
  });
}

function renderPage(fetchMock = makeFetchMock()) {
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UserWgTunnels />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// =============================================================================
// AddPeerModal — full_tunnel checkbox
// =============================================================================

describe('AddPeerModal — full_tunnel checkbox', () => {
  it('Add Peer button opens the modal', async () => {
    const user = userEvent.setup();
    renderPage();

    // Wait for the list to load (empty state)
    await waitFor(() => expect(screen.queryByText('wgTunnels.loading')).not.toBeInTheDocument());

    const addButton = screen.getByRole('button', { name: /wgTunnels\.addPeer/i });
    await user.click(addButton);

    expect(screen.getByRole('heading', { name: 'wgTunnels.addPeer' })).toBeInTheDocument();
  });

  it('renders the full_tunnel checkbox checked by default', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.queryByText('wgTunnels.loading')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wgTunnels\.addPeer/i }));

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
  });

  it('checkbox is labelled with wgTunnels.fullTunnelLabel', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.queryByText('wgTunnels.loading')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wgTunnels\.addPeer/i }));

    // The label text is the i18n key (our t() mock returns the key)
    expect(screen.getByText('wgTunnels.fullTunnelLabel')).toBeInTheDocument();
  });

  it('POSTs full_tunnel=true when checkbox remains checked', async () => {
    const fetchMock = makeFetchMock();
    const user = userEvent.setup();
    renderPage(fetchMock);

    await waitFor(() => expect(screen.queryByText('wgTunnels.loading')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wgTunnels\.addPeer/i }));

    // Type a peer name
    await user.type(screen.getByPlaceholderText('wgTunnels.peerNamePlaceholder'), 'Laptop');

    // Do NOT uncheck the checkbox — it defaults to true
    await user.click(screen.getByRole('button', { name: 'wgTunnels.createPeer' }));

    await waitFor(() => {
      const postCall = (fetchMock.mock.calls as unknown[][]).find(
        (args) => {
          const [url, init] = args as [string, RequestInit | undefined];
          return (init?.method ?? 'GET').toUpperCase() === 'POST' && String(url).includes('/wg-peers');
        },
      );
      expect(postCall).toBeDefined();
      const [, callInit] = postCall as [string, RequestInit];
      const body = JSON.parse(callInit.body as string) as Record<string, unknown>;
      expect(body.full_tunnel).toBe(true);
      expect(body.name).toBe('Laptop');
    });
  });

  it('POSTs full_tunnel=false when user unchecks the checkbox', async () => {
    const fetchMock = makeFetchMock();
    const user = userEvent.setup();
    renderPage(fetchMock);

    await waitFor(() => expect(screen.queryByText('wgTunnels.loading')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wgTunnels\.addPeer/i }));

    await user.type(screen.getByPlaceholderText('wgTunnels.peerNamePlaceholder'), 'Phone');

    // Uncheck the full_tunnel checkbox
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    await user.click(screen.getByRole('button', { name: 'wgTunnels.createPeer' }));

    await waitFor(() => {
      const postCall = (fetchMock.mock.calls as unknown[][]).find(
        (args) => {
          const [url, init] = args as [string, RequestInit | undefined];
          return (init?.method ?? 'GET').toUpperCase() === 'POST' && String(url).includes('/wg-peers');
        },
      );
      expect(postCall).toBeDefined();
      const [, callInit] = postCall as [string, RequestInit];
      const body = JSON.parse(callInit.body as string) as Record<string, unknown>;
      expect(body.full_tunnel).toBe(false);
      expect(body.name).toBe('Phone');
    });
  });
});
