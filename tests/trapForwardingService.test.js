'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn() }));
jest.mock('../src/services/jobQueueService', () => ({ add: jest.fn() }));
jest.mock('../src/services/trapForwardingReadinessService', () => ({
  checkSchemaReadiness: jest.fn(),
}));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const { EventEmitter } = require('node:events');
const dns = require('node:dns').promises;
const db = require('../src/config/database');
const emailTransport = require('../src/services/emailTransport');
const jobQueue = require('../src/services/jobQueueService');
const trapForwardingReadiness = require('../src/services/trapForwardingReadinessService');
const https = require('https');
const {
  MAX_ACTIVE_RULES,
  MAX_AMBIGUOUS_RECOVERIES,
  matchesRule,
  buildForwardPayload,
  validateRuleInput,
  prepareTrapDeliveries,
  enqueuePreparedDeliveries,
  forwardTrap,
  queueTestDelivery,
  attemptDelivery,
  processRetries,
  cancelUnclaimedDeliveriesForRule,
  safeHttpsPost,
} = require('../src/services/trapForwardingService');

const trap = {
  organizationId: 42,
  trapId: 701,
  sourceIp: '10.20.30.40',
  trapType: 'linkDown',
  trapOid: '1.3.6.1.6.3.1.1.5.3',
  snmpVersion: 2,
  receivedAt: '2026-08-17T01:02:03.000Z',
  community: 'private-community-secret',
  varbinds: [{ oid: '1.2.3', value: 'router-password-in-varbind' }],
};

const device = {
  id: 91,
  name: 'Tower router',
  ip_address: '10.20.30.40',
  snmp_community: 'device-community-secret',
  password: 'device-password-secret',
};

const rule = {
  id: 11,
  organization_id: 42,
  name: 'Link down to NOC',
  match_trap_type: 'linkDown',
  match_source_ip: null,
  match_oid_prefix: null,
  forward_to_url: null,
  forward_to_email: 'noc@example.com',
  forward_to_webhook_id: null,
  is_active: 1,
  deleted_at: null,
};

function mockHttpsResponse(statusCode = 204, remoteAddress = '8.8.8.8') {
  https.request.mockImplementation((options, callback) => {
    const request = new EventEmitter();
    request.end = jest.fn(() => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.socket = { remoteAddress };
      response.resume = jest.fn();
      callback(response);
      global.setImmediate(() => response.emit('end'));
    });
    request.destroy = jest.fn(error => request.emit('error', error));
    return request;
  });
}

function installForwardDb(rules, { webhook = null, failRuleId = null } = {}) {
  let deliveryId = 800;
  db.query.mockImplementation((sql, params = []) => {
    if (/FROM organizations/.test(sql)) {
      return Promise.resolve([[
        { id: 42, status: 'active', deleted_at: null, outbound_delivery_epoch: 7 },
      ]]);
    }
    if (/SELECT \*\s+FROM snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([rules]);
    if (/FROM webhooks/.test(sql)) {
      const requestedId = Number(params[1]);
      return Promise.resolve([[webhook && Number(webhook.id) === requestedId ? webhook : null].filter(Boolean)]);
    }
    if (/INSERT INTO snmp_trap_forwarding_deliveries/.test(sql)) {
      if (Number(params[2]) === Number(failRuleId)) return Promise.reject(new Error('delivery insert failed'));
      deliveryId += 1;
      return Promise.resolve([{ insertId: deliveryId }]);
    }
    if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    return Promise.resolve([[]]);
  });
}

function attemptPreflightRow(row) {
  return {
    ...row,
    current_rule_id: row.rule_id,
    configuration_reviewed_at: '2026-08-17T00:00:00.000Z',
    current_webhook_id: row.webhook_id,
    current_webhook_url: row.target_type === 'webhook' ? row.target_url : null,
    current_webhook_is_active: row.target_type === 'webhook' ? 1 : null,
    current_webhook_deleted_at: null,
    current_organization_id: row.organization_id,
    current_organization_status: row.current_organization_status || 'active',
    current_organization_deleted_at: row.current_organization_deleted_at || null,
    current_organization_epoch: row.current_organization_epoch ?? row.organization_epoch,
  };
}

function installAttemptDb(row, {
  webhook = null,
  claim = true,
  claimPrefix = 'F',
  organizationActive = true,
} = {}) {
  db.query.mockImplementation((sql, params = []) => {
    if (/SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql)) {
      return Promise.resolve([[attemptPreflightRow(row)]]);
    }
    if (/UPDATE snmp_trap_forwarding_deliveries\s+SET claim_token = CONCAT/.test(sql)) {
      return Promise.resolve([{ affectedRows: claim ? 1 : 0 }]);
    }
    if (/SELECT d\.\*, r\.id AS current_rule_id/.test(sql)) {
      const requestedToken = params[1];
      return Promise.resolve([claim ? [{
        ...attemptPreflightRow(row),
        claim_token: `${claimPrefix}${String(requestedToken).slice(1)}`,
      }] : []]);
    }
    if (/FROM organizations/.test(sql)) {
      return Promise.resolve([organizationActive ? [{
        id: row.organization_id,
        status: 'active',
        deleted_at: null,
        outbound_delivery_epoch: row.organization_epoch,
      }] : [{
        id: row.organization_id,
        status: 'suspended',
        deleted_at: null,
        outbound_delivery_epoch: Number(row.organization_epoch) + 1,
      }]]);
    }
    if (/FROM webhooks/.test(sql)) {
      const requestedId = Number(params[1]);
      return Promise.resolve([[webhook && Number(webhook.id) === requestedId ? webhook : null].filter(Boolean)]);
    }
    if (/UPDATE snmp_trap_forwarding_deliveries/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
    return Promise.resolve([[]]);
  });
}

function deliveryRow(overrides = {}) {
  const row = {
    id: 801,
    organization_id: 42,
    organization_epoch: 7,
    rule_id: 11,
    trap_id: 701,
    webhook_id: null,
    target_type: 'email',
    target_url: null,
    target_email: 'noc@example.com',
    payload: JSON.stringify(buildForwardPayload(trap, device)),
    is_test: 0,
    status: 'processing',
    attempt_number: 1,
    max_attempts: 4,
    created_at: '2026-08-17T01:02:04.000Z',
    rule_name: rule.name,
    rule_is_active: 1,
    rule_deleted_at: null,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rule_forward_to_url')) {
    row.rule_forward_to_url = row.target_type === 'url' ? row.target_url : null;
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rule_forward_to_email')) {
    row.rule_forward_to_email = row.target_type === 'email' ? row.target_email : null;
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rule_forward_to_webhook_id')) {
    row.rule_forward_to_webhook_id = row.target_type === 'webhook' ? row.webhook_id : null;
  }
  return row;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete db.withPrimaryContext;
  delete db.withTenantContext;
  delete db.getConnection;
  trapForwardingReadiness.checkSchemaReadiness.mockResolvedValue({
    ready: true,
    primary: { ready: true, reason: null },
    isolated: [],
    reason: null,
  });
  emailTransport.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1' });
  jobQueue.add.mockResolvedValue({ id: 'job-1', status: 'queued' });
});

