// =============================================================================
// FireISP 5.0 — DocumentTemplates page tests (migration 447)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DocumentTemplates } from '../DocumentTemplates';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => mockApiGet(...a),
    POST: (...a: unknown[]) => mockApiPost(...a),
    PUT: (...a: unknown[]) => mockApiPut(...a),
    DELETE: vi.fn(),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

let mockLocale: 'MX' | 'global' = 'MX';
let mockRole = 'admin';
let mockPermissions: string[] | undefined;
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: {
    id: 1,
    role: mockRole,
    permissions: mockPermissions,
    organization_id: 42,
    organization_locale: mockLocale,
  } }),
}));

const TPL = {
  id: 1, template_type: 'activation_contract', name: 'Contrato de adhesión',
  body_md: 'Yo {{client.name}} contrato el plan {{plan.name}}.', contract_template_mx_id: 77,
  contract_template_mx_environment: 'production',
  is_active: 1, created_at: '2026-08-05',
};

const REGISTERED_SOURCE = {
  id: 77,
  organization_id: 1,
  template_name: 'Contrato registrado 2026',
  ift_registration_number: 'CRT-2026-0042',
  registered_at: '2026-07-15',
  version: '2026.1',
  template_body: 'Texto exacto registrado para {{client.name}}.',
  status: 'registered',
  environment: 'production',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DocumentTemplates /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLocale = 'MX';
  mockRole = 'admin';
  mockPermissions = undefined;
  mockApiGet.mockImplementation((path: string) => Promise.resolve({
    data: { data: path === '/consumer-protection/contract-environment'
      ? { contract_environment: 'production' }
      : path === '/consumer-protection/contract-templates-mx' ? [REGISTERED_SOURCE] : [TPL] },
    error: undefined,
  }));
  mockApiPost.mockResolvedValue({ data: { data: { id: 2 } }, error: undefined });
  mockApiPut.mockResolvedValue({ data: { data: { id: 1 } }, error: undefined });
});

