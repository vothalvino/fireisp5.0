// =============================================================================
// FireISP 5.0 — Communication Campaigns Tests — §1.4
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  withTenantContext: jest.fn(async (_organizationId, callback) => callback()),
  withPrimaryContext: jest.fn(async callback => callback()),
}));

jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'email-msg-id' }),
}));

jest.mock('../src/services/smsTransport', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true, messageId: 'sms-msg-id' }),
}));

const mockGetOrganizationDeliveryState = jest.fn().mockResolvedValue({ active: true, epoch: 0 });
jest.mock('../src/services/clientCommunicationPreferenceService', () => ({
  getOrganizationDeliveryState: mockGetOrganizationDeliveryState,
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const emailTransport = require('../src/services/emailTransport');
const smsTransport = require('../src/services/smsTransport');
const logger = require('../src/utils/logger');
const {
  buildRecipientList,
  dispatchCampaign,
  processQueue,
  handleDeliveryCallback,
} = require('../src/services/campaignService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockQuery(results) {
  db.query.mockResolvedValueOnce(results);
}

beforeEach(() => {
  mockGetOrganizationDeliveryState.mockResolvedValue({ active: true, epoch: 0 });
});

// ---------------------------------------------------------------------------
// buildRecipientList
// ---------------------------------------------------------------------------
describe('buildRecipientList', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns email recipients for email channel, excluding DND opt-outs', async () => {
    // db.query called once to get clients
    mockQuery([
      [
        { client_id: 1, recipient: 'alice@example.com' },
        { client_id: 2, recipient: 'bob@example.com' },
      ],
    ]);

    const campaign = {
      organization_id: 1,
      channel: 'email',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: null,
    };

    const result = await buildRecipientList(campaign);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ client_id: 1, recipient: 'alice@example.com', client_contact_epoch: 0, channel: 'email' });
    expect(result[1]).toEqual({ client_id: 2, recipient: 'bob@example.com', client_contact_epoch: 0, channel: 'email' });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/EXISTS[\s\S]*subscriber_consents[\s\S]*purpose = 'marketing'/);
    expect(sql).toMatch(/communication_channel = \?/);
    expect(sql).toMatch(/withdrawn_at IS NULL/);
    expect(sql).toMatch(/c\.deleted_at IS NULL/);
    expect(sql).toMatch(/c\.status <> 'inactive'/);
    expect(params).toEqual([1, 'email', 'email']);
  });

  test('returns SMS recipients for sms channel', async () => {
    mockQuery([[{ client_id: 5, recipient: '+521234567890' }]]);

    const campaign = {
      organization_id: 1,
      channel: 'sms',
      filter_status: 'active',
      filter_plan_id: null,
      filter_tag: null,
    };

    const result = await buildRecipientList(campaign);

    expect(result).toHaveLength(1);
    expect(result[0].channel).toBe('sms');
    expect(result[0].recipient).toBe('+521234567890');
  });

  test('returns empty array when no recipients', async () => {
    mockQuery([[]]);

    const campaign = {
      organization_id: 1,
      channel: 'email',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: null,
    };

    const result = await buildRecipientList(campaign);
    expect(result).toHaveLength(0);
  });

  test('builds SQL with filter_plan_id when provided', async () => {
    mockQuery([[{ client_id: 10, recipient: 'test@example.com' }]]);

    const campaign = {
      organization_id: 2,
      channel: 'email',
      filter_status: null,
      filter_plan_id: 7,
      filter_tag: null,
    };

    await buildRecipientList(campaign);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('contracts ct');
    expect(params).toContain(7);
  });

  test('builds SQL with filter_tag when provided', async () => {
    mockQuery([[{ client_id: 10, recipient: 'test@example.com' }]]);

    const campaign = {
      organization_id: 2,
      channel: 'email',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: 'vip',
    };

    await buildRecipientList(campaign);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('client_groups');
    expect(params).toContain('vip');
  });
});

