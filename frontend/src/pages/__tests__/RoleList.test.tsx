// =============================================================================
// FireISP 5.0 — RoleList (User Groups) page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RoleList } from '../RoleList';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    DELETE: (...args: unknown[]) => mockApiDelete(...args),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roleSupport = {
  id: 1,
  name: 'Support Agents',
  description: 'Handles tickets',
  kind: 'support',
  is_system: 0,
};

const roleAdmin = {
  id: 2,
  name: 'Administrators',
  description: 'Full system access',
  kind: 'admin',
  is_system: 1,
};

// Full catalog — used by the "Special permissions" section and to derive the
// module-level CRUD subset. `module` is only present on catalog rows
// (GET /roles/permissions), matching the real SELECT in src/routes/roles.js.
//
// `billing_settings` mirrors how real modules aggregate several distinct
// entity slug-prefixes under one module column (e.g. the real 'billing'
// module holds invoices.*, payments.*, invoice_settings.*, late_fee_rules.*,
// ... — see migrations 119/205/207): two prefixes, invoice_settings.* and
// late_fee_rules.*, each with their own .view slug, plus a non-CRUD
// late_fee_rules.manage "special" slug to prove specials survive a radio
// toggle within a multi-prefix module.
const catalog = [
  { id: 1, slug: 'clients.view', description: 'View clients', module: 'clients' },
  { id: 2, slug: 'clients.create', description: 'Create clients', module: 'clients' },
  { id: 3, slug: 'clients.update', description: 'Update clients', module: 'clients' },
  { id: 4, slug: 'clients.delete', description: 'Delete clients', module: 'clients' },
  { id: 5, slug: 'clients.export', description: 'Export clients as CSV', module: 'clients' },
  { id: 6, slug: 'reports.view', description: 'View reports', module: 'reports' },
  { id: 7, slug: 'invoices.view', description: 'View invoices', module: 'invoices' },
  { id: 8, slug: 'invoices.create', description: 'Create invoices', module: 'invoices' },
  { id: 9, slug: 'invoices.update', description: 'Update invoices', module: 'invoices' },
  { id: 10, slug: 'invoices.delete', description: 'Delete invoices', module: 'invoices' },
  { id: 11, slug: 'invoice_settings.view', description: 'View invoice settings', module: 'billing_settings' },
  { id: 12, slug: 'invoice_settings.update', description: 'Update invoice settings', module: 'billing_settings' },
  { id: 13, slug: 'late_fee_rules.view', description: 'View late fee rules', module: 'billing_settings' },
  { id: 14, slug: 'late_fee_rules.create', description: 'Create late fee rules', module: 'billing_settings' },
  { id: 15, slug: 'late_fee_rules.update', description: 'Update late fee rules', module: 'billing_settings' },
  { id: 16, slug: 'late_fee_rules.delete', description: 'Delete late fee rules', module: 'billing_settings' },
  { id: 17, slug: 'late_fee_rules.manage', description: 'Manage late fee rules', module: 'billing_settings' },
];

// Support Agents currently holds: full CRUD on clients (-> Edit), only
// .view on reports (-> View), a partial subset on invoices (-> Custom), and
// the late_fee_rules.manage special (but none of billing_settings' CRUD ids,
// so that module starts at Denied). clients.export (a special/non-CRUD slug)
// is NOT held yet.
const SUPPORT_PERMISSION_IDS = [1, 2, 3, 4, 6, 7, 8, 17];

// GET /roles/{id} returns permissions as { id, slug, description } — no
// `module` column (that join only exists on the /roles/permissions catalog).
function detailPermissions(ids: number[]) {
  return catalog
    .filter(p => ids.includes(p.id))
    .map(({ id, slug, description }) => ({ id, slug, description }));
}

