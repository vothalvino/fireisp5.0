'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: Number(req.get('x-test-user') || 17),
      organization_id: Number(req.get('x-test-org') || 41),
      apiTokenId: req.get('x-test-api-token') ? 700 : null,
      isInstallOperator: req.get('x-test-install-operator') === '1',
      permissions: req.get('x-test-permissions')
        ? req.get('x-test-permissions').split(',').filter(Boolean)
        : [
          'snii_reporting.view', 'snii_reporting.review', 'snii_reporting.prepare',
          'snii_reporting.approve', 'snii_reporting.export', 'snii_reporting.file',
          'snii_reporting.evidence',
        ],
    };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = Number(req.get('x-test-org') || 41);
    next();
  },
}));

jest.mock('../src/middleware/orgLocale', () => ({
  requireMxLocale: (req, res, next) => {
    if (req.get('x-test-locale') !== 'global') return next();
    return res.status(404).json({
      error: { code: 'REGION_DISABLED', message: 'This feature requires MX' },
    });
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: permission => (req, _res, next) => {
    if (req.user.permissions.includes(permission)) return next();
    const error = new Error(`Missing permission: ${permission}`);
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    return next(error);
  },
}));

jest.mock('../src/middleware/rateLimit', () => ({
  exportLimiter: (_req, _res, next) => next(),
}));

jest.mock('../src/utils/primaryContext', () => ({
  runInPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/middleware/upload', () => ({
  contentDispositionAttachment: filename => `attachment; filename="${filename}"`,
}));

jest.mock('../src/services/sniiReportingService', () => ({
  getCatalog: jest.fn(),
  getProfile: jest.fn(),
  getProfileEnvelope: jest.fn(),
  upsertProfile: jest.fn(),
  setSubjectApplicability: jest.fn(),
  setApplicability: jest.fn(),
  listCandidates: jest.fn(),
  listAssets: jest.fn(),
  getAssetDetail: jest.fn(),
  createAsset: jest.fn(),
  updateAsset: jest.fn(),
  approveAsset: jest.fn(),
  listBatches: jest.fn(),
  createBatch: jest.fn(),
  getBatch: jest.fn(),
  validateBatch: jest.fn(),
  approveBatch: jest.fn(),
  generateArtifact: jest.fn(),
  getArtifactForDownload: jest.fn(),
  listFilingEvents: jest.fn(),
  recordFilingEvent: jest.fn(),
  getFilingEvidenceForDownload: jest.fn(),
  listAuditEvents: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const { runInPrimaryContext } = require('../src/utils/primaryContext');
const service = require('../src/services/sniiReportingService');
const router = require('../src/routes/sniiReporting');

const app = express();
app.use(express.json());
app.use('/api/v1/snii-reporting', router);
app.use((error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR', message: error.message },
  });
});

const ENDPOINTS = [
  ['get', '/catalog'],
  ['get', '/profile'],
  ['put', '/profile'],
  ['put', '/profile/subject-applicability'],
  ['put', '/profile/applicability/torre'],
  ['get', '/candidates'],
  ['get', '/assets'],
  ['get', '/assets/71'],
  ['post', '/assets'],
  ['patch', '/assets/71'],
  ['post', '/assets/71/approve'],
  ['get', '/batches'],
  ['post', '/batches'],
  ['get', '/batches/30'],
  ['post', '/batches/30/validate'],
  ['post', '/batches/30/approve'],
  ['post', '/batches/30/artifacts'],
  ['get', '/artifacts/81/download'],
  ['get', '/batches/30/filing-events'],
  ['post', '/batches/30/filing-events'],
  ['get', '/filing-events/92/evidence/download'],
  ['get', '/audit-events'],
];

function url(path) {
  return `/api/v1/snii-reporting${path}`;
}

function serviceCallCount() {
  return Object.values(service).reduce((count, fn) => count + fn.mock.calls.length, 0);
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[{ id: 1 }], []]);
  runInPrimaryContext.mockImplementation(callback => callback());
  service.getCatalog.mockReturnValue({ preparation_only: true });
  service.getProfile.mockResolvedValue(null);
  service.listCandidates.mockResolvedValue([]);
  service.listAssets.mockResolvedValue([]);
  service.listBatches.mockResolvedValue([]);
  service.listAuditEvents.mockResolvedValue([]);
});

