import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { Reports } from '../Reports';

const mocks = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  readiness: {
    current: {} as Record<string, unknown>,
  },
}));

vi.mock('@/api/client', () => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
  authedFetch: (...args: unknown[]) => mocks.authedFetch(...args),
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', organization_locale: 'global' },
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function renderReports() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Reports />
    </QueryClientProvider>,
  );
}

async function openComplianceTab(label: string) {
  const user = userEvent.setup();
  renderReports();
  await user.click(screen.getByRole('button', { name: label }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  mocks.readiness.current = {
    has_nas: false,
    has_radius_setup: false,
    ready: false,
    status: 'waiting_for_traffic',
    connection_logging: {
      active_nas: 2,
      status: 'waiting_for_traffic',
      session_logger: { configured: true },
    },
    disclaimer: 'Operator notice: validate source coverage before relying on these records.',
  };
  mocks.authedFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/reports/compliance')) {
      return jsonResponse({
        data: {
          data_retention: [],
          interception_readiness: mocks.readiness.current,
        },
      });
    }
    if (url.includes('/api/v1/reports/financial')) {
      return jsonResponse({
        data: {
          generated_at: '2026-08-14T12:00:00.000Z',
          period: { from: '2026-08-01', to: '2026-08-14' },
          revenue: { invoiced: 0, collected: 0, outstanding: 0, invoice_count: 0 },
          payments: { total: 0, count: 0 },
          expenses: { total: 0, count: 0 },
          net_income: 0,
        },
      });
    }
    return jsonResponse({}, 404);
  });
});

describe('Reports compliance tab — operational connection logging', () => {
  it('uses the nested connection-logging state, localized badges, and operator disclaimer', async () => {
    await openComplianceTab('Compliance');

    expect(await screen.findByRole('heading', {
      name: 'Operational Connection-Logging Readiness',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Active NAS available')).toHaveTextContent('Yes');
    expect(screen.getByLabelText('Session accounting configured')).toHaveTextContent('Yes');
    expect(screen.getByLabelText('Operational status')).toHaveTextContent('Waiting for records');
    expect(screen.getByRole('note')).toHaveTextContent(
      'Operator notice: validate source coverage before relying on these records.',
    );
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Not Ready$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interception Readiness/i)).not.toBeInTheDocument();
  });

  it('uses the localized Spanish safety disclaimer when the backend omits one', async () => {
    await i18n.changeLanguage('es');
    mocks.readiness.current = {
      has_nas: false,
      ready: false,
      status: 'not_configured',
      connection_logging: {
        active_nas: 0,
        status: 'not_configured',
        session_logger: { configured: false },
      },
      disclaimer: '   ',
    };

    await openComplianceTab('Cumplimiento');

    expect(await screen.findByRole('heading', {
      name: 'Estado operativo del registro de conexiones',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('NAS activo disponible')).toHaveTextContent('No');
    expect(screen.getByLabelText('Contabilidad de sesiones configurada')).toHaveTextContent('No');
    expect(screen.getByLabelText('Estado operativo')).toHaveTextContent('Sin configurar');
    expect(screen.getByRole('note')).toHaveTextContent(
      'Esta señal es solo operativa. No certifica el cumplimiento legal ni la cobertura completa de los registros.',
    );
  });

  it('localizes the operational status and fallback disclaimer in Portuguese', async () => {
    await i18n.changeLanguage('pt-BR');
    mocks.readiness.current = {
      has_nas: false,
      ready: false,
      status: 'not_applicable',
      connection_logging: {
        active_nas: 0,
        status: 'not_applicable',
        session_logger: { configured: false },
      },
      disclaimer: null,
    };

    await openComplianceTab('Conformidade');

    expect(await screen.findByRole('heading', {
      name: 'Prontidão operacional do registro de conexões',
    })).toBeInTheDocument();
    expect(screen.getByLabelText('Status operacional')).toHaveTextContent('Não aplicável');
    expect(screen.getByRole('note')).toHaveTextContent(
      'Este indicador é apenas operacional. Ele não certifica conformidade legal nem a cobertura completa dos registros.',
    );
  });
});
