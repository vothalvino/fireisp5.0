import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { SnmpTraps } from '../SnmpTraps';

const mocks = vi.hoisted(() => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
  auth: {
    user: { role: 'readonly', permissions: ['devices.view'] } as {
      role: string;
      permissions: string[];
      is_install_operator?: boolean;
    },
  },
}));

vi.mock('@/api/client', () => ({
  api: mocks.api,
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.auth.user }),
}));

const metadataTrap = {
  id: 41,
  organization_id: 7,
  device_id: 12,
  device_name: 'Core router',
  source_ip: '192.0.2.15',
  trap_type: 'linkDown',
  trap_oid: '1.3.6.1.6.3.1.1.5.3',
  snmp_version: 2,
  varbinds_truncated: false,
  varbinds_original_count: 1,
  varbinds_truncation_reason: null,
  is_acknowledged: 0,
  acknowledged_by: null,
  acknowledged_by_name: null,
  acknowledged_at: null,
  received_at: '2026-08-17T14:20:00.000Z',
  // Deliberately emulate an outdated/over-broad response. The metadata UI
  // must ignore these sensitive properties even if they appear at runtime.
  community: 'PRIVATE-COMMUNITY',
  varbinds: [{ oid: '1.3.6.1.2.1.1.1.0', type: 4, value: 'LIST-SECRET' }],
};

const detailTrap = {
  ...metadataTrap,
  community: 'DETAIL-COMMUNITY',
  varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.8.4', type: 2, value: 'DETAIL-VALUE' }],
};

function apiResponse(body: unknown) {
  return Promise.resolve({ data: body });
}

function listResponse(data: unknown[] = [metadataTrap]) {
  return apiResponse({ data, meta: { total: data.length, page: 1, limit: 50 } });
}

function defaultGet(path: string) {
  if (path === '/snmp-traps/{id}') return apiResponse({ data: detailTrap });
  if (path === '/snmp-traps') return listResponse();
  return apiResponse({ data: {} });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SnmpTraps />
    </QueryClientProvider>,
  );
}

