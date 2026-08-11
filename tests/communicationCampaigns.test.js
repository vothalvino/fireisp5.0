// =============================================================================
// FireISP 5.0 — Communication Campaigns Tests — §1.4
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'email-msg-id' }),
}));

jest.mock('../src/services/smsTransport', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true, messageId: 'sms-msg-id' }),
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
    expect(result[0]).toEqual({ client_id: 1, recipient: 'alice@example.com', channel: 'email' });
    expect(result[1]).toEqual({ client_id: 2, recipient: 'bob@example.com', channel: 'email' });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/EXISTS[\s\S]*subscriber_consents[\s\S]*purpose = 'marketing'/);
    expect(sql).toMatch(/communication_channel = \?/);
    expect(sql).toMatch(/withdrawn_at IS NULL/);
    expect(sql).toMatch(/c\.deleted_at IS NULL/);
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
    mockTxQuery([[{
      id: 1,
      organization_id: 1,
      channel: 'email',
      status: 'draft',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: null,
    }]]);
    mockTxQuery([[
      { client_id: 1, recipient: 'a@example.com' },
      { client_id: 2, recipient: 'b@example.com' },
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

    const transitionCall = conn.execute.mock.calls[2];
    expect(transitionCall[0]).toMatch(/status = \?[\s\S]*status = \?/);
    expect(transitionCall[1]).toEqual(['sending', 2, 1, 1, 'draft']);

    const insertCall = conn.execute.mock.calls[3];
    expect(insertCall[0]).toContain('campaign_messages');
    expect(insertCall[0]).not.toContain('VALUES ?');
    const expectedPlaceholders = Array(2).fill(`(${Array(7).fill('?').join(', ')})`).join(', ');
    expect(insertCall[0]).toContain(`VALUES ${expectedPlaceholders}`);
    expect(insertCall[1]).toHaveLength(14);
    expect(insertCall[1].slice(0, 6)).toEqual([1, 1, 1, 'a@example.com', 'email', 'queued']);
    expect(insertCall[1][6]).toBeInstanceOf(Date);
    expect(insertCall[1].slice(7, 13)).toEqual([1, 1, 2, 'b@example.com', 'email', 'queued']);
    expect(insertCall[1][13]).toBeInstanceOf(Date);
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
    mockTxQuery([{ affectedRows: 1 }]);

    const result = await dispatchCampaign(2, 1);

    expect(result).toEqual({ queued: 0 });
    const updateCall = conn.execute.mock.calls[2];
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
    mockTxQuery([{ affectedRows: 3 }]);
    mockTxQuery([[{ client_id: 8, recipient: '+521111111111' }]]);
    mockTxQuery([{ affectedRows: 1 }]);
    mockTxQuery([{ affectedRows: 1 }]);

    await expect(dispatchCampaign(5, 1)).resolves.toEqual({ queued: 1 });

    const [retireSql, retireParams] = conn.execute.mock.calls[1];
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
    mockTxQuery([[{ client_id: 1, recipient: 'a@example.com' }]]);
    mockTxQuery([{ affectedRows: 0 }]);

    await expect(dispatchCampaign(4, 1)).rejects.toThrow('state changed');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => /INSERT INTO campaign_messages/.test(sql))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processQueue
// ---------------------------------------------------------------------------
describe('processQueue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses the snapshotted message channel even if the campaign channel was mutated', async () => {
    // 1. SELECT queued messages
    mockQuery([[{
      id: 10,
      campaign_id: 1,
      campaign_org_id: 1,
      campaign_channel: 'sms',
      campaign_template_id: null,
      channel: 'email',
      recipient: 'alice@example.com',
      client_id: 1,
    }]]);
    // 2. Last-moment consent + DND eligibility recheck
    mockQuery([{ affectedRows: 1 }]);
    // 3. UPDATE campaign_messages status = sent
    mockQuery([{ affectedRows: 1 }]);
    // 4. UPDATE communication_campaigns sent_count
    mockQuery([{ affectedRows: 1 }]);
    // 5. UPDATE campaigns where status = sending and no queued messages
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 1, to: 'alice@example.com' }),
    );
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);

    const queueSql = db.query.mock.calls[0][0];
    expect(queueSql).toMatch(/cm\.status = 'queued'/);
    expect(queueSql).toMatch(/cc\.status = 'sending'/);
    expect(queueSql).toMatch(/cc\.deleted_at IS NULL/);
    expect(queueSql).toMatch(/cc\.organization_id <=> cm\.organization_id/);

    const [claimSql, claimParams] = db.query.mock.calls[1];
    expect(claimSql).toMatch(/cm\.status = 'queued'/);
    expect(claimSql).toMatch(/cc\.status = 'sending'/);
    expect(claimSql).toMatch(/c\.deleted_at IS NULL/);
    expect(claimSql).toMatch(/c\.email = cm\.recipient/);
    expect(claimSql).toMatch(/subscriber_consents/);
    expect(claimSql).toMatch(/client_dnd_preferences/);
    expect(claimParams.slice(-2)).toEqual(['email', 'alice@example.com']);
  });

  test('sends SMS for queued sms campaign messages', async () => {
    mockQuery([[{
      id: 11,
      campaign_id: 2,
      campaign_org_id: 1,
      campaign_channel: 'sms',
      campaign_template_id: null,
      channel: 'sms',
      recipient: '+521234567890',
      client_id: 3,
    }]]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(smsTransport.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+521234567890', organizationId: 1 }),
    );
    expect(result.sent).toBe(1);
  });

  test('marks message as failed when send fails', async () => {
    emailTransport.sendEmail.mockResolvedValueOnce({ success: false, error: 'SMTP error' });

    mockQuery([[{
      id: 12,
      campaign_id: 3,
      campaign_org_id: 1,
      campaign_channel: 'email',
      campaign_template_id: null,
      channel: 'email',
      recipient: 'fail@example.com',
      client_id: 4,
    }]]);
    mockQuery([{ affectedRows: 1 }]);
    // UPDATE failed status
    mockQuery([{ affectedRows: 1 }]);
    // UPDATE failed_count
    mockQuery([{ affectedRows: 1 }]);
    // finalize campaigns
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    const failedUpdateCall = db.query.mock.calls[2];
    expect(failedUpdateCall[0]).toContain('failed');
  });

  test('returns empty stats when queue is empty', async () => {
    mockQuery([[]]); // no queued messages

    const result = await processQueue();

    expect(result).toEqual({ sent: 0, failed: 0, total: 0 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
  });

  test('loads template and interpolates variables when template_id is set', async () => {
    mockQuery([[{
      id: 20,
      campaign_id: 5,
      campaign_org_id: 1,
      campaign_channel: 'email',
      campaign_template_id: 99,
      channel: 'email',
      recipient: 'test@example.com',
      client_id: 7,
    }]]);
    // Template query
    mockQuery([[{ id: 99, subject: 'Hello {{name}}', body_text: 'Hi {{name}}!', body_html: null }]]);
    // Client data query
    mockQuery([[{ id: 7, name: 'Carlos Lopez' }]]);
    // Last-moment consent + DND eligibility recheck
    mockQuery([{ affectedRows: 1 }]);
    // UPDATE sent
    mockQuery([{ affectedRows: 1 }]);
    // UPDATE sent_count
    mockQuery([{ affectedRows: 1 }]);
    // finalize
    mockQuery([{ affectedRows: 0 }]);

    await processQueue();

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hello Carlos Lopez',
      }),
    );
    const [templateSql, templateParams] = db.query.mock.calls[1];
    expect(templateSql).toMatch(/organization_id <=> \? OR organization_id IS NULL/);
    expect(templateSql).toMatch(/deleted_at IS NULL/);
    expect(templateParams).toEqual([99, 1]);
    const [clientSql, clientParams] = db.query.mock.calls[2];
    expect(clientSql).toMatch(/organization_id <=> \?/);
    expect(clientSql).toMatch(/deleted_at IS NULL/);
    expect(clientParams).toEqual([7, 1]);
  });

  test('HTML-escapes merge field VALUES for the email channel without touching the template markup', async () => {
    mockQuery([[{
      id: 21,
      campaign_id: 6,
      campaign_org_id: 1,
      campaign_channel: 'email',
      campaign_template_id: 100,
      channel: 'email',
      recipient: 'xss-test@example.com',
      client_id: 8,
    }]]);
    // Template query — body_html is staff-authored markup with a merge field.
    mockQuery([[{ id: 100, subject: 'Hi {{name}}', body_text: null, body_html: '<p>Hola {{name}} &amp; equipo</p>' }]]);
    // Client data — name contains HTML-significant characters.
    mockQuery([[{ id: 8, name: "O'Brien <script>alert(1)</script>" }]]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 0 }]);

    await processQueue();

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hi O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt;',
        html: '<p>Hola O&#x27;Brien &lt;script&gt;alert(1)&lt;/script&gt; &amp; equipo</p>',
      }),
    );
  });

  test('does NOT HTML-escape merge field VALUES for the sms channel (plain text)', async () => {
    mockQuery([[{
      id: 22,
      campaign_id: 7,
      campaign_org_id: 1,
      campaign_channel: 'sms',
      campaign_template_id: 101,
      channel: 'sms',
      recipient: '+521234567890',
      client_id: 9,
    }]]);
    mockQuery([[{ id: 101, subject: null, body_text: 'Hola {{name}} & equipo', body_html: null }]]);
    mockQuery([[{ id: 9, name: "O'Brien & Sons" }]]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 0 }]);

    await processQueue();

    expect(smsTransport.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Hola O'Brien & Sons & equipo" }),
    );
  });

  test('skips transport when the atomic live contact/consent/DND guard rejects the snapshot', async () => {
    mockQuery([[
      {
        id: 30,
        campaign_id: 8,
        campaign_org_id: 44,
        campaign_channel: 'email',
        campaign_template_id: null,
        channel: 'email',
        recipient: 'withdrawn@example.com',
        client_id: 91,
      },
    ]]);
    // Claim rejected because, for example, the client email changed after
    // dispatch or consent/DND changed.
    mockQuery([{ affectedRows: 0 }]);
    // This worker still owns the queued row, so mark it skipped.
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(result).toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();

    const [claimSql, claimParams] = db.query.mock.calls[1];
    expect(claimSql).toMatch(/JOIN clients c[\s\S]*c\.organization_id <=> cc\.organization_id/);
    expect(claimSql).toMatch(/c\.deleted_at IS NULL/);
    expect(claimSql).toMatch(/c\.email = cm\.recipient/);
    expect(claimSql).toMatch(/consent\.communication_channel = cm\.channel/);
    expect(claimSql).toMatch(/consent\.withdrawn_at IS NULL/);
    expect(claimSql).toMatch(/dnd\.channel IN \('all', cm\.channel\)/);
    expect(claimParams.slice(1)).toEqual([30, 44, 'email', 'withdrawn@example.com']);

    const [failedSql, failedParams] = db.query.mock.calls[2];
    expect(failedSql).toMatch(/status = 'failed'/);
    expect(failedSql).toMatch(/status = 'queued'/);
    expect(failedParams[0]).toMatch(/message skipped/);
  });

  test.each(['cancelled', 'soft-deleted'])('does not send a row selected just before its campaign was %s', async () => {
    mockQuery([[
      {
        id: 31,
        campaign_id: 9,
        campaign_org_id: 44,
        campaign_template_id: null,
        channel: 'sms',
        recipient: '+521111111111',
        client_id: 92,
      },
    ]]);
    // Atomic claim sees the campaign's new state/deleted_at and rejects it.
    mockQuery([{ affectedRows: 0 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 1 }]);
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(result).toEqual({ sent: 0, failed: 1, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][0]).toMatch(/cc\.status = 'sending' AND cc\.deleted_at IS NULL/);
  });

  test('only the worker that wins the guarded queue claim can invoke transport', async () => {
    mockQuery([[
      {
        id: 32,
        campaign_id: 10,
        campaign_org_id: 44,
        campaign_template_id: null,
        channel: 'email',
        recipient: 'claimed@example.com',
        client_id: 93,
      },
    ]]);
    // Another worker already changed queued -> claim marker.
    mockQuery([{ affectedRows: 0 }]);
    // It is no longer queued, so this worker must not mark/count it failed.
    mockQuery([{ affectedRows: 0 }]);
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(result).toEqual({ sent: 0, failed: 0, total: 1 });
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
    expect(smsTransport.sendSms).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /failed_count = failed_count \+ 1/.test(sql))).toBe(false);
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
