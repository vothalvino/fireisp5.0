'use strict';

const crypto = require('crypto');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), getConnection: jest.fn(),
}));
jest.mock('../src/services/lifecycleService', () => ({
  nextOrderNumber: jest.fn(),
  seedDefaultTasks: jest.fn(),
  startOrder: jest.fn(),
  completeOrder: jest.fn(),
  cancelOrder: jest.fn(),
}));
jest.mock('../src/services/legalDocumentService', () => ({
  generateForOrder: jest.fn(),
  signatureEvidenceIsValid: jest.fn(document => document.evidence_valid !== false),
  GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID: 0,
  GLOBAL_ACKNOWLEDGMENT_TYPE: 'service_acknowledgment',
  GLOBAL_ACKNOWLEDGMENT_TITLE: 'Service installation acknowledgment',
}));
jest.mock('../src/models/Nas', () => ({ findByIdOrFail: jest.fn() }));
jest.mock('../src/services/routerProvisioningService', () => ({ pushSubscriber: jest.fn() }));
jest.mock('../src/services/radiusService', () => ({ syncFreeradiusContract: jest.fn() }));
jest.mock('../src/services/subscriberProvisioningService', () => ({
  provisionNewContract: jest.fn(),
}));
jest.mock('../src/services/suspensionService', () => ({ sendRadiusDisconnect: jest.fn() }));

const db = require('../src/config/database');
const Contract = require('../src/models/Contract');
const User = require('../src/models/User');
const lifecycleService = require('../src/services/lifecycleService');
const legalDocumentService = require('../src/services/legalDocumentService');
const Nas = require('../src/models/Nas');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const radiusService = require('../src/services/radiusService');
const subscriberProvisioningService = require('../src/services/subscriberProvisioningService');
const suspensionService = require('../src/services/suspensionService');
const service = require('../src/services/contractActivationService');

const STARTED_AT = new Date('2026-08-10T10:00:00Z');
const MX_SOURCE_ID = 71;
const MX_SOURCE_BODY = 'Registered MX activation body';
const MX_SOURCE_HASH = crypto.createHash('sha256').update(MX_SOURCE_BODY).digest('hex');
function registeredTemplate(template = {}) {
  return {
    template_type: 'activation_contract', is_active: 1,
    body_md: MX_SOURCE_BODY, contract_template_mx_id: MX_SOURCE_ID,
    mx_id: MX_SOURCE_ID, mx_organization_id: 42,
    mx_registration_number: 'IFT-2026-001', mx_registered_at: '2026-01-15',
    mx_template_version: '1.0', mx_template_body: MX_SOURCE_BODY,
    mx_contract_environment: 'production',
    mx_status: 'registered', mx_deleted_at: null,
    ...template,
  };
}
const CONTRACT = {
  id: 33, organization_id: 42, client_id: 9, plan_id: 2,
  status: 'pending', connection_type: 'pppoe', test_window_expires_at: null,
  test_window_cleanup_pending: 0, contract_template_mx_id: MX_SOURCE_ID,
  mx_contract_environment: 'production',
};
const ORDER = {
  id: 16, organization_id: 42, order_number: 'SO-000016', order_type: 'new_install',
  status: 'in_process', client_id: 9, contract_id: 33, plan_id: 2,
  assigned_to: 7, started_at: STARTED_AT,
};
const WORK_ORDER = {
  id: 13, organization_id: 42, service_order_id: 16, contract_id: 33,
  work_type: 'installation', status: 'completed', assigned_to: 7,
  acceptance_rx_dbm: '-18.50', acceptance_waived: 0,
};
const SPEED_TEST = {
  id: 90, contract_id: 33, work_order_id: 13, test_source: 'technician',
  download_mbps: '98.100', upload_mbps: '19.800', tested_at: new Date('2026-08-10T10:30:00Z'),
};