describe('matchesRule()', () => {
  test('treats empty criteria as wildcards', () => {
    expect(matchesRule({
      match_trap_type: null,
      match_source_ip: null,
      match_oid_prefix: null,
    }, trap)).toBe(true);
  });

  test('ANDs every populated matcher', () => {
    expect(matchesRule({
      match_trap_type: 'linkDown',
      match_source_ip: '10.20.30.40',
      match_oid_prefix: '1.3.6.1.6.3',
    }, trap)).toBe(true);

    for (const mismatch of [
      { match_trap_type: 'linkUp' },
      { match_source_ip: '10.20.30.41' },
      { match_oid_prefix: '1.3.6.1.4.1' },
    ]) {
      expect(matchesRule({ ...rule, ...mismatch }, trap)).toBe(false);
    }
  });

  test('uses dotted OID-component boundaries instead of unsafe string prefixes', () => {
    expect(matchesRule({ match_oid_prefix: '1.3.6.1' }, { trapOid: '1.3.6.1.4.1' })).toBe(true);
    expect(matchesRule({ match_oid_prefix: '1.3.6.1' }, { trapOid: '1.3.6.10.1' })).toBe(false);
    expect(matchesRule({ match_oid_prefix: '1.3.6.1' }, { trapOid: '1.3.6.1' })).toBe(true);
  });

  test('normalizes the common IPv4-mapped sender representation', () => {
    expect(matchesRule(
      { match_source_ip: '10.20.30.40' },
      { sourceIp: '::ffff:10.20.30.40' },
    )).toBe(true);
    expect(matchesRule(
      { match_source_ip: '10.20.30.40' },
      { sourceIp: '::ffff:0a14:1e28' },
    )).toBe(true);
  });

  test('matches equivalent compressed and expanded IPv6 spellings', () => {
    expect(matchesRule(
      { match_source_ip: '2001:0db8:0000:0000:0000:0000:0000:0001' },
      { sourceIp: '2001:db8::1' },
    )).toBe(true);
  });

  test('never matches missing input accidentally', () => {
    expect(matchesRule(null, trap)).toBe(false);
    expect(matchesRule(rule, null)).toBe(false);
    expect(matchesRule({ match_oid_prefix: '1.2.3' }, { trapOid: null })).toBe(false);
  });
});