describe('SNII route principal and regional boundary', () => {
  test.each(ENDPOINTS)('%s %s rejects API-token principals before validation or service access',
    async (method, path) => {
      const response = await request(app)[method](url(path))
        .set('x-test-api-token', '1')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.message).toMatch(/interactive user session/i);
      expect(db.query).not.toHaveBeenCalled();
      expect(serviceCallCount()).toBe(0);
    });

  test.each(ENDPOINTS)('%s %s rejects install-operator sessions before tenant data access',
    async (method, path) => {
      const response = await request(app)[method](url(path))
        .set('x-test-install-operator', '1')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.message).toMatch(/install-operator/i);
      expect(db.query).not.toHaveBeenCalled();
      expect(serviceCallCount()).toBe(0);
    });

  test('a non-MX organization receives a feature-hidden 404 before membership lookup', async () => {
    const response = await request(app)
      .get(url('/catalog'))
      .set('x-test-locale', 'global');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('REGION_DISABLED');
    expect(db.query).not.toHaveBeenCalled();
    expect(service.getCatalog).not.toHaveBeenCalled();
  });

  test('requires live same-organization membership resolved in primary context', async () => {
    let inPrimary = false;
    runInPrimaryContext.mockImplementationOnce(async callback => {
      inPrimary = true;
      try {
        return await callback();
      } finally {
        inPrimary = false;
      }
    });
    db.query.mockImplementationOnce((sql, params) => {
      expect(inPrimary).toBe(true);
      expect(sql).toMatch(/ou\.user_id = \? AND ou\.organization_id = \?/);
      expect(params).toEqual([17, 41]);
      return Promise.resolve([[{ id: 1 }], []]);
    });

    const allowed = await request(app).get(url('/catalog'));
    expect(allowed.status).toBe(200);
    expect(runInPrimaryContext).toHaveBeenCalledTimes(1);

    db.query.mockResolvedValueOnce([[], []]);
    const denied = await request(app).get(url('/catalog'));
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/live organization membership/i);
  });

  test('does not let view-only evidence users download raw infrastructure artifacts', async () => {
    const response = await request(app)
      .get(url('/artifacts/81/download'))
      .set('x-test-permissions', 'snii_reporting.view');

    expect(response.status).toBe(403);
    expect(service.getArtifactForDownload).not.toHaveBeenCalled();
  });

  test('does not grant retained filing evidence to ordinary view-only users', async () => {
    const response = await request(app)
      .get(url('/filing-events/92/evidence/download'))
      .set('x-test-permissions', 'snii_reporting.view');

    expect(response.status).toBe(403);
    expect(service.getFilingEvidenceForDownload).not.toHaveBeenCalled();
  });
});