function tx() {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

function wireState({
  contract = CONTRACT, order = ORDER, workOrder = WORK_ORDER,
  documents = null, speedTest = SPEED_TEST, locale = 'global', templates = [],
  arrivalTemplates = [], radius = 'inactive', nasId = null,
} = {}) {
  const sourceDocuments = documents ?? (locale === 'global' ? [{
    id: 19,
    template_id: null,
    template_type: 'service_acknowledgment',
    title: 'Service installation acknowledgment',
    status: 'signed',
    signer_name: 'Customer',
  }] : []);
  const effectiveDocuments = sourceDocuments.map(row => (
    row.template_type === 'activation_contract'
      ? {
        contract_template_mx_id: MX_SOURCE_ID,
        mx_registration_number: 'IFT-2026-001',
        mx_registered_at: '2026-01-15',
        mx_template_version: '1.0',
        mx_source_sha256: MX_SOURCE_HASH,
        mx_contract_environment: 'production',
        ...row,
      }
      : row
  ));
  const effectiveTemplates = templates.map(registeredTemplate);
  db.query.mockImplementation(async (sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/SELECT c\.\* FROM contracts c/.test(s)) return [contract ? [{ ...contract }] : []];
    if (/SELECT so\.\* FROM service_orders so/.test(s)) return [order ? [{ ...order }] : []];
    if (/SELECT wo\.\* FROM work_orders wo/.test(s)) return [workOrder ? [{ ...workOrder }] : []];
    if (/SELECT \* FROM signed_documents/.test(s)) {
      return [effectiveDocuments
        .filter(row => row.template_type === params[4]
          && ['pending', 'signed'].includes(row.status))
        .map(row => ({ ...row }))];
    }
    if (/FROM document_templates dt/.test(s)
        && /template_type = 'installation_authorization'/.test(s)) {
      return [arrivalTemplates.map(template => {
        const live = effectiveDocuments.filter(row => (
          Number(row.template_id) === Number(template.id)
          && row.template_type === 'installation_authorization'
          && ['pending', 'signed'].includes(row.status)
        ));
        return {
          id: template.id,
          has_live: live.length ? 1 : 0,
          has_signed: live.some(row => row.status === 'signed') ? 1 : 0,
        };
      })];
    }
    if (/SELECT id, template_id, template_type, title, status/.test(s)
        && /FROM signed_documents/.test(s)) {
      expect(params).toEqual([order.id, contract.id]);
      return [effectiveDocuments.map(row => ({ ...row }))];
    }
    if (/FROM speed_tests/.test(s)) {
      if (speedTest) expect(params).toEqual([contract.id, workOrder.id, order.started_at]);
      return [speedTest ? [{ ...speedTest }] : []];
    }
    if (/SELECT r\.status, r\.nas_id FROM radius r/.test(s)) {
      return [radius ? [{ status: radius, nas_id: nasId }] : []];
    }
    if (/SELECT locale FROM organizations/.test(s)) return [[{ locale }]];
    if (/FROM document_templates/.test(s)) return [effectiveTemplates.map(row => ({ ...row }))];
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  legalDocumentService.generateForOrder.mockResolvedValue([]);
  legalDocumentService.signatureEvidenceIsValid
    .mockImplementation(document => document.evidence_valid !== false);
});

describe('getActivationState', () => {
  test('returns a ready global activation with a signed generic acknowledgment and no Mexican legal blockers', async () => {
    wireState();

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: true });

    expect(state).toEqual(expect.objectContaining({
      contract_id: 33,
      client_id: 9,
      status: 'pending',
      connection_type: 'pppoe',
      radius_status: 'inactive',
      speed_test_recorded: true,
      service_order_prepared: true,
      work_order_prepared: true,
      can_activate: true,
      blockers: [],
      speed_test: expect.objectContaining({ id: 90, test_source: 'technician' }),
    }));
    expect(state.service_order).toEqual(expect.objectContaining({ id: 16, order_number: 'SO-000016' }));
    expect(state.work_order).toEqual(expect.objectContaining({ id: 13, acceptance_rx_dbm: '-18.50' }));
    expect(state.blockers).not.toContain('activation_template_missing');
    expect(db.query.mock.calls.some(([sql]) => /FROM document_templates/.test(sql))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => /FROM signed_documents/.test(sql))).toBe(true);
    expect(state.documents).toEqual([expect.objectContaining({
      template_type: 'service_acknowledgment', status: 'signed',
    })]);
  });

  test('global readiness blocks until the neutral service acknowledgment is signed', async () => {
    wireState({ documents: [] });

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: true });

    expect(state.can_activate).toBe(false);
    expect(state.blockers).toContain('signature_missing');
    expect(state.blockers).not.toContain('activation_template_missing');
    expect(state.document_sync_required).toBe(true);
  });

  test('a signed status with invalid signature evidence does not satisfy readiness', async () => {
    wireState({
      documents: [{
        id: 19, template_id: null, template_type: 'service_acknowledgment',
        status: 'signed', evidence_valid: false,
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.can_activate).toBe(false);
    expect(state.blockers).toContain('signature_missing');
    expect(legalDocumentService.signatureEvidenceIsValid)
      .toHaveBeenCalledWith(expect.objectContaining({ id: 19, status: 'signed' }));
  });

  test('MX readiness is template-ID granular and exposes signer_name compatibility', async () => {
    wireState({
      locale: 'MX',
      templates: [{ id: 4, name: 'Contrato A' }, { id: 5, name: 'Contrato B' }],
      documents: [{
        id: 20, template_id: 4, template_type: 'activation_contract', title: 'Contrato A',
        status: 'signed', signer_name: 'María', signer: 'María', signed_at: new Date(),
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: true });

    expect(state.can_activate).toBe(false);
    expect(state.blockers).toContain('signature_missing');
    expect(state.documents[0]).toEqual(expect.objectContaining({ signer_name: 'María' }));
  });

  test('MX readiness blocks when no reviewed activation-contract template is active', async () => {
    wireState({ locale: 'MX', templates: [], documents: [] });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.can_activate).toBe(false);
    expect(state.blockers).toContain('activation_template_missing');
    expect(state.blockers).not.toContain('signature_missing');
  });

  test('MX readiness remains accurate without leaking document metadata to a caller lacking view permission', async () => {
    wireState({
      locale: 'MX',
      templates: [{ id: 4, name: 'Contrato A' }],
      documents: [{
        id: 20, template_id: 4, template_type: 'activation_contract', title: 'Private title',
        status: 'signed', signer_name: 'Private signer', signed_at: new Date(),
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: false });

    expect(state.can_activate).toBe(true);
    expect(state.documents).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => /signer_name/.test(sql))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) =>
      /SELECT \*[\s\S]*FROM signed_documents/.test(sql))).toBe(true);
  });

  test('MX readiness blocks a contract linked to a different registered source', async () => {
    wireState({
      locale: 'MX',
      contract: { ...CONTRACT, contract_template_mx_id: 999 },
      templates: [{ id: 4, name: 'Contrato A' }],
      documents: [{
        id: 20, template_id: 4, template_type: 'activation_contract',
        title: 'Contrato A', status: 'signed', signer_name: 'María',
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.can_activate).toBe(false);
    expect(state.blockers).toContain('registered_template_mismatch');
  });

  test('flags late-template document sync without leaking metadata to a caller lacking document view', async () => {
    wireState({
      locale: 'MX',
      templates: [{ id: 4, name: 'Contrato A' }, { id: 5, name: 'Contrato B' }],
      documents: [{
        id: 20, template_id: 4, template_type: 'activation_contract',
        title: 'Private title', status: 'signed', signer_name: 'Private signer',
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: false });

    expect(state.document_sync_required).toBe(true);
    expect(state.documents).toEqual([]);
    expect(state.blockers).toContain('signature_missing');
    expect(db.query.mock.calls.some(([sql]) => /signer_name/.test(sql))).toBe(false);
  });

  test('exposes only the non-sensitive arrival authorization flag when document metadata is hidden', async () => {
    wireState({
      locale: 'MX',
      workOrder: { ...WORK_ORDER, status: 'assigned' },
      arrivalTemplates: [{ id: 8, name: 'Autorización' }],
      documents: [{
        id: 21,
        template_id: 8,
        template_type: 'installation_authorization',
        title: 'Private arrival title',
        status: 'pending',
        signer_name: null,
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42, includeDocuments: false });

    expect(state.arrival_authorization_pending).toBe(true);
    expect(state.documents).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => /signer_name/.test(sql))).toBe(false);
    const flagRead = db.query.mock.calls.find(([sql]) =>
      /template_type = 'installation_authorization'/.test(String(sql)));
    expect(flagRead[1]).toEqual([16, 42, 9, 33, 42]);
  });

  test.each(['pending', 'cancelled'])('keeps arrival authorization pending when the active template instance is %s', async (status) => {
    wireState({
      locale: 'MX',
      workOrder: { ...WORK_ORDER, status: 'assigned' },
      arrivalTemplates: [{ id: 8, name: 'Autorización' }],
      documents: [{
        id: 21, template_id: 8, template_type: 'installation_authorization', status,
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.arrival_authorization_pending).toBe(true);
  });

  test('clears arrival authorization pending only for an exact signed active-template instance', async () => {
    wireState({
      locale: 'MX',
      workOrder: { ...WORK_ORDER, status: 'assigned' },
      arrivalTemplates: [{ id: 8, name: 'Autorización' }],
      documents: [{
        id: 21, template_id: 8, template_type: 'installation_authorization', status: 'signed',
      }],
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.arrival_authorization_pending).toBe(false);
  });

  test('does not retroactively reopen the arrival gate after the authoritative visit started', async () => {
    wireState({
      locale: 'MX',
      workOrder: { ...WORK_ORDER, status: 'in_progress' },
      arrivalTemplates: [{ id: 8, name: 'Late authorization' }],
      documents: [],
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.arrival_authorization_pending).toBe(false);
    expect(state.document_sync_required).toBe(false);
  });

  test('reports the actionable blockers while the workflow and evidence are absent', async () => {
    wireState({ order: null, workOrder: null, speedTest: null });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.blockers).toEqual(expect.arrayContaining([
      'service_order_missing', 'work_order_missing', 'speed_test_missing',
    ]));
    expect(state.can_activate).toBe(false);
    expect(state.speed_test_recorded).toBe(false);
  });

  test('retains readiness while redacting work-order and speed-test rows from unauthorized projections', async () => {
    wireState();

    const state = await service.getActivationState(33, {
      orgId: 42, includeServiceOrder: false, includeWorkOrder: false, includeSpeedTest: false,
    });

    expect(state.service_order).toBeNull();
    expect(state.service_order_prepared).toBe(true);
    expect(state.work_order).toBeNull();
    expect(state.work_order_prepared).toBe(true);
    expect(state.speed_test).toBeNull();
    expect(state.speed_test_recorded).toBe(true);
    expect(state.blockers).not.toContain('work_order_missing');
    expect(state.blockers).not.toContain('speed_test_missing');
    expect(state.can_activate).toBe(true);
  });

  test('a reset static contract returns to pending activation without an impossible cleanup blocker', async () => {
    wireState({
      contract: {
        ...CONTRACT,
        status: 'pending',
        connection_type: 'static',
        test_window_expires_at: null,
        test_window_cleanup_pending: 0,
      },
      order: null,
      workOrder: null,
      speedTest: null,
      radius: null,
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.status).toBe('pending');
    expect(state.connection_type).toBe('static');
    expect(state.blockers).toContain('service_order_missing');
    expect(state.blockers).not.toContain('test_window_open');
    expect(state.blockers).not.toContain('test_window_cleanup_pending');
  });

  test.each([
    [{ test_window_cleanup_pending: 1, test_window_expires_at: new Date(Date.now() - 60_000) }, 'test_window_cleanup_pending'],
    [{ test_window_cleanup_pending: 0, test_window_expires_at: new Date(Date.now() - 60_000) }, 'test_window_cleanup_pending'],
    [{ test_window_cleanup_pending: 0, test_window_expires_at: new Date(Date.now() + 60_000) }, 'test_window_open'],
  ])('distinguishes open access from durable cleanup state %#', async (windowState, blocker) => {
    wireState({ contract: { ...CONTRACT, ...windowState } });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.blockers).toContain(blocker);
    expect(state.can_activate).toBe(false);
    expect(state.test_window_cleanup_pending)
      .toBe(Number(windowState.test_window_cleanup_pending) === 1);
  });

  test('exposes durable network-retry eligibility for an active completed install bound to a NAS', async () => {
    wireState({
      contract: { ...CONTRACT, status: 'active', first_activated_at: STARTED_AT },
      order: { ...ORDER, status: 'done' },
      radius: 'active', nasId: 12,
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.network_retry_available).toBe(true);
    const radiusRead = db.query.mock.calls.find(([sql]) => /FROM radius/.test(sql));
    expect(radiusRead[0]).toMatch(/SELECT r\.status, r\.nas_id FROM radius r/);
    expect(radiusRead[1]).toEqual([33, 42]);
  });

  test('offers network retry to a grandfathered PPPoE subscriber with no service-order history', async () => {
    wireState({
      contract: { ...CONTRACT, status: 'active', first_activated_at: STARTED_AT },
      order: null,
      workOrder: null,
      speedTest: null,
      radius: 'active', nasId: 12,
    });

    const state = await service.getActivationState(33, { orgId: 42 });

    expect(state.service_order).toBeNull();
    expect(state.network_retry_available).toBe(true);
  });
});

describe('prepareActivation', () => {
  afterEach(() => jest.restoreAllMocks());

  test('fails closed before reading or creating anything without installations.start capability', async () => {
    const findContract = jest.spyOn(Contract, 'findById');

    await expect(service.prepareActivation(33, { orgId: 42, userId: 1 }))
      .rejects.toMatchObject({ statusCode: 403 });

    expect(findContract).not.toHaveBeenCalled();
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(lifecycleService.startOrder).not.toHaveBeenCalled();
  });

  test('rejects an MX prepare before any write when no activation-contract template is active', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    db.query.mockImplementation(async (sql) => {
      if (/SELECT locale FROM organizations/.test(String(sql))) return [[{ locale: 'MX' }]];
      if (/FROM document_templates/.test(String(sql))) return [[]];
      return [[]];
    });

    await expect(service.prepareActivation(33, {
      orgId: 42, userId: 1, canStartInstallation: true,
    }))
      .rejects.toThrow(/activation-contract template before preparing/i);

    expect(db.getConnection).not.toHaveBeenCalled();
    expect(lifecycleService.startOrder).not.toHaveBeenCalled();
    expect(lifecycleService.nextOrderNumber).not.toHaveBeenCalled();
  });

  test('creates, links, and starts a new_install order for an existing pending contract', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    lifecycleService.nextOrderNumber.mockResolvedValue('SO-000016');
    lifecycleService.seedDefaultTasks.mockResolvedValue(undefined);
    lifecycleService.startOrder.mockResolvedValue({ order: ORDER, workOrder: WORK_ORDER });

    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT \* FROM contracts/.test(s)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(s) && /status IN/.test(s)) return [[]];
      if (/FROM clients/.test(s)) return [[{ address: 'Calle 1', city: 'Chihuahua', state: 'Chih.', zip_code: '31000' }]];
      if (/INSERT INTO service_orders/.test(s)) return [{ insertId: 16 }];
      if (/SELECT \* FROM service_orders WHERE id/.test(s)) return [[{ ...ORDER, status: 'new', started_at: null }]];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM contracts/.test(sql)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'global' }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState();

    const state = await service.prepareActivation(33, {
      orgId: 42, userId: 1, canStartInstallation: true,
    });

    expect(lifecycleService.nextOrderNumber).toHaveBeenCalledWith(prepareTx, 42);
    expect(lifecycleService.seedDefaultTasks).toHaveBeenCalledWith(prepareTx, 16);
    expect(lifecycleService.startOrder).toHaveBeenCalledWith(16, {
      orgId: 42, userId: 1, canStartInstallation: true,
    });
    const insert = prepareTx.query.mock.calls.find(([sql]) => /INSERT INTO service_orders/.test(sql));
    expect(insert[0]).toMatch(/'new_install', 'new'/);
    expect(insert[1]).toEqual(expect.arrayContaining([42, 'SO-000016', 9, 2, 33]));
    expect(state.contract_id).toBe(33);
  });

  test('reuses an in-process order, validates/updates the technician, and creates no duplicate', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    jest.spyOn(User, 'hasEffectivePermission').mockResolvedValue(true);
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[{ ...ORDER, assigned_to: null }]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [[WORK_ORDER]];
      if (/UPDATE service_orders SET assigned_to/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE work_orders SET assigned_to/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM contracts/.test(sql)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'global' }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState();

    await service.prepareActivation(33, {
      orgId: 42, userId: 1, assignedTo: 7, canStartInstallation: true,
    });

    expect(User.hasEffectivePermission).toHaveBeenCalledWith(7, 42, 'work_orders.view');
    expect(User.hasEffectivePermission).toHaveBeenCalledWith(7, 42, 'work_orders.update');
    expect(User.hasEffectivePermission).toHaveBeenCalledWith(7, 42, 'speed_tests.create');
    expect(prepareTx.query.mock.calls.some(([sql]) => /INSERT INTO service_orders/.test(sql))).toBe(false);
    expect(lifecycleService.startOrder).not.toHaveBeenCalled();
    expect(prepareTx.query.mock.calls.some(([sql]) => /UPDATE work_orders SET assigned_to/.test(sql))).toBe(true);
  });

  test('backfills an exact newly-active MX template so signature_missing always has a signable document', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[ORDER]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [[WORK_ORDER]];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT id FROM contracts/.test(s)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(s)) return [[{ locale: 'MX' }]];
      if (/SELECT dt.id/.test(s)) return [[{ id: 7 }]];
      if (/SELECT wo\.\*/.test(s)) return [[WORK_ORDER]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState({ locale: 'MX', templates: [{ id: 7, name: 'Nuevo contrato' }] });

    await service.prepareActivation(33, {
      orgId: 42, userId: 1, canStartInstallation: true,
    });

    expect(legalDocumentService.generateForOrder).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        orgId: 42, orderId: 16, contractId: 33, workOrderId: 13,
        onlyTemplateIds: new Set([7]),
      }),
    );
    const missingQuery = backfillTx.query.mock.calls.find(([sql]) => /SELECT dt.id/.test(sql));
    expect(missingQuery[0]).toMatch(/dt\.template_type = 'activation_contract'/);
    expect(backfillTx.commit).toHaveBeenCalled();
  });

  test('backfills a second late active arrival template by exact ID before the visit starts', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    const assignedWorkOrder = { ...WORK_ORDER, status: 'assigned' };
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[ORDER]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [[assignedWorkOrder]];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT id FROM contracts/.test(s)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(s)) return [[{ locale: 'MX' }]];
      if (/SELECT wo\.\*/.test(s)) return [[assignedWorkOrder]];
      if (/SELECT dt\.id/.test(s)) return [[{ id: 8 }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState({
      locale: 'MX',
      templates: [{ id: 7, name: 'Contrato' }],
      arrivalTemplates: [{ id: 8, name: 'Autorización adicional' }],
      workOrder: assignedWorkOrder,
    });

    await service.prepareActivation(33, {
      orgId: 42, userId: 1, includeDocuments: false, canStartInstallation: true,
    });

    expect(legalDocumentService.generateForOrder).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        orgId: 42,
        orderId: 16,
        workOrderId: 13,
        onlyTemplateIds: new Set([8]),
      }),
    );
    const missingQuery = backfillTx.query.mock.calls.find(([sql]) => /SELECT dt\.id/.test(sql));
    expect(missingQuery[0]).toMatch(/template_type = 'installation_authorization'/);
    expect(missingQuery[1]).toEqual([42, 1, 16, 9, 33]);
  });

  test('repairs the installation WO assignment even when the service order already has that technician', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    jest.spyOn(User, 'hasEffectivePermission').mockResolvedValue(true);
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[{ ...ORDER, assigned_to: 7 }]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [[WORK_ORDER]];
      if (/UPDATE work_orders SET assigned_to/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM contracts/.test(sql)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'global' }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState();

    await service.prepareActivation(33, {
      orgId: 42, userId: 1, assignedTo: 7, canStartInstallation: true,
    });

    expect(prepareTx.query.mock.calls.some(([sql]) => /UPDATE service_orders SET assigned_to/.test(sql))).toBe(false);
    const repair = prepareTx.query.mock.calls.find(([sql]) => /UPDATE work_orders SET assigned_to/.test(sql));
    expect(repair).toBeDefined();
    expect(repair[0]).toMatch(/IF\(status = 'pending', 'assigned', status\)/);
    expect(repair[1]).toEqual([7, 16]);
  });

  test('rejects an assignee who cannot update work orders in this organization', async () => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    jest.spyOn(User, 'hasEffectivePermission').mockResolvedValue(false);

    await expect(service.prepareActivation(33, {
      orgId: 42, assignedTo: 999, canStartInstallation: true,
    }))
      .rejects.toThrow(/not authorized/i);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test.each([
    ['view prepared work orders', 'work_orders.view'],
    ['update prepared work orders', 'work_orders.update'],
    ['create commissioning speed evidence', 'speed_tests.create'],
  ])('rejects a commissioning assignee who cannot %s', async (_capability, deniedPermission) => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    jest.spyOn(User, 'hasEffectivePermission')
      .mockImplementation(async (_userId, _orgId, permission) => permission !== deniedPermission);

    await expect(service.prepareActivation(33, {
      orgId: 42, assignedTo: 7, canStartInstallation: true,
    }))
      .rejects.toThrow(/work-order view, work-order update, and speed-test create permissions/);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test.each([
    ['cancelled', [{ ...WORK_ORDER, status: 'cancelled' }]],
    ['soft-deleted', []],
  ])('creates one authoritative replacement when the prior installation WO is %s', async (_case, existingRows) => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[ORDER]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [existingRows];
      if (/INSERT INTO work_orders/.test(sql)) return [{ insertId: 14 }];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM contracts/.test(sql)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'global' }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState({ workOrder: { ...WORK_ORDER, id: 14, status: 'pending' }, speedTest: null });

    const state = await service.prepareActivation(33, {
      orgId: 42, userId: 1, canStartInstallation: true,
    });

    const replacement = prepareTx.query.mock.calls.find(([sql]) => /INSERT INTO work_orders/.test(sql));
    expect(replacement).toBeDefined();
    expect(replacement[1]).toEqual(expect.arrayContaining([42, 9, 33, 16, 7, 1]));
    expect(state.work_order).toEqual(expect.objectContaining({ id: 14 }));
    expect(prepareTx.commit).toHaveBeenCalled();
  });

  test.each([
    ['acceptance', { ...WORK_ORDER, status: 'completed', acceptance_rx_dbm: null }, false],
    ['bound speed test', { ...WORK_ORDER, status: 'completed' }, true],
  ])('recommissions a historical completed visit missing %s evidence', async (
    _missing, completedWorkOrder, shouldQuerySpeed,
  ) => {
    jest.spyOn(Contract, 'findById').mockResolvedValue(CONTRACT);
    const prepareTx = tx();
    prepareTx.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM contracts/.test(sql)) return [[CONTRACT]];
      if (/SELECT \* FROM service_orders/.test(sql)) return [[ORDER]];
      if (/SELECT \* FROM work_orders/.test(sql)) return [[completedWorkOrder]];
      if (/SELECT id FROM speed_tests/.test(sql)) return [[]];
      if (/INSERT INTO work_orders/.test(sql)) return [{ insertId: 14 }];
      return [[]];
    });
    const backfillTx = tx();
    backfillTx.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM contracts/.test(sql)) return [[{ id: 33 }]];
      if (/SELECT locale FROM organizations/.test(sql)) return [[{ locale: 'global' }]];
      return [[]];
    });
    db.getConnection.mockResolvedValueOnce(prepareTx).mockResolvedValueOnce(backfillTx);
    wireState({ workOrder: { ...WORK_ORDER, id: 14, status: 'pending' }, speedTest: null });

    const state = await service.prepareActivation(33, {
      orgId: 42, userId: 1, canStartInstallation: true,
    });

    expect(prepareTx.query.mock.calls.some(([sql]) => /INSERT INTO work_orders/.test(sql))).toBe(true);
    expect(prepareTx.query.mock.calls.some(([sql]) => /SELECT id FROM speed_tests/.test(sql)))
      .toBe(shouldQuerySpeed);
    expect(state.work_order).toEqual(expect.objectContaining({ id: 14, status: 'pending' }));
  });
});