describe('buildForwardPayload()', () => {
  test('emits only the documented metadata allowlist', () => {
    const payload = buildForwardPayload(trap, device);

    expect(payload).toEqual({
      event: 'snmp.trap',
      organization_id: 42,
      trap: {
        id: 701,
        source_ip: '10.20.30.40',
        type: 'linkDown',
        oid: '1.3.6.1.6.3.1.1.5.3',
        snmp_version: 2,
        received_at: '2026-08-17T01:02:03.000Z',
      },
      device: { id: 91, name: 'Tower router' },
    });
  });

  test('never leaks community strings, varbind values, or device credentials', () => {
    const serialized = JSON.stringify(buildForwardPayload(trap, device));

    for (const secret of [
      'private-community-secret',
      'router-password-in-varbind',
      'device-community-secret',
      'device-password-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/community|varbind|password/i);
  });
});

describe('forwardTrap()', () => {
  test('loads only active, non-deleted rules from the attributed organization', async () => {
    installForwardDb([rule]);

    const result = await forwardTrap(trap, device);

    expect(result).toEqual({
      matched_rules: 1,
      queued_deliveries: 1,
      delivery_ids: [801],
      selected_webhook_ids: [],
      errors: 0,
      skipped_deliveries: 0,
      skip_reason: null,
    });
    const ruleLookup = db.query.mock.calls.find(([sql]) => /SELECT \*\s+FROM snmp_trap_forwarding_rules/.test(sql));
    expect(ruleLookup[0]).toMatch(/organization_id = \?/);
    expect(ruleLookup[0]).toMatch(/is_active = 1/);
    expect(ruleLookup[0]).toMatch(/deleted_at IS NULL/);
    expect(ruleLookup[1]).toEqual([42]);
    expect(jobQueue.add).toHaveBeenCalledWith(
      'trap-forwarding-delivery',
      { deliveryId: 801, organizationId: 42 },
      {
        jobId: 'trap-forwarding-42-801',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  test('queues a full durable batch concurrently and reports one aggregate outage outcome', async () => {
    const rejectors = [];
    jobQueue.add.mockImplementation(() => new Promise((_, reject) => rejectors.push(reject)));

    const outcome = enqueuePreparedDeliveries(
      Array.from({ length: MAX_ACTIVE_RULES }, (_, index) => index + 1),
      42,
    );
    await new Promise(resolve => global.setImmediate(resolve));

    // A serial loop would have started only its first Redis command here and
    // multiplied the producer deadline by the rule cap.
    expect(jobQueue.add).toHaveBeenCalledTimes(MAX_ACTIVE_RULES);
    rejectors.forEach(reject => reject(Object.assign(new Error('Redis unavailable'), {
      code: 'JOB_QUEUE_ADD_TIMEOUT',
    })));
    await expect(outcome).resolves.toEqual({
      queued: 0,
      failed: MAX_ACTIVE_RULES,
      total: MAX_ACTIVE_RULES,
    });
    expect(new Set(jobQueue.add.mock.calls.map(([, , options]) => options.jobId)).size)
      .toBe(MAX_ACTIVE_RULES);
  });

  test('persists only matching rules and stores the privacy-minimal payload', async () => {
    installForwardDb([
      rule,
      { ...rule, id: 12, match_trap_type: 'linkUp' },
    ]);

    const result = await forwardTrap(trap, device);

    expect(result.matched_rules).toBe(1);
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO snmp_trap_forwarding_deliveries/.test(sql));
    const storedPayload = insert[1][8];
    expect(insert[0]).toMatch(/organization_id, organization_epoch, rule_id/);
    expect(insert[1][1]).toBe(7);
    expect(storedPayload).toContain('"type":"linkDown"');
    expect(storedPayload).not.toMatch(/community|varbind|password/i);
  });

  test.each([
    [{ forward_to_url: null, forward_to_email: null, forward_to_webhook_id: null }],
    [{ forward_to_url: 'https://8.8.8.8/hook', forward_to_email: 'noc@example.com' }],
  ])('skips an invalid legacy rule with zero or multiple destinations', async (targets) => {
    installForwardDb([{ ...rule, ...targets }]);

    const result = await forwardTrap(trap, device);

    expect(result).toMatchObject({ matched_rules: 1, queued_deliveries: 0, errors: 1 });
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO snmp_trap_forwarding_deliveries/.test(sql))).toBe(false);
    expect(jobQueue.add).not.toHaveBeenCalled();
  });

  test('does no tenant query or delivery for an unattributed trap', async () => {
    await expect(forwardTrap({ ...trap, organizationId: null }, null)).resolves.toEqual({
      matched_rules: 0,
      queued_deliveries: 0,
      delivery_ids: [],
      selected_webhook_ids: [],
      errors: 0,
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(jobQueue.add).not.toHaveBeenCalled();
  });

  test('verifies registered webhook ownership and reports its id for duplicate suppression', async () => {
    const webhook = {
      id: 44,
      organization_id: 42,
      url: 'https://8.8.8.8/hook',
      secret_encrypted: 'signing-secret',
      max_retries: 3,
      timeout_seconds: 10,
    };
    installForwardDb([{
      ...rule,
      forward_to_email: null,
      forward_to_webhook_id: 44,
    }], { webhook });

    const result = await forwardTrap(trap, device);

    expect(result.selected_webhook_ids).toEqual([44]);
    const lookup = db.query.mock.calls.find(([sql]) => /FROM webhooks/.test(sql));
    expect(lookup[0]).toMatch(/organization_id = \?/);
    expect(lookup[0]).toMatch(/is_active = 1/);
    expect(lookup[0]).toMatch(/deleted_at IS NULL/);
    expect(lookup[1]).toEqual([42, 44]);
  });

  test('does not persist a delivery when an adapter returns a same-id webhook owned by another organization', async () => {
    const foreignWebhook = {
      id: 44,
      organization_id: 99,
      url: 'https://8.8.8.8/foreign-hook',
      secret_encrypted: 'foreign-signing-secret',
      max_retries: 3,
      timeout_seconds: 10,
    };
    installForwardDb([{
      ...rule,
      forward_to_email: null,
      forward_to_webhook_id: 44,
    }], { webhook: foreignWebhook });

    await expect(forwardTrap(trap, device)).resolves.toMatchObject({
      matched_rules: 1,
      queued_deliveries: 0,
      errors: 1,
    });
    expect(db.query.mock.calls.some(
      ([sql]) => /INSERT INTO snmp_trap_forwarding_deliveries/.test(sql),
    )).toBe(false);
    expect(jobQueue.add).not.toHaveBeenCalled();
  });

  test('isolates persistence and queue failures between matching rules', async () => {
    installForwardDb([
      rule,
      { ...rule, id: 12, name: 'Second rule' },
    ], { failRuleId: 11 });
    jobQueue.add.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(forwardTrap(trap, device)).resolves.toMatchObject({
      matched_rules: 2,
      queued_deliveries: 1,
      errors: 1,
    });
    expect(jobQueue.add).toHaveBeenCalledTimes(1);
  });

  test('does not enqueue a second real delivery when the same stored trap is forwarded twice', async () => {
    let inserted = false;
    db.query.mockImplementation((sql) => {
      if (/FROM organizations/.test(sql)) {
        return Promise.resolve([[
          { id: 42, status: 'active', deleted_at: null, outbound_delivery_epoch: 7 },
        ]]);
      }
      if (/SELECT \*\s+FROM snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([[rule]]);
      if (/INSERT INTO snmp_trap_forwarding_deliveries/.test(sql)) {
        if (inserted) {
          return Promise.reject(Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          }));
        }
        inserted = true;
        return Promise.resolve([{ insertId: 801 }]);
      }
      if (/SELECT id\s+FROM snmp_trap_forwarding_deliveries/.test(sql)) {
        return Promise.resolve([[{ id: 801 }]]);
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.reject(new Error(`Unexpected idempotency SQL: ${sql}`));
    });

    await expect(forwardTrap(trap, device)).resolves.toMatchObject({ queued_deliveries: 1, errors: 0 });
    await expect(forwardTrap(trap, device)).resolves.toMatchObject({ queued_deliveries: 0, errors: 0 });

    expect(jobQueue.add).toHaveBeenCalledTimes(1);
    const duplicateLookup = db.query.mock.calls.find(
      ([sql]) => /SELECT id\s+FROM snmp_trap_forwarding_deliveries/.test(sql),
    );
    expect(duplicateLookup[0]).toMatch(/organization_id = \? AND rule_id = \? AND trap_id = \?/);
    expect(duplicateLookup[1]).toEqual([42, 11, 701]);
  });

  test('atomic preparation rolls back only a failing rule savepoint and preserves other durable rows', async () => {
    const firstRule = { ...rule, id: 11 };
    const brokenRule = { ...rule, id: 12, name: 'Deleted destination parent' };
    let deliveryInsert = 0;
    const exec = jest.fn(async (sql) => {
      if (/FROM organizations/.test(sql)) {
        return [[{ id: 42, status: 'active', deleted_at: null, outbound_delivery_epoch: 7 }]];
      }
      if (/SELECT \*\s+FROM snmp_trap_forwarding_rules/.test(sql)) {
        return [[firstRule, brokenRule]];
      }
      if (/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i.test(sql)) {
        return [{ affectedRows: 0 }];
      }
      if (/INSERT INTO snmp_trap_forwarding_deliveries/.test(sql)) {
        deliveryInsert += 1;
        if (deliveryInsert === 2) {
          throw Object.assign(new Error('destination foreign key failed'), {
            code: 'ER_NO_REFERENCED_ROW_2',
          });
        }
        return [{ insertId: 901 }];
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected atomic preparation SQL: ${sql}`);
    });

    const refundCapacity = jest.fn().mockResolvedValue(undefined);
    await expect(prepareTrapDeliveries(trap, device, {
      exec,
      atomic: true,
      refundCapacity,
    })).resolves.toEqual({
      matched_rules: 2,
      queued_deliveries: 1,
      delivery_ids: [901],
      selected_webhook_ids: [],
      errors: 1,
      skipped_deliveries: 0,
      skip_reason: null,
    });
    expect(refundCapacity).toHaveBeenCalledTimes(1);
    expect(refundCapacity).toHaveBeenCalledWith(1);

    const statements = exec.mock.calls.map(([sql]) => sql.trim());
    expect(statements.filter(sql => /^SAVEPOINT trap_forward_resolve_/i.test(sql))).toHaveLength(2);
    expect(statements.filter(sql => /^SAVEPOINT trap_forward_rule_/i.test(sql))).toHaveLength(2);
    expect(statements.filter(sql => /^ROLLBACK TO SAVEPOINT trap_forward_rule_/i.test(sql))).toHaveLength(1);
    expect(statements.filter(sql => /^RELEASE SAVEPOINT trap_forward_resolve_/i.test(sql))).toHaveLength(2);
    expect(statements.filter(sql => /^RELEASE SAVEPOINT trap_forward_rule_/i.test(sql))).toHaveLength(2);
  });

  test('daily delivery capacity persists only the allowed outboxes and reports every skipped match', async () => {
    installForwardDb([
      rule,
      { ...rule, id: 12, name: 'Second match' },
      { ...rule, id: 13, name: 'Third match' },
    ]);
    const reserveCapacity = jest.fn().mockResolvedValue({
      allowed_count: 1,
      skipped_count: 2,
      reason: 'daily_forwarding_delivery_limit',
    });

    await expect(prepareTrapDeliveries(trap, device, { reserveCapacity })).resolves.toEqual({
      matched_rules: 3,
      queued_deliveries: 1,
      delivery_ids: [801],
      selected_webhook_ids: [],
      errors: 0,
      skipped_deliveries: 2,
      skip_reason: 'daily_forwarding_delivery_limit',
    });
    expect(reserveCapacity).toHaveBeenCalledWith(3);
    expect(db.query.mock.calls.filter(
      ([sql]) => /INSERT INTO snmp_trap_forwarding_deliveries/.test(sql),
    )).toHaveLength(1);
  });

  test('caps active rule evaluation before reserving capacity or creating outboxes', async () => {
    const rows = Array.from({ length: MAX_ACTIVE_RULES + 2 }, (_, index) => ({
      ...rule,
      id: index + 1,
      name: `Bounded rule ${index + 1}`,
    }));
    db.query.mockImplementation(sql => {
      if (/FROM organizations/.test(sql)) {
        return Promise.resolve([[
          { id: 42, status: 'active', deleted_at: null, outbound_delivery_epoch: 7 },
        ]]);
      }
      if (/SELECT \*\s+FROM snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([rows]);
      throw new Error(`No outbox should be written after zero capacity: ${sql}`);
    });
    const reserveCapacity = jest.fn().mockResolvedValue({
      allowed_count: 0,
      skipped_count: MAX_ACTIVE_RULES,
      reason: 'daily_forwarding_delivery_limit',
    });

    await expect(prepareTrapDeliveries(trap, device, { reserveCapacity })).resolves.toMatchObject({
      matched_rules: MAX_ACTIVE_RULES,
      queued_deliveries: 0,
      skipped_deliveries: MAX_ACTIVE_RULES,
    });
    expect(reserveCapacity).toHaveBeenCalledWith(MAX_ACTIVE_RULES);
    expect(db.query.mock.calls[1][0]).toContain(`LIMIT ${MAX_ACTIVE_RULES + 1}`);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('attemptDelivery()', () => {
  test('email success records an observable success outcome', async () => {
    const row = deliveryRow();
    installAttemptDb(row);

    const result = await attemptDelivery(row.id);

    expect(result).toMatchObject({ id: row.id, status: 'success', attempt_number: 1 });
    const preflight = db.query.mock.calls.find(
      ([sql]) => /SELECT d\.id, d\.organization_id/.test(sql),
    );
    expect(preflight[0]).toMatch(/d\.organization_epoch/);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 42,
      emailFunction: 'noc',
      to: 'noc@example.com',
      subject: expect.stringContaining('linkDown'),
      installTransportOnly: true,
      sanitizeFailure: true,
    }));
    const sent = JSON.stringify(emailTransport.sendEmail.mock.calls[0][0]);
    expect(sent).not.toMatch(/community|varbind|password/i);
  });

  test('email failure schedules a retry without throwing', async () => {
    const row = deliveryRow();
    installAttemptDb(row);
    emailTransport.sendEmail.mockResolvedValue({ success: false, error: 'SMTP temporarily unavailable' });

    const result = await attemptDelivery(row.id);

    expect(result.status).toBe('retrying');
    expect(result.next_attempt_at).toBeTruthy();
  });

  test('an SMTP absolute-deadline outcome terminalizes before the claim lease without requeueing', async () => {
    const row = deliveryRow();
    installAttemptDb(row);
    emailTransport.sendEmail.mockResolvedValue({
      success: false,
      error: 'Email delivery exceeded its absolute deadline.',
      code: 'EMAIL_DELIVERY_TIMEOUT',
    });

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'dead_letter',
      attempt_number: 1,
    });

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      absoluteTimeoutMs: expect.any(Number),
    }));
    const timeout = emailTransport.sendEmail.mock.calls[0][0].absoluteTimeoutMs;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThan(5 * 60 * 1000);
    expect(jobQueue.add).not.toHaveBeenCalled();
    const outcomeUpdate = db.query.mock.calls.find(
      ([sql]) => /UPDATE snmp_trap_forwarding_deliveries[\s\S]*?claim_token = \?/.test(sql),
    );
    expect(outcomeUpdate[1][0]).toBe('dead_letter');
  });

  test('exhausted delivery becomes dead-letter', async () => {
    const row = deliveryRow({ attempt_number: 4, max_attempts: 4 });
    installAttemptDb(row);
    emailTransport.sendEmail.mockResolvedValue({ success: false, error: 'SMTP unavailable' });

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({ status: 'dead_letter' });
  });

  test('pausing, editing, or deleting a rule revokes only its unclaimed tenant-owned deliveries', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

    await expect(cancelUnclaimedDeliveriesForRule(11, 42, 'Rule changed.')).resolves.toBe(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE rule_id = \? AND organization_id = \?[\s\S]*status IN \('pending','retrying'\)/),
      ['Rule changed.', 11, 42],
    );
    expect(db.query.mock.calls[0][0]).not.toMatch(/status IN \([^)]*processing/);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('an operator test for a paused rule still delivers so it can be verified before enabling', async () => {
    const row = deliveryRow({
      trap_id: null,
      is_test: 1,
      rule_is_active: 0,
      payload: JSON.stringify({
        event: 'snmp.trap.test',
        test: true,
        organization_id: 42,
        rule: { id: 11, name: rule.name },
        sent_at: '2026-08-17T01:02:03.000Z',
      }),
    });
    installAttemptDb(row);

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({ status: 'success' });
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      installTransportOnly: true,
      sanitizeFailure: true,
    }));
  });

  test('a queued attempt cancels after its organization is suspended or deleted', async () => {
    const row = deliveryRow();
    db.withPrimaryContext = jest.fn(callback => callback());
    installAttemptDb(row, { organizationActive: false });

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'cancelled',
    });
    const organizationLookup = db.query.mock.calls.find(([sql]) => /FROM organizations/.test(sql));
    expect(organizationLookup[0]).toMatch(/outbound_delivery_epoch/);
    expect(organizationLookup[1]).toEqual([42]);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('suspend then reactivate cannot resurrect a delivery carrying the old lifecycle epoch', async () => {
    const row = deliveryRow({
      organization_epoch: 7,
      current_organization_status: 'active',
      current_organization_epoch: 9,
    });
    installAttemptDb(row);

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'destination_changed',
    });

    const preflight = db.query.mock.calls.find(
      ([sql]) => /SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql),
    );
    expect(preflight[0]).toMatch(/o\.outbound_delivery_epoch AS current_organization_epoch/);
    expect(db.query.mock.calls.some(([sql]) => /SET claim_token = CONCAT/.test(sql))).toBe(false);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a destination mutation before claim cancels the stale immutable snapshot', async () => {
    const row = deliveryRow({ rule_forward_to_email: 'new-noc@example.com' });
    installAttemptDb(row);

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'destination_changed',
    });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a rule mutation after preflight but before claim completion is rechecked and never sent', async () => {
    const row = deliveryRow();
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql)) {
        return Promise.resolve([[attemptPreflightRow(row)]]);
      }
      if (/SET claim_token = CONCAT/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT d\.\*, r\.id AS current_rule_id/.test(sql)) {
        return Promise.resolve([[
          attemptPreflightRow({
            ...row,
            rule_forward_to_email: 'changed-after-preflight@example.com',
            claim_token: `F${String(params[1]).slice(1)}`,
          }),
        ]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected post-claim mutation SQL: ${sql}`);
    });

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'cancelled',
      attempt_number: 1,
    });
    const outcome = db.query.mock.calls.find(
      ([sql]) => /AND status = 'processing' AND claim_token = \?/.test(sql),
    );
    expect(outcome[1][0]).toBe('cancelled');
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a case-only webhook capability-token change after preflight is rejected before HTTPS', async () => {
    const row = deliveryRow({
      target_type: 'webhook',
      target_email: null,
      target_url: 'https://8.8.8.8/hook/TokenA',
      webhook_id: 44,
    });
    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql)) {
        return Promise.resolve([[attemptPreflightRow(row)]]);
      }
      if (/SET claim_token = CONCAT/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT d\.\*, r\.id AS current_rule_id/.test(sql)) {
        return Promise.resolve([[
          {
            ...attemptPreflightRow(row),
            current_webhook_url: 'https://8.8.8.8/hook/tokena',
            claim_token: `F${String(params[1]).slice(1)}`,
          },
        ]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      throw new Error(`Unexpected case-only destination SQL: ${sql}`);
    });

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a selected webhook is re-checked against the delivery organization at attempt time', async () => {
    const row = deliveryRow({
      target_type: 'webhook',
      target_email: null,
      target_url: 'https://8.8.8.8/hook',
      webhook_id: 44,
    });
    installAttemptDb(row, { webhook: null });

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({ status: 'cancelled' });
    const lookup = db.query.mock.calls.find(([sql]) => /FROM webhooks/.test(sql));
    expect(lookup[1]).toEqual([42, 44]);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a same-id webhook owned by another organization cannot authorize redelivery', async () => {
    const row = deliveryRow({
      target_type: 'webhook',
      target_email: null,
      target_url: 'https://8.8.8.8/foreign-hook',
      webhook_id: 44,
    });
    installAttemptDb(row, {
      webhook: {
        id: 44,
        organization_id: 99,
        url: row.target_url,
        secret_encrypted: 'foreign-signing-secret',
      },
    });

    await expect(attemptDelivery(row.id, row.organization_id)).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(https.request).not.toHaveBeenCalled();
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('an unsafe URL is permanent failure and never opens a socket', async () => {
    const row = deliveryRow({
      target_type: 'url',
      target_email: null,
      target_url: 'https://169.254.169.254/latest/meta-data/',
    });
    installAttemptDb(row);

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({ status: 'dead_letter' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test.each([
    [500, 'retrying'],
    [429, 'retrying'],
    [400, 'dead_letter'],
    [204, 'success'],
  ])('maps HTTP %s to %s', async (statusCode, expectedStatus) => {
    const row = deliveryRow({
      target_type: 'url',
      target_email: null,
      target_url: 'https://8.8.8.8/hook',
    });
    installAttemptDb(row);
    mockHttpsResponse(statusCode);

    await expect(attemptDelivery(row.id)).resolves.toMatchObject({ status: expectedStatus });
  });

  test('duplicate or early jobs cannot claim the same delivery twice', async () => {
    installAttemptDb(deliveryRow(), { claim: false });

    await expect(attemptDelivery(801, 42)).resolves.toEqual({ id: 801, status: 'not_due' });
    const [claimSql, claimParams] = db.query.mock.calls.find(
      ([sql]) => /SET claim_token = CONCAT/.test(sql),
    );
    expect(claimSql).toMatch(/WHERE id = \? AND organization_id = \?/);
    expect(claimSql).toMatch(/revoked_at IS NULL/);
    expect(claimSql).toMatch(/attempt_number < max_attempts/);
    expect(claimSql).toMatch(/recovery_count >= 1 THEN 'X'/);
    expect(claimSql).toMatch(/attempt_number >= max_attempts THEN 'R'/);
    expect(claimSql).toMatch(/WHEN status = 'processing' THEN 'S'/);
    expect(claimSql).toMatch(/ELSE 'F'/);
    expect(claimSql).toMatch(/LEFT\(claim_token, 1\) = 'R'/);
    expect(claimSql).toMatch(/LEFT\(claim_token, 1\) IN \('F','S'\)/);
    expect(claimParams).toEqual([expect.any(String), 801, 42]);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('a stale final attempt gets one bounded recovery, then terminalizes without another send', async () => {
    expect(MAX_AMBIGUOUS_RECOVERIES).toBe(1);
    const state = deliveryRow({
      status: 'processing',
      attempt_number: 4,
      max_attempts: 4,
      recovery_count: 0,
      locked_at: '2026-08-17 00:00:00',
      claim_token: 'old-worker-token',
    });
    let crashOutcomeWrite = true;

    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql)) {
        return Promise.resolve([[attemptPreflightRow(state)]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries\s+SET claim_token = CONCAT/.test(sql)) {
        const prefix = state.recovery_count >= MAX_AMBIGUOUS_RECOVERIES ? 'X' : 'R';
        state.claim_token = `${prefix}${String(params[0]).slice(1)}`;
        if (prefix === 'R') state.recovery_count += 1;
        else {
          state.status = 'dead_letter';
          state.locked_at = null;
        }
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT d\.\*, r\.id AS current_rule_id/.test(sql)) {
        return Promise.resolve([[attemptPreflightRow(state)]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries[\s\S]*?AND status = 'processing' AND claim_token = \?/.test(sql)) {
        if (crashOutcomeWrite) {
          crashOutcomeWrite = false;
          return Promise.reject(new Error('connection lost after transport completed'));
        }
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    await expect(attemptDelivery(state.id, state.organization_id))
      .rejects.toThrow('connection lost after transport completed');
    expect(state.attempt_number).toBe(4);
    expect(state.recovery_count).toBe(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);

    // Simulate the bounded recovery worker also disappearing before its CAS
    // outcome. The next stale sweep must mark X/dead-letter and do no I/O.
    state.locked_at = '2026-08-17 00:00:00';
    await expect(attemptDelivery(state.id, state.organization_id)).resolves.toEqual({
      id: state.id,
      status: 'dead_letter',
      attempt_number: 4,
    });
    expect(state.recovery_count).toBe(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('a late stale worker cannot overwrite or summarize a newer claimant success', async () => {
    const state = { claimToken: null, status: 'pending' };
    let releaseFirstAttempt;
    emailTransport.sendEmail
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseFirstAttempt = () => resolve({ success: false, error: 'late SMTP failure' });
      }))
      .mockResolvedValueOnce({ success: true, messageId: 'new-owner-success' });

    db.query.mockImplementation((sql, params = []) => {
      if (/SELECT d\.id, d\.organization_id, d\.organization_epoch/.test(sql)) {
        return Promise.resolve([[attemptPreflightRow(deliveryRow({ status: state.status }))]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries\s+SET claim_token = CONCAT/.test(sql)) {
        state.claimToken = `F${String(params[0]).slice(1)}`;
        state.status = 'processing';
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT d\.\*, r\.id AS current_rule_id/.test(sql)) {
        return Promise.resolve([[
          attemptPreflightRow(deliveryRow({ claim_token: state.claimToken })),
        ]]);
      }
      if (/UPDATE snmp_trap_forwarding_deliveries[\s\S]*?AND status = 'processing' AND claim_token = \?/.test(sql)) {
        const submittedToken = params.at(-1);
        const ownsClaim = state.status === 'processing' && submittedToken === state.claimToken;
        if (ownsClaim) {
          state.status = params[0];
          state.claimToken = null;
        }
        return Promise.resolve([{ affectedRows: ownsClaim ? 1 : 0 }]);
      }
      if (/UPDATE snmp_trap_forwarding_rules/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[]]);
    });

    const staleWorker = attemptDelivery(801, 42);
    await new Promise(resolve => global.setImmediate(resolve));
    expect(releaseFirstAttempt).toEqual(expect.any(Function));

    await expect(attemptDelivery(801, 42)).resolves.toMatchObject({ status: 'success' });
    releaseFirstAttempt();
    await expect(staleWorker).resolves.toMatchObject({ status: 'superseded' });

    expect(state.status).toBe('success');
    const summaries = db.query.mock.calls.filter(([sql]) => /UPDATE snmp_trap_forwarding_rules/.test(sql));
    expect(summaries).toHaveLength(1);
    expect(summaries[0][1][0]).toBe('success');
  });
});

describe('authoritative attribution-readiness egress gate', () => {
  const policyReasons = [
    'isolated_tenant_attribution_unsupported',
    'multi_organization_attribution_unsupported',
  ];

  function installUnavailableReadiness(reason) {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.getConnection = jest.fn();
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValue({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: reason === 'isolated_tenant_attribution_unsupported' ? [{
        organization_id: 99,
        ready: false,
        reason: 'isolated_tenant_attribution_unsupported',
      }] : [],
      reason,
    });
  }

  test.each(policyReasons)(
    'synthetic tests create no row or job after policy revocation: %s',
    async (reason) => {
      installUnavailableReadiness(reason);

      await expect(queueTestDelivery(rule, rule.organization_id)).rejects.toMatchObject({
        statusCode: 503,
        code: reason,
      });

      expect(trapForwardingReadiness.checkSchemaReadiness).toHaveBeenCalledWith({ force: true });
      expect(db.query).not.toHaveBeenCalled();
      expect(jobQueue.add).not.toHaveBeenCalled();
      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    },
  );

  test.each(policyReasons)(
    'a queued attempt cancels without transport after policy revocation: %s',
    async (reason) => {
      installUnavailableReadiness(reason);
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      await expect(attemptDelivery(801, 42)).resolves.toEqual({
        id: 801,
        status: 'cancelled',
        reason,
      });

      expect(trapForwardingReadiness.checkSchemaReadiness).toHaveBeenCalledWith({ force: true });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[0][0]).toMatch(/status IN \('pending','retrying'\)/);
      expect(db.query.mock.calls[0][0]).toMatch(/status = 'processing'[\s\S]*locked_at < DATE_SUB/);
      expect(db.query.mock.calls[0][1]).toEqual([801, 42]);
      expect(jobQueue.add).not.toHaveBeenCalled();
      expect(emailTransport.sendEmail).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    },
  );

  test.each(policyReasons)(
    'retry recovery queues nothing after policy revocation: %s',
    async (reason) => {
      installUnavailableReadiness(reason);

      await expect(processRetries()).resolves.toEqual({
        queued: 0,
        failed: 0,
        total: 0,
        cancelled: 1,
        skipped_reason: reason,
      });

      expect(trapForwardingReadiness.checkSchemaReadiness).toHaveBeenCalledWith({ force: true });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[0][0]).toMatch(/status IN \('pending','retrying'\)/);
      expect(db.query.mock.calls[0][0]).toMatch(/status = 'processing'[\s\S]*locked_at < DATE_SUB/);
      expect(db.withTenantContext).toBeUndefined();
      expect(jobQueue.add).not.toHaveBeenCalled();
    },
  );
});

describe('safeHttpsPost()', () => {
  test('pins the socket lookup to the validated public address and disables pooling', async () => {
    mockHttpsResponse(202);

    await expect(safeHttpsPost('https://8.8.8.8/hook', '{}')).resolves.toMatchObject({ statusCode: 202 });
    const options = https.request.mock.calls[0][0];
    expect(options.agent).toBe(false);
    expect(options.lookup).toEqual(expect.any(Function));
    await expect(new Promise((resolve, reject) => {
      options.lookup('8.8.8.8', { family: 4 }, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    })).resolves.toBe('8.8.8.8');
  });

  test('rejects a private DNS resolution before making the request', async () => {
    const lookup = jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);

    await expect(safeHttpsPost('https://traps.example/hook', '{}'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
    expect(https.request).not.toHaveBeenCalled();
    lookup.mockRestore();
  });

  test('never-resolving delivery DNS settles by the absolute deadline without opening a socket', async () => {
    jest.useFakeTimers();
    const lookup = jest.spyOn(dns, 'lookup').mockImplementation(() => new Promise(() => {}));
    try {
      const result = safeHttpsPost('https://never-resolves.example/hook', '{}', {}, 25);
      const rejection = expect(result).rejects.toMatchObject({ code: 'ETIMEDOUT' });

      await jest.advanceTimersByTimeAsync(25);
      await rejection;
      expect(https.request).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      jest.useRealTimers();
    }
  });

  test('rejects a private connected peer even after public DNS validation', async () => {
    const lookup = jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mockHttpsResponse(204, '127.0.0.1');

    await expect(safeHttpsPost('https://traps.example/hook', '{}'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
    lookup.mockRestore();
  });

  test('enforces an absolute wall-clock deadline when a peer never returns response headers', async () => {
    jest.useFakeTimers();
    try {
      https.request.mockImplementation(() => {
        const request = new EventEmitter();
        request.end = jest.fn();
        request.destroy = jest.fn(error => request.emit('error', error));
        return request;
      });

      const result = safeHttpsPost('https://8.8.8.8/hook', '{}', {}, 25);
      const rejection = expect(result).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await jest.advanceTimersByTimeAsync(25);

      await rejection;
      expect(https.request.mock.results[0].value.destroy)
        .toHaveBeenCalledWith(expect.objectContaining({ code: 'ETIMEDOUT' }));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('write/test DNS deadlines', () => {
  test('save and test validation both settle when DNS never answers and create no delivery', async () => {
    jest.useFakeTimers();
    const lookup = jest.spyOn(dns, 'lookup').mockImplementation(() => new Promise(() => {}));
    try {
      const save = validateRuleInput({
        name: 'Never resolving save',
        forward_to_url: 'https://never-resolves.example/hook',
      }, 42);
      const saveRejection = expect(save).rejects.toMatchObject({ code: 'UNSAFE_URL' });
      await jest.advanceTimersByTimeAsync(5000);
      await saveRejection;

      const testDelivery = queueTestDelivery({
        ...rule,
        configuration_reviewed_at: '2026-08-17 00:00:00',
        forward_to_email: null,
        forward_to_url: 'https://never-resolves.example/hook',
      }, 42);
      const testRejection = expect(testDelivery).rejects.toMatchObject({ code: 'UNSAFE_URL' });
      await jest.advanceTimersByTimeAsync(5000);
      await testRejection;

      expect(db.query).not.toHaveBeenCalled();
      expect(jobQueue.add).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('processRetries()', () => {
  test('requeues pending, retrying, and stale processing rows with per-row isolation', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[
        { id: 1, organization_id: 10 },
        { id: 2, organization_id: 20 },
      ]]);
    jobQueue.add
      .mockRejectedValueOnce(new Error('queue temporarily down'))
      .mockResolvedValueOnce({ id: 'job-2', status: 'queued' });

    const result = await processRetries();

    expect(result).toEqual({ queued: 1, failed: 1, total: 2 });
    const select = db.query.mock.calls[2][0];
    expect(select).toMatch(/d\.revoked_at IS NULL/);
    expect(select).toMatch(/status IN \('pending','retrying'\)/);
    expect(select).toMatch(/status = 'processing'/);
    expect(select).toMatch(/locked_at < DATE_SUB/);
    expect(jobQueue.add).toHaveBeenCalledTimes(2);
    expect(jobQueue.add).toHaveBeenNthCalledWith(
      1,
      'trap-forwarding-delivery',
      { deliveryId: 1, organizationId: 10 },
      expect.any(Object),
    );
    expect(jobQueue.add).toHaveBeenNthCalledWith(
      2,
      'trap-forwarding-delivery',
      { deliveryId: 2, organizationId: 20 },
      expect.any(Object),
    );
  });

  test('shared-only retry recovery stays in primary and enqueues exactly one job per durable row', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.getConnection = jest.fn();
    db.withTenantContext = jest.fn();
    db.query
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[
        { id: 1001, organization_id: 10 },
        { id: 1002, organization_id: 11 },
      ]]);

    await expect(processRetries()).resolves.toEqual({ queued: 2, failed: 0, total: 2 });
    expect(trapForwardingReadiness.checkSchemaReadiness).toHaveBeenCalledWith({ force: true });
    expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(jobQueue.add).toHaveBeenCalledTimes(2);
    expect(jobQueue.add).toHaveBeenNthCalledWith(
      1,
      'trap-forwarding-delivery',
      { deliveryId: 1001, organizationId: 10 },
      expect.any(Object),
    );
    expect(jobQueue.add).toHaveBeenNthCalledWith(
      2,
      'trap-forwarding-delivery',
      { deliveryId: 1002, organizationId: 11 },
      expect.any(Object),
    );
  });

  test('a stale processing claim revoked by an A-to-B-to-A edit is cancelled, never requeued', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[]]);

    await expect(processRetries()).resolves.toEqual({ queued: 0, failed: 0, total: 0 });
    const revokeFence = db.query.mock.calls[0][0];
    expect(revokeFence).toMatch(/d\.revoked_at IS NOT NULL/);
    expect(revokeFence).toMatch(
      /status = 'processing'[\s\S]*locked_at < DATE_SUB/,
    );
    expect(db.query.mock.calls[2][0]).toMatch(/d\.revoked_at IS NULL/);
    expect(jobQueue.add).not.toHaveBeenCalled();
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('retained isolated configuration cancels stale primary rows and never enters a tenant database', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.withTenantContext = jest.fn();
    db.getConnection = jest.fn();
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [{ organization_id: 22 }],
      reason: 'isolated_tenant_attribution_unsupported',
    });
    db.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

    await expect(processRetries()).resolves.toEqual({
      queued: 0,
      failed: 0,
      total: 0,
      cancelled: 2,
      skipped_reason: 'isolated_tenant_attribution_unsupported',
    });
    expect(db.query.mock.calls[0][0]).toMatch(/status IN \('pending','retrying'\)/);
    expect(db.query.mock.calls[0][0]).toMatch(/status = 'processing'[\s\S]*locked_at < DATE_SUB/);
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(jobQueue.add).not.toHaveBeenCalled();
  });

  test('a transient readiness failure defers recovery without mutating rows or performing egress', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.getConnection = jest.fn();
    trapForwardingReadiness.checkSchemaReadiness.mockResolvedValueOnce({
      ready: false,
      primary: { ready: true, reason: null },
      isolated: [],
      reason: 'source_attribution_unavailable',
    });

    await expect(processRetries()).resolves.toEqual({
      queued: 0,
      failed: 0,
      total: 0,
      skipped_reason: 'source_attribution_unavailable',
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(jobQueue.add).not.toHaveBeenCalled();
  });
});
