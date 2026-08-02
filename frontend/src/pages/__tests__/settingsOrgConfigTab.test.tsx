// =============================================================================
// FireISP 5.0 — Settings / Org Config tab (j56 split)
// =============================================================================
// Two properties under test.
//
// 1. THE TAB ACTUALLY RENDERS ROWS. Before the split the backend returned an
//    object map while this component expected an array — both `length` checks
//    were false on an object, so the tab rendered its heading and nothing
//    else, silently, for everyone, always. An assertion that a row EXISTS is
//    the regression test for that entire failure mode.
//
// 2. THE SCOPE SPLIT IS VISIBLE. Install-wide rows arrive with
//    editable:false for an org caller and must offer no Edit button — the
//    backend 403s the write, and a visible button that 403s is the classic
//    FireISP bug this codebase keeps re-growing.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/AuthContext')>()),
  useAuth: () => ({
    user: {
      id: 1, email: 'u@test.com', name: 'U', role: 'admin',
      organization_id: 1, is_active: true, email_verified_at: null, twofa_enabled: false,
    },
    loading: false, initialized: true,
    login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), switchOrganization: vi.fn(),
  }),
}));

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-token', setAccess: vi.fn(),
    getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn(),
  },
  authedFetch: vi.fn().mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  ),
}));

const SETTINGS = [
  { key: 'mab_password_mode', value: 'auth_type_accept', description: 'MAB credential shape', scope: 'org', editable: true },
  { key: 'pppoe_auth_failure_threshold', value: '5', description: 'Auth failures per window', scope: 'org', editable: true },
  { key: 'ops_alert_email', value: 'ops@isp.mx', description: 'Infra alerts', scope: 'install', editable: false },
];

function respondWith(settings: unknown[] = SETTINGS) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/settings')) {
      return { ok: true, status: 200, json: async () => ({ data: settings }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  });
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  respondWith();
});

describe('the tab renders rows from the array response', () => {
  it('shows org rows and install rows in their sections', async () => {
    renderSettings();
    expect(await screen.findByText('mab_password_mode')).toBeInTheDocument();
    expect(screen.getByText('pppoe_auth_failure_threshold')).toBeInTheDocument();
    expect(screen.getByText('ops_alert_email')).toBeInTheDocument();
    expect(screen.getByText('Organization settings')).toBeInTheDocument();
    expect(screen.getByText('Installation-wide settings')).toBeInTheDocument();
  });
});

describe('non-editable install rows offer no write path', () => {
  it('shows the operator-only note instead of an Edit button', async () => {
    renderSettings();
    await screen.findByText('ops_alert_email');
    // Two editable org rows → exactly two Edit buttons; the install row gets none.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    expect(screen.getByText('Install operator only')).toBeInTheDocument();
  });

  it('offers Edit on an install row the backend marks editable (the operator)', async () => {
    respondWith(SETTINGS.map(s => ({ ...s, editable: true })));
    renderSettings();
    await screen.findByText('ops_alert_email');
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3);
  });
});

describe('known keys get shaped editors', () => {
  it('edits mab_password_mode through a select restricted to the legal values', async () => {
    renderSettings();
    await screen.findByText('mab_password_mode');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map(o => o.getAttribute('value'));
    expect(options).toEqual(['auth_type_accept', 'cleartext']);
  });
});
