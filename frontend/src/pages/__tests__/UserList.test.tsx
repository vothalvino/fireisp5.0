// =============================================================================
// FireISP 5.0 — UserList page tests
// =============================================================================
// Covers the staff Users admin page, in particular the user-groups + org
// access rework (migration 378):
//   - the Group column/select is populated from GET /roles, not a hardcoded
//     role enum, and the table falls back to the raw role mirror text
//   - the New User modal defaults to the system "support" group and checks
//     the current org, and POSTs group_id + organization_ids — never `role`
//   - the Edit User modal prefills org access from GET /users/:id/organizations
//     and PATCHes group_id + organization_ids — never `role`
//   - the group filter sends ?group_id=<id>
//   - Save/Create is disabled with a hint when no organization is checked
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UserList, apiErrorMessage } from '../UserList';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';

// ---------------------------------------------------------------------------
// UserList uses raw fetch()/authedFetch, not api.GET — mock @/api/client and
// route the mocked authedFetch through the same global fetch spy used for
// GETs, so POST/PATCH bodies are inspectable via fetch.mock.calls.
// ---------------------------------------------------------------------------

vi.mock('@/api/client', () => ({
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

const adminUser: AuthUser = {
  id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin',
  organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false,
};

const user1 = {
  id: 2, first_name: 'Bob', last_name: 'Tech', email: 'bob@test.com',
  role: 'technician', group_id: 13, phone: null, status: 'active', totp_enabled: false,
  last_login_at: null, created_at: '2024-01-01',
};

// Real response shapes (see src/routes/roles.js — SELECT * FROM roles, and
// src/routes/organizations.js — generic crudController list).
const GROUPS_RESPONSE = {
  data: [
    { id: 10, name: 'admin', description: null, kind: 'admin', is_system: 1 },
    { id: 11, name: 'billing', description: null, kind: 'billing', is_system: 1 },
    { id: 12, name: 'support', description: null, kind: 'support', is_system: 1 },
    { id: 13, name: 'technician', description: null, kind: 'technician', is_system: 1 },
    { id: 20, name: 'Custom NOC', description: null, kind: 'technician', is_system: 0 },
  ],
  meta: { total: 5, page: 1, limit: 100, totalPages: 1 },
};

const ORGANIZATIONS_RESPONSE = {
  data: [
    { id: 1, name: 'Org One' },
    { id: 2, name: 'Org Two' },
  ],
};

// src/routes/users.js GET /:id/organizations shape
const USER_ORGANIZATIONS_RESPONSE = {
  data: [
    { id: 1, name: 'Org One', membership_role: 'technician' },
  ],
};

const USERS_RESPONSE = {
  data: [user1],
  meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

// Dispatches the mocked global fetch by URL so GET /users, GET /roles,
// GET /organizations, and GET /users/:id/organizations can all be served
// from a single spy — and POST/PATCH to /users fall through to the users
// response so create/update flows re-render without erroring.
function routeFetch(overrides: {
  users?: unknown;
  groups?: unknown;
  organizations?: unknown;
  userOrganizations?: unknown;
} = {}) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (/\/users\/\d+\/organizations/.test(url)) {
      return Promise.resolve(jsonResponse(overrides.userOrganizations ?? USER_ORGANIZATIONS_RESPONSE));
    }
    if (url.includes('/roles')) {
      return Promise.resolve(jsonResponse(overrides.groups ?? GROUPS_RESPONSE));
    }
    if (url.includes('/organizations')) {
      return Promise.resolve(jsonResponse(overrides.organizations ?? ORGANIZATIONS_RESPONSE));
    }
    if (url.includes('/users')) {
      return Promise.resolve(jsonResponse(overrides.users ?? USERS_RESPONSE));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function renderUserList() {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: adminUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as ReturnType<typeof AuthContextModule.useAuth>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UserList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Finds the last fetch call whose URL matches `urlSubstr` and method matches
// (default GET calls pass no explicit method — accept undefined for GET).
function findCall(fetchMock: ReturnType<typeof vi.fn>, urlSubstr: string, method: string) {
  const calls = fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit?]>;
  return [...calls].reverse().find(([input, init]) => {
    const url = typeof input === 'string' ? input : input.toString();
    const callMethod = init?.method ?? 'GET';
    return url.includes(urlSubstr) && callMethod === method;
  });
}

describe('UserList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch());
  });

  it('renders the page heading', async () => {
    renderUserList();
    await waitFor(() => expect(screen.getByText('🔑 Users')).toBeInTheDocument());
  });

  it('renders a user row after data loads, with the Group column resolved from GET /roles', async () => {
    renderUserList();
    await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
    // user1.group_id = 13 → GROUPS_RESPONSE id 13 = "technician". Scope to the
    // row itself — the group filter <select> also has a "technician" option.
    const row = screen.getByText('bob@test.com').closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('technician')).toBeInTheDocument());
  });

  it('falls back to the raw role mirror text when the group id is unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch({
      users: { data: [{ ...user1, group_id: 999 }], meta: USERS_RESPONSE.meta },
    }));
    renderUserList();
    await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
    // group_id 999 isn't in GROUPS_RESPONSE — falls back to role "technician" text
    const row = screen.getByText('bob@test.com').closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('technician')).toBeInTheDocument());
  });

  it('shows empty message when no users', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch({
      users: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
    }));
    renderUserList();
    await waitFor(() => expect(screen.getByText(/No users found/)).toBeInTheDocument());
  });

  it('sends the group filter as ?group_id=<id> and re-fetches users', async () => {
    const user = userEvent.setup();
    renderUserList();
    await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

    const filter = await screen.findByLabelText('Filter by group');
    await waitFor(() => expect(within(filter).getByText('Custom NOC')).toBeInTheDocument());
    await user.selectOptions(filter, '13');

    await waitFor(() => {
      const call = findCall(globalThis.fetch as ReturnType<typeof vi.fn>, '/api/v1/users?', 'GET');
      expect(call).toBeDefined();
      const url = typeof call![0] === 'string' ? call![0] : call![0].toString();
      expect(url).toContain('group_id=13');
      expect(url).not.toContain('role=');
    });
  });

  describe('New User modal — group + organization access', () => {
    it('defaults the group to the system "support" group and checks the current org', async () => {
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await userEvent.click(screen.getByText('+ New User'));

      const groupSelect = await screen.findByLabelText('Group') as HTMLSelectElement;
      await waitFor(() => expect(groupSelect.value).toBe('12')); // support group id

      const orgCheckbox = screen.getByLabelText('Org One') as HTMLInputElement;
      expect(orgCheckbox.checked).toBe(true);
      const otherOrgCheckbox = screen.getByLabelText('Org Two') as HTMLInputElement;
      expect(otherOrgCheckbox.checked).toBe(false);
    });

    it('POSTs group_id and organization_ids, and never sends role', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('+ New User'));

      await screen.findByLabelText('Org One');
      await user.type(screen.getByPlaceholderText('First name'), 'New');
      await user.type(screen.getByPlaceholderText('Last name'), 'Guy');
      await user.type(screen.getByPlaceholderText('user@example.com'), 'new@test.com');
      await user.type(screen.getByPlaceholderText('••••••••'), 'password123');

      const groupSelect = await screen.findByLabelText('Group') as HTMLSelectElement;
      await waitFor(() => expect(groupSelect.value).toBe('12'));
      await user.selectOptions(groupSelect, '20'); // Custom NOC

      await user.click(screen.getByLabelText('Org Two'));

      await user.click(screen.getByText('Create User'));

      await waitFor(() => {
        const call = findCall(globalThis.fetch as ReturnType<typeof vi.fn>, '/api/v1/users', 'POST');
        expect(call).toBeDefined();
        const body = JSON.parse(call![1]!.body as string);
        expect(body.group_id).toBe(20);
        expect(body.organization_ids.sort()).toEqual([1, 2]);
        expect(body).not.toHaveProperty('role');
      });
    });

    it('disables Create and shows a hint when no organization is checked', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('+ New User'));

      const orgOne = await screen.findByLabelText('Org One') as HTMLInputElement;
      expect(orgOne.checked).toBe(true);
      await user.click(orgOne); // uncheck the only checked org

      expect(screen.getByText('Select at least one organization')).toBeInTheDocument();
      expect(screen.getByText('Create User')).toBeDisabled();
    });
  });

  describe('Edit User modal — group + organization access', () => {
    it('prefills group + org checkboxes from GET /users/:id/organizations', async () => {
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await userEvent.click(screen.getByText('Edit'));

      const groupSelect = await screen.findByLabelText('Group') as HTMLSelectElement;
      expect(groupSelect.value).toBe('13'); // user1.group_id

      const orgOne = await screen.findByLabelText('Org One') as HTMLInputElement;
      await waitFor(() => expect(orgOne.checked).toBe(true));
      const orgTwo = screen.getByLabelText('Org Two') as HTMLInputElement;
      expect(orgTwo.checked).toBe(false);
    });

    it('PATCHes group_id and organization_ids, and never sends role', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('Edit'));

      const orgOne = await screen.findByLabelText('Org One') as HTMLInputElement;
      await waitFor(() => expect(orgOne.checked).toBe(true));

      const groupSelect = screen.getByLabelText('Group') as HTMLSelectElement;
      await user.selectOptions(groupSelect, '20'); // Custom NOC
      await user.click(screen.getByLabelText('Org Two'));

      await user.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        const call = findCall(globalThis.fetch as ReturnType<typeof vi.fn>, '/api/v1/users/2', 'PATCH');
        expect(call).toBeDefined();
        const body = JSON.parse(call![1]!.body as string);
        expect(body.group_id).toBe(20);
        expect(body.organization_ids.sort()).toEqual([1, 2]);
        expect(body).not.toHaveProperty('role');
      });
    });

    // Finding 3: the PATCH diff used `form.phone.trim() || undefined` for a
    // changed phone value — clearing the field made that expression evaluate
    // to `undefined`, which JSON.stringify drops from the body entirely, so
    // the PATCH silently omitted `phone` and the backend kept the old value.
    it('sends phone: null (not omitted) when an existing phone is explicitly cleared', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch({
        users: { data: [{ ...user1, phone: '555-1234-000' }], meta: USERS_RESPONSE.meta },
      }));
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('Edit'));

      const orgOne = await screen.findByLabelText('Org One') as HTMLInputElement;
      await waitFor(() => expect(orgOne.checked).toBe(true));

      const phoneInput = screen.getByPlaceholderText('+52 55 1234 5678 (optional)') as HTMLInputElement;
      expect(phoneInput.value).toBe('555-1234-000');
      await user.clear(phoneInput);

      await user.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        const call = findCall(globalThis.fetch as ReturnType<typeof vi.fn>, '/api/v1/users/2', 'PATCH');
        expect(call).toBeDefined();
        const body = JSON.parse(call![1]!.body as string);
        expect(body).toHaveProperty('phone');
        expect(body.phone).toBeNull();
      });
    });

    it('disables Save and shows a hint when every organization is unchecked', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('Edit'));

      const orgOne = await screen.findByLabelText('Org One') as HTMLInputElement;
      await waitFor(() => expect(orgOne.checked).toBe(true));
      await user.click(orgOne);

      expect(screen.getByText('Select at least one organization')).toBeInTheDocument();
      expect(screen.getByText('Save Changes')).toBeDisabled();
    });

    // Finding 2: a failed GET /users/:id/organizations prefill used to be
    // swallowed — the modal fell back to an empty checklist and, the moment
    // the user toggled ANY org checkbox, `valid` silently flipped back to
    // true from that empty baseline. Saving then replaced the user's real
    // (never-loaded) org memberships with just the toggled org(s).
    it('shows an inline error and disables Save when org prefill fails, until Retry succeeds', async () => {
      const user = userEvent.setup();
      const base = routeFetch();
      let orgCallCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (/\/users\/\d+\/organizations/.test(url)) {
          orgCallCount += 1;
          if (orgCallCount === 1) {
            return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
          }
        }
        return base(input, init);
      });

      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByText('Edit'));

      // "Couldn't load..." is unique to the error banner — the modal's own
      // label text is "Organization Access *", which would also match a
      // looser /organization access/i query and make it ambiguous.
      await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
      expect(screen.getByText('Save Changes')).toBeDisabled();
      // The checklist itself must be inert while errored — otherwise toggling
      // a box would seed `orgIds` from an empty Set and re-enable Save with
      // the wrong (incomplete) org set.
      const orgOne = screen.getByLabelText('Org One') as HTMLInputElement;
      expect(orgOne).toBeDisabled();

      await user.click(screen.getByRole('button', { name: /retry/i }));

      await waitFor(() => expect(screen.getByText('Save Changes')).not.toBeDisabled());
      expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
      await waitFor(() => expect((screen.getByLabelText('Org One') as HTMLInputElement).checked).toBe(true));
    });
  });

  // Regression: the API returns errors as { error: { message, details } }; the old
  // code read err.error as a string, so create/update failures rendered "[object Object]".
  describe('apiErrorMessage', () => {
    it('returns the error message, not the stringified object', () => {
      expect(apiErrorMessage({ error: { message: 'Email already exists' } }, 'fallback'))
        .toBe('Email already exists');
    });

    it('joins validation details when present', () => {
      const json = { error: { message: 'Validation failed', details: [{ message: 'first_name is required' }, { message: 'email is invalid' }] } };
      expect(apiErrorMessage(json, 'fallback')).toBe('first_name is required, email is invalid');
    });

    it('falls back when there is no usable message (never returns [object Object])', () => {
      expect(apiErrorMessage({}, 'Failed to create user')).toBe('Failed to create user');
      expect(apiErrorMessage({ error: {} }, 'Failed to create user')).toBe('Failed to create user');
      expect(apiErrorMessage(null, 'Failed to create user')).toBe('Failed to create user');
    });
  });
});
