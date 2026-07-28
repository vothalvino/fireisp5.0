// =============================================================================
// FireISP 5.0 — TechnicianMap tests (j28)
// =============================================================================
// The feature was unwired at BOTH ends — nothing showed positions, nothing
// sent them. The behaviours worth pinning are the ones that make a dispatch
// map trustworthy: a stale dot must not read as "where they are now", a denied
// GPS permission must SAY so rather than silently sharing nothing, and the
// share button must not appear for a role that cannot ingest.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TechnicianMap } from '../TechnicianMap';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// react-leaflet needs a real DOM canvas; render the pieces as plain markers so
// the assertions are about OUR logic, not leaflet's.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tiles" />,
  CircleMarker: ({ children, pathOptions }: { children?: React.ReactNode; pathOptions?: { color?: string } }) =>
    <div data-testid="marker" data-color={pathOptions?.color}>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockGet(...a), POST: (...a: unknown[]) => mockPost(...a) },
}));

type MockUser = { role?: string; permissions?: string[] };
const mockUser = vi.hoisted(() => ({ current: { role: 'admin' } as MockUser }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

const freshPosition = (over: Partial<Record<string, unknown>> = {}) => ({
  user_id: 9, latitude: '19.4326', longitude: '-99.1332', accuracy_m: 12,
  recorded_at: new Date(Date.now() - 60_000).toISOString(),   // 1 min ago
  first_name: 'Luis', last_name: 'Ramírez', ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TechnicianMap /></QueryClientProvider>);
}

let watchCb: ((p: unknown) => void) | null = null;
let errCb: ((e: unknown) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.current = { role: 'admin' };
  mockGet.mockResolvedValue({ data: { data: [freshPosition()] }, error: undefined });
  mockPost.mockResolvedValue({ data: {}, error: undefined });
  watchCb = null; errCb = null;
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok, fail) => { watchCb = ok; errCb = fail; return 1; }),
      clearWatch: vi.fn(),
    },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('the dispatch view', () => {
  it('renders a marker per technician with their name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('marker')).toHaveLength(1));
    expect(screen.getAllByText('Luis Ramírez').length).toBeGreaterThan(0);
  });

  it('says plainly when nobody has reported', async () => {
    mockGet.mockResolvedValue({ data: { data: [] }, error: undefined });
    renderPage();
    await waitFor(() => expect(screen.getByText('technicianMap.noPositions')).toBeInTheDocument());
  });

  it('drops a row with an unusable coordinate rather than plotting NaN', async () => {
    mockGet.mockResolvedValue({
      data: { data: [freshPosition(), freshPosition({ user_id: 10, latitude: null })] }, error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('marker')).toHaveLength(1));
  });
});

describe('a stale position does not read as a live one', () => {
  it('greys the marker and warns when the last report is old', async () => {
    mockGet.mockResolvedValue({
      data: { data: [freshPosition({ recorded_at: new Date(Date.now() - 30 * 60_000).toISOString() })] },
      error: undefined,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('marker')).toHaveAttribute('data-color', '#9ca3af'));
    expect(screen.getByText('technicianMap.staleWarning')).toBeInTheDocument();
  });

  it('keeps a recent one live-coloured with no warning', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('marker')).toHaveAttribute('data-color', '#2563eb'));
    expect(screen.queryByText('technicianMap.staleWarning')).toBeNull();
  });
});

describe('sharing my own position', () => {
  it('posts a breadcrumb when a fix arrives', async () => {
    renderPage();
    fireEvent.click(screen.getByText('technicianMap.startSharing'));
    watchCb?.({ coords: { latitude: 19.1, longitude: -99.2, accuracy: 8 } });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/technician-tracking/breadcrumb',
      expect.objectContaining({ body: { latitude: 19.1, longitude: -99.2, accuracy_m: 8 } }),
    ));
  });

  it('SAYS SO when the permission is denied — never silently shares nothing', async () => {
    renderPage();
    fireEvent.click(screen.getByText('technicianMap.startSharing'));
    errCb?.({ code: 1, PERMISSION_DENIED: 1 });
    await waitFor(() => expect(screen.getByText('technicianMap.permissionDenied')).toBeInTheDocument());
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('reports a send failure rather than looking like it worked', async () => {
    mockPost.mockResolvedValue({ error: { message: 'nope' } });
    renderPage();
    fireEvent.click(screen.getByText('technicianMap.startSharing'));
    watchCb?.({ coords: { latitude: 19.1, longitude: -99.2, accuracy: 8 } });
    await waitFor(() => expect(screen.getByText('technicianMap.sendError')).toBeInTheDocument());
  });

  it('stops the GPS watch when sharing is turned off', () => {
    renderPage();
    fireEvent.click(screen.getByText('technicianMap.startSharing'));
    fireEvent.click(screen.getByText('technicianMap.stopSharing'));
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(1);
  });

  it('hides the share button for a role that can VIEW but not INGEST', async () => {
    // support holds technician_tracking.view only (migration 298). An ungated
    // button would prompt for GPS and then 403.
    mockUser.current = { role: 'support', permissions: ['technician_tracking.view'] };
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('marker').length).toBeGreaterThan(0));
    expect(screen.queryByText('technicianMap.startSharing')).toBeNull();
  });
});
