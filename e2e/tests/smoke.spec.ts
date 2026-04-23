/**
 * FireISP 5.0 — End-to-End Smoke Test
 *
 * Scenario: log in → create client (API) → assign plan (UI) →
 *           generate invoice (UI) → record payment (UI) → open ticket (UI) → log out
 *
 * The test relies on the development seed data
 * (admin@demo-isp.com / admin123!, plans 1–4, sites 1–2) being present.
 * "Create client" is done via the REST API because the ClientList page is
 * intentionally read-only; all subsequent write operations use the browser UI.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@demo-isp.com';
const ADMIN_PASSWORD = 'admin123!';
const API = '/api/v1';

/** Log in via the REST API and return an access token. */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `API login failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (body.data?.accessToken ?? body.accessToken) as string;
}

/** Create a throwaway client and return its id. */
async function apiCreateClient(
  request: APIRequestContext,
  token: string,
  suffix: string,
): Promise<number> {
  const res = await request.post(`${API}/clients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `Smoke ${suffix}`,
      email: `smoke.${suffix}@e2e.test`,
      client_type: 'residential',
      status: 'active',
      country: 'US',
    },
  });
  expect(res.ok(), `Create client failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (body.data?.id ?? body.id) as number;
}

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

test('full operator workflow smoke test', async ({ page, request }) => {
  // A unique suffix to identify this test run's data in table rows.
  const suffix = Date.now().toString(36).toUpperCase();

  // -------------------------------------------------------------------------
  // Step 0 — Create a test client via API (no UI form on ClientList)
  // -------------------------------------------------------------------------
  const token = await apiLogin(request);
  const clientId = await apiCreateClient(request, token, suffix);

  // We need the client name in the UI selects later.
  const clientName = `Smoke ${suffix}`;

  // -------------------------------------------------------------------------
  // Step 1 — Log in via the browser UI
  // -------------------------------------------------------------------------
  await page.goto('/login');
  await expect(page).toHaveTitle(/FireISP/i);

  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // After login we should land on the Dashboard
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('h1, [class*="title"]').first()).toBeVisible();

  // -------------------------------------------------------------------------
  // Step 2 — Dashboard loads
  // -------------------------------------------------------------------------
  await page.goto('/');
  await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 3 — Navigate to Clients; verify seeded + new client are present
  // -------------------------------------------------------------------------
  await page.goto('/clients');
  await expect(page.getByText('John Doe')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(clientName)).toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 4 — Contracts → New Contract (assign plan to our test client)
  // -------------------------------------------------------------------------
  await page.goto('/contracts');

  // Open the modal
  await page.getByRole('button', { name: /new contract/i }).click();

  // Wait for the client dropdown to be populated
  const clientSelect = page.getByRole('dialog').locator('select').first();
  await expect(clientSelect).toBeVisible({ timeout: 10_000 });
  await clientSelect.selectOption({ label: clientName });

  // Select the first plan
  const planSelect = page.getByRole('dialog').locator('select').nth(1);
  await planSelect.selectOption({ index: 1 }); // first real option after the placeholder

  // Start date is pre-filled with today — leave it as-is
  // Submit
  await page.getByRole('dialog').getByRole('button', { name: /create|save|submit/i }).click();

  // Modal should close and the contracts table should refresh
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 5 — Invoices → Generate Invoice for our test client
  // -------------------------------------------------------------------------
  await page.goto('/invoices');

  await page.getByRole('button', { name: /generate invoice/i }).click();

  // Select client
  const invClientSelect = page.locator('div[style*="position: fixed"] select, [role="dialog"] select').first();
  await expect(invClientSelect).toBeVisible({ timeout: 10_000 });
  await invClientSelect.selectOption({ label: clientName });

  // Select the contract we just created (first option after placeholder)
  const invContractSelect = page
    .locator('div[style*="position: fixed"] select, [role="dialog"] select')
    .nth(1);
  await invContractSelect.selectOption({ index: 1 });

  await page.getByRole('button', { name: /^generate$/i }).click();

  // Modal closes; invoice list refreshes
  await expect(
    page.locator('div[style*="position: fixed"], [role="dialog"]'),
  ).not.toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 6 — Payments → Record Payment for our test client
  // -------------------------------------------------------------------------
  await page.goto('/payments');

  await page.getByRole('button', { name: /record payment/i }).click();

  const payClientSelect = page
    .locator('div[style*="position: fixed"] select, [role="dialog"] select')
    .first();
  await expect(payClientSelect).toBeVisible({ timeout: 10_000 });
  await payClientSelect.selectOption({ label: clientName });

  // Enter amount
  await page
    .locator('div[style*="position: fixed"] input[type="number"], [role="dialog"] input[type="number"]')
    .first()
    .fill('29.99');

  // Submit
  await page.getByRole('button', { name: /^record payment$/i }).click();

  // Modal closes
  await expect(
    page.locator('div[style*="position: fixed"], [role="dialog"]'),
  ).not.toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 7 — Tickets → New Ticket linked to our test client
  // -------------------------------------------------------------------------
  await page.goto('/tickets');

  await page.getByRole('button', { name: /new ticket/i }).click();

  // Fill subject
  const subjectInput = page
    .locator('div[style*="position: fixed"] input, [role="dialog"] input')
    .first();
  await expect(subjectInput).toBeVisible({ timeout: 10_000 });
  await subjectInput.fill(`E2E smoke ${suffix}`);

  // Link to client (optional field — use the first non-empty select)
  const ticketClientSelect = page
    .locator('div[style*="position: fixed"] select, [role="dialog"] select')
    .first();
  await ticketClientSelect.selectOption({ label: clientName });

  // Submit
  await page.getByRole('button', { name: /create ticket/i }).click();

  // Modal closes; our ticket subject should appear in the list
  await expect(
    page.locator('div[style*="position: fixed"], [role="dialog"]'),
  ).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`E2E smoke ${suffix}`)).toBeVisible({ timeout: 15_000 });

  // -------------------------------------------------------------------------
  // Step 8 — Sign out → redirected to /login
  // -------------------------------------------------------------------------
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/FireISP/i).first()).toBeVisible();

  // Confirm protected routes are inaccessible after logout
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Lightweight health-check smoke test (runs independently, no seed data)
// ---------------------------------------------------------------------------

test('API health endpoint is reachable', async ({ request }) => {
  const res = await request.get('/health/live');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});
