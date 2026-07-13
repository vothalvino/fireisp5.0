// =============================================================================
// FireISP 5.0 — Verify Email page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VerifyEmail } from '../VerifyEmail';

function mockFetchOnce(resp: { ok: boolean; status?: number; json?: object }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: resp.ok,
    status: resp.status ?? (resp.ok ? 200 : 401),
    json: () => Promise.resolve(resp.json ?? {}),
  } as Response);
}

function renderPage(path = '/verify-email?token=valid-token-hex') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmail />
    </MemoryRouter>
  );
}

describe('VerifyEmail page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a missing-token message immediately when no token is present, without calling the API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage('/verify-email');

    expect(screen.getByText(/no verification token was provided/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('auto-calls verify-email on mount and shows success', async () => {
    const fetchSpy = mockFetchOnce({ ok: true, json: { message: 'Email verified successfully' } });
    renderPage();

    expect(screen.getByText(/verifying your email/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/your email has been verified/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/auth/verify-email',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'valid-token-hex' }),
      })
    );
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });

  it('shows an invalid/expired message on failure, with a link back to login', async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { message: 'Invalid verification token' } } });
    renderPage();

    await waitFor(() => expect(screen.getByText(/this link is invalid or has expired/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });
});
