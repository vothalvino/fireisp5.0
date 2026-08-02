// =============================================================================
// FireISP 5.0 — AIAssistantSettings page tests (P1 §6.4)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AIAssistantSettings } from '../AIAssistantSettings';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/api/client', () => ({
  api: { GET: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  authedFetch: vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultPolicy = {
  id: 1,
  enabled: true,
  mode: 'draft_only',
  active_provider_id: null,
  enabled_channels: { portal: true, email: true, whatsapp: false, sms: false },
  auto_send_confidence: 0.9,
  default_locale: 'en',
  tone: 'formal',
  redact_pii_before_llm: true,
  updated_at: '2025-01-01T00:00:00Z',
};

const provider1 = {
  id: 1, name: 'OpenAI Main', kind: 'openai', model: 'gpt-4o',
  endpoint_url: null, extra_config: null, priority: 10,
  enabled: true, status: 'verified', created_at: '2025-01-01',
};

const phrase1 = {
  id: 1, category: 'greeting', locale: 'en',
  text: 'Hello {{client_name}}, how can I help?',
  created_at: '2025-01-01',
};

const term1 = {
  id: 1, term: 'cancel', locale: 'en', created_at: '2025-01-01',
};

/**
 * Mirror of the backend PROVIDER_CATALOG (GET /ai/providers/catalog) — the
 * form's kind dropdown, per-kind fields and recommended models all come from
 * this since j62.
 */
const providerCatalog = [
  { kind: 'openai', label: 'OpenAI', requiresApiKey: true, requiresEndpoint: false, models: ['gpt-4o', 'gpt-4o-mini'] },
  { kind: 'azure_openai', label: 'Azure OpenAI', requiresApiKey: true, requiresEndpoint: true, requiresDeployment: true, models: ['gpt-4o'] },
  { kind: 'anthropic', label: 'Anthropic', requiresApiKey: true, requiresEndpoint: false, models: ['claude-3-5-sonnet-20241022'] },
  { kind: 'gemini', label: 'Google Gemini', requiresApiKey: true, requiresEndpoint: false, models: ['gemini-1.5-pro'] },
  { kind: 'ollama', label: 'Ollama (local)', requiresApiKey: false, requiresEndpoint: true, models: ['llama3.1:8b'] },
  { kind: 'openrouter', label: 'OpenRouter', requiresApiKey: true, requiresEndpoint: false, models: [], dynamicModels: true },
  { kind: 'custom', label: 'Custom (OpenAI-compatible)', requiresApiKey: false, requiresEndpoint: true, optionalApiKey: true, models: [] },
];

const openRouterModels = [
  {
    id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5',
    context_length: 200000, prompt_price: 0.000003, completion_price: 0.000015, free: false,
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Meta: Llama 3.1 8B Instruct (free)',
    context_length: 131072, prompt_price: 0, completion_price: 0, free: true,
  },
  {
    id: 'somevendor/mystery-model', name: 'SomeVendor: Mystery Model',
    context_length: null, prompt_price: null, completion_price: null, free: false,
  },
];

const metrics = {
  drafts_total: 42, auto_sent: 7, sent_or_edited: 30, discarded: 5,
  edit_rate: 0.71, auto_send_rate: 0.17, cost_usd_total: 0.0234,
  avg_duration_ms: 1200, date_from: '2025-01-01', date_to: null,
};

const logEntry = {
  id: 1, ticket_id: 100, action: 'sent',
  confidence: 91, provider_id: 1, cost_usd: 0.0012,
  channel: 'email', created_at: '2025-01-15T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
  } as Response;
}

/** Payload for GET /ai/providers/models — overridden per-test, reset in beforeEach. */
const DEFAULT_MODELS_PAYLOAD = {
  data: {
    kind: 'openrouter',
    models: openRouterModels,
    cached_at: '2025-01-01T00:00:00Z',
    stale: false,
    error: null,
  },
};
let modelsPayload: unknown = DEFAULT_MODELS_PAYLOAD;

