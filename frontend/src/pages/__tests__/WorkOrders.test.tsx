// =============================================================================
// FireISP 5.0 — WorkOrders page tests (§12 / Inventory Phase 3, migration 391)
// =============================================================================
// Focused on the pickup-checklist disposition UI: a work_type='pickup' order
// shows the outstanding rented-equipment checklist instead of the materials
// panel when expanded, and resolving a unit posts the disposition endpoint.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkOrders } from '../WorkOrders';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockAuthedFetch = vi.fn();
vi.mock('@/api/client', () => ({
  api: { GET: (...a: unknown[]) => mockApiGet(...a), POST: (...a: unknown[]) => mockApiPost(...a) },
  authedFetch: (...a: unknown[]) => mockAuthedFetch(...a),
}));

let mockLocale: 'global' | 'MX' = 'MX';
let mockRole = 'admin';
let mockPermissions: string[] | undefined;
vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: {
    id: 1,
    role: mockRole,
    permissions: mockPermissions,
    organization_locale: mockLocale,
  } }),
}));

const pickupOrder = {
  id: 700, ticket_id: null, assigned_to: null, status: 'in_progress', priority: 'medium',
  title: 'Equipment pickup', description: null, scheduled_at: null, completed_at: null,
  organization_id: 42, created_at: '2026-01-01',
  client_id: 100, site_id: null, device_id: null, contract_id: 900, service_order_id: null,
  work_type: 'pickup', client_name: 'Acme Corp', site_name: null, device_name: null,
  assigned_first: null, assigned_last: null,
};

const pickupUnit = { id: 50, serial_number: 'SN-RENT-1', item_name: 'ONU-X', sku: 'ONU-X-1', lifecycle_state: 'assigned' };

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkOrders />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLocale = 'MX';
  mockRole = 'admin';
  mockPermissions = undefined;
  mockApiPost.mockResolvedValue({ data: { data: {} }, error: undefined });
  mockApiGet.mockImplementation((path: string) => {
    if (path === '/work-orders') {
      return Promise.resolve({
        data: { data: [pickupOrder], meta: { total: 1, page: 1, limit: 25 } },
        error: undefined,
      });
    }
    if (path === '/work-orders/assignable-users') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/sites' || path === '/devices') {
      return Promise.resolve({ data: { data: [] }, error: undefined });
    }
    if (path === '/work-orders/{id}/pickup-items') {
      return Promise.resolve({
        data: { data: [pickupUnit], meta: { work_order_id: 700, contract_id: 900, status: 'in_progress' } },
        error: undefined,
      });
    }
    return Promise.resolve({ data: { data: [] }, error: undefined });
  });
  mockAuthedFetch.mockResolvedValue(jsonResponse({ data: {} }));
});

describe('WorkOrders — pickup checklist', () => {
  it('labels a pickup order with the Pickup work type and hides the generic Complete button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    // in_progress pickup orders can still be Cancelled, but never blindly Completed.
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('expanding the row shows the outstanding rented-equipment checklist, not materials', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));

    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());
    expect(screen.getByText('ONU-X')).toBeInTheDocument();
    expect(screen.queryByText('Add Material')).not.toBeInTheDocument();
  });

  it('resolving a unit as returned posts the disposition endpoint', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Returned to Stock'));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/700/pickup-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cpe_device_id: 50, disposition: 'returned' }),
      }),
    ));
  });

  it('resolving a unit as damaged posts an rma disposition', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('SN-RENT-1')).toBeInTheDocument());

    const row = screen.getByText('SN-RENT-1').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByText('Damaged / RMA'));

    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/700/pickup-items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cpe_device_id: 50, disposition: 'rma' }),
      }),
    ));
  });

  it('shows "no outstanding equipment" once the checklist is empty', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [pickupOrder], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      if (path === '/work-orders/{id}/pickup-items') {
        return Promise.resolve({ data: { data: [], meta: { work_order_id: 700, contract_id: 900, status: 'completed' } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Equipment pickup')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Equipment pickup'));
    await waitFor(() => expect(screen.getByText('No outstanding equipment.')).toBeInTheDocument());
  });
});

