// =============================================================================
// FireISP 5.0 — DrDrillStatus page tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DrDrillStatus } from '../DrDrillStatus';

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
        <DrDrillStatus />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DrDrillStatus page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a passing, up-to-date drill', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dr-drill/status')
        return Promise.resolve({
          data: { data: { last_run_at: '2026-05-01T00:00:00.000Z', status: 'pass', days_since_drill: 10, overdue: false, last_error: null } },
          error: undefined,
        });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('🛟 Disaster-Recovery Drill')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Up to date')).toBeInTheDocument());
    expect(screen.getByText('Pass')).toBeInTheDocument();
  });

  it('shows guidance when no drill has run', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dr-drill/status')
        return Promise.resolve({
          data: { data: { last_run_at: null, status: null, days_since_drill: null, overdue: true, last_error: null } },
          error: undefined,
        });
      return Promise.resolve({ data: {}, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No drill has been run yet/)).toBeInTheDocument());
  });

  // The page is where the DrDrillBanner modal's "Open DR runbook" link lands,
  // so the runbook document must actually render here (GET /dr-drill/runbook).
  const RUNBOOK_MD = [
    '# FireISP 5.0 — Disaster-Recovery Drill',
    '',
    '## Phase 1 — Take a Fresh Backup',
    '',
    'Run `pnpm run backup` and verify the archive size.',
    '',
    '| Requirement | Check |',
    '|---|---|',
    '| mysqldump | present |',
  ].join('\n');

  function mockWithRunbook({ runbookError = false } = {}) {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/dr-drill/status')
        return Promise.resolve({
          data: { data: { last_run_at: '2026-05-01T00:00:00.000Z', status: 'pass', days_since_drill: 10, overdue: false, last_error: null } },
          error: undefined,
        });
      if (path === '/dr-drill/runbook')
        return runbookError
          ? Promise.resolve({ data: undefined, error: { message: 'boom' } })
          : Promise.resolve({ data: { data: { markdown: RUNBOOK_MD } }, error: undefined });
      return Promise.resolve({ data: {}, error: undefined });
    });
  }

  it('renders the runbook document (markdown headings, code, GFM table)', async () => {
    mockWithRunbook();
    renderPage();
    expect(await screen.findByText('📖 DR Runbook')).toBeInTheDocument();
    // Lazy MarkdownView chunk + query resolve — findBy* awaits both.
    expect(await screen.findByRole('heading', { name: /Phase 1 — Take a Fresh Backup/ })).toBeInTheDocument();
    expect(screen.getByText('pnpm run backup')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'mysqldump' })).toBeInTheDocument();
  });

  it('shows an error message when the runbook fails to load', async () => {
    mockWithRunbook({ runbookError: true });
    renderPage();
    expect(await screen.findByText('Failed to load the runbook document.')).toBeInTheDocument();
  });
});