describe('SnmpTraps privacy and permissions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.auth.user = { role: 'readonly', permissions: ['devices.view'] };
    mocks.api.GET.mockImplementation(defaultGet);
    mocks.api.POST.mockResolvedValue({ data: {} });
    await i18n.changeLanguage('en');
  });

  it('renders safe metadata but never list payloads or community strings', async () => {
    renderPage();

    const row = (await screen.findByText('Core router')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('linkDown')).toBeInTheDocument();
    expect(within(row!).getByText('192.0.2.15')).toBeInTheDocument();
    expect(within(row!).getByText('1.3.6.1.6.3.1.1.5.3')).toBeInTheDocument();
    expect(within(row!).getByText('v2')).toBeInTheDocument();
    expect(screen.queryByText('PRIVATE-COMMUNITY')).not.toBeInTheDocument();
    expect(screen.queryByText('LIST-SECRET')).not.toBeInTheDocument();
    expect(screen.queryByText(/community/i)).not.toBeInTheDocument();
  });

  it('shows the restricted state and never requests raw detail without permission', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Raw details restricted')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'View details' }));

    expect(screen.getAllByText('Raw details restricted')).toHaveLength(2);
    expect(screen.getByText(/limited to authorized administrators/i)).toBeInTheDocument();
    expect(mocks.api.GET.mock.calls.some(([path]) => path === '/snmp-traps/{id}')).toBe(false);
  });

  it('lazy-loads raw varbinds only after an authorized user explicitly opens details', async () => {
    mocks.auth.user = {
      role: 'super_admin',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
    };
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Core router');
    expect(mocks.api.GET.mock.calls.some(([path]) => path === '/snmp-traps/{id}')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(await screen.findByText('DETAIL-VALUE')).toBeInTheDocument();
    expect(screen.getByText('1.3.6.1.2.1.2.2.1.8.4')).toBeInTheDocument();
    expect(mocks.api.GET.mock.calls.filter(([path]) => path === '/snmp-traps/{id}')).toHaveLength(1);
    expect(mocks.api.GET).toHaveBeenCalledWith('/snmp-traps/{id}', {
      params: { path: { id: 41 } },
    });
    expect(screen.queryByText('DETAIL-COMMUNITY')).not.toBeInTheDocument();
  });

  it('retries a failed detail request without collapsing the expanded row', async () => {
    mocks.auth.user = {
      role: 'super_admin',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
    };
    let detailAttempts = 0;
    mocks.api.GET.mockImplementation((path: string) => {
      if (path === '/snmp-traps/{id}') {
        detailAttempts += 1;
        return detailAttempts === 1
          ? Promise.resolve({ error: { error: 'forbidden' } })
          : apiResponse({ data: detailTrap });
      }
      return listResponse();
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByText(/Raw details could not be loaded/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('DETAIL-VALUE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(detailAttempts).toBe(2);
  });

  it('hides acknowledge and remove from users without mutation permissions', async () => {
    renderPage();
    await screen.findByText('Core router');

    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details' })).toBeInTheDocument();
  });

  it('does not offer raw detail to a custom persona even if the payload slug was delegated', async () => {
    mocks.auth.user = {
      role: 'custom',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'View details' }));
    expect(screen.getAllByText('Raw details restricted')).toHaveLength(2);
    expect(mocks.api.GET.mock.calls.some(([path]) => path === '/snmp-traps/{id}')).toBe(false);
  });

  it('honors the install-operator exception when both raw-detail permissions are present', async () => {
    mocks.auth.user = {
      role: 'readonly',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
      is_install_operator: true,
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByText('DETAIL-VALUE')).toBeInTheDocument();
  });

  it('shows and calls mutation actions only when their device permissions are present', async () => {
    mocks.auth.user = {
      role: 'custom',
      permissions: ['devices.view', 'devices.update', 'devices.delete'],
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(mocks.api.POST).toHaveBeenCalledWith(
      '/snmp-traps/{id}/acknowledge',
      { params: { path: { id: 41 } } },
    ));

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mocks.api.POST).not.toHaveBeenCalledWith(
      '/snmp-traps/{id}/clear',
      { params: { path: { id: 41 } } },
    );
    const confirmation = screen.getByRole('alertdialog', { name: 'Permanently remove this trap?' });
    expect(within(confirmation).getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: 'Permanently remove' }));
    await waitFor(() => expect(mocks.api.POST).toHaveBeenCalledWith(
      '/snmp-traps/{id}/clear',
      { params: { path: { id: 41 } } },
    ));
  });

  it('sends the selected metadata filters without fetching any detail', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Core router');

    await user.type(screen.getByLabelText('Device ID'), '12');
    await user.selectOptions(screen.getByLabelText('Trap type'), 'linkDown');

    await waitFor(() => {
      const queries = mocks.api.GET.mock.calls
        .filter(([path]) => path === '/snmp-traps')
        .map(([, options]) => options.params.query);
      expect(queries.some(query => query.device_id === 12 && query.trap_type === 'linkDown')).toBe(true);
    });
    expect(mocks.api.GET.mock.calls.some(([path]) => path === '/snmp-traps/{id}')).toBe(false);
  });

  it('converts browser-local date filters to RFC3339 UTC before querying', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Core router');

    await user.type(screen.getByLabelText('From'), '2026-08-17T08:15');
    const expected = new Date('2026-08-17T08:15').toISOString();
    await waitFor(() => {
      const queries = mocks.api.GET.mock.calls
        .filter(([path]) => path === '/snmp-traps')
        .map(([, options]) => options.params.query);
      expect(queries.some(query => query.from === expected)).toBe(true);
    });
  });

  it('makes shortened raw details explicit to the operator', async () => {
    mocks.auth.user = {
      role: 'super_admin',
      permissions: ['devices.view', 'snmp_traps.payload.view'],
    };
    const shortened = {
      ...detailTrap,
      varbinds_truncated: true,
      varbinds_original_count: 75,
      varbinds_truncation_reason: 'count_limit',
      varbinds: [{ ...detailTrap.varbinds[0], value: 'SHORT-VALUE', truncated: true }],
    };
    mocks.api.GET.mockImplementation((path: string) => {
      if (path === '/snmp-traps/{id}') return apiResponse({ data: shortened });
      return listResponse();
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByText('Raw details were shortened')).toBeInTheDocument();
    expect(screen.getByText(/kept 1 of 75 varbind entries/i)).toBeInTheDocument();
    expect(screen.getByText('(shortened)')).toBeInTheDocument();
  });

  it.each([
    { locale: 'es', restricted: 'Detalles sin procesar restringidos', clear: 'Limpiar filtros' },
    { locale: 'pt-BR', restricted: 'Detalhes brutos restritos', clear: 'Limpar filtros' },
  ])('localizes the privacy state and controls in $locale', async ({ locale, restricted, clear }) => {
    await i18n.changeLanguage(locale);
    renderPage();

    expect(await screen.findByText(restricted)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: clear })).toBeInTheDocument();
  });
});
