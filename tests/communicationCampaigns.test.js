// =============================================================================
// FireISP 5.0 — Communication Campaigns Tests — §1.4
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
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
  beforeEach(() => jest.clearAllMocks());

  test('inserts campaign_messages and updates campaign status to sending', async () => {
    // 1. findCampaign
    mockQuery([[{
      id: 1,
      organization_id: 1,
      channel: 'email',
      status: 'draft',
      filter_status: null,
      filter_plan_id: null,
      filter_tag: null,
    }]]);
    // 2. buildRecipientList — returns 2 recipients
    mockQuery([[
      { client_id: 1, recipient: 'a@example.com' },
      { client_id: 2, recipient: 'b@example.com' },
    ]]);
    // 3. INSERT campaign_messages
    mockQuery([{ affectedRows: 2 }]);
    // 4. UPDATE communication_campaigns
    mockQuery([{ affectedRows: 1 }]);

    const result = await dispatchCampaign(1, 1);

    expect(result).toEqual({ queued: 2 });
    expect(db.query).toHaveBeenCalledTimes(4);
    // Check the INSERT call contains 'campaign_messages'
    const insertCall = db.query.mock.calls[2];
    expect(insertCall[0]).toContain('campaign_messages');
    // Check the UPDATE sets status = 'sending'
    const updateCall = db.query.mock.calls[3];
    expect(updateCall[0]).toContain('sending');
    expect(updateCall[1][0]).toBe(2); // recipient_count
  });

  test('marks campaign as sent immediately when no recipients', async () => {
    mockQuery([[{
      id: 2,
      organization_id: 1,
      channel: 'sms',
      status: 'draft',
      filter_status: 'suspended',
      filter_plan_id: null,
      filter_tag: null,
    }]]);
    // No recipients
    mockQuery([[]]);
    // UPDATE to sent
    mockQuery([{ affectedRows: 1 }]);

    const result = await dispatchCampaign(2, 1);

    expect(result).toEqual({ queued: 0 });
    const updateCall = db.query.mock.calls[2];
    expect(updateCall[0]).toContain('sent');
  });

  test('throws when campaign not found', async () => {
    mockQuery([[]]); // empty result

    await expect(dispatchCampaign(999, 1)).rejects.toThrow('Campaign 999 not found');
  });

  test('throws when campaign is already in sending status', async () => {
    mockQuery([[{ id: 3, organization_id: 1, status: 'sending' }]]);

    await expect(dispatchCampaign(3, 1)).rejects.toThrow('cannot be dispatched');
  });
});

// ---------------------------------------------------------------------------
// processQueue
// ---------------------------------------------------------------------------
describe('processQueue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends email for queued email campaign messages', async () => {
    // 1. SELECT queued messages
    mockQuery([[{
      id: 10,
      campaign_id: 1,
      campaign_org_id: 1,
      campaign_channel: 'email',
      campaign_template_id: null,
      channel: 'email',
      recipient: 'alice@example.com',
      client_id: 1,
    }]]);
    // 2. UPDATE campaign_messages status = sent
    mockQuery([{ affectedRows: 1 }]);
    // 3. UPDATE communication_campaigns sent_count
    mockQuery([{ affectedRows: 1 }]);
    // 4. UPDATE campaigns where status = sending and no queued messages
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 1, to: 'alice@example.com' }),
    );
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);
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
    // UPDATE failed status
    mockQuery([{ affectedRows: 1 }]);
    // UPDATE failed_count
    mockQuery([{ affectedRows: 1 }]);
    // finalize campaigns
    mockQuery([{ affectedRows: 0 }]);

    const result = await processQueue();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    const failedUpdateCall = db.query.mock.calls[1];
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
