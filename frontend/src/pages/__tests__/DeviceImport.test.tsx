// =============================================================================
// FireISP 5.0 — DeviceImport page tests
// =============================================================================
// This page had no test at all, which is how it kept posting to the
// unversioned /api prefix unnoticed. That mount still forwards to the same v1
// router but carries a Deprecation header with a 2027-06-01 Sunset
// (src/app.js), so the page would have started 404ing on a date nobody was
// watching for. The endpoint assertion below is the point of the file.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeviceImport } from '../DeviceImport';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { changeLanguage: vi.fn() } }),
}));
vi.mock('@/api/csrf', () => ({ readCsrfCookie: () => 'csrf-token' }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeviceImport /></QueryClientProvider>);
}

const chooseFile = () => {
  const file = new File(['name,ip_address\nr1,10.0.0.1\n'], 'devices.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('device_import.upload_label'), { target: { files: [file] } });
};

beforeEach(() => vi.restoreAllMocks());

describe('DeviceImport', () => {
  it('posts to the VERSIONED /api/v1 import endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: () => Promise.resolve({ data: { imported: 1, total: 1, errors: [] } }),
    } as Response);
    renderPage();
    chooseFile();
    fireEvent.click(screen.getByText('device_import.import_btn'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/import/devices/upload');
    // Explicitly NOT the deprecated mount.
    expect(fetchSpy.mock.calls[0][0]).not.toBe('/api/import/devices/upload');
  });

  it('sends the file as multipart with the CSRF header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: () => Promise.resolve({ data: { imported: 1, total: 1, errors: [] } }),
    } as Response);
    renderPage();
    chooseFile();
    fireEvent.click(screen.getByText('device_import.import_btn'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-token');
  });

  it('refuses to submit with no file, without calling the API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPage();
    fireEvent.click(screen.getByText('device_import.import_btn'));
    expect(screen.getByText('device_import.no_file')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders per-row errors with their line numbers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: { imported: 8, total: 10, errors: [{ row: 4, error: 'name and ip_address are required' }] },
      }),
    } as Response);
    renderPage();
    chooseFile();
    fireEvent.click(screen.getByText('device_import.import_btn'));

    await waitFor(() => expect(screen.getByText('device_import.result_title')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('name and ip_address are required')).toBeInTheDocument();
  });
});