describe('DocumentTemplates', () => {
  it('STRICTLY MX: a global org gets the explanation, no fetch, no create button', async () => {
    mockLocale = 'global';
    renderPage();
    expect(await screen.findByText(/MX-locale organizations only/)).toBeInTheDocument();
    expect(screen.queryByText('+ New template')).not.toBeInTheDocument();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('does not query or expose template actions without document_templates.view', async () => {
    mockRole = 'readonly';
    mockPermissions = ['signed_documents.view'];
    renderPage();

    expect(await screen.findByText(/do not have permission to view legal document templates/i)).toBeInTheDocument();
    expect(screen.queryByText('+ New template')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('lists templates with their type and active state', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Contrato de adhesión')).toBeInTheDocument());
    expect(screen.getByText('Activation contract (contrato de adhesión)')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('creates a template through the modal, inactive by default', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Contrato de adhesión')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ New template'));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });

    fireEvent.change(within(dialog).getByLabelText(/Name \*/), { target: { value: 'Autorización de instalación' } });
    fireEvent.change(within(dialog).getByLabelText(/Document text/), { target: { value: 'Autorizo a {{org.name}} a instalar en {{order.address}}.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/document-templates', expect.objectContaining({
      body: expect.objectContaining({
        name: 'Autorización de instalación',
        template_type: 'installation_authorization',
        is_active: false,
      }),
    })));
  });

  it('refuses to save an empty body instead of posting a blank legal document', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Contrato de adhesión')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ New template'));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    fireEvent.change(within(dialog).getByLabelText(/Name \*/), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The document text is required.')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('uses the exact registered MX source and submits its evidence link', async () => {
    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });

    await waitFor(() => expect(within(dialog).getByLabelText(/MX contract source/)).toHaveValue('77'));
    expect(within(dialog).getByLabelText(/Name \*/)).toHaveValue('Contrato registrado 2026');
    expect(within(dialog).getByLabelText(/Name \*/)).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText(/Document text/)).toHaveValue('Texto exacto registrado para {{client.name}}.');
    expect(within(dialog).getByLabelText(/Document text/)).toHaveAttribute('readonly');
    expect(within(dialog).getByText('CRT-2026-0042')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-07-15')).toBeInTheDocument();
    expect(within(dialog).getByText('2026.1')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Registered').length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith('/document-templates/{id}', expect.objectContaining({
      params: { path: { id: 1 } },
      body: {
        name: 'Contrato registrado 2026',
        template_type: 'activation_contract',
        body_md: 'Texto exacto registrado para {{client.name}}.',
        contract_template_mx_id: 77,
        is_active: true,
      },
    })));
  });

  it('loads every source page so a source after row 100 remains editable', async () => {
    mockApiGet.mockImplementation((path: string, options?: { params?: { query?: { page?: number } } }) => {
      if (path === '/consumer-protection/contract-environment') {
        return Promise.resolve({ data: { data: { contract_environment: 'production' } }, error: undefined });
      }
      if (path === '/consumer-protection/contract-templates-mx') {
        const page = options?.params?.query?.page ?? 1;
        return Promise.resolve({
          data: {
            data: page === 2 ? [REGISTERED_SOURCE] : [],
            meta: { total: 101, page, limit: 100, totalPages: 2 },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [TPL] }, error: undefined });
    });

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });

    expect(await within(dialog).findByRole('option', { name: /Contrato registrado 2026/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/MX contract source/)).toHaveValue('77');
    expect(mockApiGet).toHaveBeenCalledWith(
      '/consumer-protection/contract-templates-mx',
      { params: { query: { page: 2, limit: 100, order_by: 'id', order: 'ASC' } } },
    );
  });

  it('allows a separate sandbox-ready activation template without registration metadata', async () => {
    const sandboxSource = {
      ...REGISTERED_SOURCE,
      id: 88,
      template_name: 'Contrato simulado',
      template_body: 'TEST / SIMULATION\n\nTexto para {{client.name}}.',
      version: 'sim-1',
      environment: 'sandbox',
      status: 'sandbox_ready',
      ift_registration_number: null,
      registered_at: null,
    };
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: { data: path === '/consumer-protection/contract-environment'
        ? { contract_environment: 'sandbox' }
        : path === '/consumer-protection/contract-templates-mx'
          ? [REGISTERED_SOURCE, sandboxSource]
          : [TPL] },
      error: undefined,
    }));

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByText('+ New template'));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    fireEvent.change(within(dialog).getByLabelText(/Type \*/), { target: { value: 'activation_contract' } });
    await within(dialog).findByRole('option', { name: /Contrato simulado/ });
    const sourceSelect = within(dialog).getByLabelText(/MX contract source/);
    fireEvent.change(sourceSelect, { target: { value: '88' } });

    expect(await within(dialog).findByTestId('mx-contract-sandbox-banner')).toHaveTextContent(/NO LEGAL EFFECT/);
    expect(within(dialog).queryByText('Registration number')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Name \*/)).toHaveValue('Contrato simulado');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/document-templates', expect.objectContaining({
      body: expect.objectContaining({
        name: 'Contrato simulado',
        body_md: 'TEST / SIMULATION\n\nTexto para {{client.name}}.',
        contract_template_mx_id: 88,
        is_active: true,
      }),
    })));
  });

  it('keeps activation unavailable when no complete registered source exists', async () => {
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: {
        data: path === '/consumer-protection/contract-templates-mx'
          ? [{ ...REGISTERED_SOURCE, id: 88, status: 'submitted', ift_registration_number: null }]
          : [TPL],
      },
      error: undefined,
    }));
    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByText('+ New template'));
    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    fireEvent.change(within(dialog).getByLabelText(/Type \*/), { target: { value: 'activation_contract' } });

    expect(await within(dialog).findByText(/No usable source is available/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Select a usable MX contract source/)).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('allows only an exact active-to-inactive transition after the linked source expires', async () => {
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: {
        data: path === '/consumer-protection/contract-templates-mx'
          ? [{ ...REGISTERED_SOURCE, status: 'expired' }]
          : [TPL],
      },
      error: undefined,
    }));

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });

    const activeToggle = within(dialog).getByRole('checkbox');
    expect(activeToggle).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Select a usable MX contract source/)).toBeInTheDocument();
    expect(mockApiPut).not.toHaveBeenCalled();

    fireEvent.click(activeToggle);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith('/document-templates/{id}', expect.objectContaining({
      params: { path: { id: 1 } },
      body: {
        name: TPL.name,
        template_type: TPL.template_type,
        body_md: TPL.body_md,
        contract_template_mx_id: TPL.contract_template_mx_id,
        is_active: false,
      },
    })));
  });

  it('allows an exact active-to-inactive transition for a legacy template without an MX source', async () => {
    const legacyTemplate = { ...TPL, contract_template_mx_id: null };
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: {
        data: path === '/consumer-protection/contract-environment'
          ? { contract_environment: 'production' }
          : path === '/consumer-protection/contract-templates-mx' ? [] : [legacyTemplate],
      },
      error: undefined,
    }));

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });

    const activeToggle = within(dialog).getByRole('checkbox');
    expect(activeToggle).toBeChecked();
    fireEvent.click(activeToggle);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledWith('/document-templates/{id}', expect.objectContaining({
      params: { path: { id: 1 } },
      body: {
        name: legacyTemplate.name,
        template_type: legacyTemplate.template_type,
        body_md: legacyTemplate.body_md,
        contract_template_mx_id: null,
        is_active: false,
      },
    })));
  });

  it('keeps a legacy source attachment inactive and shows the backend reason if it is reactivated', async () => {
    const legacyTemplate = { ...TPL, contract_template_mx_id: null };
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: {
        data: path === '/consumer-protection/contract-environment'
          ? { contract_environment: 'production' }
          : path === '/consumer-protection/contract-templates-mx'
            ? [REGISTERED_SOURCE]
            : [legacyTemplate],
      },
      error: undefined,
    }));
    mockApiPut.mockResolvedValueOnce({
      data: undefined,
      error: { error: { message: 'Deactivate this template before changing legal content' } },
    });

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });
    const sourceSelect = within(dialog).getByLabelText(/MX contract source/);
    await within(dialog).findByRole('option', { name: /Contrato registrado 2026/ });

    fireEvent.change(sourceSelect, { target: { value: '77' } });
    const activeToggle = within(dialog).getByRole('checkbox');
    expect(activeToggle).not.toBeChecked();
    fireEvent.click(activeToggle);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('Deactivate this template before changing legal content')).toBeInTheDocument();
    expect(within(dialog).queryByText('Failed to save the template')).not.toBeInTheDocument();
    expect(mockApiPut).toHaveBeenCalledTimes(1);
  });

  it('keeps a terminal-source activation template strict when it is not being deactivated', async () => {
    mockApiGet.mockImplementation((path: string) => Promise.resolve({
      data: {
        data: path === '/consumer-protection/contract-templates-mx'
          ? [{ ...REGISTERED_SOURCE, status: 'revoked' }]
          : [{ ...TPL, is_active: 0 }],
      },
      error: undefined,
    }));

    renderPage();
    await screen.findByText('Contrato de adhesión');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit template' });

    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Select a usable MX contract source/)).toBeInTheDocument();
    expect(mockApiPut).not.toHaveBeenCalled();
  });
});