describe('activate', () => {
  test('delegates permanent activation to lifecycleService.completeOrder and returns readiness plus invoice', async () => {
    let contractReads = 0;
    db.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT c\.\* FROM contracts c/.test(s)) {
        contractReads += 1;
        return [[{ ...CONTRACT, status: contractReads === 1 ? 'pending' : 'active' }]];
      }
      if (/SELECT so\.\*/.test(s)) return [[{ ...ORDER, status: contractReads === 1 ? 'in_process' : 'done' }]];
      if (/SELECT wo\.\*/.test(s)) return [[WORK_ORDER]];
      if (/FROM signed_documents/.test(s)) return [[]];
      if (/FROM speed_tests/.test(s)) return [[SPEED_TEST]];
      if (/SELECT status, nas_id FROM radius/.test(s)) return [[{ status: 'active', nas_id: null }]];
      if (/SELECT locale FROM organizations/.test(s)) return [[{ locale: 'global' }]];
      return [[]];
    });
    lifecycleService.completeOrder.mockResolvedValue({
      order: { ...ORDER, status: 'done' },
      invoice: { id: 6, invoice_number: 'INV-000006' },
    });

    const state = await service.activate(33, {
      orgId: 42, userId: 1, billing: 'create_invoice', installationFee: 500, description: 'Install',
    });

    expect(lifecycleService.completeOrder).toHaveBeenCalledWith(16, {
      orgId: 42, userId: 1, billing: 'create_invoice', installationFee: 500, description: 'Install',
      canActivateContract: true, canCreateInvoice: true,
    });
    expect(state.status).toBe('active');
    expect(state.invoice).toEqual({ id: 6, invoice_number: 'INV-000006' });
  });
});

