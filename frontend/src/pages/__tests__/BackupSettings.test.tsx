// =============================================================================
// FireISP 5.0 — BackupSettings page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BackupSettings } from '../BackupSettings';

const mockApiGet = vi.fn();
const mockApiPut = vi.fn();
const mockApiPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    GET: (...args: unknown[]) => mockApiGet(...args),
    PUT: (...args: unknown[]) => mockApiPut(...args),
    POST: (...args: unknown[]) => mockApiPost(...args),
  },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const SETTINGS = {
  remote_enabled: true,
  provider: 'minio',
  bucket: 'fireisp-backups',
  region: 'us-east-1',
  endpoint: 'http://192.168.1.50:9000',
  prefix: 'db-backups/',
  access_key: 'minio-key',
  secret_configured: true,
  last_test_at: '2026-07-16T10:00:00.000Z',
  last_test_status: 'success',
  last_test_error: null,
  env_configured: false,
  effective_source: 'settings',
};

const RUN = {
  id: 1, trigger_source: 'scheduled', status: 'success', filename: 'fireisp_2026-07-17.sql.gz',
  size_bytes: 2 * 1024 * 1024, remote_status: 'uploaded', remote_url: 'http://x/y',
  error_message: null, started_at: '2026-07-17T03:00:00.000Z', finished_at: '2026-07-17T03:00:30.000Z',
};

function installGets({ settings = SETTINGS, runs = [RUN], files = [{ filename: 'fireisp_2026-07-17.sql.gz', size_bytes: 2 * 1024 * 1024, modified_at: '2026-07-17T03:00:30.000Z' }] } = {}) {
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/backup-settings')
      return Promise.resolve({
        data: { data: { settings, schedule: { cron_expression: '0 3 * * *', is_enabled: 1, last_run_at: '2026-07-16T03:00:00.000Z', last_status: 'success', next_run_at: '2026-07-18T03:00:00.000Z' }, latest_run: runs[0] ?? null } },
        error: undefined,
      });
    if (path === '/backup-settings/runs')
      return Promise.resolve({ data: { data: { runs, files } }, error: undefined });
    return Promise.resolve({ data: {}, error: undefined });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BackupSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BackupSettings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installGets();
  });

  it('renders schedule, saved destination, and run history', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Database Backups/)).toBeInTheDocument());
    expect(await screen.findByText(/0 3 \* \* \*/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('fireisp-backups')).toBeInTheDocument();
    // The filename shows in BOTH the runs table and the local-files table.
    expect((await screen.findAllByText('fireisp_2026-07-17.sql.gz')).length).toBe(2);
    expect(screen.getAllByText('uploaded').length).toBeGreaterThan(0);
    // 2 MB run + identical local file size both render
    expect(screen.getAllByText('2.0 MB').length).toBeGreaterThan(0);
  });

  it('masks the saved secret and OMITS secret_key when saving with the field blank', async () => {
    mockApiPut.mockResolvedValue({ data: { data: SETTINGS }, error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('fireisp-backups')).toBeInTheDocument());

    const secretInput = screen.getByPlaceholderText(/saved — leave blank to keep/);
    expect(secretInput).toHaveValue('');

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1));
    const body = (mockApiPut.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty('secret_key');
    expect(body).toMatchObject({ bucket: 'fireisp-backups', provider: 'minio' });
  });

  it('sends a typed secret on save', async () => {
    mockApiPut.mockResolvedValue({ data: { data: SETTINGS }, error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('fireisp-backups')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/saved — leave blank to keep/), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1));
    const body = (mockApiPut.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(body.secret_key).toBe('new-secret');
  });

  it('shows the failure message when the connection test fails', async () => {
    mockApiPost.mockResolvedValue({
      data: { data: { success: false, source: 'settings', error: 'HTTP 403 — AccessDenied' } },
      error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Test connection')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test connection'));
    await waitFor(() => expect(screen.getByText(/Connection test failed/)).toBeInTheDocument());
    expect(screen.getByText(/AccessDenied/)).toBeInTheDocument();
  });

  it('triggers a manual backup via Run now', async () => {
    mockApiPost.mockResolvedValue({ data: { data: { started: true } }, error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Run backup now/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Run backup now/));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/backup-settings/run-now', {}));
  });

  it('warns when no off-site destination is configured at all', async () => {
    installGets({ settings: { ...SETTINGS, remote_enabled: false, secret_configured: false, effective_source: 'none' }, runs: [], files: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/backups stay on this server only/)).toBeInTheDocument());
  });
});
