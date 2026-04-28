// =============================================================================
// FireISP 5.0 — ChangelogPanel tests (P3.8)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureAxe } from 'jest-axe';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ChangelogPanel, type ChangelogEntry } from '@/components/ChangelogPanel';

// ---------------------------------------------------------------------------
// axe setup
// ---------------------------------------------------------------------------
const axe = configureAxe({
  rules: { 'color-contrast': { enabled: false } },
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ENTRIES: ChangelogEntry[] = [
  { id: 'p3.7', date: '2025-01-15T00:00:00.000Z', title: 'Feature A', body: 'Body A', tags: ['realtime'] },
  { id: 'p3.6', date: '2025-01-10T00:00:00.000Z', title: 'Feature B', body: 'Body B', tags: ['snmp'] },
  { id: 'p3.1', date: '2024-12-01T00:00:00.000Z', title: 'Feature C', body: 'Body C', tags: ['graphql'] },
];

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel(queryClient?: QueryClient) {
  const qc = queryClient ?? makeQueryClient();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <ChangelogPanel />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangelogPanel', () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: ENTRIES }),
    });
  });

  it('renders the bell icon button', () => {
    renderPanel();
    const btn = screen.getByTestId('changelog-bell');
    expect(btn).toBeInTheDocument();
  });

  it('shows unread badge when entries are newer than seen id', async () => {
    localStorageMock.setItem('fireisp_changelog_seen', 'p3.1');
    renderPanel();
    await waitFor(() => expect(screen.queryByTestId('changelog-badge')).toBeInTheDocument());
    const badge = screen.getByTestId('changelog-badge');
    expect(Number(badge.textContent)).toBeGreaterThan(0);
  });

  it('hides badge when all entries are seen (seen id = newest)', async () => {
    localStorageMock.setItem('fireisp_changelog_seen', 'p3.7');
    renderPanel();
    // Wait for data to load then check badge is absent
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // badge should not exist
    expect(screen.queryByTestId('changelog-badge')).not.toBeInTheDocument();
  });

  it('opens panel when bell button is clicked', async () => {
    renderPanel();
    const btn = screen.getByTestId('changelog-bell');
    fireEvent.click(btn);
    expect(screen.getByTestId('changelog-panel')).toBeInTheDocument();
  });

  it('panel closes when X button is clicked', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('changelog-bell'));
    await waitFor(() => expect(screen.getByTestId('changelog-close')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('changelog-close'));
    // panel is still in DOM but translated off-screen; check transform style
    const panel = screen.getByTestId('changelog-panel');
    expect(panel.style.transform).toContain('translateX(100%)');
  });

  it('mark-all-read clears the badge', async () => {
    localStorageMock.setItem('fireisp_changelog_seen', 'p3.1');
    renderPanel();
    await waitFor(() => expect(screen.queryByTestId('changelog-badge')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('changelog-bell'));
    await waitFor(() => expect(screen.getByTestId('changelog-mark-all-read')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('changelog-mark-all-read'));
    await waitFor(() => expect(screen.queryByTestId('changelog-badge')).not.toBeInTheDocument());
  });

  it('panel closes on Escape key', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('changelog-bell'));
    fireEvent.keyDown(document, { key: 'Escape' });
    const panel = screen.getByTestId('changelog-panel');
    expect(panel.style.transform).toContain('translateX(100%)');
  });

  it('bell button has aria-label (accessibility)', () => {
    renderPanel();
    const btn = screen.getByTestId('changelog-bell');
    expect(btn).toHaveAttribute('aria-label');
    expect(btn.getAttribute('aria-label')).not.toBe('');
  });

  it('passes axe accessibility scan on closed state', async () => {
    const { container } = renderPanel();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