describe('SNII route tenant propagation and download controls', () => {
  test('propagates an indistinguishable cross-org 404 from the scoped service lookup', async () => {
    const error = new Error('SNII report batch not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    service.getBatch.mockRejectedValueOnce(error);

    const response = await request(app)
      .get(url('/batches/999'))
      .set('x-test-org', '41');

    expect(response.status).toBe(404);
    expect(service.getBatch).toHaveBeenCalledWith(
      41,
      '999',
      expect.objectContaining({ organizationId: 41, actorId: 17 }),
    );
    expect(response.body.error.message).not.toMatch(/organization|tenant/i);
  });

  test('strips tenant, actor, state and approval mass-assignment fields', async () => {
    service.createAsset.mockResolvedValueOnce({ id: 71, decision: 'unreviewed' });

    const response = await request(app)
      .post(url('/assets'))
      .send({
        profile_id: 9,
        source_type: 'manual',
        element_type: 'torre',
        manual_payload: { LATITUD: 28.6, LONGITUD: -106.1 },
        organization_id: 999,
        classified_by: 999,
        approved_by: 999,
        approval_status: 'approved',
        status: 'accepted',
        content_sha256: '0'.repeat(64),
      });

    expect(response.status).toBe(201);
    expect(service.createAsset).toHaveBeenCalledWith(
      41,
      17,
      {
        profile_id: 9,
        source_type: 'manual',
        element_type: 'torre',
        manual_payload: { LATITUD: 28.6, LONGITUD: -106.1 },
      },
      expect.objectContaining({ organizationId: 41, actorId: 17 }),
    );
  });

  test('accepts filing evidence only as multipart bytes and derives its identity server-side', async () => {
    const evidenceBytes = Buffer.from('%PDF-1.7\nCRT filing evidence\n', 'utf8');
    service.recordFilingEvent.mockResolvedValueOnce({
      id: 92,
      event_type: 'submitted',
      evidence_upload_id: 91,
      evidence_sha256: 'b'.repeat(64),
    });

    const response = await request(app)
      .post(url('/batches/30/filing-events'))
      .field('event_type', 'submitted')
      .field('attempt_no', '1')
      .field('occurred_at', '2026-08-15T12:30:00.000-06:00')
      .field('occurred_timezone', 'America/Chihuahua')
      .field('authority_reference', 'CRT-VENTANILLA-001')
      .attach('evidence_file', evidenceBytes, {
        filename: 'acuse.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(201);
    expect(service.recordFilingEvent).toHaveBeenCalledWith(
      41,
      17,
      '30',
      {
        event_type: 'submitted',
        attempt_no: 1,
        occurred_at: '2026-08-15T12:30:00.000-06:00',
        occurred_timezone: 'America/Chihuahua',
        authority_reference: 'CRT-VENTANILLA-001',
      },
      expect.objectContaining({
        originalname: 'acuse.pdf',
        mimetype: 'application/pdf',
        buffer: evidenceBytes,
      }),
      expect.objectContaining({ organizationId: 41, actorId: 17 }),
    );
  });

  test('rejects caller-supplied evidence IDs or hashes and mismatched file types', async () => {
    const callerIdentity = await request(app)
      .post(url('/batches/30/filing-events'))
      .field('event_type', 'submitted')
      .field('attempt_no', '1')
      .field('occurred_at', '2026-08-15T12:30:00.000-06:00')
      .field('occurred_timezone', 'America/Chihuahua')
      .field('authority_reference', 'CRT-VENTANILLA-001')
      .field('evidence_file_id', '999')
      .attach('evidence_file', Buffer.from('evidence'), {
        filename: 'acuse.pdf',
        contentType: 'application/pdf',
      });

    expect(callerIdentity.status).toBe(422);
    expect(service.recordFilingEvent).not.toHaveBeenCalled();

    const mismatchedType = await request(app)
      .post(url('/batches/30/filing-events'))
      .field('event_type', 'submitted')
      .field('attempt_no', '1')
      .field('occurred_at', '2026-08-15T12:30:00.000-06:00')
      .field('occurred_timezone', 'America/Chihuahua')
      .field('authority_reference', 'CRT-VENTANILLA-001')
      .attach('evidence_file', Buffer.from('not really a PDF'), {
        filename: 'acuse.pdf',
        contentType: 'text/plain',
      });

    expect(mismatchedType.status).toBe(422);
    expect(service.recordFilingEvent).not.toHaveBeenCalled();
  });

  test('downloads only after service audit and sets private attachment integrity headers', async () => {
    const checksum = 'b'.repeat(64);
    service.getArtifactForDownload.mockResolvedValueOnce({
      id: 81,
      organization_id: 41,
      file_name: 'torre.csv',
      mime_type: 'text/csv; charset=utf-8',
      content_sha256: checksum,
      content_text: 'CODIGO_IDENTIFICADOR\r\nT-1',
    });

    const response = await request(app)
      .get(url('/artifacts/81/download'))
      .set('x-test-org', '41')
      .set('x-test-user', '17');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toMatch(/no-store/);
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe('sandbox');
    expect(response.headers['content-disposition']).toBe('attachment; filename="torre.csv"');
    expect(response.headers['x-evidence-sha256']).toBe(checksum);
    expect(response.headers['content-type']).toMatch(/^text\/csv/);
    expect(response.text).toBe('CODIGO_IDENTIFICADOR\r\nT-1');
    expect(service.getArtifactForDownload).toHaveBeenCalledWith(
      41, 17, '81', expect.objectContaining({ organizationId: 41, actorId: 17 }),
    );
  });

  test('sends no artifact bytes or integrity headers when audit/service access fails', async () => {
    service.getArtifactForDownload.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await request(app).get(url('/artifacts/81/download'));

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('audit unavailable');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.headers['x-evidence-sha256']).toBeUndefined();
    expect(response.headers['cache-control']).toMatch(/no-store/);
  });

  test('downloads retained evidence only through the audited private attachment endpoint', async () => {
    const evidenceBytes = Buffer.from('immutable CRT evidence\n', 'utf8');
    const checksum = 'c'.repeat(64);
    service.getFilingEvidenceForDownload.mockResolvedValueOnce({
      id: 92,
      evidence_file_name: 'acuse.pdf',
      evidence_mime_type: 'application/pdf',
      evidence_byte_size: evidenceBytes.length,
      evidence_sha256: checksum,
      evidence_content: evidenceBytes,
    });

    const response = await request(app)
      .get(url('/filing-events/92/evidence/download'))
      .set('x-test-permissions', 'snii_reporting.view,snii_reporting.evidence');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toMatch(/no-store/);
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe('sandbox');
    expect(response.headers['content-disposition']).toBe('attachment; filename="acuse.pdf"');
    expect(response.headers['x-evidence-sha256']).toBe(checksum);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(response.body).toEqual(evidenceBytes);
    expect(service.getFilingEvidenceForDownload).toHaveBeenCalledWith(
      41, 17, '92', expect.objectContaining({ organizationId: 41, actorId: 17 }),
    );
  });

  test('sends no retained evidence bytes or integrity headers when its audit fails', async () => {
    service.getFilingEvidenceForDownload.mockRejectedValueOnce(new Error('evidence audit unavailable'));

    const response = await request(app)
      .get(url('/filing-events/92/evidence/download'))
      .set('x-test-permissions', 'snii_reporting.view,snii_reporting.evidence');

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('evidence audit unavailable');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.headers['x-evidence-sha256']).toBeUndefined();
    expect(response.headers['cache-control']).toMatch(/no-store/);
  });
});