describe('cancelActivation', () => {
  test('delegates a prepared activation to canonical service-order cancellation', async () => {
    const conn = tx();
    conn.query.mockImplementation(async (sql) => {
      if (/SELECT so\.id FROM service_orders/.test(sql)) return [[{ id: 16 }]];
      if (/SELECT c\.\* FROM contracts c/.test(sql)) return [[CONTRACT]];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);
    lifecycleService.cancelOrder.mockResolvedValue({
      order: { ...ORDER, status: 'cancelled' }, contractCancelled: true,
    });
    wireState({
      contract: { ...CONTRACT, status: 'cancelled' },
      order: { ...ORDER, status: 'cancelled' },
      workOrder: { ...WORK_ORDER, status: 'cancelled' },
      speedTest: null,
      radius: 'inactive',
    });

    const result = await service.cancelActivation(33, { orgId: 42 });

    expect(conn.commit).toHaveBeenCalled();
    expect(lifecycleService.cancelOrder).toHaveBeenCalledWith(16, { orgId: 42 });
    expect(result).toEqual(expect.objectContaining({
      contract_id: 33,
      status: 'cancelled',
      cancelled: true,
      cancellation: {
        contract_cancelled: true,
        service_order_id: 16,
        service_order_cancelled: true,
      },
    }));
  });

  test('cancels an unprepared no-marker PPPoE contract with durable cleanup', async () => {
    const conn = tx();
    let orderReads = 0;
    conn.query.mockImplementation(async (sql) => {
      if (/SELECT so\.id FROM service_orders/.test(sql)) {
        orderReads += 1;
        return [[]];
      }
      if (/SELECT c\.\* FROM contracts c/.test(sql)) return [[CONTRACT]];
      if (/UPDATE contracts/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM radius/.test(sql)) {
        return [[{
          id: 91, organization_id: 42, contract_id: 33,
          username: 'pending-user', status: 'inactive', nas_id: null,
        }]];
      }
      if (/UPDATE radius/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);
    radiusService.syncFreeradiusContract.mockResolvedValue({ found: true, enabled: false });
    suspensionService.sendRadiusDisconnect.mockResolvedValue({ sent: false, response: 'no active session' });
    wireState({
      contract: { ...CONTRACT, status: 'cancelled' },
      order: null,
      workOrder: null,
      speedTest: null,
      radius: 'inactive',
    });

    const result = await service.cancelActivation(33, { orgId: 42 });

    expect(orderReads).toBe(1);
    expect(lifecycleService.cancelOrder).not.toHaveBeenCalled();
    expect(radiusService.syncFreeradiusContract).toHaveBeenCalledWith(33, {
      organizationId: 42, enabled: false, runner: conn,
    });
    const contractOff = conn.query.mock.calls.find(([sql]) =>
      /UPDATE contracts/.test(sql));
    expect(contractOff[0]).toMatch(/test_window_cleanup_pending = 1/);
    expect(contractOff[0]).not.toMatch(/DATE_SUB|COALESCE/);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
    expect(result.cancellation).toEqual({
      contract_cancelled: true,
      service_order_id: null,
      service_order_cancelled: false,
    });
  });
});

describe('retryNetworkActivation', () => {
  function wireRetry({ pushError = null } = {}) {
    db.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT c\.\* FROM contracts c/.test(s)) {
        return [[{ ...CONTRACT, status: 'active', first_activated_at: STARTED_AT }]];
      }
      if (/SELECT so\.\* FROM service_orders so/.test(s)) return [[{ ...ORDER, status: 'done' }]];
      if (/SELECT r\.\* FROM radius r/.test(s)) {
        return [[{
          id: 91, organization_id: 42, contract_id: 33, nas_id: 12,
          username: 'client01', password: 'secret', profile: '50M', status: 'active',
        }]];
      }
      return [[]];
    });
    Nas.findByIdOrFail.mockResolvedValue({ id: 12, organization_id: 42 });
    if (pushError) routerProvisioningService.pushSubscriber.mockRejectedValue(pushError);
    else routerProvisioningService.pushSubscriber.mockResolvedValue({ created: true });
  }

  test('idempotently re-pushes an active completed installation without billing or lifecycle transitions', async () => {
    wireRetry();

    const result = await service.retryNetworkActivation(33, { orgId: 42 });

    expect(result).toEqual({
      contract_id: 33, service_order_id: 16, radius_id: 91, nas_id: 12, success: true,
    });
    expect(routerProvisioningService.pushSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      expect.objectContaining({ username: 'client01', password: 'secret', profile: '50M' }),
    );
    const radiusRead = db.query.mock.calls.find(([sql]) => /SELECT r\.\* FROM radius r/.test(sql));
    expect(radiusRead[0]).toMatch(/r\.organization_id = \?/);
    expect(radiusRead[1]).toEqual([33, 42]);
    expect(lifecycleService.completeOrder).not.toHaveBeenCalled();
  });

  test('returns an explicit retryable failure after a RouterOS transport error', async () => {
    wireRetry({ pushError: new Error('connect ETIMEDOUT') });

    const result = await service.retryNetworkActivation(33, { orgId: 42 });

    expect(result).toEqual(expect.objectContaining({
      contract_id: 33, nas_id: 12, success: false, error: 'connect ETIMEDOUT',
    }));
  });

  test('re-pushes a grandfathered subscriber without requiring service-order history', async () => {
    wireRetry();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (/SELECT so\.\* FROM service_orders so/.test(String(sql))) return [[]];
      return original(sql, params);
    });

    const result = await service.retryNetworkActivation(33, { orgId: 42 });

    expect(result).toEqual({
      contract_id: 33, service_order_id: null, radius_id: 91, nas_id: 12, success: true,
    });
    expect(lifecycleService.completeOrder).not.toHaveBeenCalled();
  });

  test('rejects ambiguous active RADIUS accounts instead of pushing an arbitrary subscriber', async () => {
    wireRetry();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (/SELECT r\.\* FROM radius r/.test(String(sql))) {
        return [[
          { id: 91, organization_id: 42, status: 'active', nas_id: 12 },
          { id: 92, organization_id: 42, status: 'active', nas_id: 12 },
        ]];
      }
      return original(sql, params);
    });

    await expect(service.retryNetworkActivation(33, { orgId: 42 }))
      .rejects.toThrow(/multiple active RADIUS/i);
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
  });
});

