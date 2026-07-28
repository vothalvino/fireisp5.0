// =============================================================================
// FireISP 5.0 — SuspensionConsole tests (j22)
// =============================================================================
// The engine had zero frontend consumers, so it acted invisibly on the feature
// most likely to anger a paying customer if it misfires. The behaviours worth
// pinning are the ones that stop it misfiring: you cannot run it by accident,
// the preview does not overstate what a run would do, and the history says
// whether the ENGINE or a PERSON did it.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SuspensionConsole } from '../SuspensionConsole';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Render interpolations so a count assertion means something.
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockGet(...a), POST: (...a: unknown[]) => mockPost(...a) },
}));

type MockUser = { role?: string; permissions?: string[] };
const mockUser = vi.hoisted(() => ({ current: { role: 'admin' } as MockUser }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

const LOG = {
  id: 3, contract_id: 31, client_id: 9, client_name: 'Juana Pérez', rule_name: 'Suspensión 15 días',
  action: 'suspended', reason: '15 days overdue', triggered_by: 'system',
  performed_by_name: null, radius_coa_sent: 1, related_invoice_id: 77,
  suspended_at: '2026-07-20T03:00:00.000Z', restored_at: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SuspensionConsole /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.current = { role: 'admin' };
  mockGet.mockResolvedValue({ data: { data: [LOG] }, error: undefined });
  mockPost.mockResolvedValue({ data: { data: [] }, error: undefined });
});

describe('running the engine cannot happen by accident', () => {
  it('the run button asks for confirmation before doing anything', async () => {
    renderPage();
    fireEvent.click(screen.getByText('suspensionConsole.run'));
    // Still nothing posted — only the confirm step appeared.
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText('suspensionConsole.confirmRunYes')).toBeInTheDocument();
  });

  it('confirming POSTs to run-auto', async () => {
    renderPage();
    fireEvent.click(screen.getByText('suspensionConsole.run'));
    fireEvent.click(screen.getByText('suspensionConsole.confirmRunYes'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/suspension/run-auto', expect.anything()));
  });

  it('cancelling backs out without posting', () => {
    renderPage();
    fireEvent.click(screen.getByText('suspensionConsole.run'));
    fireEvent.click(screen.getByText('common.cancel'));
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText('suspensionConsole.run')).toBeInTheDocument();
  });

  it('hides the run button entirely without contracts.update', () => {
    // run-auto requires contracts.update. A button that 403s on the engine
    // which disconnects customers is not a button worth having.
    mockUser.current = { role: 'technician', permissions: ['contracts.view'] };
    renderPage();
    expect(screen.queryByText('suspensionConsole.run')).toBeNull();
    // Preview stays — it only needs contracts.view.
    expect(screen.getByText('suspensionConsole.preview')).toBeInTheDocument();
  });
});

describe('the preview does not overstate what a run would do', () => {
  it('counts only rules that actually disconnect', async () => {
    // An 'alert' rule matches, and shows, but disconnects nobody. Counting it
    // as "would be suspended" is how a preview misleads.
    mockPost.mockResolvedValue({
      data: { data: [
        { rule_id: 1, rule_action: 'auto_suspend', contract_id: 31, client_id: 9, invoice_id: 77, days_overdue: 20 },
        { rule_id: 2, rule_action: 'alert', contract_id: 32, client_id: 10, invoice_id: 78, days_overdue: 5 },
      ] }, error: undefined,
    });
    renderPage();
    fireEvent.click(screen.getByText('suspensionConsole.preview'));
    await waitFor(() => expect(screen.getByText(/suspensionConsole.previewSummary/)).toBeInTheDocument());
    // 2 matched, only 1 would act.
    expect(screen.getByText(/"total":2/)).toBeInTheDocument();
    expect(screen.getByText(/"acting":1/)).toBeInTheDocument();
    // and the non-acting row is labelled as such
    expect(screen.getByText('suspensionConsole.noDisconnect')).toBeInTheDocument();
  });

  it('says plainly when nothing matches', async () => {
    mockPost.mockResolvedValue({ data: { data: [] }, error: undefined });
    renderPage();
    fireEvent.click(screen.getByText('suspensionConsole.preview'));
    await waitFor(() => expect(screen.getByText('suspensionConsole.previewEmpty')).toBeInTheDocument());
  });
});

describe('the history distinguishes the engine from a person', () => {
  it('shows a system-triggered row as automatic, not as a blank user', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Juana Pérez')).toBeInTheDocument());
    expect(screen.getByText('suspensionConsole.bySystem')).toBeInTheDocument();
    expect(screen.getByText('Suspensión 15 días')).toBeInTheDocument();
  });

  it('shows the operator name for a manual action', async () => {
    mockGet.mockResolvedValue({
      data: { data: [{ ...LOG, triggered_by: 'manual', performed_by_name: 'Ana Torres' }] },
      error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Ana Torres')).toBeInTheDocument());
    expect(screen.queryByText('suspensionConsole.bySystem')).toBeNull();
  });

  it('reads the history from /suspension/logs', async () => {
    renderPage();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/suspension/logs', expect.anything()));
  });

  it('says so when nothing has happened yet', async () => {
    mockGet.mockResolvedValue({ data: { data: [] }, error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByText('suspensionConsole.historyEmpty')).toBeInTheDocument());
  });
});
