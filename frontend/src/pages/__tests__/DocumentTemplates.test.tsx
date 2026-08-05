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
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin', organization_locale: mockLocale } }),
}));

const TPL = {
  id: 1, template_type: 'activation_contract', name: 'Contrato de adhesión',
  body_md: 'Yo {{client.name}} contrato el plan {{plan.name}}.', is_active: 1, created_at: '2026-08-05',
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
  mockApiGet.mockResolvedValue({ data: { data: [TPL] }, error: undefined });
  mockApiPost.mockResolvedValue({ data: { data: { id: 2 } }, error: undefined });
});

describe('DocumentTemplates', () => {
  it('STRICTLY MX: a global org gets the explanation, no fetch, no create button', async () => {
    mockLocale = 'global';
    renderPage();
    expect(await screen.findByText(/MX-locale organizations only/)).toBeInTheDocument();
    expect(screen.queryByText('+ New template')).not.toBeInTheDocument();
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
});