describe('renewPreviouslyActivated', () => {
  function wireRenewalTransaction({ radius = null } = {}) {
    const conn = tx();
    conn.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT c\.\* FROM contracts c/.test(s) && /FOR UPDATE/.test(s)) {
        return [[{
          ...CONTRACT,
          status: 'terminated',
          first_activated_at: new Date('2025-01-01T00:00:00Z'),
        }]];
      }
      if (/SELECT r\.\* FROM radius r/.test(s) && /FOR UPDATE/.test(s)) {
        return [radius ? [{ ...radius }] : []];
      }
      if (/UPDATE contracts SET/.test(s)) return [{ affectedRows: 1 }];
      if (/UPDATE radius SET status = 'active'/.test(s)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM `contracts`/.test(s)) {
        return [[{
          ...CONTRACT,
          status: 'active',
          first_activated_at: new Date('2025-01-01T00:00:00Z'),
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);
    radiusService.syncFreeradiusContract.mockResolvedValue({ found: true, enabled: true });
    return conn;
  }

  test('reprovisions a missing account and atomically restores FreeRADIUS after the contract is active', async () => {
    const conn = wireRenewalTransaction();
    subscriberProvisioningService.provisionNewContract.mockResolvedValue({
      connection_type: 'pppoe',
      pppoe: {
        radius_id: 91, username: 'renewed-user', password: 'secret',
        ipv4_pool_id: 2, ipv6_pool_id: null,
      },
    });

    const result = await service.renewPreviouslyActivated(33, { orgId: 42 });

    expect(subscriberProvisioningService.provisionNewContract).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ id: 33, status: 'terminated' }),
    );
    const contractUpdateIndex = conn.query.mock.calls.findIndex(([sql]) =>
      /UPDATE contracts SET/.test(String(sql)));
    const radiusUpdateIndex = conn.query.mock.calls.findIndex(([sql]) =>
      /UPDATE radius SET status = 'active'/.test(String(sql)));
    expect(contractUpdateIndex).toBeGreaterThan(-1);
    expect(radiusUpdateIndex).toBeGreaterThan(contractUpdateIndex);
    expect(radiusService.syncFreeradiusContract).toHaveBeenCalledWith(33, {
      organizationId: 42, enabled: true, runner: conn,
    });
    expect(conn.commit).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      contract: expect.objectContaining({ status: 'active' }),
      provisioning: expect.objectContaining({ pppoe: expect.objectContaining({ radius_id: 91 }) }),
      network_activation: expect.objectContaining({
        radius_id: 91, radius_synced: true, nas_pushed: false,
      }),
    }));
  });

  test('best-effort RouterOS failure is explicit and does not roll back the renewal', async () => {
    const conn = wireRenewalTransaction({
      radius: {
        id: 92, organization_id: 42, contract_id: 33, status: 'inactive',
        username: 'existing-user', password: 'secret', profile: '50M', nas_id: 12,
      },
    });
    Nas.findByIdOrFail.mockResolvedValue({ id: 12, organization_id: 42 });
    routerProvisioningService.pushSubscriber.mockRejectedValue(new Error('NAS unreachable'));

    const result = await service.renewPreviouslyActivated(33, { orgId: 42 });

    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(result.network_activation).toEqual(expect.objectContaining({
      radius_id: 92,
      nas_id: 12,
      radius_synced: true,
      nas_pushed: false,
      nas_push_error: 'NAS unreachable',
    }));
  });

  test('does not revive a frozen sandbox contract after the organization switches to production', async () => {
    const conn = tx();
    conn.query.mockImplementation(async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT c\.\* FROM contracts c/.test(s) && /FOR UPDATE/.test(s)) {
        return [[{
          ...CONTRACT,
          status: 'terminated',
          first_activated_at: new Date('2025-01-01T00:00:00Z'),
          mx_contract_environment: 'sandbox',
        }]];
      }
      if (/FROM organizations o/.test(s)) {
        expect(params).toEqual([42]);
        return [[{
          locale: 'MX', contract_environment: 'production', mx_profile_id: 4,
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    await expect(service.renewPreviouslyActivated(33, { orgId: 42 }))
      .rejects.toThrow(/sandbox.*production|production.*sandbox/i);

    expect(subscriberProvisioningService.provisionNewContract).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /SELECT r\.\* FROM radius r/.test(String(sql))))
      .toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE contracts SET/.test(String(sql))))
      .toBe(false);
    expect(radiusService.syncFreeradiusContract).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  test('does not renew source-free legacy history after its organization becomes Mexican', async () => {
    const conn = tx();
    conn.query.mockImplementation(async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT c\.\* FROM contracts c/.test(s) && /FOR UPDATE/.test(s)) {
        return [[{
          ...CONTRACT,
          status: 'terminated',
          first_activated_at: new Date('2025-01-01T00:00:00Z'),
          contract_template_mx_id: null,
          mx_contract_environment: null,
        }]];
      }
      if (/FROM organizations o/.test(s)) {
        expect(params).toEqual([42]);
        return [[{
          locale: 'MX', contract_environment: 'sandbox', mx_profile_id: 4,
        }]];
      }
      return [[]];
    });
    db.getConnection.mockResolvedValue(conn);

    await expect(service.renewPreviouslyActivated(33, { orgId: 42 }))
      .rejects.toThrow(/frozen MX contract source.*environment|classified MX contract/i);

    expect(subscriberProvisioningService.provisionNewContract).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.some(([sql]) => /SELECT r\.\* FROM radius r/.test(String(sql))))
      .toBe(false);
    expect(conn.query.mock.calls.some(([sql]) => /UPDATE contracts SET/.test(String(sql))))
      .toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
