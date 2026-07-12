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

// GET /users?only_deleted=true — the Archived tab's list. Distinct from
// USERS_RESPONSE so tests can tell the two queries apart.
const ARCHIVED_USER = {
  id: 9, first_name: 'Alice', last_name: 'Retired', email: 'alice@test.com',
  role: 'support', group_id: 12, phone: null, status: 'inactive', totp_enabled: false,
  last_login_at: null, created_at: '2023-06-01', deleted_at: '2024-03-15T10:00:00Z',
};
const ARCHIVED_USERS_RESPONSE = {
  data: [ARCHIVED_USER],
  meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

// Dispatches the mocked global fetch by URL so GET /users, GET /roles,
// GET /organizations, GET /users/:id/organizations, GET /users?only_deleted,
// DELETE /users/:id, and POST /users/:id/restore can all be served from a
// single spy — POST/PATCH/DELETE to /users fall through to the users
// response so create/update/archive/restore flows re-render without erroring.
function routeFetch(overrides: {
  users?: unknown;
  groups?: unknown;
  organizations?: unknown;
  userOrganizations?: unknown;
  archivedUsers?: unknown;
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
    if (url.includes('only_deleted=true')) {
      return Promise.resolve(jsonResponse(overrides.archivedUsers ?? ARCHIVED_USERS_RESPONSE));
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

  // "Delete" for staff users is ARCHIVING (soft-delete + forced status
  // 'inactive'): DELETE /users/:id, listed back via GET /users?only_deleted=true,
  // and reversible via POST /users/:id/restore.
  describe('Archive action (main tab) + Archived tab', () => {
    it('shows a count badge on the Archived tab from meta.total', async () => {
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      const archivedTabBtn = await screen.findByRole('tab', { name: /Archived/ });
      await waitFor(() => expect(within(archivedTabBtn).getByText('1')).toBeInTheDocument());
    });

    it('archive confirm dialog shows the archive/deactivate language, then DELETEs /users/:id', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

      // Exactly one "Archive" trigger exists before the modal opens.
      await user.click(screen.getByText('Archive'));

      const dialog = await screen.findByRole('dialog', { name: 'Archive user?' });
      expect(within(dialog).getByText(/Bob Tech will be archived and deactivated/)).toBeInTheDocument();
      expect(within(dialog).getByText(/restore this account later from the Archived tab/)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

      await waitFor(() => {
        const call = findCall(globalThis.fetch as ReturnType<typeof vi.fn>, '/api/v1/users/2', 'DELETE');
        expect(call).toBeDefined();
      });
      // Modal closes after a successful archive.
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Archive user?' })).not.toBeInTheDocument());
    });

    it('renders archived rows (name, email, group, archived date) from GET /users?only_deleted=true', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

      await user.click(screen.getByRole('tab', { name: /Archived/ }));

      await waitFor(() => expect(screen.getByText('alice@test.com')).toBeInTheDocument());
      const row = screen.getByText('alice@test.com').closest('tr') as HTMLElement;
      expect(within(row).getByText('Alice Retired')).toBeInTheDocument();
      // ARCHIVED_USER.group_id = 12 → GROUPS_RESPONSE id 12 = "support".
      expect(within(row).getByText('support')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Restore' })).toBeInTheDocument();

      // No create/edit affordances in this tab.
      expect(screen.queryByText('+ New User')).not.toBeInTheDocument();
      expect(within(row).queryByText('Edit')).not.toBeInTheDocument();
    });

    it('shows the empty state when there are no archived users', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch({
        archivedUsers: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
      }));
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

      await user.click(screen.getByRole('tab', { name: /Archived/ }));
      await waitFor(() => expect(screen.getByText('No archived users found.')).toBeInTheDocument());
    });

    it('Restore POSTs to /users/:id/restore, refetches both lists, and shows an inactive-restore notice', async () => {
      const user = userEvent.setup();
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

      await user.click(screen.getByRole('tab', { name: /Archived/ }));
      await waitFor(() => expect(screen.getByText('alice@test.com')).toBeInTheDocument());

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      // The main list and the archived list share the `/api/v1/users?` prefix
      // (archived just adds `only_deleted=true`) — exclude/require it so each
      // counter isolates its own query.
      const countGetCalls = (urlSubstr: string, exclude?: string) => fetchMock.mock.calls.filter(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as URL).toString();
        const method = init?.method ?? 'GET';
        return url.includes(urlSubstr) && method === 'GET' && (!exclude || !url.includes(exclude));
      }).length;
      const archivedGetsBefore = countGetCalls('only_deleted=true');
      const mainListGetsBefore = countGetCalls('/api/v1/users?', 'only_deleted=true');

      await user.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => {
        const call = findCall(fetchMock, '/api/v1/users/9/restore', 'POST');
        expect(call).toBeDefined();
      });

      // Inline notice explains the restored account comes back INACTIVE.
      await waitFor(() => expect(screen.getByText(
        'Alice Retired was restored as inactive. Activate the account from the Users tab if needed.',
      )).toBeInTheDocument());

      // Both the archived list and the main users list refetch after restore
      // — invalidateQueries({queryKey:['users']}) prefix-matches both keys.
      await waitFor(() => {
        expect(countGetCalls('only_deleted=true')).toBeGreaterThan(archivedGetsBefore);
        expect(countGetCalls('/api/v1/users?', 'only_deleted=true')).toBeGreaterThan(mainListGetsBefore);
      });
    });

    // Defect: Restore/Archive are the page's first list-shrinking mutations.
    // Neither tab used to clamp its page state, so restoring the last row on
    // a later page left `archivedPage` stranded past the new totalPages —
    // the refetch returns `data: []` and <Pagination> hides its controls
    // (totalPages <= 1), with no way back to page 1.
    it('clamps the Archived tab back to page 1 after Restore empties the stranded last page', async () => {
      const user = userEvent.setup();
      const page1Rows = Array.from({ length: 25 }, (_, i) => ({
        ...ARCHIVED_USER, id: 100 + i, first_name: `Arch${i}`, last_name: 'User', email: `arch${i}@test.com`,
      }));
      const lastRow = { ...ARCHIVED_USER, id: 200, first_name: 'Last', last_name: 'Row', email: 'lastrow@test.com' };
      let restored = false;

      vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        if (url.includes('/users/200/restore') && method === 'POST') {
          restored = true;
          return Promise.resolve(jsonResponse({}));
        }
        if (url.includes('only_deleted=true')) {
          const page = new URLSearchParams(url.split('?')[1]).get('page');
          if (page === '2') {
            return Promise.resolve(jsonResponse(
              restored
                ? { data: [], meta: { total: 25, page: 2, limit: 25, totalPages: 1 } }
                : { data: [lastRow], meta: { total: 26, page: 2, limit: 25, totalPages: 2 } },
            ));
          }
          return Promise.resolve(jsonResponse({
            data: page1Rows,
            meta: restored ? { total: 25, page: 1, limit: 25, totalPages: 1 } : { total: 26, page: 1, limit: 25, totalPages: 2 },
          }));
        }
        if (/\/users\/\d+\/organizations/.test(url)) return Promise.resolve(jsonResponse(USER_ORGANIZATIONS_RESPONSE));
        if (url.includes('/roles')) return Promise.resolve(jsonResponse(GROUPS_RESPONSE));
        if (url.includes('/organizations')) return Promise.resolve(jsonResponse(ORGANIZATIONS_RESPONSE));
        if (url.includes('/users')) return Promise.resolve(jsonResponse(USERS_RESPONSE));
        return Promise.resolve(jsonResponse({}));
      });

      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByRole('tab', { name: /Archived/ }));
      await waitFor(() => expect(screen.getByText('arch0@test.com')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Next →' }));
      await waitFor(() => expect(screen.getByText('lastrow@test.com')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Restore' }));

      // Stranded-page repro: without the clamp this would show the empty
      // state forever with no pagination control to get back to page 1.
      await waitFor(() => expect(screen.getByText('arch0@test.com')).toBeInTheDocument());
      expect(screen.queryByText('lastrow@test.com')).not.toBeInTheDocument();
      expect(screen.queryByText('No archived users found.')).not.toBeInTheDocument();
    });

    // Defect: restoreMutation is one shared mutation for every row in the
    // table, so gating the busy state on `isPending` alone disabled/relabeled
    // every row's Restore button while any single restore was in flight.
    it('only disables/relabels the clicked row while its restore is in flight — other rows stay enabled', async () => {
      const user = userEvent.setup();
      const secondArchived = { ...ARCHIVED_USER, id: 15, first_name: 'Second', last_name: 'Row', email: 'second@test.com' };
      let resolveRestore: (() => void) | undefined;
      const restorePending = new Promise<void>((resolve) => { resolveRestore = resolve; });

      vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        if (url.includes('/users/9/restore') && method === 'POST') {
          return restorePending.then(() => jsonResponse({}));
        }
        if (url.includes('only_deleted=true')) {
          return Promise.resolve(jsonResponse({
            data: [ARCHIVED_USER, secondArchived],
            meta: { total: 2, page: 1, limit: 25, totalPages: 1 },
          }));
        }
        if (/\/users\/\d+\/organizations/.test(url)) return Promise.resolve(jsonResponse(USER_ORGANIZATIONS_RESPONSE));
        if (url.includes('/roles')) return Promise.resolve(jsonResponse(GROUPS_RESPONSE));
        if (url.includes('/organizations')) return Promise.resolve(jsonResponse(ORGANIZATIONS_RESPONSE));
        if (url.includes('/users')) return Promise.resolve(jsonResponse(USERS_RESPONSE));
        return Promise.resolve(jsonResponse({}));
      });

      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());
      await user.click(screen.getByRole('tab', { name: /Archived/ }));
      await waitFor(() => expect(screen.getByText('alice@test.com')).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('second@test.com')).toBeInTheDocument());

      const row1 = screen.getByText('alice@test.com').closest('tr') as HTMLElement;
      const row2 = screen.getByText('second@test.com').closest('tr') as HTMLElement;

      await user.click(within(row1).getByRole('button', { name: 'Restore' }));

      // row1 (clicked) shows the busy state while its restore is pending...
      await waitFor(() => expect(within(row1).getByRole('button', { name: 'Restoring…' })).toBeDisabled());
      // ...but row2 is untouched: still labeled "Restore" and still enabled.
      expect(within(row2).getByRole('button', { name: 'Restore' })).not.toBeDisabled();

      resolveRestore?.();
      await waitFor(() => expect(within(row1).getByRole('button', { name: 'Restore' })).toBeInTheDocument());
    });

    // Defect: archiving yourself locks you out instantly (no admin left to
    // restore the account) — the backend rejects it with 422, and the UI
    // must not offer an Archive action on the acting admin's own row.
    it('disables the Archive action on the current admin\'s own row', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch({
        users: { data: [{ ...user1, id: adminUser.id }], meta: USERS_RESPONSE.meta },
      }));
      renderUserList();
      await waitFor(() => expect(screen.getByText('bob@test.com')).toBeInTheDocument());

      const row = screen.getByText('bob@test.com').closest('tr') as HTMLElement;
      const archiveBtn = within(row).getByRole('button', { name: 'Archive' });
      expect(archiveBtn).toBeDisabled();
      expect(archiveBtn).toHaveAttribute('title', 'You cannot archive your own account');

      await user.click(archiveBtn);
      expect(screen.queryByRole('dialog', { name: 'Archive user?' })).not.toBeInTheDocument();
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
