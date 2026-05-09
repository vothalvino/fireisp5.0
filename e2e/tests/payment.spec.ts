/**
 * FireISP 5.0 — Record Payment E2E test
 *
 * Scenario: log in (API + browser) → create client (API) →
 *           navigate to /payments → open "Record Payment" modal →
 *           fill every field → submit → verify the payment appears in
 *           the table (UI) → verify the record exists in the database (API).
 *
 * The test uses a unique reference string so it can unambiguously locate
 * the newly-created row even when many other payments are present.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_EMAIL    = 'admin@demo-isp.com';
const ADMIN_PASSWORD = 'admin123!';
const API            = '/api/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SavedPayment {
  reference: string | null;
  amount: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers (same pattern as smoke.spec.ts)
// ---------------------------------------------------------------------------

async function apiLogin(
  request: APIRequestContext,
): Promise<{ token: string; csrfToken: string }> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `API login failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  const token = (body.data?.accessToken ?? body.accessToken) as string;

  const state     = await request.storageState();
  const csrfCookie = state.cookies.find((c) => c.name === 'fireisp_csrf');
  const csrfToken  = csrfCookie?.value ?? '';

  return { token, csrfToken };
}

async function apiCreateClient(
  request: APIRequestContext,
  token: string,
  csrfToken: string,
  suffix: string,
): Promise<{ id: number; name: string }> {
  const name = `PayTest ${suffix}`;
  const res  = await request.post(`${API}/clients`, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'X-CSRF-Token': csrfToken,
    },
    data: {
      name,
      email:       `paytest.${suffix}@e2e.test`,
      client_type: 'residential',
      status:      'active',
      country:     'US',
    },
  });
  expect(res.ok(), `Create client failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return { id: (body.data?.id ?? body.id) as number, name };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('record payment and verify it saves', async ({ page, request }) => {
  // A unique suffix used for the reference folio and the test client name.
  const suffix    = Date.now().toString(36).toUpperCase();
  const reference = `E2E-PAY-${suffix}`;
  const amount    = '75.50';
  // Use UTC date (ISO slice) — the payment_date column stores YYYY-MM-DD and
  // the date input accepts the same format, so UTC is intentional here.
  const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  // -------------------------------------------------------------------------
  // 0 — Pre-dismiss the DR Drill banner so it never blocks interactions.
  //     (Same technique used in smoke.spec.ts — see stored memory.)
  // -------------------------------------------------------------------------
  await page.addInitScript(() => {
    try { sessionStorage.setItem('drDrillBannerDismissed', '1'); } catch { /* ignore */ }
  });

  // -------------------------------------------------------------------------
  // 1 — Create a disposable client via the REST API.
  // -------------------------------------------------------------------------
  const { token, csrfToken } = await apiLogin(request);
  const { name: clientName } = await apiCreateClient(request, token, csrfToken, suffix);

  // -------------------------------------------------------------------------
  // 2 — Log in via the browser UI.
  // -------------------------------------------------------------------------
  await page.goto('/login');
  await page.fill('input[type="email"]',    ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);

  // -------------------------------------------------------------------------
  // 3 — Navigate to /payments and open the Record Payment modal.
  // -------------------------------------------------------------------------
  await page.goto('/payments');
  await expect(page.getByText(/💳 Payments/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /record payment/i }).click();

  const dialog = page.getByRole('dialog', { name: /record payment/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // -------------------------------------------------------------------------
  // 4 — Fill in the form.
  // -------------------------------------------------------------------------

  // Client (first <select>)
  const clientSelect = dialog.locator('select').first();
  await expect(clientSelect).toBeVisible({ timeout: 10_000 });
  await clientSelect.selectOption({ label: clientName });

  // Amount (first number input)
  await dialog.locator('input[type="number"]').first().fill(amount);

  // Currency (text input next to amount — set explicitly to USD)
  await dialog.locator('input[type="text"]').first().fill('USD');

  // Payment Method (second <select>)
  const methodSelect = dialog.locator('select').nth(1);
  await methodSelect.selectOption('cash');

  // Status (third <select> — default is "completed", leave as-is)
  // Payment Date (date input)
  await dialog.locator('input[type="date"]').fill(today);

  // Reference / Folio (last text input)
  await dialog.locator('input[type="text"]').last().fill(reference);

  // -------------------------------------------------------------------------
  // 5 — Submit the form.
  // -------------------------------------------------------------------------
  await dialog.getByRole('button', { name: /^record payment$/i }).click();

  // Modal must close to confirm the request succeeded.
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // 6 — Verify the payment appears in the UI table.
  //
  // The Reference column renders payment.reference directly, so our unique
  // folio string is a reliable selector even amid many other rows.
  // -------------------------------------------------------------------------
  await expect(page.getByText(reference)).toBeVisible({ timeout: 15_000 });

  // Also confirm the formatted amount is visible in the same area.
  // fmtAmount uses MXN locale by default; tolerate any currency formatting
  // by just checking the digits.
  await expect(page.getByText(/75[.,]50/)).toBeVisible({ timeout: 10_000 });

  // -------------------------------------------------------------------------
  // 7 — Verify the payment is persisted in the database via the API.
  //
  // GET /api/v1/payments does not currently support filtering by reference,
  // so we fetch page 1 (most-recent-first) and look for our row.
  // A fresh test environment will have few payments, so page 1 is sufficient.
  // -------------------------------------------------------------------------
  const listRes = await request.get(`${API}/payments?page=1&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listRes.ok(), `Fetch payments failed: ${await listRes.text()}`).toBeTruthy();
  const listBody = await listRes.json() as {
    data: { data: SavedPayment[] } | SavedPayment[];
  };

  // Normalise paginated vs flat response shape.
  const payments: SavedPayment[] =
    Array.isArray(listBody.data)
      ? listBody.data
      : (listBody.data as { data: SavedPayment[] }).data;

  const saved = payments.find((p) => p.reference === reference);
  if (!saved) {
    throw new Error(`Payment with reference ${reference} not found in API response`);
  }
  expect(parseFloat(saved.amount)).toBeCloseTo(parseFloat(amount), 2);
  expect(saved.status).toBe('completed');
});
