// =============================================================================
// FireISP 5.0 — Forgot Password page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPassword } from '../ForgotPassword';

function mockFetchOnce(resp: { ok: boolean; status?: number; json?: object }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: resp.ok,
    status: resp.status ?? (resp.ok ? 200 : 422),
    json: () => Promise.resolve(resp.json ?? {}),
  } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPassword />
    </MemoryRouter>
  );
}

describe('ForgotPassword page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the form', () => {
    renderPage();
    expect(screen.getByText('Forgot Password')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('submits the email and shows the generic success message', async () => {
    const fetchSpy = mockFetchOnce({ ok: true, json: { message: 'If that email exists, a reset link has been sent' } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/if that email exists/i)).toBeInTheDocument());

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/auth/password-reset/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@test.com' }),
      })
    );
  });

  it('shows the SAME generic success message even for an unknown email (anti-enumeration)', async () => {
    mockFetchOnce({ ok: true, json: { message: 'If that email exists, a reset link has been sent' } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'nobody@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/if that email exists/i)).toBeInTheDocument());
  });

  it('shows an error message when the request fails', async () => {
    // A syntactically valid address (jsdom's <input type="email" required>
    // blocks form submission client-side on a malformed one before onSubmit
    // ever fires) whose rejection comes from the server response instead.
    mockFetchOnce({ ok: false, status: 422, json: { error: { message: 'Invalid email' } } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'rejected@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText('Invalid email')).toBeInTheDocument());
  });
});
