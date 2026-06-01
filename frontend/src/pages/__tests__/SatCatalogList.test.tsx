// =============================================================================
// FireISP 5.0 — SatCatalogList page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SatCatalogList } from '../SatCatalogList';

const mockApiGet = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...args: unknown[]) => mockApiGet(...args) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SatCatalogList />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SatCatalogList page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/sat-catalogs/regimen-fiscal')
        return Promise.resolve({ data: { data: [{ clave: '601', descripcion: 'General de Ley Personas Morales' }] }, error: undefined });
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  });

  it('renders the default catalog rows', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('📚 SAT Catalogs')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('General de Ley Personas Morales')).toBeInTheDocument());
  });

  it('prompts for a search term when a searchable catalog is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('General de Ley Personas Morales')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Select catalog'), 'clave-prod-serv');
    await waitFor(() => expect(screen.getByText(/Enter a search term/)).toBeInTheDocument());
  });
});
