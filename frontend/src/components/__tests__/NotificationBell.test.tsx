// =============================================================================
// FireISP 5.0 — NotificationBell tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockGet(...a), POST: (...a: unknown[]) => mockPost(...a) },
  tokenStore: { getAccess: () => 'tok', setAccess: vi.fn(), getRefresh: () => null, setRefresh: vi.fn(), clear: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { NotificationBell } from '../NotificationBell';

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = {
  id: 11,
  title: 'Work order assigned: Tower North',
  body: 'Type: maintenance',
  type: 'work_order',
  entity_type: 'work_orders',
  entity_id: 42,
  is_read: 0,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((path: string) => {
    if (path === '/notifications/unread-count') {
      return Promise.resolve({ data: { data: { count: 3 } } });
    }
    return Promise.resolve({ data: { data: [row] } });
  });
  mockPost.mockResolvedValue({ data: {} });
});

describe('NotificationBell', () => {
  it('shows the unread badge from the poll', async () => {
    renderBell();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('opens the panel, lists notifications, marks read + deep-links on click', async () => {
    renderBell();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await waitFor(() => expect(screen.getByText('Work order assigned: Tower North')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Work order assigned: Tower North'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/notifications/{id}/read',
      expect.objectContaining({ params: { path: { id: 11 } } }),
    ));
    expect(mockNavigate).toHaveBeenCalledWith('/work-orders');
  });

  it('mark-all-read hits the endpoint', async () => {
    renderBell();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await waitFor(() => expect(screen.getByText('Mark all read')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/read-all'));
  });

  it('deep-links a device notification to /devices/:id', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/notifications/unread-count') return Promise.resolve({ data: { data: { count: 1 } } });
      return Promise.resolve({
        data: {
          data: [{
            id: 12, title: 'Dispositivo fuera de línea: AP-Tower-1', body: 'IP: 10.0.0.1',
            type: 'device', entity_type: 'devices', entity_id: 70, is_read: 0,
            created_at: new Date(Date.now() - 60_000).toISOString(),
          }],
        },
      });
    });

    renderBell();
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await waitFor(() => expect(screen.getByText('Dispositivo fuera de línea: AP-Tower-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dispositivo fuera de línea: AP-Tower-1'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/devices/70'));
  });

  it('deep-links an outage notification to the /outages list (no detail route)', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/notifications/unread-count') return Promise.resolve({ data: { data: { count: 1 } } });
      return Promise.resolve({
        data: {
          data: [{
            id: 13, title: 'Interrupción reportada: Fiber cut', body: 'Severidad: critical',
            type: 'outage', entity_type: 'outages', entity_id: 50, is_read: 0,
            created_at: new Date(Date.now() - 60_000).toISOString(),
          }],
        },
      });
    });

    renderBell();
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await waitFor(() => expect(screen.getByText('Interrupción reportada: Fiber cut')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Interrupción reportada: Fiber cut'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/outages'));
  });
});
