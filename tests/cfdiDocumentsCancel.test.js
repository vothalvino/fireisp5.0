// =============================================================================
// FireISP 5.0 — POST /cfdi-documents/:id/cancel delegates to cfdiService.cancel()
// =============================================================================
// This route used to hand-roll the cancellation SQL: it inserted
// cfdi_cancellations and then IMMEDIATELY set cfdi_documents.sat_status =
// 'cancelado' + cancelled_at = NOW() with no PAC/SAT submission at all — a
// legally false fiscal record (per schema.sql, 'cancelado' means "SAT
// confirmed cancellation") that also made the document permanently
// un-cancellable through the real flow (cfdiService.cancel() requires
// sat_status === 'vigente'). It must now delegate to the same canonical
// PAC → SAT flow used by POST /cfdi/cancel, never write cfdi_cancellations or
// cfdi_documents.sat_status itself.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/cfdiService', () => ({
  cancel: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const cfdiService = require('../src/services/cfdiService');
const app = require('../src/app');

const AUTH = 'Bearer ' + jwt.sign(
  { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

describe('POST /api/v1/cfdi-documents/:id/cancel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue({
      id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
    });
    db.query.mockImplementation((sql) => {
      if (/SELECT locale FROM organizations/i.test(sql)) return [[{ locale: 'MX' }]];
      if (/SELECT id FROM cfdi_documents WHERE id = \? AND organization_id = \?/i.test(sql)) {
        return [[{ id: 5 }]];
      }
      return [[]];
    });
  });

  test('delegates to cfdiService.cancel() and never writes cfdi_cancellations/sat_status itself', async () => {
    cfdiService.cancel.mockResolvedValueOnce({
      cfdi_document_id: 5, cancellation_id: 9, status: 'cancel_pending', reason: '02',
    });

    const res = await request(app)
      .post('/api/v1/cfdi-documents/5/cancel')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ cancellation_reason: '02' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      cfdi_document_id: 5, cancellation_id: 9, status: 'cancel_pending', reason: '02',
    });

    // Delegated with the org-scoped document id, the reason, and the
    // replacement uuid — never issued its own INSERT/UPDATE against
    // cfdi_cancellations or cfdi_documents.
    expect(cfdiService.cancel).toHaveBeenCalledWith('5', '02', null);
    const sqlIssued = db.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlIssued).not.toMatch(/INSERT INTO cfdi_cancellations/i);
    expect(sqlIssued).not.toMatch(/UPDATE cfdi_documents/i);
  });

  test('passes replacement_uuid through when provided (motivo 01)', async () => {
    cfdiService.cancel.mockResolvedValueOnce({
      cfdi_document_id: 5, cancellation_id: 10, status: 'cancel_pending', reason: '01',
    });

    await request(app)
      .post('/api/v1/cfdi-documents/5/cancel')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ cancellation_reason: '01', replacement_uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' });

    expect(cfdiService.cancel).toHaveBeenCalledWith(
      '5', '01', 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    );
  });

  test('404s (and never calls cfdiService.cancel) when the document is not in the caller org', async () => {
    db.query.mockImplementation((sql) => {
      if (/SELECT locale FROM organizations/i.test(sql)) return [[{ locale: 'MX' }]];
      if (/SELECT id FROM cfdi_documents/i.test(sql)) return [[]];      // not found for this org
      return [[]];
    });

    const res = await request(app)
      .post('/api/v1/cfdi-documents/999/cancel')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ cancellation_reason: '02' });

    expect(res.status).toBe(404);
    expect(cfdiService.cancel).not.toHaveBeenCalled();
  });

  test('propagates a service-level rejection (e.g. document not vigente) as an error response, not a fabricated success', async () => {
    // Same AppError subclass, same propagation path as POST /cfdi/cancel
    // (cfdiController.cancel) — CfdiCancellationError is a 502 by design.
    const { CfdiCancellationError } = require('../src/utils/errors');
    cfdiService.cancel.mockRejectedValueOnce(
      new CfdiCancellationError('Can only cancel vigente documents', { cfdiDocumentId: 5, currentStatus: 'cancel_pending' }),
    );

    const res = await request(app)
      .post('/api/v1/cfdi-documents/5/cancel')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1')
      .send({ cancellation_reason: '02' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CFDI_CANCELLATION_FAILED');
  });
});