// =============================================================================
// Install-acceptance modal (migration 445): completing a contract-linked
// installation WO must capture a reading (or waive) — never a blind flip.
// =============================================================================
const installOrder = {
  ...pickupOrder,
  id: 701, title: 'Installation — SO-000011', work_type: 'installation', contract_id: 901,
};

describe('WorkOrders — install acceptance on Complete', () => {
  beforeEach(() => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [installOrder], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue(jsonResponse({ data: {} }));
  });

  it('Complete opens the acceptance modal instead of patching blindly', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Complete'));
    expect(await screen.findByText(/acceptance readings/i)).toBeInTheDocument();
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });

  it('requires a reading or a waive before submitting', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Complete'));
    fireEvent.click(await screen.findByText('Complete work order'));
    expect(await screen.findByText('Enter at least one reading, or tick the waive checkbox.')).toBeInTheDocument();
    expect(mockAuthedFetch).not.toHaveBeenCalled();
  });

  it('submits the readings with the completion PATCH', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Complete'));
    const signal = await screen.findByPlaceholderText('-58');
    fireEvent.change(signal, { target: { value: '-61' } });
    fireEvent.click(screen.getByText('Complete work order'));
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/701',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', acceptance_signal_dbm: -61 }),
      }),
    ));
  });

  it('a non-installation order still completes directly', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({
          data: { data: [{ ...installOrder, id: 702, title: 'Fix antenna', work_type: 'repair' }], meta: { total: 1, page: 1, limit: 25 } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Fix antenna')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Complete'));
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/702',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }),
    ));
  });
});