function setup() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = typeof url === 'string' ? url.replace(/\?.*/, '') : '';

    // Must be matched before /ai/providers — literal path, same prefix.
    if (path.endsWith('/ai/providers/models') && method === 'GET')
      return Promise.resolve(makeJsonResponse(modelsPayload));
    if (path.endsWith('/ai/providers/catalog') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: providerCatalog }));
    if (path.endsWith('/ai/policy') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: defaultPolicy }));
    if (path.endsWith('/ai/policy') && method === 'PUT')
      return Promise.resolve(makeJsonResponse({ data: { ...defaultPolicy } }));
    if (path.match(/\/ai\/providers\/\d+\/verify/) && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ok: true, model: 'gpt-4o', latency_ms: 42 } }));
    if (path.endsWith('/ai/providers') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [provider1] }));
    if (path.endsWith('/ai/providers') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...provider1, id: 2 } }));
    if (path.match(/\/ai\/providers\/\d+/) && method === 'PUT')
      return Promise.resolve(makeJsonResponse({ data: provider1 }));
    if (path.match(/\/ai\/providers\/\d+/) && method === 'DELETE')
      return Promise.resolve(makeJsonResponse({}, true));
    if (path.endsWith('/ai/phrases') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [phrase1] }));
    if (path.endsWith('/ai/phrases') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...phrase1, id: 2 } }));
    if (path.match(/\/ai\/phrases\/\d+/) && method === 'DELETE')
      return Promise.resolve(makeJsonResponse({}, true));
    if (path.endsWith('/ai/forbidden-terms') && method === 'GET')
      return Promise.resolve(makeJsonResponse({ data: [term1] }));
    if (path.endsWith('/ai/forbidden-terms') && method === 'POST')
      return Promise.resolve(makeJsonResponse({ data: { ...term1, id: 2 } }));
    if (path.match(/\/ai\/forbidden-terms\/\d+/) && method === 'DELETE')
      return Promise.resolve(makeJsonResponse({}, true));
    if (path.endsWith('/ai/metrics'))
      return Promise.resolve(makeJsonResponse({ data: metrics }));
    if (path.endsWith('/ai/logs'))
      return Promise.resolve(makeJsonResponse({ data: [logEntry], meta: { total: 1 } }));
    return Promise.resolve(makeJsonResponse({ data: [] }));
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AIAssistantSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIAssistantSettings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelsPayload = DEFAULT_MODELS_PAYLOAD;
  });

  it('renders the page heading', () => {
    setup();
    expect(screen.getByText(/AI Assistant Settings/i)).toBeInTheDocument();
  });

  it('renders all 5 tabs', () => {
    setup();
    expect(screen.getByText(/General/i)).toBeInTheDocument();
    expect(screen.getByText(/Providers/i)).toBeInTheDocument();
    expect(screen.getByText(/Phrase Library/i)).toBeInTheDocument();
    expect(screen.getByText(/Forbidden Terms/i)).toBeInTheDocument();
    expect(screen.getByText(/Audit/i)).toBeInTheDocument();
  });

  // ---- General tab --------------------------------------------------------

  describe('General tab', () => {
    it('shows master toggle after policy loads', async () => {
      setup();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: /AI Reply Assistant enabled/i })).toBeInTheDocument(),
      );
    });

    it('disabling the master switch sends enabled:false', async () => {
      setup();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: /AI Reply Assistant enabled/i })).toBeChecked(),
      );

      const toggle = screen.getByRole('switch', { name: /AI Reply Assistant enabled/i });
      fireEvent.click(toggle);

      const saveBtn = screen.getByRole('button', { name: /Save Settings/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        const calls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
          ([url, init]) =>
            url.endsWith('/ai/policy') && (init?.method ?? '').toUpperCase() === 'PUT',
        );
        expect(calls.length).toBeGreaterThan(0);
        const body = JSON.parse(calls[0][1].body as string);
        expect(body.enabled).toBe(false);
      });
    });

    it('shows save confirmation after successful save', async () => {
      setup();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Save Settings/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Save Settings/i }));
      await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument());
    });

    it('shows per-channel toggles', async () => {
      setup();
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /Enable email channel/i })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: /Enable whatsapp channel/i })).toBeInTheDocument();
      });
    });

    it('renders mode radio buttons', async () => {
      setup();
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: /Mode: draft only/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Mode: suggest/i })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Mode: auto send/i })).toBeInTheDocument();
      });
    });
  });

  // ---- Providers tab -------------------------------------------------------

  describe('Providers tab', () => {
    function goToProviders() {
      setup();
      fireEvent.click(screen.getByText(/🔌 Providers/i));
    }

    it('lists providers after navigation', async () => {
      goToProviders();
      await waitFor(() => expect(screen.getByText('OpenAI Main')).toBeInTheDocument());
    });

    it('shows provider kind badge by its label, not the raw slug', async () => {
      goToProviders();
      // The badge now reads "OpenAI", not "openai". getByText is exact, so it
      // will not collide with the provider's name "OpenAI Main".
      await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument());
      expect(screen.queryByText('openai')).not.toBeInTheDocument();
    });

    it('clicking Test button calls verify endpoint and shows success', async () => {
      goToProviders();
      await waitFor(() => expect(screen.getByText('OpenAI Main')).toBeInTheDocument());

      const testBtn = screen.getByRole('button', { name: /Test connection for OpenAI Main/i });
      fireEvent.click(testBtn);

      await waitFor(() => expect(screen.getByText(/Connection OK/i)).toBeInTheDocument());

      const verifyCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) =>
          url.includes('/ai/providers/1/verify') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(verifyCalls.length).toBe(1);
    });

    it('verify failure shows error message', async () => {
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/ai/providers/1/verify') && method === 'POST')
          return Promise.resolve(makeJsonResponse({ error: 'Invalid API key' }, false));
        if (url.includes('/ai/providers') && method === 'GET')
          return Promise.resolve(makeJsonResponse({ data: [provider1] }));
        if (url.endsWith('/ai/policy'))
          return Promise.resolve(makeJsonResponse({ data: defaultPolicy }));
        return Promise.resolve(makeJsonResponse({ data: [] }));
      });

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <AIAssistantSettings />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.click(screen.getByText(/🔌 Providers/i));
      await waitFor(() => expect(screen.getByText('OpenAI Main')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Test connection for OpenAI Main/i }));
      await waitFor(() => expect(screen.getByText(/Invalid API key/i)).toBeInTheDocument());
    });

    it('selecting a provider radio calls PUT /ai/policy with active_provider_id', async () => {
      goToProviders();
      await waitFor(() => expect(screen.getByText('OpenAI Main')).toBeInTheDocument());

      const radio = screen.getByRole('radio', { name: /Set OpenAI Main as active provider/i });
      fireEvent.click(radio);

      await waitFor(() => {
        const calls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(
          ([url, init]) =>
            url.endsWith('/ai/policy') && (init?.method ?? '').toUpperCase() === 'PUT',
        );
        expect(calls.length).toBeGreaterThan(0);
        const body = JSON.parse(calls[0][1].body as string);
        expect(body.active_provider_id).toBe(1);
      });
    });

    it('shows Add Provider modal when button clicked', async () => {
      goToProviders();
      await waitFor(() => expect(screen.getByText(/\+ Add Provider/i)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/\+ Add Provider/i));
      expect(screen.getByRole('dialog', { name: /Add Provider/i })).toBeInTheDocument();
    });
  });

  // ---- OpenRouter live model picker ----------------------------------------

  describe('OpenRouter model picker', () => {
    async function openAddProviderModal() {
      const rendered = setup();
      fireEvent.click(screen.getByText(/🔌 Providers/i));
      await waitFor(() => expect(screen.getByText(/\+ Add Provider/i)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/\+ Add Provider/i));
      await waitFor(() => expect(screen.getByRole('dialog', { name: /Add Provider/i })).toBeInTheDocument());
      return rendered;
    }

    function modelCalls() {
      return (mockFetch.mock.calls as Array<[string, RequestInit?]>).filter(
        ([url]) => typeof url === 'string' && url.includes('/ai/providers/models'),
      );
    }

    function selectKind(kind: string) {
      fireEvent.change(screen.getByLabelText(/Provider kind/i), { target: { value: kind } });
    }

    it('offers openrouter as a provider kind', async () => {
      await openAddProviderModal();
      const kindSelect = screen.getByLabelText(/Provider kind/i) as HTMLSelectElement;
      // The kind list comes from GET /providers/catalog (j62) — wait for it.
      await waitFor(() =>
        expect([...kindSelect.options].map(o => o.value)).toContain('openrouter'),
      );
    });

    it('shows the OpenRouter option by its brand name, not the raw slug', async () => {
      // The dropdown rendered raw slugs, so the option read "openrouter"
      // (lowercase, sixth) and a user looking for "OpenRouter" could not find
      // it. The value stays the slug; only the visible text is the label.
      await openAddProviderModal();
      const kindSelect = screen.getByLabelText(/Provider kind/i) as HTMLSelectElement;
      await waitFor(() => {
        const opt = [...kindSelect.options].find(o => o.value === 'openrouter');
        expect(opt?.textContent).toBe('OpenRouter');
      });
    });

    it('does not fetch the live model list for other kinds', async () => {
      await openAddProviderModal();
      // Default kind is openai — its model field is free text backed by the
      // catalog's RECOMMENDED models datalist (static list, no fetch), never
      // the live OpenRouter picker.
      const input = screen.getByLabelText(/^Model/i);
      expect(input).not.toHaveAttribute('list', 'ai-provider-model-options');
      await waitFor(() => expect(screen.getByLabelText(/API key/i)).toBeInTheDocument());
      expect(modelCalls()).toHaveLength(0);
    });

    it('static kinds offer the catalog recommended models as a datalist', async () => {
      const { container } = await openAddProviderModal();
      const input = await screen.findByLabelText(/^Model/i);
      await waitFor(() =>
        expect(input).toHaveAttribute('list', 'ai-provider-recommended-models'),
      );
      const options = [...container.querySelectorAll('datalist#ai-provider-recommended-models option')];
      expect(options.map(o => o.getAttribute('value'))).toEqual(['gpt-4o', 'gpt-4o-mini']);
    });

    it('the per-kind fields come from the catalog (azure shows deployment, ollama hides the key)', async () => {
      await openAddProviderModal();
      const kindSelect = screen.getByLabelText(/Provider kind/i) as HTMLSelectElement;
      await waitFor(() =>
        expect([...kindSelect.options].map(o => o.value)).toContain('azure_openai'),
      );

      selectKind('azure_openai');
      await waitFor(() => {
        expect(screen.getByLabelText(/Deployment/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Endpoint/i)).toBeInTheDocument();
      });

      selectKind('ollama');
      await waitFor(() => {
        expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Deployment/i)).not.toBeInTheDocument();
        expect(screen.getByLabelText(/Endpoint/i)).toBeInTheDocument();
      });

      // custom: key is OPTIONAL (optionalApiKey) — the field must still show.
      selectKind('custom');
      await waitFor(() => {
        expect(screen.getByLabelText(/API key/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Endpoint/i)).toBeInTheDocument();
      });
    });

    it('selecting openrouter loads the list and shows a datalist-backed picker', async () => {
      const { container } = await openAddProviderModal();
      selectKind('openrouter');

      await waitFor(() => expect(modelCalls()).toHaveLength(1));

      const input = await screen.findByLabelText('Model');
      expect(input).toHaveAttribute('list', 'ai-provider-model-options');

      const options = [...container.querySelectorAll('datalist#ai-provider-model-options option')];
      expect(options.map(o => o.getAttribute('value'))).toEqual([
        'anthropic/claude-sonnet-4.5',
        'meta-llama/llama-3.1-8b-instruct:free',
        'somevendor/mystery-model',
      ]);

      // Prices are per token upstream; the picker quotes them per 1M tokens.
      expect(options[0].getAttribute('label')).toContain('$3.00/M in');
      expect(options[0].getAttribute('label')).toContain('$15.00/M out');
      expect(options[0].getAttribute('label')).toContain('200K ctx');
      // free === true is labelled Free …
      expect(options[1].getAttribute('label')).toContain('Free');
      // … while unknown prices show nothing at all, never "$0".
      expect(options[2].getAttribute('label')).not.toContain('$');
      expect(options[2].getAttribute('label')).not.toContain('Free');
    });

    it('does not refetch when the kind is switched away and back', async () => {
      await openAddProviderModal();
      selectKind('openrouter');
      await waitFor(() => expect(modelCalls()).toHaveLength(1));

      selectKind('openai');
      // Back on a static kind: the field is the recommended-models datalist,
      // not the live picker.
      await waitFor(() =>
        expect(screen.getByLabelText(/^Model/i)).toHaveAttribute('list', 'ai-provider-recommended-models'),
      );

      selectKind('openrouter');
      await waitFor(() => expect(screen.getByLabelText('Model')).toHaveAttribute('list'));
      expect(modelCalls()).toHaveLength(1);
    });

    it('Refresh refetches with force=1', async () => {
      await openAddProviderModal();
      selectKind('openrouter');
      await waitFor(() => expect(modelCalls()).toHaveLength(1));

      fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
      await waitFor(() => expect(modelCalls()).toHaveLength(2));
      expect(modelCalls()[1][0]).toContain('force=1');
    });

    it('flags a stale list but still uses it', async () => {
      modelsPayload = { data: { ...DEFAULT_MODELS_PAYLOAD.data, stale: true } };
      const { container } = await openAddProviderModal();
      selectKind('openrouter');

      await waitFor(() => expect(screen.getByText(/may be out of date/i)).toBeInTheDocument());
      expect(container.querySelectorAll('datalist#ai-provider-model-options option')).toHaveLength(3);
    });

    it('an upstream error falls back to a free-text model field', async () => {
      modelsPayload = {
        data: {
          kind: 'openrouter', models: [], cached_at: null, stale: false,
          error: 'OpenRouter unreachable (502)',
        },
      };
      const { container } = await openAddProviderModal();
      selectKind('openrouter');

      await waitFor(() => expect(screen.getByText(/OpenRouter unreachable \(502\)/)).toBeInTheDocument());

      const input = screen.getByLabelText('Model') as HTMLInputElement;
      expect(input).not.toHaveAttribute('list');
      expect(container.querySelector('datalist')).toBeNull();

      // The provider must still be configurable by typing the id.
      fireEvent.change(input, { target: { value: 'anthropic/claude-sonnet-4.5' } });
      expect(input.value).toBe('anthropic/claude-sonnet-4.5');
    });

    it('a thrown fetch error also falls back to free text', async () => {
      const rendered = setup();
      const realImpl = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/ai/providers/models'))
          return Promise.resolve(makeJsonResponse({ error: 'Boom' }, false));
        return realImpl(url, init);
      });

      fireEvent.click(screen.getByText(/🔌 Providers/i));
      await waitFor(() => expect(screen.getByText(/\+ Add Provider/i)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/\+ Add Provider/i));
      selectKind('openrouter');

      await waitFor(() => expect(screen.getByText(/Boom/)).toBeInTheDocument());
      expect(screen.getByLabelText('Model')).not.toHaveAttribute('list');
      expect(rendered.container.querySelector('datalist')).toBeNull();
    });
  });

  // ---- Phrase Library tab --------------------------------------------------

  describe('Phrase Library tab', () => {
    it('renders phrases grouped by category', async () => {
      setup();
      fireEvent.click(screen.getByText(/💬 Phrase Library/i));
      await waitFor(() =>
        expect(screen.getByText('Hello {{client_name}}, how can I help?')).toBeInTheDocument(),
      );
      expect(screen.getByText('greeting')).toBeInTheDocument();
    });

    it('locale switcher is visible', async () => {
      setup();
      fireEvent.click(screen.getByText(/💬 Phrase Library/i));
      await waitFor(() => expect(screen.getByRole('combobox', { name: /Locale/i })).toBeInTheDocument());
    });

    it('opens add phrase modal', async () => {
      setup();
      fireEvent.click(screen.getByText(/💬 Phrase Library/i));
      await waitFor(() => expect(screen.getByText(/\+ Add Phrase/i)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/\+ Add Phrase/i));
      expect(screen.getByRole('dialog', { name: /Add Phrase/i })).toBeInTheDocument();
    });
  });

  // ---- Forbidden Terms tab -------------------------------------------------

  describe('Forbidden Terms tab', () => {
    it('renders forbidden terms list', async () => {
      setup();
      fireEvent.click(screen.getByText(/🚫 Forbidden Terms/i));
      await waitFor(() => expect(screen.getByText('cancel')).toBeInTheDocument());
    });

    it('shows the term locale', async () => {
      setup();
      fireEvent.click(screen.getByText(/🚫 Forbidden Terms/i));
      await waitFor(() => expect(screen.getByText('cancel')).toBeInTheDocument());
      expect(screen.getByText('en')).toBeInTheDocument();
    });

    it('opens add term modal', async () => {
      setup();
      fireEvent.click(screen.getByText(/🚫 Forbidden Terms/i));
      await waitFor(() => expect(screen.getByText(/\+ Add Term/i)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/\+ Add Term/i));
      expect(screen.getByRole('dialog', { name: /Add Forbidden Term/i })).toBeInTheDocument();
    });
  });

  // ---- Audit & Metrics tab -------------------------------------------------

  describe('Audit & Metrics tab', () => {
    it('renders metrics cards', async () => {
      setup();
      fireEvent.click(screen.getByText(/📊 Audit/i));
      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument(); // drafts_total
        expect(screen.getByText('30')).toBeInTheDocument(); // sent_or_edited
      });
    });

    it('renders reply log entries', async () => {
      setup();
      fireEvent.click(screen.getByText(/📊 Audit/i));
      await waitFor(() => {
        expect(screen.getByText('#100')).toBeInTheDocument();
      });
    });

    it('renders month picker', async () => {
      const { container } = setup();
      fireEvent.click(screen.getByText(/📊 Audit/i));
      await waitFor(() =>
        expect(container.querySelector('input[type="month"]')).toBeTruthy(),
      );
    });
  });
});
