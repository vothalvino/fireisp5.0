import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { TrapForwardingRuleList } from '../TrapForwardingRuleList';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();
const authState = vi.hoisted(() => ({
  user: { role: 'admin', permissions: ['*'] } as { role: string; permissions: string[] },
}));

vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    DELETE: (...args: unknown[]) => mockApiDelete(...args),
  },
  tokenStore: {
    getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null,
    setRefresh: vi.fn(), clear: vi.fn(),
  },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const emailRule = {
  id: 1,
  name: 'All traps to NOC',
  match_trap_type: null,
  match_source_ip: null,
  match_oid_prefix: null,
  target_type: 'email',
  target_display: 'n***@example.com',
  target_display_code: 'email_recipient',
  target_needs_attention: false,
  is_active: 1,
  last_delivery_status: 'success',
  last_delivery_at: '2026-08-17T10:00:00.000Z',
  last_delivery_is_test: 1,
};

const webhookRule = {
  id: 2,
  name: 'Core link events',
  match_trap_type: 'linkDown',
  match_source_ip: '192.0.2.10',
  match_oid_prefix: '1.3.6.1.6.3.1.1.5',
  target_type: 'webhook',
  target_display: 'NOC automation',
  target_display_code: 'registered_webhook',
  target_needs_attention: false,
  is_active: 0,
  last_delivery_status: null,
  last_delivery_at: null,
};

const invalidLegacyRule = {
  id: 3,
  name: 'Old incomplete rule',
  match_trap_type: 'warmStart',
  match_source_ip: null,
  match_oid_prefix: null,
  target_type: null,
  target_display: null,
  target_display_code: 'review_destination',
  target_needs_attention: true,
  is_active: 1,
  last_delivery_status: null,
  last_delivery_at: null,
};

const webhookOptions = [{ id: 7, label: 'NOC automation', url: 'https://hooks.example.com/noc' }];
const readinessReady = { data: { ready: true, status: 'ready', reason: null, ingest: null } };

const configurations: Record<number, Record<string, unknown>> = {
  1: { forward_to_url: null, forward_to_email: 'noc@example.com', forward_to_webhook_id: null },
  2: { forward_to_url: null, forward_to_email: null, forward_to_webhook_id: 7 },
  3: { forward_to_url: null, forward_to_email: null, forward_to_webhook_id: null },
};