// =============================================================================
// Legal documents panel (migration 447): pending docs surface on installation
// WOs with a Read & sign action; the modal shows the FROZEN body.
// =============================================================================
describe('WorkOrders — legal documents panel', () => {
  const docsOrder = { ...installOrder, id: 703, service_order_id: 16 };
  const arrivalDetail = {
    id: 9,
    title: 'Autorización de instalación',
    status: 'pending',
    signer_name: null,
    signed_at: null,
    template_type: 'installation_authorization',
    rendered_body: 'Yo **María** autorizo la instalación en Calle 1.',
  };

  function mockDocsPaths({ docs, detail = arrivalDetail }: { docs: unknown[]; detail?: Record<string, unknown> }) {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [docsOrder], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      if (path === '/signed-documents') {
        return Promise.resolve({ data: { data: docs }, error: undefined });
      }
      if (path === '/signed-documents/{id}') {
        return Promise.resolve({
          data: { data: detail },
          error: undefined,
        });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
  }

  it('lists pending documents on an expanded installation WO and opens the sign modal with the frozen text', async () => {
    mockDocsPaths({ docs: [{ id: 9, template_type: 'installation_authorization', title: 'Autorización de instalación', status: 'pending', signer_name: null, signed_at: null }] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText('Autorización de instalación')).toBeInTheDocument();
    expect(screen.getByText('Pending signature')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Read & sign'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });
    expect(await within(dialog).findByText(/autorizo la instalación en Calle 1/)).toBeInTheDocument();
    expect(within(dialog).getByText('Sign document')).toBeInTheDocument();
    expect(within(dialog).queryByText('Optional marketing communications')).not.toBeInTheDocument();
  });

  it('does not request or expose document metadata without signed_documents.view', async () => {
    mockRole = 'custom';
    mockPermissions = ['work_orders.view'];
    mockDocsPaths({ docs: [{ id: 9, template_type: 'installation_authorization', title: 'Private authorization', status: 'pending' }] });
    renderPage();
    fireEvent.click(await screen.findByText('Installation — SO-000011'));

    expect(await screen.findByText(/need signed_documents.view/i)).toBeInTheDocument();
    expect(screen.queryByText('Private authorization')).not.toBeInTheDocument();
    expect(mockApiGet.mock.calls.some(([path]) => path === '/signed-documents')).toBe(false);
  });

  it('allows document viewing but not signing without signed_documents.sign', async () => {
    mockRole = 'custom';
    mockPermissions = ['work_orders.view', 'signed_documents.view'];
    mockDocsPaths({ docs: [{ id: 9, template_type: 'installation_authorization', title: 'View-only authorization', status: 'pending' }] });
    renderPage();
    fireEvent.click(await screen.findByText('Installation — SO-000011'));

    expect(await screen.findByText('View-only authorization')).toBeInTheDocument();
    expect(screen.getByText(/Signing requires signed_documents.sign/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read & sign' })).not.toBeInTheDocument();
  });

  it('keeps a visible close and retry path when document detail fails to load', async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [docsOrder], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      if (path === '/signed-documents') {
        return Promise.resolve({
          data: { data: [{ id: 9, template_type: 'installation_authorization', title: 'Authorization', status: 'pending' }] },
          error: undefined,
        });
      }
      if (path === '/signed-documents/{id}') {
        return Promise.resolve({ data: undefined, error: { error: { message: 'offline' } } });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });

    renderPage();
    fireEvent.click(await screen.findByText('Installation — SO-000011'));
    fireEvent.click(await screen.findByText('Read & sign'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign document' })).not.toBeInTheDocument());
  });

  it('signs an arrival authorization without communication-choice fields', async () => {
    mockDocsPaths({ docs: [{ id: 9, template_type: 'installation_authorization', title: 'Autorización de instalación', status: 'pending', signer_name: null, signed_at: null }] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));
    fireEvent.click(await screen.findByText('Read & sign'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });

    fireEvent.change(await within(dialog).findByLabelText('Full name of the signer'), { target: { value: 'María F.' } });
    const canvas = within(dialog).getByTestId('signature-canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getContext', {
      value: () => ({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() }),
    });
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'toDataURL', { value: () => 'data:image/png;base64,YXJyaXZhbA==' });
    fireEvent.pointerDown(canvas, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign document' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/signed-documents/{id}/sign',
      {
        params: { path: { id: 9 } },
        body: {
          signer_name: 'María F.',
          signature_image: 'data:image/png;base64,YXJyaXZhbA==',
        },
      },
    ));
  });

  it('shows generic service acknowledgments and binds choices to the exact server privacy notice', async () => {
    mockLocale = 'global';
    mockDocsPaths({
      docs: [{ id: 10, template_type: 'service_acknowledgment', title: 'Service installation acknowledgment', status: 'pending', signer_name: null, signed_at: null }],
      detail: {
        id: 10,
        template_type: 'service_acknowledgment',
        title: 'Service installation acknowledgment',
        status: 'pending',
        signer_name: null,
        signed_at: null,
        rendered_body: 'I confirm the service handoff.',
        communication_contacts: { email: false, phone: true },
        privacy_notice: {
          version: 'global-2026-08',
          content: '# Global privacy notice\nFull notice text.',
          hash: 'b'.repeat(64),
        },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText('Service acknowledgments')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Read & sign'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });
    expect(await within(dialog).findByText('Global privacy notice')).toBeInTheDocument();
    expect(within(dialog).getByText(/version global-2026-08/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Email/ })).toBeDisabled();
    const sms = within(dialog).getByRole('checkbox', { name: /SMS/ });
    expect(sms).not.toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /WhatsApp/ })).not.toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Full name of the signer'), { target: { value: 'Ada Customer' } });
    const canvas = within(dialog).getByTestId('signature-canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getContext', {
      value: () => ({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() }),
    });
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'toDataURL', { value: () => 'data:image/png;base64,Z2xvYmFs' });
    fireEvent.pointerDown(canvas, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(sms);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /customer reviewed the privacy notice/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign document' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/signed-documents/{id}/sign',
      {
        params: { path: { id: 10 } },
        body: {
          signer_name: 'Ada Customer',
          signature_image: 'data:image/png;base64,Z2xvYmFs',
          communication_opt_ins: { email: false, sms: true, whatsapp: false },
          communication_choices_confirmed: true,
          privacy_notice_version: 'global-2026-08',
          privacy_notice_hash: 'b'.repeat(64),
        },
      },
    ));
  });

  it('does not overwrite communication choices already recorded by another MX handoff document', async () => {
    mockDocsPaths({
      docs: [{ id: 11, template_type: 'activation_contract', title: 'Second activation annex', status: 'pending', signer_name: null, signed_at: null }],
      detail: {
        id: 11,
        template_type: 'activation_contract',
        title: 'Second activation annex',
        status: 'pending',
        signer_name: null,
        signed_at: null,
        rendered_body: 'A second required activation annex.',
        communication_choices_recorded: true,
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));
    fireEvent.click(await screen.findByText('Read & sign'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign document' });

    expect(await within(dialog).findByTestId('communication-choices-recorded')).toHaveTextContent(/already captured with another handoff document/i);
    expect(within(dialog).queryByText('Optional marketing communications')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Full name of the signer'), { target: { value: 'María F.' } });
    const canvas = within(dialog).getByTestId('signature-canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getContext', {
      value: () => ({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() }),
    });
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'toDataURL', { value: () => 'data:image/png;base64,c2Vjb25k' });
    fireEvent.pointerDown(canvas, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign document' }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith(
      '/signed-documents/{id}/sign',
      {
        params: { path: { id: 11 } },
        body: {
          signer_name: 'María F.',
          signature_image: 'data:image/png;base64,c2Vjb25k',
        },
      },
    ));
  });

  it('shows signed state instead of a sign button once signed', async () => {
    mockDocsPaths({ docs: [{ id: 9, template_type: 'installation_authorization', title: 'Autorización de instalación', status: 'signed', signer_name: 'María F.', signed_at: '2026-08-05' }] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText(/Signed by María F\./)).toBeInTheDocument();
    expect(screen.queryByText('Read & sign')).not.toBeInTheDocument();
  });

  it('renders no panel at all when the order has no documents', async () => {
    mockDocsPaths({ docs: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));
    await waitFor(() => expect(screen.queryByText('Legal documents')).not.toBeInTheDocument());
  });
});

// =============================================================================
// Install test window (migration 448): pending contract → start/end controls;
// active contract → panel absent (activation owns the line).
// =============================================================================
describe('WorkOrders — install test window', () => {
  function mockWindowPaths({ contract }: { contract: {
    status: string;
    connection_type?: string;
    test_window_expires_at: string | null;
    test_window_cleanup_pending?: boolean;
  } }) {
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/work-orders') {
        return Promise.resolve({ data: { data: [{ ...installOrder, id: 704, contract_id: 901, service_order_id: 16 }], meta: { total: 1, page: 1, limit: 25 } }, error: undefined });
      }
      if (path === '/contracts/{id}') {
        return Promise.resolve({ data: { data: contract }, error: undefined });
      }
      if (path === '/signed-documents') {
        return Promise.resolve({ data: { data: [] }, error: undefined });
      }
      return Promise.resolve({ data: { data: [] }, error: undefined });
    });
    mockAuthedFetch.mockResolvedValue(jsonResponse({ data: { expires_at: 'x' } }));
  }

  it('offers Start on a pending contract with the line down, and posts the start action', async () => {
    mockWindowPaths({ contract: { status: 'pending', test_window_expires_at: null } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText(/Line is down until activation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open contract commissioning/ })).toHaveAttribute('href', '/contracts/901');
    fireEvent.click(screen.getByText('Start test window'));
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/704/test-window/start',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('shows the open window with its bound and an End action', async () => {
    mockWindowPaths({ contract: { status: 'pending', test_window_expires_at: '2099-08-05 12:30:00' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText(/Test internet ON until 12:30/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('End test window'));
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/704/test-window/end',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('shows cleanup retry instead of claiming an expired retained window is still open', async () => {
    mockWindowPaths({ contract: {
      status: 'pending',
      test_window_expires_at: '2000-08-05 12:30:00',
      test_window_cleanup_pending: true,
    } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText(/live-session shutdown is still being verified/)).toBeInTheDocument();
    expect(screen.queryByText(/Test internet ON/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry shutdown' }));
    await waitFor(() => expect(mockAuthedFetch).toHaveBeenCalledWith(
      '/api/v1/work-orders/704/test-window/end',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('renders no panel once the contract is active', async () => {
    mockWindowPaths({ contract: { status: 'active', test_window_expires_at: null } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));
    await waitFor(() => expect(screen.queryByText('Test window')).not.toBeInTheDocument());
  });

  it('sends a static installation to contract commissioning without offering a RADIUS window', async () => {
    mockWindowPaths({ contract: { status: 'pending', connection_type: 'static', test_window_expires_at: null } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Installation — SO-000011')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Installation — SO-000011'));

    expect(await screen.findByText(/static\/non-RADIUS line must be tested and switched off manually/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start test window' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open contract commissioning/ })).toHaveAttribute('href', '/contracts/901');
  });
});
