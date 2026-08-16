// =============================================================================
// FireISP 5.0 — SNII infrastructure preparation regressions
// =============================================================================
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SniiInfrastructureReportingPage } from '../SniiInfrastructureReportingPage';

type MockUser = {
  id: number;
  role: string;
  organization_locale: 'MX' | 'global';
  permissions: string[];
};

const mocks = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  digest: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:snii-artifact'),
  revokeObjectURL: vi.fn(),
  user: {
    current: {
      id: 17,
      role: 'support',
      organization_locale: 'MX',
      permissions: [] as string[],
    } as MockUser,
  },
}));

vi.mock('@/api/client', () => ({
  authedFetch: (...args: unknown[]) => mocks.authedFetch(...args),
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

const ALL_PERMISSIONS = [
  'snii_reporting.view',
  'snii_reporting.review',
  'snii_reporting.prepare',
  'snii_reporting.approve',
  'snii_reporting.export',
  'snii_reporting.file',
  'snii_reporting.evidence',
];

const CATALOG = {
  module_mode: 'preparation_only',
  legal_basis: 'LMTR 174-181',
  authority: 'CRT',
  exclusion_reasons: ['dummy', 'test', 'cpe', 'customer_drop', 'duplicate', 'not_applicable', 'reported_by_owner', 'other'],
  element_types: [
    {
      key: 'torre',
      label: 'Tower',
      filename: 'torre.csv',
      format: 'csv',
      geometry: 'point',
      frequency: 'semiannual',
      headers: ['CODIGO_IDENTIFICADOR', 'LATITUD', 'LONGITUD'],
    },
    {
      key: 'cable_fibra_acceso',
      label: 'Access fiber',
      filename: 'cable_fibra_acceso.kml',
      format: 'kml',
      geometry: 'line',
      frequency: 'annual',
      headers: ['CODIGO_IDENTIFICADOR', 'LONGITUD'],
    },
  ],
};

const PROFILE = {
  id: 7,
  concession_title_id: 21,
  concession_title_snapshot: {
    id: 21,
    title_number: 'CRT-TITLE-21',
    concession_type: 'single_concession',
    services_authorized: ['internet', 'transport'],
    geographic_scope: 'Chihuahua, MX',
    spectrum_bands: ['5 GHz'],
    granted_date: '2024-01-15',
    expiration_date: '2034-01-14',
    renewal_filed_at: '2033-07-01T14:22:11.321Z',
    regulatory_body: 'CRT',
    document_file_id: 809,
    status: 'active',
  },
  concession_title_sha256: 'e'.repeat(64),
  electronic_folio: 'SNII-0009',
  source_channel: 'crt_ventanilla_current',
  source_attestation_reference: 'CRT-VENTANILLA-REVIEW-2026-08',
  adapter_reconciliation_reference: 'SNII-ADAPTER-REVIEW-2026-08',
  adapter_reconciliation_sha256: 'd'.repeat(64),
  adapter_reconciled_at: '2026-08-11T12:30:45.123Z',
  template_version: 'IFT-SNII-2024-v2',
  template_source_url: 'https://www.ift.org.mx/industria/plantillas-de-descarga-disponibles-para-snii',
  template_sha256: 'a'.repeat(64),
  template_effective_date: '2024-02-29T00:00:00.000Z',
  dictionary_version: 'IFT-SNII-dictionary-v2',
  dictionary_source_url: 'https://www.ift.org.mx/industria/diccionarios-de-datos',
  dictionary_sha256: 'b'.repeat(64),
  annex_v_version: 'IFT-SNII-annex-v',
  annex_v_source_url: 'https://www.ift.org.mx/sites/default/files/contenidogeneral/industria/anexov.xlsx',
  annex_v_sha256: 'c'.repeat(64),
  official_sources_reviewed_at: '2026-08-10T12:30:45.123Z',
  subject_applicability: 'unreviewed',
  applicability_basis: null,
  external_decision_reference: null,
  source_freshness_days: 90,
};

const PROFILE_ENVELOPE = {
  data: PROFILE,
  applicability: [],
  readiness: {
    ready: false,
    blockers: ['Every candidate must be reviewed.'],
    counts: { unreviewed_candidates: 1 },
    schedule: {
      folio_last_digit: 9,
      first_window: { year: 2026, start_month: 1, end_month: 2, reference_range: 'January–February 2026' },
      second_window: { year: 2026, start_month: 7, end_month: 8, reference_range: 'July–August 2026' },
    },
  },
};

const CANDIDATE = {
  source_type: 'device',
  source_id: 42,
  suggested_element_type: 'torre',
  source_hash: 'a'.repeat(64),
  registry_id: null,
  decision: null,
  eligibility: 'unreviewed',
  blockers: ['classification_required'],
  payload: { name: 'POP north tower' },
};

const ASSET = {
  id: 61,
  profile_id: 7,
  source_type: 'device',
  source_id: 42,
  element_type: 'torre',
  decision: 'included',
  approval_status: 'pending',
  official_code: 'TORRE-42',
  source_snapshot_hash: '3'.repeat(64),
  classification_hash: '4'.repeat(64),
  classification_revision: 2,
  current_source_hash: '3'.repeat(64),
  is_stale: false,
  decision_evidence_reference: 'CLASSIFICATION-42',
  classified_by: 91,
  reviewed_payload: { CODIGO_IDENTIFICADOR: 'TORRE-42', LATITUD: '28.63299', LONGITUD: '-106.06910' },
  current_reviewed_payload: { CODIGO_IDENTIFICADOR: 'TORRE-42', LATITUD: '28.63299', LONGITUD: '-106.06910' },
};

const ARTIFACT = {
  id: 88,
  element_type: 'torre',
  filename: 'torre.csv',
  mime_type: 'text/csv',
  byte_size: 321,
  sha256: '1'.repeat(64),
};

const BATCH = {
  id: 51,
  profile_id: 7,
  concession_title_id: 21,
  concession_title_snapshot: PROFILE.concession_title_snapshot,
  concession_title_sha256: PROFILE.concession_title_sha256,
  applicability_snapshot: {
    subject: {
      status: 'applicable',
      basis: 'LMTR 174–181 title review',
      external_decision_reference: 'LEGAL-2026-42',
      decided_by: 91,
      decided_at: '2026-08-12T15:00:00.000Z',
    },
    elements: [{
      element_type: 'torre',
      applicability: 'applicable',
      rationale: 'Operator-owned towers',
      population_status: 'has_assets',
      population_evidence_reference: null,
      reviewed_by: 91,
      reviewed_at: '2026-08-12T15:05:00.000Z',
    }],
  },
  electronic_folio: PROFILE.electronic_folio,
  revision: 3,
  correction_root_batch_id: null,
  supersession_reason: null,
  period_start: '2026-07-01T00:00:00.000Z',
  period_end: '2026-08-31T23:59:59.000Z',
  state: 'exported',
  snapshot_hash: '2'.repeat(64),
  filing_kind: 'update',
  filing_window: 'second_combined',
  filing_frequency: 'annual_and_semiannual',
  filing_year: 2026,
  full_load: true,
  template_version: PROFILE.template_version,
  template_sha256: PROFILE.template_sha256,
  dictionary_version: PROFILE.dictionary_version,
  dictionary_sha256: PROFILE.dictionary_sha256,
  annex_v_version: PROFILE.annex_v_version,
  annex_v_sha256: PROFILE.annex_v_sha256,
  official_sources_reviewed_by: 17,
  official_sources_reviewed_at: PROFILE.official_sources_reviewed_at,
  source_freshness_days: PROFILE.source_freshness_days,
  validation_result: null,
  item_count: 1,
  artifacts: [ARTIFACT],
  filing_events: [] as unknown[],
  element_types_snapshot: ['torre'],
};

interface ApiFixture {
  candidates?: unknown[];
  assets?: unknown[];
  assetDetail?: typeof ASSET;
  batches?: unknown[];
  selectedBatch?: Record<string, unknown>;
  profileEnvelope?: Record<string, unknown>;
  profileAfterSave?: Record<string, unknown>;
  createBatchError?: { error: { message: string; details?: Array<Record<string, unknown>> } };
  downloadChecksum?: string | null;
  evidenceDownloadChecksum?: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
    blob: vi.fn().mockResolvedValue(new Blob()),
  } as unknown as Response;
}

function binaryResponse(checksum: string | null): Response {
  const headers = new Headers({
    'content-disposition': 'attachment; filename="torre.csv"',
    'content-type': 'text/csv',
  });
  if (checksum !== null) headers.set('x-evidence-sha256', checksum);
  const bytes = new TextEncoder().encode('official SNII artifact').buffer;
  const blob = { arrayBuffer: vi.fn().mockResolvedValue(bytes) } as unknown as Blob;
  return {
    ok: true,
    status: 200,
    headers,
    json: vi.fn().mockResolvedValue(null),
    blob: vi.fn().mockResolvedValue(blob),
  } as unknown as Response;
}

function installApi(fixture: ApiFixture = {}) {
  let profileEnvelope = fixture.profileEnvelope ?? PROFILE_ENVELOPE;
  mocks.authedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace('/api/v1/snii-reporting', '');
    const method = init?.method ?? 'GET';

    if (path === '/catalog' && method === 'GET') return jsonResponse({ data: CATALOG });
    if (path === '/profile' && method === 'GET') return jsonResponse(profileEnvelope);
    if (path === '/profile' && method === 'PUT' && fixture.profileAfterSave) {
      profileEnvelope = fixture.profileAfterSave;
      return jsonResponse({ data: fixture.profileAfterSave.data });
    }
    if (path === '/candidates?limit=250&offset=0' && method === 'GET') {
      return jsonResponse({ data: fixture.candidates ?? [] });
    }
    if (path === '/assets?limit=250&offset=0' && method === 'GET') return jsonResponse({ data: fixture.assets ?? [] });
    if (path === `/assets/${ASSET.id}` && method === 'GET') return jsonResponse({ data: fixture.assetDetail ?? ASSET });
    if (path === '/batches' && method === 'GET') return jsonResponse({ data: fixture.batches ?? [] });
    if (path === '/batches' && method === 'POST' && fixture.createBatchError) {
      return jsonResponse(fixture.createBatchError, 422);
    }
    if (path === `/batches/${BATCH.id}` && method === 'GET') {
      return jsonResponse({ data: fixture.selectedBatch ?? BATCH });
    }
    if (path === `/artifacts/${ARTIFACT.id}/download` && method === 'GET') {
      const checksum = Object.prototype.hasOwnProperty.call(fixture, 'downloadChecksum')
        ? fixture.downloadChecksum ?? null
        : 'ab'.repeat(32);
      return binaryResponse(checksum);
    }
    if (path === '/filing-events/73/evidence/download' && method === 'GET') {
      const checksum = Object.prototype.hasOwnProperty.call(fixture, 'evidenceDownloadChecksum')
        ? fixture.evidenceDownloadChecksum ?? null
        : 'ab'.repeat(32);
      return binaryResponse(checksum);
    }
    if (path === '/audit-events?limit=100&offset=0' && method === 'GET') return jsonResponse({ data: [] });
    return jsonResponse({ data: { ok: true } });
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SniiInfrastructureReportingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPackages() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Packages & filing' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
  await screen.findByText('Batch #51');
}

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

describe('SniiInfrastructureReportingPage', () => {
  beforeEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    mocks.user.current = {
      id: 17,
      role: 'support',
      organization_locale: 'MX',
      permissions: [...ALL_PERMISSIONS],
    };
    mocks.digest.mockResolvedValue(Uint8Array.from({ length: 32 }, () => 0xab).buffer);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: mocks.digest } },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
    installApi();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    if (originalCreateObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('is visibly preparation-only and states that CPE is never auto-included', async () => {
    installApi({ candidates: [CANDIDATE] });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'SNII infrastructure preparation' })).toBeInTheDocument();
    expect(screen.getByText('Preparation only')).toBeInTheDocument();
    expect(screen.getByText(/FireISP does not submit to the CRT or certify legal compliance/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Infrastructure review' }));
    expect(await screen.findByText(/Customer CPE, ONUs, drops, dummy assets/)).toHaveTextContent(
      'never auto-included',
    );
  });

  it('saves a trimmed organization profile only with prepare permission', async () => {
    mocks.user.current.permissions = ['snii_reporting.view', 'snii_reporting.prepare'];
    renderPage();

    const folio = await screen.findByDisplayValue('SNII-0009');
    fireEvent.change(folio, { target: { value: '  CRT-12345  ' } });
    fireEvent.change(screen.getByDisplayValue('IFT-SNII-2024-v2'), {
      target: { value: '  CRT-2026-08  ' },
    });
    fireEvent.change(screen.getByDisplayValue(PROFILE.template_source_url), {
      target: { value: '  https://portal.crt.gob.mx/snii/templates  ' },
    });
    fireEvent.change(screen.getByDisplayValue('2024-02-29'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByDisplayValue('90'), {
      target: { value: '30' },
    });
    const form = folio.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/profile'
        && (init as RequestInit | undefined)?.method === 'PUT');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        concession_title_id: 21,
        electronic_folio: 'CRT-12345',
        source_channel: 'crt_ventanilla_current',
        source_attestation_reference: 'CRT-VENTANILLA-REVIEW-2026-08',
        adapter_reconciliation_reference: 'SNII-ADAPTER-REVIEW-2026-08',
        adapter_reconciliation_sha256: 'd'.repeat(64),
        adapter_reconciled_at: PROFILE.adapter_reconciled_at,
        template_version: 'CRT-2026-08',
        template_source_url: 'https://portal.crt.gob.mx/snii/templates',
        template_sha256: 'a'.repeat(64),
        template_effective_date: '2026-08-01',
        dictionary_version: 'IFT-SNII-dictionary-v2',
        dictionary_source_url: 'https://www.ift.org.mx/industria/diccionarios-de-datos',
        dictionary_sha256: 'b'.repeat(64),
        annex_v_version: 'IFT-SNII-annex-v',
        annex_v_source_url: 'https://www.ift.org.mx/sites/default/files/contenidogeneral/industria/anexov.xlsx',
        annex_v_sha256: 'c'.repeat(64),
        official_sources_reviewed_at: PROFILE.official_sources_reviewed_at,
        source_freshness_days: 30,
      });
    });
  });

  it('round-trips profile attestation instants through datetime-local fields in the MX timezone', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Chihuahua';

    try {
      mocks.user.current.permissions = ['snii_reporting.view', 'snii_reporting.prepare'];
      renderPage();

      expect(await screen.findByDisplayValue('2026-08-11T06:30:45.123')).toHaveAttribute('type', 'datetime-local');
      expect(screen.getByDisplayValue('2026-08-11T06:30:45.123')).toHaveAttribute('step', '0.001');
      expect(screen.getByDisplayValue('2026-08-10T06:30:45.123')).toHaveAttribute('type', 'datetime-local');
      expect(screen.getByDisplayValue('2026-08-10T06:30:45.123')).toHaveAttribute('step', '0.001');

      const folio = screen.getByDisplayValue('SNII-0009');
      const form = folio.closest('form');
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);

      await waitFor(() => {
        const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
          String(input) === '/api/v1/snii-reporting/profile'
          && (init as RequestInit | undefined)?.method === 'PUT');
        expect(call).toBeDefined();
        const body = JSON.parse(String((call?.[1] as RequestInit).body));
        expect(body.adapter_reconciled_at).toBe(PROFILE.adapter_reconciled_at);
        expect(body.official_sources_reviewed_at).toBe(PROFILE.official_sources_reviewed_at);
      });
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('keeps the legal applicability decision behind the review permission and separate endpoint', async () => {
    mocks.user.current.permissions = ['snii_reporting.view', 'snii_reporting.review'];
    renderPage();

    expect(await screen.findByDisplayValue('SNII-0009')).toBeDisabled();
    const titleContext = screen.getByRole('region', { name: 'Frozen concession-title review context' });
    expect(within(titleContext).getByText('CRT-TITLE-21')).toBeInTheDocument();
    expect(within(titleContext).getByText('single_concession')).toBeInTheDocument();
    expect(within(titleContext).getByText('internet, transport')).toBeInTheDocument();
    expect(within(titleContext).getByText('Chihuahua, MX')).toBeInTheDocument();
    expect(within(titleContext).getByText('active')).toBeInTheDocument();
    expect(within(titleContext).getByText(PROFILE.concession_title_sha256)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Organization / title applicability'), {
      target: { value: 'applicable' },
    });
    fireEvent.change(screen.getByLabelText(/Applicability decision basis/), {
      target: { value: '  LMTR 174–181 title review  ' },
    });
    fireEvent.change(screen.getByLabelText(/External counsel \/ compliance decision reference/), {
      target: { value: '  LEGAL-2026-42  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save applicability decision' }));

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/profile/subject-applicability'
        && (init as RequestInit | undefined)?.method === 'PUT');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        status: 'applicable',
        applicability_basis: 'LMTR 174–181 title review',
        external_decision_reference: 'LEGAL-2026-42',
      });
    });
    expect(mocks.authedFetch.mock.calls.some(([input, init]) =>
      String(input) === '/api/v1/snii-reporting/profile'
      && (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('resets element applicability controls after a profile identity change invalidates review', async () => {
    const reviewedEnvelope = {
      ...PROFILE_ENVELOPE,
      applicability: [{
        element_type: 'torre',
        status: 'applicable',
        rationale: 'Old title tower decision',
        population_status: 'zero_population',
        population_evidence_reference: 'OLD-TITLE-ZERO-POPULATION',
      }],
    };
    const resetEnvelope = {
      ...PROFILE_ENVELOPE,
      data: { ...PROFILE, electronic_folio: 'SNII-0010' },
      applicability: [{
        element_type: 'torre',
        status: 'unreviewed',
        rationale: null,
        population_status: 'unreviewed',
        population_evidence_reference: null,
      }],
    };
    installApi({ profileEnvelope: reviewedEnvelope, profileAfterSave: resetEnvelope });
    renderPage();

    const towerRow = (await screen.findByText('Tower')).closest('tr') as HTMLTableRowElement;
    expect(within(towerRow).getByLabelText('Status')).toHaveValue('applicable');
    expect(within(towerRow).getByLabelText('Decision rationale / reference')).toHaveValue('Old title tower decision');
    expect(within(towerRow).getByLabelText('Population decision')).toHaveValue('zero_population');

    const folio = screen.getByDisplayValue('SNII-0009');
    fireEvent.change(folio, { target: { value: 'SNII-0010' } });
    fireEvent.submit(folio.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(within(towerRow).getByLabelText('Status')).toHaveValue('unreviewed');
      expect(within(towerRow).getByLabelText('Decision rationale / reference')).toHaveValue('');
      expect(within(towerRow).queryByLabelText('Population decision')).not.toBeInTheDocument();
    });
  });

  it('keeps a newly discovered candidate unreviewed until an explicit decision', async () => {
    installApi({ candidates: [CANDIDATE] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Infrastructure review' }));

    const source = await screen.findByText('device #42');
    const row = source.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getAllByText('unreviewed').length).toBeGreaterThan(0);
    fireEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: 'Review' }));

    const dialog = screen.getByRole('dialog', { name: 'Classify infrastructure candidate' });
    expect(within(dialog).getByLabelText('Decision')).toHaveValue('unreviewed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/assets'
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        profile_id: 7,
        source_type: 'device',
        source_id: 42,
        element_type: 'torre',
        decision: 'unreviewed',
      });
    });
  });

  it('uses a controlled exclusion reason instead of sending arbitrary text', async () => {
    installApi({ candidates: [CANDIDATE] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Infrastructure review' }));
    const row = (await screen.findByText('device #42')).closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Review' }));
    const dialog = screen.getByRole('dialog', { name: 'Classify infrastructure candidate' });
    fireEvent.change(within(dialog).getByLabelText('Decision'), { target: { value: 'excluded' } });
    fireEvent.change(within(dialog).getByLabelText('Controlled exclusion reason'), { target: { value: 'dummy' } });
    fireEvent.change(within(dialog).getByLabelText(/Classification evidence \/ decision reference/), { target: { value: 'DEMO-ASSET-REVIEW-42' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/assets'
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        decision: 'excluded',
        exclusion_reason: 'dummy',
        decision_evidence_reference: 'DEMO-ASSET-REVIEW-42',
      });
    });
  });

  it('loads restricted detail and binds approval to both source and classification hashes', async () => {
    const excludedAsset = { ...ASSET, decision: 'excluded', exclusion_reason: 'dummy' };
    installApi({ assets: [excludedAsset], assetDetail: excludedAsset });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Infrastructure review' }));
    const row = (await screen.findByText('device #42')).closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Review approval' }));

    const dialog = await screen.findByRole('dialog', { name: 'Independently approve classification' });
    expect(within(dialog).getByText('dummy')).toBeInTheDocument();
    expect((within(dialog).getByDisplayValue(/TORRE-42/) as HTMLTextAreaElement).value).toContain('LONGITUD');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve classification' }));

    await waitFor(() => {
      const detailCall = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === `/api/v1/snii-reporting/assets/${ASSET.id}`
        && !(init as RequestInit | undefined)?.method);
      expect(detailCall).toBeDefined();
      const approvalCall = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === `/api/v1/snii-reporting/assets/${ASSET.id}/approve`
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(approvalCall).toBeDefined();
      expect(JSON.parse(String((approvalCall?.[1] as RequestInit).body))).toEqual({
        expected_source_snapshot_hash: ASSET.source_snapshot_hash,
        expected_classification_hash: ASSET.classification_hash,
      });
    });
  });

  it('shows an exported package as generated but not externally filed', async () => {
    installApi({ batches: [BATCH], selectedBatch: BATCH });
    renderPage();
    await openPackages();

    expect(screen.getByText('Generation is not filing')).toBeInTheDocument();
    expect(screen.getByText(/Generated, submitted, corrected and accepted are separate states/)).toBeInTheDocument();
    expect(screen.getAllByText('exported').length).toBeGreaterThan(0);
    expect(screen.getByText('No external filing events are recorded.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate preparation artifact' }));
    await waitFor(() => {
      expect(mocks.authedFetch.mock.calls.some(([input, init]) =>
        String(input) === `/api/v1/snii-reporting/batches/${BATCH.id}/artifacts`
        && (init as RequestInit | undefined)?.method === 'POST')).toBe(true);
    });
    expect(mocks.authedFetch.mock.calls.some(([input]) =>
      String(input).includes('/filing-events'))).toBe(false);
  });

  it('keeps the initial timing label neutral instead of assuming the 120-day branch', async () => {
    installApi({ batches: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Packages & filing' }));

    expect(await screen.findByRole('option', {
      name: 'Initial timing — operator must calculate from current CRT guidance',
    })).toBeInTheDocument();
    expect(screen.queryByText(/Initial 120-business-day window/)).not.toBeInTheDocument();
  });

  it('shows validation errors from the frozen batch instead of a generic success state', async () => {
    const invalid = {
      ...BATCH,
      state: 'draft',
      artifacts: [],
      validation_result: {
        valid: false,
        errors: [{ code: 'duplicate_official_code', element_type: 'torre', official_code: 'TORRE-42' }],
      },
    };
    installApi({ batches: [invalid], selectedBatch: invalid });
    renderPage();
    await openPackages();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Validation failed');
    expect(alert).toHaveTextContent('duplicate official code');
    expect(alert).toHaveTextContent('TORRE-42');
  });

  it('requires an approver to confirm the sanitized legal and provenance snapshot', async () => {
    const validated = {
      ...BATCH,
      state: 'validated',
      artifacts: [],
      correction_root_batch_id: 19,
    };
    installApi({ batches: [validated], selectedBatch: validated });
    renderPage();
    await openPackages();

    expect(screen.getByText('CRT-TITLE-21 (active)')).toBeInTheDocument();
    expect(screen.getByText('update / second_combined / annual_and_semiannual (2026)')).toBeInTheDocument();
    expect(screen.getByText('torre: applicable/has_assets')).toBeInTheDocument();
    expect(screen.getByText(PROFILE.template_sha256)).toBeInTheDocument();
    expect(screen.getByText(PROFILE.dictionary_sha256)).toBeInTheDocument();
    expect(screen.getByText(PROFILE.annex_v_sha256)).toBeInTheDocument();
    expect(screen.getByText(`${PROFILE.official_sources_reviewed_at} (user #17)`)).toBeInTheDocument();
    expect(screen.getByText(String(PROFILE.source_freshness_days))).toBeInTheDocument();
    expect(screen.getByText('External correction root batch')).toBeInTheDocument();
    expect(screen.getByText('#19')).toBeInTheDocument();
    expect(screen.getByText(BATCH.snapshot_hash)).toBeInTheDocument();

    const approve = screen.getByRole('button', { name: 'Approve snapshot' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I reviewed this sanitized title/));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === `/api/v1/snii-reporting/batches/${BATCH.id}/approve`
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        expected_snapshot_hash: BATCH.snapshot_hash,
      });
    });
  });

  it('creates a voluntary private-site full load with the anytime window', async () => {
    installApi({ batches: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Packages & filing' }));
    fireEvent.change(await screen.findByLabelText(/Period start/), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/Period end/), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText(/Filing kind/), { target: { value: 'voluntary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze draft snapshot' }));

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/batches'
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        filing_kind: 'voluntary',
        filing_window: 'anytime',
        filing_frequency: 'voluntary',
        filing_year: 2026,
      });
    });
  });

  it('requires and sends a reason when replacing the latest draft revision', async () => {
    const draft = {
      ...BATCH,
      revision: 1,
      revision_no: 1,
      state: 'draft',
      status: 'draft',
      artifacts: [],
    };
    installApi({ batches: [draft], selectedBatch: draft });
    renderPage();
    await openPackages();

    fireEvent.change(screen.getByLabelText(/Period start/), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/Period end/), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText(/Predecessor batch revision/), {
      target: { value: String(draft.id) },
    });
    const reason = screen.getByLabelText(/Replacement reason \/ reference/);
    expect(reason).toBeRequired();
    fireEvent.change(reason, {
      target: { value: '  Source inventory changed after initial freeze  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze draft snapshot' }));

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === '/api/v1/snii-reporting/batches'
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        supersedes_batch_id: draft.id,
        supersession_reason: 'Source inventory changed after initial freeze',
        filing_kind: 'update',
        filing_window: 'second_combined',
        filing_frequency: 'annual_and_semiannual',
      });
    });
  });

  it('surfaces structured voluntary-window readiness blockers', async () => {
    installApi({
      batches: [],
      createBatchError: {
        error: {
          message: 'SNII batch is not ready',
          details: [{ code: 'no_applicable_types_due', element_type: 'sitio_privado' }],
        },
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Packages & filing' }));
    fireEvent.change(await screen.findByLabelText(/Period start/), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/Period end/), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText(/Filing kind/), { target: { value: 'voluntary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze draft snapshot' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no applicable types due (object sitio_privado)',
    );
  });

  it('does not offer artifact regeneration after a batch enters a terminal filing state', async () => {
    const accepted = { ...BATCH, state: 'accepted' };
    installApi({ batches: [accepted], selectedBatch: accepted });
    renderPage();
    await openPackages();
    expect(screen.queryByRole('button', { name: 'Generate preparation artifact' })).not.toBeInTheDocument();
  });

  it('uploads filing evidence atomically as multipart data without a caller-supplied checksum', async () => {
    installApi({ batches: [BATCH], selectedBatch: BATCH });
    renderPage();
    await openPackages();

    fireEvent.change(await screen.findByLabelText(/External event time/), { target: { value: '2026-08-15T12:30' } });
    fireEvent.change(screen.getByLabelText(/Authority \/ Ventanilla reference/), { target: { value: 'CRT-ACK-42' } });
    const evidence = new File(['acuse bytes'], 'acuse.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Original filing \/ response evidence file/), {
      target: { files: [evidence] },
    });
    const recordButton = screen.getByRole('button', { name: 'Record immutable event' });
    await waitFor(() => expect(recordButton).toBeEnabled());
    fireEvent.submit(recordButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      const call = mocks.authedFetch.mock.calls.find(([input, init]) =>
        String(input) === `/api/v1/snii-reporting/batches/${BATCH.id}/filing-events`
        && (init as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeDefined();
      const body = (call?.[1] as RequestInit).body;
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get('evidence_file')).toBe(evidence);
      expect((body as FormData).get('event_type')).toBe('submitted');
      expect((body as FormData).get('authority_reference')).toBe('CRT-ACK-42');
      expect((body as FormData).has('evidence_sha256')).toBe(false);
      expect(new Headers((call?.[1] as RequestInit).headers).has('content-type')).toBe(false);
    });
  });

  it('verifies preserved filing-evidence bytes before download', async () => {
    const event = {
      id: 73,
      event_type: 'submitted',
      occurred_at: '2026-08-15T18:30:45.000Z',
      occurred_timezone: 'America/Chihuahua',
      authority_reference: 'CRT-ACK-42',
      evidence_upload_id: 99,
      evidence_file_name: 'acuse.pdf',
      evidence_sha256: 'ab'.repeat(32),
    };
    const selected = { ...BATCH, filing_events: [event] };
    installApi({ batches: [selected], selectedBatch: selected, evidenceDownloadChecksum: 'ab'.repeat(32) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    await openPackages();
    expect(screen.getByText(/2026-08-15 12:30:45 GMT-6 \(America\/Chihuahua\)/)).toBeInTheDocument();
    expect(screen.queryByText(/18:30:45/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify & download evidence' }));

    expect(await screen.findByRole('status')).toHaveTextContent(`SHA-256 ${'ab'.repeat(32)}`);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(mocks.authedFetch.mock.calls.some(([input]) =>
      String(input) === '/api/v1/snii-reporting/filing-events/73/evidence/download')).toBe(true);
  });

  it.each([
    {
      name: 'a non-MX organization even when the user has view permission',
      locale: 'global' as const,
      permissions: ['snii_reporting.view'],
      message: /available only in an organization whose compliance locale is MX/,
    },
    {
      name: 'an MX user without the view permission',
      locale: 'MX' as const,
      permissions: [],
      message: /do not have permission to view this restricted infrastructure workflow/,
    },
  ])('does not call the API for $name', async ({ locale, permissions, message }) => {
    mocks.user.current.organization_locale = locale;
    mocks.user.current.permissions = permissions;
    renderPage();

    expect(screen.getByText(message)).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.authedFetch).not.toHaveBeenCalled();
  });

  it('does not expose prepare, review, export, approval or filing actions to a view-only user', async () => {
    mocks.user.current.permissions = ['snii_reporting.view'];
    installApi({ candidates: [CANDIDATE], batches: [BATCH], selectedBatch: BATCH });
    renderPage();

    expect(await screen.findByDisplayValue('SNII-0009')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Infrastructure review' }));
    await screen.findByText('device #42');
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();

    await openPackages();
    expect(screen.queryByRole('button', { name: 'Freeze draft snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate full load' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate preparation artifact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify & download' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record immutable event' })).not.toBeInTheDocument();
    expect(mocks.authedFetch.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
  });

  it('verifies the evidence checksum before saving an artifact', async () => {
    installApi({ batches: [BATCH], selectedBatch: BATCH, downloadChecksum: 'ab'.repeat(32) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    await openPackages();
    fireEvent.click(screen.getByRole('button', { name: 'Verify & download' }));

    expect(await screen.findByRole('status')).toHaveTextContent(`SHA-256 ${'ab'.repeat(32)}`);
    expect(mocks.digest).toHaveBeenCalledTimes(1);
    expect(mocks.digest.mock.calls[0]?.[0]).toBe('SHA-256');
    expect(mocks.digest.mock.calls[0]?.[1]).toHaveProperty('byteLength');
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a mismatched checksum', 'cd'.repeat(32), /do not match the evidence checksum/],
    ['a missing checksum', null, /did not provide a valid evidence checksum/],
  ])('refuses to save an artifact with %s', async (_name, checksum, expectedMessage) => {
    installApi({ batches: [BATCH], selectedBatch: BATCH, downloadChecksum: checksum });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    await openPackages();
    fireEvent.click(screen.getByRole('button', { name: 'Verify & download' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage as RegExp);
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
