// =============================================================================
// FireISP 5.0 — Reset Password page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResetPassword } from '../ResetPassword';

function mockFetchOnce(resp: { ok: boolean; status?: number; json?: object }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: resp.ok,
    status: resp.status ?? (resp.ok ? 200 : 422),
    json: () => Promise.resolve(resp.json ?? {}),
  } as Response);
}

function renderPage(path = '/reset-password?token=valid-token-hex') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ResetPassword />
    </MemoryRouter>
  );
}

describe('ResetPassword page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a missing-token message and a link back to forgot-password when no token is present', () => {
    renderPage('/reset-password');
    expect(screen.getByText(/no reset token was provided/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('renders the form when a token is present', () => {
    renderPage();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('rejects mismatched passwords client-side without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('submits the new password and shows a success message + login link', async () => {
    const fetchSpy = mockFetchOnce({ ok: true, json: { message: 'Password reset successfully' } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText(/your password has been reset/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/auth/password-reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'valid-token-hex', password: 'newpassword123' }),
      })
    );
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });

  it('shows a clear invalid/expired message with a recovery link on a 401', async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { message: 'Invalid or expired reset token' } } });
    renderPage();

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText(/this link is invalid or has expired/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });
});
