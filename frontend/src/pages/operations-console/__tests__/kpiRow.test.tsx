// =============================================================================
// FireISP Operations Console — KPI tile visibility + deep links
// =============================================================================
// Active Clients is admin-only; Overdue is admin/billing; Devices Online and
// Open Tickets are clickable for everyone who sees the console.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as AuthContextModule from '@/auth/AuthContext';
import type { AuthUser } from '@/auth/AuthContext';
import { KpiRow } from '../consoleWidgets';
import type { KpiModel } from '../consoleModel';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const kpis: KpiModel = {
  activeClients: { value: '26', spark: null },
  mrr: { value: '12.4', unit: 'k', code: 'MXN', spark: null },
  devicesOnline: { online: 4, total: 5 },
  liveSessions: { value: '31', note: 'PPPoE + DHCP' },
  openTickets: { value: '7', mix: [{ w: 1, tone: 'accent' }] },
  overdue: { value: '12', amount: '48k', note: '3 clients > 30d' },
};

function mockRole(role: string) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: { id: 1, email: 'x@y.z', name: 'X', role, organization_id: 1, is_active: true, email_verified_at: null, twofa_enabled: false } as AuthUser,
    loading: false,
    initialized: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchOrganization: vi.fn(),
  } as unknown as ReturnType<typeof AuthContextModule.useAuth>);
}

function renderRow(role: string) {
  mockRole(role);
  render(<MemoryRouter><KpiRow kpis={kpis} /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe('KpiRow role visibility', () => {
  it('admin sees Active Clients and Overdue', () => {
    renderRow('admin');
    expect(screen.getByText('Active Clients')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('billing sees Overdue but not Active Clients', () => {
    renderRow('billing');
    expect(screen.queryByText('Active Clients')).not.toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('support sees neither Active Clients nor Overdue', () => {
    renderRow('support');
    expect(screen.queryByText('Active Clients')).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByText('Open Tickets')).toBeInTheDocument();
  });
});

describe('KpiRow deep links', () => {
  it('Open Tickets tile navigates to the pre-filtered ticket list', () => {
    renderRow('admin');
    fireEvent.click(screen.getByRole('link', { name: /Open Tickets/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/tickets?status=open');
  });

  it('Active Clients tile navigates to the client list', () => {
    renderRow('admin');
    fireEvent.click(screen.getByRole('link', { name: /Active Clients/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/clients');
  });

  it('Devices Online tile navigates to the device map', () => {
    renderRow('admin');
    fireEvent.click(screen.getByRole('link', { name: /Devices Online/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/devices');
  });

  it('Overdue tile navigates to overdue invoices, also via keyboard', () => {
    renderRow('billing');
    fireEvent.keyDown(screen.getByRole('link', { name: /Overdue/ }), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/invoices?status=overdue');
  });
});