function roleById(id: number) {
  if (id === roleSupport.id) return { ...roleSupport, permissions: detailPermissions(SUPPORT_PERMISSION_IDS) };
  if (id === roleAdmin.id) return { ...roleAdmin, permissions: [] };
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RoleList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

async function openPermissionsFor(name: string) {
  fireEvent.click(within(rowFor(name)).getByTitle('Manage permissions'));
  return screen.findByRole('dialog', { name: new RegExp(`Permissions for ${name}`, 'i') });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockApiGet.mockImplementation((path: string, opts?: { params?: { path?: { id?: number } } }) => {
    if (path === '/roles') {
      return Promise.resolve({
        data: { data: [roleSupport, roleAdmin], meta: { total: 2, page: 1, limit: 50, totalPages: 1 } },
        error: undefined,
      });
    }
    if (path === '/roles/{id}') {
      const id = opts?.params?.path?.id;
      const role = typeof id === 'number' ? roleById(id) : null;
      if (!role) return Promise.resolve({ data: undefined, error: { error: { message: 'Not found' } } });
      return Promise.resolve({ data: { data: role }, error: undefined });
    }
    if (path === '/roles/permissions') {
      return Promise.resolve({ data: { data: catalog }, error: undefined });
    }
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });

  mockApiPost.mockImplementation((path: string, opts?: { body?: Record<string, unknown> }) => {
    if (path === '/roles') {
      const body = opts?.body ?? {};
      return Promise.resolve({
        data: { data: { id: 99, name: body.name, description: body.description ?? null, kind: body.kind, is_system: 0 } },
        error: undefined,
      });
    }
    return Promise.resolve({ data: { data: {} }, error: undefined });
  });

  mockApiPut.mockImplementation((path: string, opts?: { body?: { permission_ids?: number[] } }) => {
    if (path === '/roles/{id}/permissions') {
      const ids = opts?.body?.permission_ids ?? [];
      return Promise.resolve({ data: { data: detailPermissions(ids) }, error: undefined });
    }
    return Promise.resolve({ data: { data: {} }, error: undefined });
  });

  mockApiDelete.mockImplementation(() => Promise.resolve({ data: undefined, error: undefined }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RoleList page (User Groups)', () => {
  it('renders the page heading', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('👥 User Groups')).toBeInTheDocument());
  });

  it('lists groups with their kind and a System badge', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());
    expect(screen.getByText('Administrators')).toBeInTheDocument();

    // Kind badges (label text, not the raw enum value)
    expect(within(rowFor('Support Agents')).getByText('Support')).toBeInTheDocument();
    expect(within(rowFor('Administrators')).getByText('Admin')).toBeInTheDocument();

    // System badge only on the system group
    expect(within(rowFor('Administrators')).getByText(/System/)).toBeInTheDocument();
    expect(within(rowFor('Support Agents')).queryByText(/System/)).not.toBeInTheDocument();
  });

  it('hides the rename/kind inputs and the Delete action for a system group', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Administrators')).toBeInTheDocument());

    // Row-level: no Delete button for the system group, but Edit still exists.
    expect(within(rowFor('Administrators')).queryByTitle('Delete this group')).not.toBeInTheDocument();
    expect(within(rowFor('Support Agents')).getByTitle('Delete this group')).toBeInTheDocument();

    fireEvent.click(within(rowFor('Administrators')).getByTitle('Edit this group'));
    const dialog = await screen.findByRole('dialog', { name: /Edit group Administrators/i });
    expect(within(dialog).getByText(/System groups cannot be renamed/i)).toBeInTheDocument();
    // The editable Name/Based-on inputs are replaced with static text.
    expect(within(dialog).queryByPlaceholderText(/Field Technicians/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    // Description remains editable even for system groups.
    expect(within(dialog).getByLabelText('Description')).toBeInTheDocument();
  });

  it('creating a group sends name, description, and kind', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());

    fireEvent.click(screen.getByText('+ New Group'));
    const dialog = await screen.findByRole('dialog', { name: /New user group/i });

    fireEvent.change(within(dialog).getByPlaceholderText(/Field Technicians/i), { target: { value: 'Field Techs' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'On-site crew' } });
    fireEvent.change(within(dialog).getByLabelText(/^Based on/i), { target: { value: 'technician' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create Group/i }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled());
    const [path, opts] = mockApiPost.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/roles');
    expect(opts.body).toEqual({ name: 'Field Techs', description: 'On-site crew', kind: 'technician' });
  });

  it('derives Denied/View/Edit/Custom matrix states from the current permission set', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());
    const dialog = await openPermissionsFor('Support Agents');

    // clients: full CRUD held -> Edit
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /clients — Edit/i })).toBeChecked());
    // reports: only .view held -> View
    expect(within(dialog).getByRole('radio', { name: /reports — View/i })).toBeChecked();
    // invoices: partial subset held -> auto Custom (checked + disabled)
    const invoicesCustom = within(dialog).getByRole('radio', { name: /invoices — Custom/i });
    expect(invoicesCustom).toBeChecked();
    expect(invoicesCustom).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: /invoices — Edit/i })).not.toBeChecked();
    // billing_settings: none of its CRUD ids (across either prefix) held -> Denied,
    // even though the late_fee_rules.manage special IS held.
    expect(within(dialog).getByRole('radio', { name: /billing_settings — Denied/i })).toBeChecked();
  });

  it('aggregates the View preset across multiple entity-slug prefixes within one module', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());
    const dialog = await openPermissionsFor('Support Agents');

    // Starts Denied (neither invoice_settings.* nor late_fee_rules.* CRUD ids held),
    // but the late_fee_rules.manage special is already checked.
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /billing_settings — Denied/i })).toBeChecked());
    const manageCheckbox = within(dialog).getByRole('checkbox', { name: /Manage late fee rules/i });
    expect(manageCheckbox).toBeChecked();

    // A single "View" click on the module row must select BOTH .view slugs
    // (invoice_settings.view id 11 AND late_fee_rules.view id 13) — not just
    // the first one found — and state detection must recognize the result as View.
    fireEvent.click(within(dialog).getByRole('radio', { name: /billing_settings — View/i }));
    expect(within(dialog).getByRole('radio', { name: /billing_settings — View/i })).toBeChecked();
    // The special stays independently checked — untouched by the radio toggle.
    expect(within(dialog).getByRole('checkbox', { name: /Manage late fee rules/i })).toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions');
      expect(call).toBeTruthy();
    });
    const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions') as [string, { body: { permission_ids: number[] } }];
    const ids = new Set(call[1].body.permission_ids);
    expect(ids.has(11)).toBe(true); // invoice_settings.view
    expect(ids.has(13)).toBe(true); // late_fee_rules.view
    // Neither prefix's non-view CRUD ids were pulled in.
    expect(ids.has(12)).toBe(false); // invoice_settings.update
    expect(ids.has(14)).toBe(false); // late_fee_rules.create
    expect(ids.has(15)).toBe(false); // late_fee_rules.update
    expect(ids.has(16)).toBe(false); // late_fee_rules.delete
    // The special permission survived the radio toggle within its own module.
    expect(ids.has(17)).toBe(true); // late_fee_rules.manage
  });

  it('toggling a radio to Edit and saving PUTs the union of permission_ids', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());
    const dialog = await openPermissionsFor('Support Agents');

    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /invoices — Custom/i })).toBeChecked());
    fireEvent.click(within(dialog).getByRole('radio', { name: /invoices — Edit/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions');
      expect(call).toBeTruthy();
    });
    const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions') as [string, { body: { permission_ids: number[] } }];
    const ids = new Set(call[1].body.permission_ids);
    // clients (edit, unchanged) + reports (view, unchanged) + invoices now full CRUD
    // + late_fee_rules.manage (special, unchanged, untouched by this module's radio)
    expect(ids).toEqual(new Set([1, 2, 3, 4, 6, 7, 8, 9, 10, 17]));
  });

  it('checking a special permission includes it in the saved permission_ids', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Support Agents')).toBeInTheDocument());
    const dialog = await openPermissionsFor('Support Agents');

    await waitFor(() => expect(within(dialog).getByText('Special permissions')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Export clients as CSV/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions');
      expect(call).toBeTruthy();
    });
    const call = mockApiPut.mock.calls.find(([p]) => p === '/roles/{id}/permissions') as [string, { body: { permission_ids: number[] } }];
    const ids = new Set(call[1].body.permission_ids);
    expect(ids.has(5)).toBe(true); // clients.export, newly checked
    expect(ids.has(1)).toBe(true); // original selections preserved
    // invoices was left in Custom state (untouched) — its currently-selected
    // CRUD ids (view + create) must reach the save payload unchanged, with no
    // silent normalization toward Denied/View/Edit.
    expect(ids.has(7)).toBe(true); // invoices.view
    expect(ids.has(8)).toBe(true); // invoices.create
    expect(ids.has(9)).toBe(false); // invoices.update — never held
    expect(ids.has(10)).toBe(false); // invoices.delete — never held
  });

  it('renders an admin-kind group’s matrix read-only with a notice', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Administrators')).toBeInTheDocument());
    const dialog = await openPermissionsFor('Administrators');

    await waitFor(() => expect(within(dialog).getByText(/not editable/i)).toBeInTheDocument());
    // The matrix rows come from a separate permissions fetch and can render
    // after the notice on slow CI runners — wait for them instead of assuming
    // they arrived with the notice (this exact line flaked in CI).
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /clients — Denied/i })).toBeDisabled());
    expect(within(dialog).queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    // Two elements share the accessible name "Close": the header ✕ button
    // (aria-label) and the footer action button (text) — the read-only
    // notice replaces "Cancel" with a second "Close", confirming no Save
    // Changes button was rendered for this admin-kind group.
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);

    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(mockApiPut).not.toHaveBeenCalledWith('/roles/{id}/permissions', expect.anything());
  });

  it('shows empty message when no groups', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/roles')
        return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/No user groups found/)).toBeInTheDocument());
  });
});