// ---------------------------------------------------------------------------
// dispatchCampaign
// ---------------------------------------------------------------------------
describe('dispatchCampaign', () => {
  let conn;

  beforeEach(() => {
    jest.clearAllMocks();
    conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
  });

  const mockTxQuery = result => conn.execute.mockResolvedValueOnce(result);

  test('locks, guarded-transitions, and inserts the recipient snapshot in one transaction', async () => {
    mockGetOrganizationDeliveryState.mockResolvedValue({ active: true, epoch: 23 });
    mockTxQuery([[{
      id: 1,
      organization_id: 1,
      channel: 'email',
      status: 'draft',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: null,
    }]]);
    mockTxQuery([[]]);
    mockTxQuery([[
      { client_id: 1, recipient: 'a@example.com', client_contact_epoch: 31 },
      { client_id: 2, recipient: 'b@example.com', client_contact_epoch: 32 },
    ]]);
    mockTxQuery([{ affectedRows: 1 }]);
    mockTxQuery([{ affectedRows: 2 }]);

    const result = await dispatchCampaign(1, 1);

    expect(result).toEqual({ queued: 2 });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();

    const lockCall = conn.execute.mock.calls[0];
    expect(lockCall[0]).toMatch(/communication_campaigns[\s\S]*FOR UPDATE/);
    expect(lockCall[0]).toMatch(/organization_id <=> \?/);

    const transitionCall = conn.execute.mock.calls[3];
    expect(transitionCall[0]).toMatch(/status = \?[\s\S]*status = \?/);
    expect(transitionCall[1]).toEqual(['sending', 2, 1, 1, 'draft']);

    const insertCall = conn.execute.mock.calls[4];
    expect(insertCall[0]).toContain('campaign_messages');
    expect(insertCall[0]).not.toContain('VALUES ?');
    const expectedPlaceholders = Array(2).fill(`(${Array(9).fill('?').join(', ')})`).join(', ');
    expect(insertCall[0]).toContain(`VALUES ${expectedPlaceholders}`);
    expect(insertCall[1]).toHaveLength(18);
    expect(insertCall[1].slice(0, 8)).toEqual([1, 23, 1, 1, 31, 'a@example.com', 'email', 'queued']);
    expect(insertCall[1][8]).toBeInstanceOf(Date);
    expect(insertCall[1].slice(9, 17)).toEqual([1, 23, 1, 2, 32, 'b@example.com', 'email', 'queued']);
    expect(insertCall[1][17]).toBeInstanceOf(Date);
  });

  test('marks campaign as sent immediately when no recipients', async () => {
    mockTxQuery([[{
      id: 2,
      organization_id: 1,
      channel: 'sms',
      status: 'draft',
      filter_status: 'suspended',
      filter_plan_id: null,
      filter_tag: null,
    }]]);
    mockTxQuery([[]]);
    mockTxQuery([[]]);
    mockTxQuery([{ affectedRows: 1 }]);

    const result = await dispatchCampaign(2, 1);

    expect(result).toEqual({ queued: 0 });
    const updateCall = conn.execute.mock.calls[3];
    expect(updateCall[1][0]).toBe('sent');
    expect(updateCall[0]).toContain('completed_at = NOW()');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('throws when campaign not found', async () => {
    mockTxQuery([[]]);

    await expect(dispatchCampaign(999, 1)).rejects.toThrow('Campaign 999 not found');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('throws when campaign is already in sending status', async () => {
    mockTxQuery([[{ id: 3, organization_id: 1, status: 'sending' }]]);

    await expect(dispatchCampaign(3, 1)).rejects.toThrow('cannot be dispatched');
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  test('retires stale queued rows before redispatching a cancelled campaign', async () => {
    mockTxQuery([[
      {
        id: 5,
        organization_id: 1,
        channel: 'sms',
        status: 'cancelled',
        filter_status: null,
        filter_plan_id: null,
        filter_tag: null,
      },
    ]]);
    mockTxQuery([[]]);
    mockTxQuery([{ affectedRows: 3 }]);
    mockTxQuery([[{ client_id: 8, recipient: '+521111111111' }]]);
    mockTxQuery([{ affectedRows: 1 }]);
    mockTxQuery([{ affectedRows: 1 }]);

    await expect(dispatchCampaign(5, 1)).resolves.toEqual({ queued: 1 });

    const [retireSql, retireParams] = conn.execute.mock.calls[2];
    expect(retireSql).toMatch(/UPDATE campaign_messages/);
    expect(retireSql).toMatch(/status = 'queued'/);
    expect(retireParams).toEqual(['Superseded by campaign redispatch', 5, 1]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('rolls back recipient inserts when the guarded state transition loses a race', async () => {
    mockTxQuery([[
      {
        id: 4,
        organization_id: 1,
        channel: 'email',
        status: 'draft',
        filter_status: null,
        filter_plan_id: null,
        filter_tag: null,
      },
    ]]);
    mockTxQuery([[]]);
    mockTxQuery([[{ client_id: 1, recipient: 'a@example.com' }]]);
    mockTxQuery([{ affectedRows: 0 }]);

    await expect(dispatchCampaign(4, 1)).rejects.toThrow('state changed');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => /INSERT INTO campaign_messages/.test(sql))).toBe(false);
  });

  test.each([
    'Delivery claimed; awaiting provider result',
    'Provider invocation started; delivery outcome is unknown',
  ])('refuses redispatch while a prior row has ambiguous provider state: %s', async errorMessage => {
    mockTxQuery([[
      {
        id: 6,
        organization_id: 1,
        channel: 'email',
        status: 'failed',
      },
    ]]);
    mockTxQuery([[{ id: 601, error_message: errorMessage }]]);

    await expect(dispatchCampaign(6, 1)).rejects.toThrow('unresolved provider outcome');

    expect(conn.execute).toHaveBeenCalledTimes(2);
    const [unresolvedSql, unresolvedParams] = conn.execute.mock.calls[1];
    expect(unresolvedSql).toMatch(/status = 'failed' AND error_message IN \(\?, \?\)/);
    expect(unresolvedSql).toMatch(/LIMIT 1 FOR UPDATE/);
    expect(unresolvedParams).toEqual([
      6,
      1,
      'Delivery claimed; awaiting provider result',
      'Provider invocation started; delivery outcome is unknown',
    ]);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processQueue
// ---------------------------------------------------------------------------
describe('processQueue', () => {
  const deliveryClaimMarker = 'Delivery claimed; awaiting provider result';
  const deliveryOutcomeUnknown = 'Provider invocation started; delivery outcome is unknown';

  const queuedMessage = overrides => ({
    id: 10,
    campaign_id: 1,
    campaign_org_id: 1,
    campaign_template_id: null,
    organization_epoch: 0,
    client_contact_epoch: 9,
    channel: 'email',
    recipient: 'alice@example.com',
    client_id: 1,
    ...overrides,
  });

  function installQueueMock({
    queued = [],
    templates = [],
    clients = [],
    staleAffected = 0,
    claimAffected = 1,
    invocationAffected = 1,
    outcomeAffected = 1,
    outcomeError = null,
    terminalAffected = 1,
    counterAffected = 1,
    finalizeAffected = 0,
  } = {}) {
    db.query.mockImplementation(async (sql) => {
      if (/FROM organization_database_configs/.test(sql)) return [[]];
      if (/SET cm\.status = 'queued', cm\.error_message = NULL/.test(sql)) {
        return [{ affectedRows: staleAffected }];
      }
      if (/SELECT cm\.\*, cc\.template_id AS campaign_template_id/.test(sql)) return [queued];
      if (/FROM message_templates/.test(sql)) return [templates];
      if (/SELECT \* FROM clients/.test(sql)) return [clients];
      if (/UPDATE campaign_messages cm[\s\S]*JOIN clients c/.test(sql)) {
        return [{ affectedRows: claimAffected }];
      }
      if (/SET error_message = \?[\s\S]*status = 'failed' AND error_message = \?/.test(sql)) {
        return [{ affectedRows: invocationAffected }];
      }
      if (/SET status = 'sent', sent_at = NOW\(\)/.test(sql)) {
        if (outcomeError) throw outcomeError;
        return [{ affectedRows: outcomeAffected }];
      }
      if (/UPDATE campaign_messages\s+SET status = 'failed'/.test(sql)) {
        return [{ affectedRows: terminalAffected }];
      }
      if (/UPDATE communication_campaigns\s+SET (?:sent_count|failed_count)/.test(sql)) {
        return [{ affectedRows: counterAffected }];
      }
      if (/UPDATE communication_campaigns cc/.test(sql)) {
        return [{ affectedRows: finalizeAffected }];
      }
      throw new Error(`Unexpected campaign queue SQL: ${sql}`);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    emailTransport.sendEmail.mockReset().mockResolvedValue({ success: true, messageId: 'email-msg-id' });
    smsTransport.sendSms.mockReset().mockResolvedValue({ success: true, messageId: 'sms-msg-id' });
    mockGetOrganizationDeliveryState.mockReset().mockResolvedValue({ active: true, epoch: 0 });
  });

  test('claims the snapshotted channel, marks provider invocation, and finalizes by CAS', async () => {
    installQueueMock({ queued: [queuedMessage({ campaign_channel: 'sms' })] });

    await expect(processQueue(1)).resolves.toEqual({ sent: 1, failed: 0, total: 1 });

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1,
      clientId: 1,
      to: 'alice@example.com',
      messageClass: 'marketing',
      expectedClientContactEpoch: 9,
    }));
    expect(smsTransport.sendSms).not.toHaveBeenCalled();

    const [queueSql] = db.query.mock.calls.find(([sql]) => /SELECT cm\.\*/.test(sql));
    expect(queueSql).toMatch(/cm\.status = 'queued'/);
    expect(queueSql).toMatch(/cc\.status = 'sending'/);
    expect(queueSql).toMatch(/cc\.deleted_at IS NULL/);
    expect(queueSql).toMatch(/cc\.organization_id <=> cm\.organization_id/);

    const [claimSql, claimParams] = db.query.mock.calls.find(([sql]) => (
      /UPDATE campaign_messages cm[\s\S]*JOIN clients c/.test(sql)
    ));
    expect(claimSql).toMatch(/c\.deleted_at IS NULL/);
    expect(claimSql).toMatch(/c\.status <> 'inactive'/);
    expect(claimSql).toMatch(/c\.email = cm\.recipient/);
    expect(claimSql).toMatch(/subscriber_consents/);
    expect(claimSql).toMatch(/client_dnd_preferences/);
    expect(claimSql).toMatch(/cm\.client_contact_epoch = CASE/);
    expect(claimParams).toEqual([deliveryClaimMarker, 10, 1, 'email', 'alice@example.com']);

    const invocationCall = db.query.mock.calls.find(([sql]) => (
      /SET error_message = \?[\s\S]*status = 'failed' AND error_message = \?/.test(sql)
    ));
    expect(invocationCall[1]).toEqual([deliveryOutcomeUnknown, 10, 1, deliveryClaimMarker]);
    expect(db.query.mock.invocationCallOrder[db.query.mock.calls.indexOf(invocationCall)])
      .toBeLessThan(emailTransport.sendEmail.mock.invocationCallOrder[0]);

    const [outcomeSql, outcomeParams] = db.query.mock.calls.find(([sql]) => (
      /SET status = 'sent', sent_at = NOW\(\)/.test(sql)
    ));
    expect(outcomeSql).toMatch(/status = 'failed' AND error_message = \?/);
    expect(outcomeParams).toEqual(['email-msg-id', 10, 1, deliveryOutcomeUnknown]);
  });

  test('sends SMS from a queued SMS snapshot with marketing attribution', async () => {
    installQueueMock({ queued: [queuedMessage({
      id: 11,
      campaign_id: 2,
      channel: 'sms',
      recipient: '+521234567890',
      client_id: 3,
    })] });

    await expect(processQueue(1)).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    expect(smsTransport.sendSms).toHaveBeenCalledWith(expect.objectContaining({
      to: '+521234567890',
      organizationId: 1,
      clientId: 3,
      channel: 'sms',
      messageClass: 'marketing',
      expectedClientContactEpoch: 9,
    }));
  });

  test('preserves outcome-unknown when the provider reports a non-policy failure', async () => {
    emailTransport.sendEmail.mockResolvedValueOnce({ success: false, error: 'SMTP error' });
    installQueueMock({ queued: [queuedMessage({ id: 12, recipient: 'fail@example.com' })] });

    await expect(processQueue(1)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });

    const invocationCall = db.query.mock.calls.find(([sql]) => /SET error_message = \?/.test(sql));
    expect(invocationCall[1][0]).toBe(deliveryOutcomeUnknown);
    expect(db.query.mock.calls.some(([sql]) => /SET status = 'sent'/.test(sql))).toBe(false);
    const [finalizeSql, finalizeParams] = db.query.mock.calls.find(([sql]) => /UPDATE communication_campaigns cc/.test(sql));
    expect(finalizeSql).toMatch(/THEN 'failed'/);
    expect(finalizeParams.slice(0, 2)).toEqual([deliveryOutcomeUnknown, deliveryClaimMarker]);
  });

  test('returns empty stats while still recovering stale claims and finalizing eligible campaigns', async () => {
    installQueueMock();

    await expect(processQueue(1)).resolves.toEqual({ sent: 0, failed: 0, total: 0 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
  });

  test('loads tenant-scoped template/client data and interpolates variables', async () => {
    installQueueMock({
      queued: [queuedMessage({ id: 20, campaign_id: 5, campaign_template_id: 99, client_id: 7 })],
      templates: [{ id: 99, subject: 'Hello {{name}}', body_text: 'Hi {{name}}!', body_html: null }],
      clients: [{ id: 7, name: 'Carlos Lopez' }],
    });

    await processQueue(1);

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Hello Carlos Lopez',
      text: 'Hi Carlos Lopez!',
    }));
    const [templateSql, templateParams] = db.query.mock.calls.find(([sql]) => /FROM message_templates/.test(sql));
    expect(templateSql).toMatch(/organization_id <=> \? OR organization_id IS NULL/);
    expect(templateSql).toMatch(/deleted_at IS NULL/);
    expect(templateParams).toEqual([99, 1]);
    const [clientSql, clientParams] = db.query.mock.calls.find(([sql]) => /SELECT \* FROM clients/.test(sql));
    expect(clientSql).toMatch(/organization_id <=> \?/);
    expect(clientSql).toMatch(/deleted_at IS NULL/);
    expect(clientParams).toEqual([7, 1]);
  });

  test('HTML-escapes email merge values without touching template markup', async () => {
    installQueueMock({
      queued: [queuedMessage({ id: 21, campaign_template_id: 100, client_id: 8 })],
      templates: [{
        id: 100,
        subject: 'Hi {{name}}',
        body_text: null,
        body_html: '<p>Hola {{name}} &amp; equipo</p>',
      }],
      clients: [{ id: 8, name: "O'Brien <script>alert(1)</script>" }],
    });

    await processQueue(1);

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Hi O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt;',
      html: '<p>Hola O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt; &amp; equipo</p>',
    }));
  });

  test('keeps SMS merge values as plain text', async () => {
    installQueueMock({
      queued: [queuedMessage({
        id: 22,
        campaign_template_id: 101,
        channel: 'sms',
        recipient: '+521234567890',
        client_id: 9,
      })],
      templates: [{ id: 101, subject: null, body_text: 'Hola {{name}} & equipo', body_html: null }],
      clients: [{ id: 9, name: "O'Brien & Sons" }],
    });

    await processQueue(1);

    expect(smsTransport.sendSms).toHaveBeenCalledWith(expect.objectContaining({
      body: "Hola O'Brien & Sons & equipo",
    }));
  });

  test('skips transport when the atomic contact/consent/DND claim rejects the snapshot', async () => {
    installQueueMock({
      queued: [queuedMessage({
        id: 30,
        campaign_id: 8,
        campaign_org_id: 44,
        recipient: 'withdrawn@example.com',
        client_id: 91,
      })],
      claimAffected: 0,
    });

    await expect(processQueue(44)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();

    const [claimSql, claimParams] = db.query.mock.calls.find(([sql]) => (
      /UPDATE campaign_messages cm[\s\S]*JOIN clients c/.test(sql)
    ));
    expect(claimSql).toMatch(/c\.organization_id <=> cc\.organization_id/);
    expect(claimSql).toMatch(/consent\.withdrawn_at IS NULL/);
    expect(claimSql).toMatch(/dnd\.channel IN \('all', cm\.channel\)/);
    expect(claimParams.slice(1)).toEqual([30, 44, 'email', 'withdrawn@example.com']);
    const [skipSql, skipParams] = db.query.mock.calls.find(([sql]) => (
      /UPDATE campaign_messages\s+SET status = 'failed'[\s\S]*status = 'queued'/.test(sql)
    ));
    expect(skipParams[0]).toMatch(/message skipped/);
    expect(skipSql).toMatch(/organization_id <=> \?/);
  });

  test.each(['cancelled', 'soft-deleted'])('does not send a row selected just before its campaign was %s', async () => {
    installQueueMock({
      queued: [queuedMessage({
        id: 31,
        campaign_id: 9,
        campaign_org_id: 44,
        channel: 'sms',
        recipient: '+521111111111',
        client_id: 92,
      })],
      claimAffected: 0,
    });

    await expect(processQueue(44)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
    const [claimSql] = db.query.mock.calls.find(([sql]) => (
      /UPDATE campaign_messages cm[\s\S]*JOIN clients c/.test(sql)
    ));
    expect(claimSql).toMatch(/cc\.status = 'sending' AND cc\.deleted_at IS NULL/);
  });

  test('only the worker that wins the guarded queue claim can invoke transport', async () => {
    installQueueMock({
      queued: [queuedMessage({ id: 32, campaign_org_id: 44, recipient: 'claimed@example.com' })],
      claimAffected: 0,
      terminalAffected: 0,
    });

    await expect(processQueue(44)).resolves.toEqual({ sent: 0, failed: 0, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /failed_count = failed_count \+ 1/.test(sql))).toBe(false);
  });

  test('does not deliver a snapshot after an inactive-to-active epoch change', async () => {
    mockGetOrganizationDeliveryState.mockResolvedValue({ active: true, epoch: 5 });
    installQueueMock({ queued: [queuedMessage({
      id: 33,
      campaign_id: 11,
      campaign_org_id: 44,
      organization_epoch: 4,
      recipient: 'old-epoch@example.com',
      client_id: 94,
    })] });

    await expect(processQueue(44)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
    const [, params] = db.query.mock.calls.find(([sql]) => (
      /UPDATE campaign_messages SET status = 'failed'[\s\S]*status = 'queued'/.test(sql)
    ));
    expect(params[0]).toMatch(/authorization changed/);
  });

  test('a hard-delete orphan with NULL organization is terminalized by the client lane', async () => {
    emailTransport.sendEmail.mockResolvedValueOnce({
      success: false,
      skipped: true,
      code: 'CLIENT_ORGANIZATION_REQUIRED',
      error: 'Client communication preference blocks this delivery.',
    });
    installQueueMock({ queued: [queuedMessage({
      id: 36,
      campaign_id: 12,
      campaign_org_id: null,
      organization_epoch: 0,
      recipient: 'orphan@example.com',
      client_id: 95,
    })] });

    await expect(processQueue()).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: null,
      clientId: 95,
      messageClass: 'marketing',
    }));
    const terminal = db.query.mock.calls.find(([sql, params]) => (
      /UPDATE campaign_messages\s+SET status = 'failed'/.test(sql)
      && params?.[0] === 'Client communication preference blocks this delivery.'
    ));
    expect(terminal[1].at(-1)).toBe(deliveryOutcomeUnknown);
  });

  test('recovers only stale pre-I/O claims and never outcome-unknown rows', async () => {
    installQueueMock({ staleAffected: 2 });

    await expect(processQueue(44)).resolves.toEqual({ sent: 0, failed: 0, total: 0 });

    const [recoverySql, recoveryParams] = db.query.mock.calls.find(([sql]) => /SET cm\.status = 'queued'/.test(sql));
    expect(recoverySql).toMatch(/cm\.error_message = \?/);
    expect(recoverySql).toMatch(/updated_at < DATE_SUB/);
    expect(recoveryParams).toEqual([deliveryClaimMarker, 44]);
    expect(recoveryParams).not.toContain(deliveryOutcomeUnknown);
  });

  test('provider success plus a throwing outcome CAS remains ambiguous and fails the campaign', async () => {
    installQueueMock({
      queued: [queuedMessage({ id: 34 })],
      outcomeError: new Error('database unavailable after provider acceptance'),
    });

    await expect(processQueue(1)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => /sent_count = sent_count \+ 1/.test(sql))).toBe(false);
    expect(db.query.mock.calls.filter(([sql]) => /UPDATE campaign_messages/.test(sql))).toHaveLength(4);
    const [finalizeSql, finalizeParams] = db.query.mock.calls.find(([sql]) => /UPDATE communication_campaigns cc/.test(sql));
    expect(finalizeSql).toMatch(/THEN 'failed'/);
    expect(finalizeParams[0]).toBe(deliveryOutcomeUnknown);
  });

  test('provider success plus a lost outcome CAS is not counted sent and leaves campaign fail-closed', async () => {
    installQueueMock({ queued: [queuedMessage({ id: 35 })], outcomeAffected: 0 });

    await expect(processQueue(1)).resolves.toEqual({ sent: 0, failed: 0, total: 1 });
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => /sent_count = sent_count \+ 1/.test(sql))).toBe(false);
    const [finalizeSql, finalizeParams] = db.query.mock.calls.find(([sql]) => /UPDATE communication_campaigns cc/.test(sql));
    expect(finalizeSql).toMatch(/THEN 'failed'/);
    expect(finalizeParams.slice(0, 2)).toEqual([deliveryOutcomeUnknown, deliveryClaimMarker]);
  });

  test('fans out the shared queue and each isolated organization queue', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM organization_database_configs/.test(sql)) return [[{ organization_id: 77 }]];
      if (/SET cm\.status = 'queued'/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT cm\.\*/.test(sql)) return [[]];
      if (/UPDATE communication_campaigns cc/.test(sql)) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected isolated campaign SQL: ${sql}`);
    });

    await expect(processQueue()).resolves.toEqual({ sent: 0, failed: 0, total: 0 });

    expect(db.withPrimaryContext).toHaveBeenCalledTimes(2);
    expect(db.withTenantContext).toHaveBeenCalledWith(77, expect.any(Function));
    const recoveries = db.query.mock.calls.filter(([sql]) => /SET cm\.status = 'queued'/.test(sql));
    expect(recoveries.map(([, params]) => params)).toEqual([
      [deliveryClaimMarker, 77],
      [deliveryClaimMarker, 77],
    ]);
    const queueReads = db.query.mock.calls.filter(([sql]) => /SELECT cm\.\*/.test(sql));
    expect(queueReads.map(([, params]) => params)).toEqual([[77], [77]]);
  });
});

// ---------------------------------------------------------------------------
// handleDeliveryCallback
// ---------------------------------------------------------------------------
describe('handleDeliveryCallback', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates message status to delivered and increments campaign counter', async () => {
    mockQuery([[{ id: 50, campaign_id: 1, status: 'sent' }]]);
    mockQuery([{ affectedRows: 1 }]); // UPDATE campaign_messages
    mockQuery([{ affectedRows: 1 }]); // UPDATE communication_campaigns

    const result = await handleDeliveryCallback('msg-sid-123', 'delivered', {});

    expect(result).toEqual({ updated: true });
    const updateMsgCall = db.query.mock.calls[1];
    expect(updateMsgCall[0]).toContain('delivered_at');
    const updateCampaignCall = db.query.mock.calls[2];
    expect(updateCampaignCall[0]).toContain('delivered_count');
  });

  test('updates message status to bounced', async () => {
    mockQuery([[{ id: 51, campaign_id: 1, status: 'sent' }]]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);

    const result = await handleDeliveryCallback('msg-sid-456', 'bounced');

    expect(result.updated).toBe(true);
    const updateCampaignCall = db.query.mock.calls[2];
    expect(updateCampaignCall[0]).toContain('bounced_count');
  });

  test('updates message status to opened', async () => {
    mockQuery([[{ id: 52, campaign_id: 2, status: 'delivered' }]]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);

    const result = await handleDeliveryCallback('msg-sid-789', 'opened');

    expect(result.updated).toBe(true);
    const updateCampaignCall = db.query.mock.calls[2];
    expect(updateCampaignCall[0]).toContain('opened_count');
  });

  test('returns updated: false when message not found', async () => {
    mockQuery([[]]); // no rows

    const result = await handleDeliveryCallback('unknown-sid', 'delivered');

    expect(result).toEqual({ updated: false });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('returns updated: false when providerMessageId is null', async () => {
    const result = await handleDeliveryCallback(null, 'delivered');

    expect(result).toEqual({ updated: false });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('returns updated: false for unknown status', async () => {
    const result = await handleDeliveryCallback('some-sid', 'unknown_status');

    expect(result).toEqual({ updated: false });
    expect(logger.warn).toHaveBeenCalled();
  });
});
