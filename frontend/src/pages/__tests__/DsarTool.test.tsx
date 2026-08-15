// =============================================================================
// FireISP 5.0 — DsarTool page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { DsarTool } from '../DsarTool';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const dsar = {
  meta: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    clientId: 42,
    organizationId: 1,
    version: '2.0',
    completeForEnumeratedDatasets: true,
    collectionCounts: {
      contacts: 2,
      mxProfiles: 1,
      contracts: 1,
      invoices: 0,
      payments: 0,
      tickets: 1,
      connectionLogs: 2,
      radiusAccountingEvents: 3,
      radiusAccountingUsageDaily: 4,
      cgnatAttributionBindings: 5,
      cgnatAttributionEvents: 6,
      ipAssignments: 0,
      aiReplyLogs: 0,
    },
    scope: {
      description: 'Selected FireISP operational datasets attributable to this client in this organization',
      organizationScoped: true,
      connectionAttribution: 'Direct client ID or unambiguous same-organization contract/session linkage',
      compatibilityViews: 'mxProfile is current; mxProfiles contains every held profile row',
      allStorageSystemsCovered: false,
    },
    cancellation: {
      automaticDeletionPerformed: false,
      handling: 'review_required',
      notice: 'Cancellation or erasure requires a documented retention and legal-hold review.',
    },
  },
  data: {
    client: { id: 42, name: 'Jane Doe', email: 'jane@example.com' },
    contacts: [{}, {}],
    mxProfile: { rfc: 'XAXX010101000' },
    mxProfiles: [{}],
    contracts: [{}],
    invoices: [],
    payments: [],
    tickets: [{}],
    connectionLogs: [{}, {}],
    radiusAccountingEvents: [{}, {}, {}],
    radiusAccountingUsageDaily: [{}, {}, {}, {}],
    cgnatAttributionBindings: [{}, {}, {}, {}, {}],
    cgnatAttributionEvents: [{}, {}, {}, {}, {}, {}],
    ipAssignments: [],
    aiReplyLogs: [],
  },
};

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DsarTool />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DsarTool page', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dsar/clients/{id}')
        return Promise.resolve({ data: dsar, error: undefined });
      return Promise.resolve({ data: {}, error: undefined });
    });
  });

  it('renders the page heading', async () => {
    renderTool();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Data Subject Access Request Export' })).toBeInTheDocument());
    expect(screen.getByRole('form', { name: 'Assemble a client data-access export' })).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toHaveAttribute('placeholder', 'e.g. 42');
    expect(screen.getByText(/enumerated FireISP datasets/i)).toBeInTheDocument();
    expect(screen.queryByText(/every piece of personal data/i)).not.toBeInTheDocument();
  });

  it('assembles the export and shows the client summary', async () => {
    renderTool();
    fireEvent.change(screen.getByPlaceholderText('e.g. 42'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Assemble export'));
    await waitFor(() => expect(screen.getByText(/Jane Doe/)).toBeInTheDocument());
    // mxProfile present + a download button appears
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download the client data-access JSON export' })).toBeInTheDocument());
    expect(mockApiGet).toHaveBeenCalledWith('/dsar/clients/{id}', { params: { path: { id: 42 } } });
    const summary = screen.getByRole('group', { name: 'Export metadata' });
    expect(summary).toHaveTextContent('Email: jane@example.com');
    expect(summary).toHaveTextContent('Schema: v2.0');
    expect(summary).toHaveTextContent('Requested by: Not reported');
  });

  it('shows the bounded v2 export scope and cancellation review notice', async () => {
    renderTool();
    fireEvent.change(screen.getByPlaceholderText('e.g. 42'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Assemble export'));

    const scope = await screen.findByRole('group', { name: 'Export scope' });
    expect(scope).toHaveTextContent('This snapshot covers only the enumerated FireISP datasets shown below.');
    expect(scope).toHaveTextContent('Server-declared scope');
    expect(scope).toHaveTextContent('Complete for enumerated datasets');
    expect(scope).toHaveTextContent('Organization scoped');
    expect(scope).toHaveTextContent('All storage systems covered');
    expect(scope).toHaveTextContent('No — review external and integrated systems separately');
    expect(scope).toHaveTextContent('Direct client ID or unambiguous same-organization contract/session linkage');
    expect(scope).toHaveTextContent('mxProfile is current; mxProfiles contains every held profile row');

    const cancellation = screen.getByRole('note', { name: 'Cancellation and erasure review' });
    expect(cancellation).toHaveTextContent('This export does not itself delete data.');
    expect(within(cancellation).getByText('Automatic deletion performed')).toBeInTheDocument();
    expect(within(cancellation).getByText('No')).toBeInTheDocument();
    expect(within(cancellation).getByText('Review required')).toBeInTheDocument();
    expect(within(cancellation).getByText('Cancellation or erasure requires a documented retention and legal-hold review.')).toBeInTheDocument();
    expect(screen.queryByText(/every piece of personal data/i)).not.toBeInTheDocument();
  });

  it('shows server-reported counts for the v2 connection-accounting datasets', async () => {
    renderTool();
    fireEvent.change(screen.getByPlaceholderText('e.g. 42'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('Assemble export'));
    await screen.findByText(/Jane Doe/);

    expect(within(screen.getByRole('row', { name: /RADIUS accounting evidence/ })).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Daily accounting usage/ })).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /CGNAT address and port assignment evidence/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /CGNAT collector source events/ })).getByText('6')).toBeInTheDocument();
    expect(screen.queryByText(/subscriber flows/i)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Export record totals' })).toBeInTheDocument();
    expect(screen.getByText('Record totals reported by the server for this export snapshot.')).toBeInTheDocument();
  });

  it('localizes labels, fallbacks, metadata, and record sections in Spanish', async () => {
    await i18n.changeLanguage('es');
    mockApiGet.mockResolvedValue({
      data: {
        ...dsar,
        meta: {
          ...dsar.meta,
          scope: {
            ...dsar.meta.scope,
            description: '',
            connectionAttribution: '',
            compatibilityViews: '',
          },
          cancellation: {
            ...dsar.meta.cancellation,
            notice: '',
          },
        },
        data: {
          ...dsar.data,
          client: { ...dsar.data.client, email: null },
        },
      },
      error: undefined,
    });

    renderTool();
    expect(screen.getByRole('heading', { name: 'Exportación de solicitud de acceso a datos personales' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Preparar una exportación de acceso a datos del cliente' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ID del cliente'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar exportación' }));

    const summary = await screen.findByRole('group', { name: 'Metadatos de la exportación' });
    expect(summary).toHaveTextContent('Correo electrónico: Sin correo electrónico registrado');
    expect(summary).toHaveTextContent('Solicitada por: No informado');

    const scope = screen.getByRole('group', { name: 'Alcance de la exportación' });
    expect(scope).toHaveTextContent('Esta instantánea abarca únicamente los conjuntos de datos enumerados de FireISP');
    expect(scope).toHaveTextContent('El servidor no proporcionó una descripción adicional del alcance.');
    expect(within(scope).getByText('Atribución de conexiones')).toBeInTheDocument();
    expect(within(scope).getAllByText('No informado')).toHaveLength(2);
    expect(within(scope).getByText('No — revisa por separado los sistemas externos e integrados')).toBeInTheDocument();

    const cancellation = screen.getByRole('note', { name: 'Revisión de cancelación y supresión' });
    expect(cancellation).toHaveTextContent('Esta exportación no elimina datos por sí misma.');
    expect(cancellation).toHaveTextContent('El servidor no proporcionó instrucciones adicionales sobre la cancelación.');
    expect(within(screen.getByRole('row', { name: /Perfil fiscal de MX/ })).getByText('Presente')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Evidencia de contabilidad RADIUS/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar la exportación JSON de acceso a datos del cliente' })).toBeInTheDocument();
  });

  it('localizes loading and error feedback in Portuguese', async () => {
    await i18n.changeLanguage('pt-BR');
    let finishRequest: ((value: unknown) => void) | undefined;
    mockApiGet.mockReturnValue(new Promise(resolve => { finishRequest = resolve; }));

    renderTool();
    fireEvent.change(screen.getByLabelText('ID do cliente'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar exportação' }));
    expect(await screen.findByRole('button', { name: 'Preparando…' })).toBeDisabled();

    finishRequest?.({ data: undefined, error: { message: 'failed' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível preparar a exportação. Verifique o ID do cliente e tente novamente.',
    );
  });
});