function rulesResponse(data: Array<Record<string, unknown>> = [emailRule, webhookRule, invalidLegacyRule]) {
  return { data: { data, meta: { total: data.length, page: 1, limit: 25, totalPages: 1 } }, error: undefined };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrapForwardingRuleList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TrapForwardingRuleList', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    authState.user = { role: 'admin', permissions: ['*'] };
    await i18n.changeLanguage('en');
    mockApiGet.mockImplementation((path: string, options?: { params?: { path?: { id?: number } } }) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({ data: readinessReady, error: undefined });
      }
      if (path === '/trap-forwarding-rules/destinations') {
        return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
      }
      if (path === '/trap-forwarding-rules/{id}/configuration') {
        const id = Number(options?.params?.path?.id);
        return Promise.resolve({ data: { data: configurations[id] }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockApiPost.mockResolvedValue({ data: { data: { id: 10 } }, error: undefined });
    mockApiPut.mockResolvedValue({ data: { data: { id: 1 } }, error: undefined });
    mockApiDelete.mockResolvedValue({ data: {}, error: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('explains traps, examples, and the receiver setup without implying polling creates traps', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'What is an SNMP trap?' })).toBeInTheDocument();
    expect(screen.getByText(/a link goes down, a device restarts/i)).toBeInTheDocument();
    expect(screen.getByText(/SNMP polling does not create these traps/i)).toBeInTheDocument();
    expect(screen.getByText(/default listener is UDP port 1620/i)).toBeInTheDocument();
    expect(screen.getByText(/only route traps FireISP actually receives/i)).toBeInTheDocument();
  });

  it('explains the isolated-storage safety pause and disables sending while rules remain editable', async () => {
    mockApiGet.mockImplementation((path: string, options?: { params?: { path?: { id?: number } } }) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({
          data: { data: { ready: false, status: 'unavailable', reason: 'isolated_tenant_attribution_unsupported', ingest: null } },
          error: undefined,
        });
      }
      if (path === '/trap-forwarding-rules/{id}/configuration') {
        return Promise.resolve({ data: { data: configurations[Number(options?.params?.path?.id)] }, error: undefined });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Trap forwarding is unavailable')).toBeInTheDocument();
    expect(screen.getByText(/organization with separated data storage/i)).toBeInTheDocument();
    expect(screen.getByText(/create and edit rules for later/i)).toBeInTheDocument();
    const row = screen.getByText('All traps to NOC').closest('tr');
    expect(within(row!).getByText('Sending paused')).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Send test' })).toBeDisabled();
    expect(within(row!).getByRole('button', { name: 'Edit' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Add forwarding rule/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add forwarding rule' });
    expect(within(dialog).getByLabelText('Enable this rule')).toBeDisabled();
    expect(within(dialog).getByLabelText('Enable this rule')).not.toBeChecked();
    expect(within(dialog).getByText(/save this rule for later/i)).toBeInTheDocument();
  });

  it('fails sending closed when forwarding readiness cannot be verified', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({ data: undefined, error: { status: 503 } });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not verify that trap forwarding is safe/i);
    const row = screen.getByText('All traps to NOC').closest('tr');
    expect(within(row!).getByRole('button', { name: 'Send test' })).toBeDisabled();
  });

  it.each([
    { locale: 'es', title: 'El reenvío de traps no está disponible' },
    { locale: 'pt-BR', title: 'O encaminhamento de traps está indisponível' },
  ])('localizes the readiness safety notice in $locale', async ({ locale, title }) => {
    await i18n.changeLanguage(locale);
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({
          data: { data: { ready: false, status: 'unavailable', reason: 'listener_not_ready', ingest: null } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();

    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('shows tenant quota usage and explains dropped or reduced outcomes', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({ data: { data: {
          ready: true, status: 'ready', reason: null,
          ingest: {
            usage_date: '2026-08-17', trap_count: 40, trap_limit: 10000,
            varbind_bytes: 2048, varbind_byte_limit: 16777216,
            delivery_count: 70, delivery_limit: 10000,
            metadata_only_count: 2, dropped_trap_count: 3, forwarding_skipped_count: 4,
          },
        } }, error: undefined });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();

    expect(await screen.findByText("Today's SNMP safety limits")).toBeInTheDocument();
    expect(screen.getByText(/Traps 40 \/ 10000/)).toBeInTheDocument();
    expect(screen.getByText(/2 trap\(s\) were stored without raw details/)).toBeInTheDocument();
    expect(screen.getByText(/3 trap\(s\) were not stored/)).toBeInTheDocument();
    expect(screen.getByText(/Forwarding was skipped for 4/)).toBeInTheDocument();
  });

  it.each([
    ['source_attribution_unavailable', /cannot safely confirm which organization owns/i],
    ['feature_disabled', /SNMP trap receiving is disabled/i],
    ['multi_organization_attribution_unsupported', /contains more than one organization/i],
    ['invalid_port', /listener port is invalid/i],
    ['invalid_bind_ip', /listener address is invalid/i],
    ['bind_failed', /could not open the configured trap listener/i],
  ])('renders the %s readiness reason without an untranslated key', async (reason, expected) => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') {
        return Promise.resolve({ data: { data: { ready: false, status: 'unavailable', reason, ingest: null } }, error: undefined });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(String(reason)))).not.toBeInTheDocument();
  });

  it('shows readable match, destination, status, and test-delivery summaries', async () => {
    renderPage();
    const allRow = (await screen.findByText('All traps to NOC')).closest('tr');
    expect(allRow).not.toBeNull();
    expect(within(allRow!).getByText('All SNMP traps FireISP receives')).toBeInTheDocument();
    expect(within(allRow!).getByText('Configured email recipient')).toBeInTheDocument();
    expect(allRow).not.toHaveTextContent('noc@example.com');
    expect(within(allRow!).getByText('Enabled')).toBeInTheDocument();
    expect(within(allRow!).getByText('Delivered').parentElement).toHaveTextContent('Test: Delivered');

    const filteredRow = screen.getByText('Core link events').closest('tr');
    expect(within(filteredRow!).getByText('Type is linkDown')).toBeInTheDocument();
    expect(within(filteredRow!).getByText('Source IP is 192.0.2.10')).toBeInTheDocument();
    expect(within(filteredRow!).getByText('OID starts with 1.3.6.1.6.3.1.1.5')).toBeInTheDocument();
    expect(within(filteredRow!).getByText('All conditions above must match (AND)')).toBeInTheDocument();
    expect(within(filteredRow!).getByText('Configured registered webhook')).toBeInTheDocument();
    expect(within(filteredRow!).getByText('Disabled')).toBeInTheDocument();
  });

  it('never renders HTTPS path, query, fragment, or token details in the list', async () => {
    const secretUrl = 'https://alerts.example.com/hooks/private-token?api_key=very-secret#internal';
    const urlRule = {
      ...emailRule,
      id: 8,
      name: 'Secure endpoint rule',
      target_type: 'url',
      target_display: 'https://alerts.example.com',
      target_display_code: 'direct_https_url',
      last_delivery_is_test: 0,
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse([urlRule]));
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      if (path === '/trap-forwarding-rules/{id}/configuration') {
        return Promise.resolve({ data: { data: { forward_to_url: secretUrl, forward_to_email: null, forward_to_webhook_id: null } }, error: undefined });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('Secure endpoint rule')).closest('tr');
    expect(within(row!).getByText('Configured HTTPS endpoint')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('alerts.example.com');
    expect(row).not.toHaveTextContent('private-token');
    expect(row).not.toHaveTextContent('very-secret');

    await user.click(within(row!).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit forwarding rule' })).toBeInTheDocument();
    expect(screen.getByLabelText('HTTPS URL')).toHaveValue(secretUrl);
  });

  it('fails legacy rows with no destination closed and points the operator to Edit', async () => {
    renderPage();
    const row = (await screen.findByText('Old incomplete rule')).closest('tr');
    expect(within(row!).getByText('No destination — edit this rule')).toBeInTheDocument();
    expect(within(row!).getByText('Needs attention')).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Send test' })).toBeDisabled();
    expect(within(row!).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('provides a useful empty state with a direct creation action', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse([]));
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No forwarding rules yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your first rule' })).toBeInTheDocument();
  });

  it('shows status to a view-only user without exposing any mutating controls', async () => {
    authState.user = { role: 'technician', permissions: ['trap_forwarding.view'] };
    renderPage();
    expect(await screen.findByText('All traps to NOC')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add forwarding rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(mockApiGet).not.toHaveBeenCalledWith('/trap-forwarding-rules/{id}/configuration', expect.anything());
    expect(mockApiGet).not.toHaveBeenCalledWith('/trap-forwarding-rules/destinations', expect.anything());
  });

  it('requires one destination and gives actionable wildcard, IP, OID, URL, and email errors', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Add forwarding rule/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add forwarding rule' });
    await user.type(within(dialog).getByLabelText(/Rule name/), 'Router alerts');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    expect(within(dialog).getByText(/Choose one destination/)).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Trap type (optional)'), '*');
    await user.type(within(dialog).getByLabelText('Source IP (optional)'), '2001:db8::1');
    await user.type(within(dialog).getByLabelText('OID prefix (optional)'), '.1.3.6');
    await user.click(within(dialog).getByRole('radio', { name: /Send to an HTTPS endpoint/ }));
    await user.type(within(dialog).getByLabelText('HTTPS URL'), 'http://alerts.example.com/traps');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    expect(within(dialog).getByText(/Leave this field blank/)).toBeInTheDocument();
    expect(within(dialog).getByText(/complete IPv4 address/)).toBeInTheDocument();
    expect(within(dialog).getByText(/numeric OID without a leading dot/)).toBeInTheDocument();
    expect(within(dialog).getByText(/complete public HTTPS URL/)).toBeInTheDocument();
  });

  it('creates an HTTPS rule with trimmed values and explicit nulls for unused fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Add forwarding rule/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add forwarding rule' });
    await user.type(within(dialog).getByLabelText(/Rule name/), '  Link down alerts  ');
    await user.type(within(dialog).getByLabelText('Trap type (optional)'), '  linkDown  ');
    await user.click(within(dialog).getByRole('radio', { name: /Send to an HTTPS endpoint/ }));
    await user.type(within(dialog).getByLabelText('HTTPS URL'), 'https://alerts.example.com/traps');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));
    expect(mockApiPost).toHaveBeenCalledWith('/trap-forwarding-rules', {
      body: {
        name: 'Link down alerts',
        match_trap_type: 'linkDown',
        match_source_ip: null,
        match_oid_prefix: null,
        forward_to_url: 'https://alerts.example.com/traps',
        forward_to_email: null,
        forward_to_webhook_id: null,
        is_active: true,
      },
    });
  });

  it('updates a rule with exactly one new destination and clears the stale target', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('All traps to NOC')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit forwarding rule' });
    expect(within(dialog).getByRole('radio', { name: /Email a recipient/ })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /Use a registered webhook/ }));
    await user.selectOptions(within(dialog).getByLabelText('Registered webhook'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1));
    const [, options] = mockApiPut.mock.calls[0];
    expect(options.body).toMatchObject({
      forward_to_email: null,
      forward_to_url: null,
      forward_to_webhook_id: 7,
    });
  });

  it('fetches editable configuration only on demand and preserves an unchanged target', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('All traps to NOC')).closest('tr');
    expect(mockApiGet).not.toHaveBeenCalledWith('/trap-forwarding-rules/{id}/configuration', expect.anything());
    await user.click(within(row!).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit forwarding rule' });
    expect(mockApiGet).toHaveBeenCalledWith('/trap-forwarding-rules/{id}/configuration', {
      params: { path: { id: 1 } },
    });
    await user.clear(within(dialog).getByLabelText(/Rule name/));
    await user.type(within(dialog).getByLabelText(/Rule name/), 'Renamed NOC rule');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1));
    const [, options] = mockApiPut.mock.calls[0];
    expect(options.body).not.toHaveProperty('forward_to_url');
    expect(options.body).not.toHaveProperty('forward_to_email');
    expect(options.body).not.toHaveProperty('forward_to_webhook_id');
  });

  it('fails an edit closed when the private configuration cannot be loaded', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      if (path === '/trap-forwarding-rules/{id}/configuration') {
        return Promise.resolve({ data: undefined, error: { status: 403 } });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('All traps to NOC')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded.*Nothing was changed/i);
    expect(screen.queryByRole('dialog', { name: 'Edit forwarding rule' })).not.toBeInTheDocument();
  });

  it('keeps direct destinations usable if registered webhook choices cannot load', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse());
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      if (path === '/trap-forwarding-rules/destinations') return Promise.resolve({ data: undefined, error: { status: 403 } });
      return Promise.resolve({ data: {}, error: undefined });
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Add forwarding rule/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add forwarding rule' });
    expect(within(dialog).getByRole('radio', { name: /Use a registered webhook/ })).toBeDisabled();
    expect(within(dialog).getByText(/You can still choose email or an HTTPS endpoint/)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Email a recipient/ })).toBeEnabled();
  });

  it('fails a stale registered webhook closed and forces a safe new choice when editing', async () => {
    const staleWebhookRule = {
      ...webhookRule,
      id: 9,
      name: 'Stale webhook rule',
      target_display: 'Unavailable registered webhook',
      target_needs_attention: true,
      is_active: 1,
    };
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') return Promise.resolve(rulesResponse([staleWebhookRule]));
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      if (path === '/trap-forwarding-rules/{id}/configuration') {
        return Promise.resolve({ data: { data: { forward_to_url: null, forward_to_email: null, forward_to_webhook_id: 99 } }, error: undefined });
      }
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('Stale webhook rule')).closest('tr');
    await waitFor(() => expect(within(row!).getByText('Needs attention')).toBeInTheDocument());
    expect(within(row!).getByRole('button', { name: 'Send test' })).toBeDisabled();
    await user.click(within(row!).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit forwarding rule' });
    expect(await within(dialog).findByText(/previous webhook is no longer an active choice/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Use a registered webhook/ })).not.toBeChecked();
  });

  it('confirms that Send test contacts the destination without creating an SNMP trap', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText('All traps to NOC')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: 'Send test' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Send a test delivery?' });
    expect(within(dialog).getByText(/contacts the configured destination/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not create an SNMP trap/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/trap-forwarding-rules/{id}/test', {
      params: { path: { id: 1 } },
    }));
  });

  it('refreshes in-flight delivery status until the delivery becomes terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listCalls = 0;
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') {
        listCalls += 1;
        const status = listCalls === 1 ? 'pending' : listCalls === 2 ? 'processing' : 'success';
        return Promise.resolve(rulesResponse([{
          ...emailRule,
          last_delivery_status: status,
          last_delivery_is_test: 1,
          last_delivery_at: '2026-08-17T10:00:00.000Z',
        }]));
      }
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();

    expect(await screen.findByText('Waiting to send')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(await screen.findByText('Sending')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(await screen.findByText('Delivered')).toBeInTheDocument();

    const terminalCalls = listCalls;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listCalls).toBe(terminalCalls);
  });

  it('caps automatic status requests and lets the operator restart checks manually', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listCalls = 0;
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/trap-forwarding-rules') {
        listCalls += 1;
        return Promise.resolve(rulesResponse([{
          ...emailRule,
          last_delivery_status: 'retrying',
          last_delivery_is_test: 1,
        }]));
      }
      if (path === '/trap-forwarding-rules/readiness') return Promise.resolve({ data: readinessReady, error: undefined });
      return Promise.resolve({ data: { data: webhookOptions }, error: undefined });
    });
    renderPage();
    expect(await screen.findByText('Retrying')).toBeInTheDocument();

    for (let attempt = 0; attempt < 18; attempt += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    }
    expect(listCalls).toBe(16); // Initial load plus the bounded 15 refreshes.

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listCalls).toBe(16);

    await act(async () => { screen.getByRole('button', { name: 'Refresh status' }).click(); });
    await waitFor(() => expect(listCalls).toBe(17));
  });
});
