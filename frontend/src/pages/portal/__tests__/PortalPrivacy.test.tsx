// =============================================================================
// FireISP 5.0 — Portal Privacy Notice page tests (LFPDPPP, j25)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalPrivacy } from '../PortalPrivacy';

vi.mock('@/auth/PortalAuthContext', () => ({
  portalTokenStore: { getAccess: () => 'portal-token' },
}));

type NoticeState = { accepted: boolean; accepted_at: string | null };

function mockApi(state: NoticeState) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
    if (String(url).endsWith('/privacy-notice/accept') && opts?.method === 'POST') {
      state.accepted = true;
      state.accepted_at = '2026-07-27T12:00:00.000Z';
      return {
        ok: true, status: 201,
        json: async () => ({ data: { accepted: true, accepted_at: state.accepted_at } }),
      } as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        data: {
          version: 'default-1',
          content: '# Aviso de Privacidad\n\nTexto del aviso.',
          accepted: state.accepted,
          accepted_at: state.accepted_at,
        },
      }),
    } as Response;
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/portal/privacy']}>
      <QueryClientProvider client={qc}>
        <PortalPrivacy />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('PortalPrivacy page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the notice text and an accept button when not yet accepted', async () => {
    mockApi({ accepted: false, accepted_at: null });
    renderPage();
    // MarkdownView is lazy — wait for the heading to arrive.
    await waitFor(() => expect(screen.getByText('Aviso de Privacidad')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /accept the privacy notice/i })).toBeInTheDocument();
  });

  it('accepting POSTs to the portal endpoint and swaps to the accepted state', async () => {
    const state: NoticeState = { accepted: false, accepted_at: null };
    const fetchSpy = mockApi(state);
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(screen.getByText(/you accepted this privacy notice/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/portal/privacy-notice/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('shows no accept button when the current version is already accepted', async () => {
    mockApi({ accepted: true, accepted_at: '2026-07-01T00:00:00.000Z' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/you accepted this privacy notice/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });
});
