// =============================================================================
// FireISP 5.0 — DataImport page tests (j45)
// =============================================================================
// Four of the five CSV importers had no GUI at all, so day-one migration off a
// previous billing system was curl-only. What matters most here is that the
// page never offers an import the caller cannot perform, and that the per-row
// errors the backend already returns actually reach the operator with a line
// number they can act on.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DataImport } from '../DataImport';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { changeLanguage: vi.fn() } }),
}));
vi.mock('@/api/csrf', () => ({ readCsrfCookie: () => 'csrf-token' }));

type MockUser = { role?: string; permissions?: string[] };
const mockUser = vi.hoisted(() => ({ current: { role: 'admin' } as MockUser }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DataImport /></MemoryRouter>
    </QueryClientProvider>
  );
}

const okResponse = (data: unknown) => ({
  ok: true, status: 200, json: () => Promise.resolve({ data }),
} as Response);

beforeEach(() => {
  vi.restoreAllMocks();
  mockUser.current = { role: 'admin' };
});

describe('entity choices follow the caller permissions', () => {
  it('an admin sees all five importers', () => {
    renderPage();
    const select = screen.getByLabelText('dataImport.whatToImport') as HTMLSelectElement;
    expect(select.options).toHaveLength(5);
  });

  it('offers ONLY what the caller may import', () => {
    // The failure this prevents: choosing an entity, picking a file, and
    // discovering the 403 on submit. Each importer guards on its own entity's
    // create permission server-side.
    mockUser.current = { role: 'billing', permissions: ['invoices.create', 'payments.create'] };
    renderPage();
    const select = screen.getByLabelText('dataImport.whatToImport') as HTMLSelectElement;
    const values = [...select.options].map(o => o.value);
    expect(values).toEqual(['invoices', 'payments']);
    expect(values).not.toContain('devices');
  });

  it('says so plainly when the caller may import nothing', () => {
    mockUser.current = { role: 'readonly', permissions: [] };
    renderPage();
    expect(screen.getByText('dataImport.noPermission')).toBeInTheDocument();
    expect(screen.queryByLabelText('dataImport.chooseFile')).not.toBeInTheDocument();
  });
});

describe('the expected columns are shown, not left to be discovered', () => {
  it('lists the required and optional columns for the selected entity', () => {
    renderPage();
    // Invoices is not the default (clients is, for an admin) — switch to it.
    fireEvent.change(screen.getByLabelText('dataImport.whatToImport'), { target: { value: 'invoices' } });
    expect(screen.getByText(/client_id, invoice_number, issue_date, due_date/)).toBeInTheDocument();
    expect(screen.getByText(/contract_id, subtotal, tax_rate/)).toBeInTheDocument();
  });

  it('switching entity swaps the column list', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('dataImport.whatToImport'), { target: { value: 'payments' } });
    expect(screen.getByText(/client_id, amount, payment_date/)).toBeInTheDocument();
    expect(screen.queryByText(/invoice_number/)).not.toBeInTheDocument();
  });
});

describe('upload posts to the right versioned endpoint', () => {
  it('POSTs multipart to /api/v1/import/<entity>/upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse({ imported: 2, total: 2, errors: [] }));
    renderPage();
    fireEvent.change(screen.getByLabelText('dataImport.whatToImport'), { target: { value: 'invoices' } });
    const file = new File(['client_id\n42\n'], 'invoices.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('dataImport.chooseFile'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('dataImport.importBtn'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    // The versioned prefix: /api (unversioned) still works but carries a
    // Deprecation header with a 2027-06-01 sunset.
    expect(url).toBe('/api/v1/import/invoices/upload');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('refuses to submit with no file chosen, without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    renderPage();
    fireEvent.click(screen.getByText('dataImport.importBtn'));
    expect(screen.getByText('dataImport.noFile')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('per-row errors reach the operator', () => {
  it('renders each failing line with its number and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({
      imported: 498, total: 500,
      errors: [
        { row: 3, error: 'client_id is required' },
        { row: 117, error: 'This invoice carries no tax, but 16% applies to this client.' },
      ],
    }));
    renderPage();
    const file = new File(['x'], 'invoices.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('dataImport.chooseFile'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('dataImport.importBtn'));

    await waitFor(() => expect(screen.getByText('dataImport.resultTitle')).toBeInTheDocument());
    expect(screen.getByText('498')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('client_id is required')).toBeInTheDocument();
    expect(screen.getByText('117')).toBeInTheDocument();
    expect(screen.getByText(/16% applies to this client/)).toBeInTheDocument();
  });

  it('warns that successful rows are NOT rolled back', async () => {
    // The importer commits row by row. Without this an operator fixes the file
    // and re-runs the whole thing, double-importing everything that worked.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({
      imported: 1, total: 2, errors: [{ row: 3, error: 'boom' }],
    }));
    renderPage();
    const file = new File(['x'], 'f.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('dataImport.chooseFile'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('dataImport.importBtn'));
    await waitFor(() => expect(screen.getByText('dataImport.partialWarning')).toBeInTheDocument());
  });

  it('shows no warning and no table on a clean import', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ imported: 5, total: 5, errors: [] }));
    renderPage();
    const file = new File(['x'], 'f.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('dataImport.chooseFile'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('dataImport.importBtn'));
    await waitFor(() => expect(screen.getByText('dataImport.allImported')).toBeInTheDocument());
    expect(screen.queryByText('dataImport.partialWarning')).not.toBeInTheDocument();
  });

  it("surfaces the backend's message when the whole request fails", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 422,
      json: () => Promise.resolve({ error: { message: 'csv field is required' } }),
    } as Response);
    renderPage();
    const file = new File(['x'], 'f.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('dataImport.chooseFile'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('dataImport.importBtn'));
    await waitFor(() => expect(screen.getByText('csv field is required')).toBeInTheDocument());
  });
});
