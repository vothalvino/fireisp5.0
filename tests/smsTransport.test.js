'use strict';

const mockQuery = jest.fn();
const mockWithTenantContext = jest.fn(async (_organizationId, callback) => callback());
const mockWithPrimaryContext = jest.fn(async callback => callback());

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  withTenantContext: mockWithTenantContext,
  withPrimaryContext: mockWithPrimaryContext,
}));

const mockGetOrganizationDeliveryState = jest.fn();
const mockEvaluateClientCommunication = jest.fn();
const mockBlockedResult = jest.fn(code => ({
  success: false,
  skipped: true,
  code,
  error: 'Client communication preference blocks this delivery.',
}));
const mockBlockCodes = Object.freeze({
  ORGANIZATION_INACTIVE: 'ORGANIZATION_INACTIVE',
  ORGANIZATION_REQUIRED: 'CLIENT_ORGANIZATION_REQUIRED',
  CLIENT_INACTIVE: 'CLIENT_INACTIVE',
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  CONTACT_MISMATCH: 'CLIENT_COMMUNICATION_CONTACT_MISMATCH',
  OPTED_OUT: 'CLIENT_COMMUNICATION_OPTED_OUT',
  CONSENT_REQUIRED: 'CLIENT_MARKETING_CONSENT_REQUIRED',
});
jest.mock('../src/services/clientCommunicationPreferenceService', () => ({
  getOrganizationDeliveryState: mockGetOrganizationDeliveryState,
  evaluateClientCommunication: mockEvaluateClientCommunication,
  assertMessageClass: jest.fn(messageClass => messageClass),
  blockedResult: mockBlockedResult,
  BLOCK_CODES: mockBlockCodes,
}));

const https = require('https');
const http = require('http');
jest.spyOn(https, 'request');
jest.spyOn(http, 'request');

const smsTransport = require('../src/services/smsTransport');

function mockHttpsRequest({ statusCode = 201, body = '{}' } = {}) {
  const { EventEmitter } = require('events');
  https.request.mockImplementationOnce((_options, callback) => {
    const response = new EventEmitter();
    response.statusCode = statusCode;
    const request = new EventEmitter();
    request.write = jest.fn();
    request.end = jest.fn(() => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    });
    request.destroy = jest.fn(error => request.emit('error', error));
    return request;
  });
}

const ACTIVE = { active: true, epoch: 8 };

function mockQueueFlow(entry, {
  claimAffected = 1,
  invocationAffected = 1,
  outcomeAffected = 1,
  outcomeError = null,
} = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SET status = 'queued', error_code = NULL/.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    if (/SELECT \* FROM sms_logs WHERE status = 'queued'/.test(sql)) return [[entry]];
    if (/SET status = 'failed', error_code = \?/.test(sql)) {
      return [{ affectedRows: claimAffected }];
    }
    if (/SET error_code = \?, error_message = \?, sent_at = NOW\(\)/.test(sql)) {
      return [{ affectedRows: invocationAffected }];
    }
    if (/SET status = \?, provider_message_id = \?/.test(sql)) {
      if (outcomeError) throw outcomeError;
      return [{ affectedRows: outcomeAffected }];
    }
    throw new Error(`Unexpected queued SMS SQL: ${sql}`);
  });
}

function mockRetryFlow(entry, { claimAffected = 1, outcomeAffected = 1 } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT \* FROM sms_logs WHERE id = \? AND organization_id = \?/.test(sql)) {
      return [[entry]];
    }
    if (/SET status = 'failed', error_code = \?/.test(sql)) {
      return [{ affectedRows: claimAffected }];
    }
    if (/SET status = \?, provider_message_id = \?/.test(sql)) {
      return [{ affectedRows: outcomeAffected }];
    }
    throw new Error(`Unexpected retried SMS SQL: ${sql}`);
  });
}

describe('smsTransport — authoritative client communication enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    https.request.mockReset();
    http.request.mockReset();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM;
    delete process.env.TWILIO_WHATSAPP_FROM;
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER_URL;
    delete process.env.SMS_PROVIDER_API_KEY;
    delete process.env.REDIS_URL;
    mockGetOrganizationDeliveryState.mockResolvedValue(ACTIVE);
    mockEvaluateClientCommunication.mockResolvedValue({ allowed: true, code: null, contactEpoch: 19 });
    mockQuery.mockResolvedValue([{ affectedRows: 1, insertId: 1 }]);
  });

  test('detects configured providers deterministically', () => {
    expect(smsTransport.detectProvider()).toBeNull();
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    expect(smsTransport.detectProvider()).toBe('twilio');
    process.env.SMS_PROVIDER = 'generic';
    process.env.SMS_PROVIDER_URL = 'https://sms.example.com/send';
    expect(smsTransport.detectProvider()).toBe('generic');
  });

  test.each(['sms', 'whatsapp'])('DND blocks direct %s before provider I/O', async channel => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockEvaluateClientCommunication.mockResolvedValueOnce({
      allowed: false,
      code: 'CLIENT_COMMUNICATION_OPTED_OUT',
    });

    const result = await smsTransport.sendSms({
      organizationId: 7,
      clientId: 44,
      channel,
      messageClass: 'transactional',
      to: '+526141234567',
      body: 'Invoice notice',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'CLIENT_COMMUNICATION_OPTED_OUT',
    });
    expect(mockEvaluateClientCommunication).toHaveBeenCalledWith({
      organizationId: 7,
      clientId: 44,
      channel,
      destination: '+526141234567',
      messageClass: 'transactional',
    });
    expect(https.request).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('organization_epoch'),
      expect.arrayContaining([7, 8, 44, '+526141234567', channel, 'transactional']),
    );
  });

  test('successful client SMS rechecks the organization and records class/epoch', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM123', status: 'queued' }) });

    const result = await smsTransport.sendSms({
      organizationId: 7,
      clientId: 44,
      channel: 'sms',
      messageClass: 'security',
      to: '+526141234567',
      body: 'Your code is 123456',
    });

    expect(result).toEqual({ success: true, messageId: 'SM123' });
    expect(mockGetOrganizationDeliveryState).toHaveBeenCalledTimes(2);
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'api.twilio.com' }),
      expect.any(Function),
    );
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining([7, 8, 44, 'security', 'SM123', 'sent']));
  });

  test('an explicit provider-delivered result is a successful direct SMS', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM-DELIVERED', status: 'delivered' }) });

    const result = await smsTransport.sendSms({
      organizationId: 7,
      clientId: 44,
      channel: 'sms',
      messageClass: 'transactional',
      to: '+526141234567',
      body: 'Delivery confirmation',
    });

    expect(result).toEqual({ success: true, messageId: 'SM-DELIVERED' });
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining(['SM-DELIVERED', 'delivered']));
    expect(params[params.length - 1]).toBeInstanceOf(Date);
  });

  test('organization epoch change immediately before dispatch prevents provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockGetOrganizationDeliveryState
      .mockResolvedValueOnce({ active: true, epoch: 8 })
      .mockResolvedValueOnce({ active: true, epoch: 9 });

    const result = await smsTransport.sendSms({
      organizationId: 7,
      clientId: 44,
      channel: 'sms',
      messageClass: 'transactional',
      to: '+526141234567',
      body: 'stale',
    });

    expect(result).toMatchObject({ success: false, code: 'ORGANIZATION_INACTIVE' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('queue snapshot stores message class and organization epoch without provider I/O', async () => {
    mockQuery.mockResolvedValueOnce([{ insertId: 20 }]);

    const result = await smsTransport.queueSms({
      organizationId: 7,
      clientId: 44,
      channel: 'whatsapp',
      messageClass: 'support_reply',
      to: '+526141234567',
      body: 'How can we help?',
    });

    expect(result).toEqual({ queued: true, logId: 20 });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("'queued'"),
      [7, 8, 44, 19, '+526141234567', 'whatsapp', null, 'How can we help?', 'none', 'support_reply'],
    );
    expect(https.request).not.toHaveBeenCalled();
  });

  test.each(['sendSms', 'queueSms'])(
    '%s rejects missing client attribution before database or provider I/O',
    async method => {
      await expect(smsTransport[method]({
        organizationId: 7,
        to: '+526141234567',
        body: 'Unattributed client work',
        messageClass: 'transactional',
      })).rejects.toMatchObject({ code: 'CLIENT_ATTRIBUTION_REQUIRED' });
      expect(mockQuery).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    },
  );

  test.each(['sendSms', 'queueSms'])(
    '%s rejects a client whose organization ownership became NULL',
    async method => {
      await expect(smsTransport[method]({
        organizationId: null,
        clientId: 44,
        to: '+526141234567',
        body: 'Orphaned client work',
        messageClass: 'transactional',
      })).rejects.toMatchObject({ code: 'CLIENT_ATTRIBUTION_REQUIRED' });
      expect(mockQuery).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    },
  );

  test('inactive client blocks direct SMS before provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockEvaluateClientCommunication.mockResolvedValueOnce({
      allowed: false,
      code: 'CLIENT_INACTIVE',
    });

    await expect(smsTransport.sendSms({
      organizationId: 7,
      clientId: 44,
      channel: 'sms',
      messageClass: 'transactional',
      to: '+526141234567',
      body: 'Inactive client work',
    })).resolves.toMatchObject({ success: false, skipped: true, code: 'CLIENT_INACTIVE' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('deleted-client queued SMS is terminalized without provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockQueueFlow({
      id: 30,
      organization_id: 7,
      organization_epoch: 8,
      client_id: null,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Old invoice',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(https.request).not.toHaveBeenCalled();
    const claim = mockQuery.mock.calls.find(([sql]) => /status IN \(\?\)/.test(sql));
    expect(claim[0]).toMatch(/error_code = \?[\s\S]*status IN \(\?\)/);
    const outcome = mockQuery.mock.calls.find(([sql]) => /provider_message_id = \?/.test(sql));
    expect(outcome[1]).toEqual([
      'failed',
      null,
      'failed',
      mockBlockCodes.CLIENT_NOT_FOUND,
      'Client delivery authorization is unavailable; message skipped.',
      30,
      7,
      'DELIVERY_CLAIMED',
    ]);
  });

  test('legacy queued client work with lost provenance fails closed without SMS provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM-LEGACY', status: 'queued' }) });
    mockQueueFlow({
      id: 35,
      organization_id: 7,
      organization_epoch: 8,
      client_id: null,
      client_contact_epoch: 0,
      message_class: null,
      phone_number: '+526141234567',
      message_body: 'Legacy invoice',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('inactive-to-active epoch mismatch terminalizes queued SMS', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockQueueFlow({
      id: 31,
      organization_id: 7,
      organization_epoch: 7,
      client_id: 44,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Old invoice',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockEvaluateClientCommunication).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('client delete/restore epoch mismatch terminalizes queued SMS', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockQueueFlow({
      id: 34,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 18,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Old invoice',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    const outcome = mockQuery.mock.calls.find(([sql]) => /provider_message_id = \?/.test(sql));
    expect(outcome[1][3]).toBe(mockBlockCodes.CONTACT_MISMATCH);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('inactive client terminalizes queued SMS before provider invocation', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockEvaluateClientCommunication.mockResolvedValueOnce({
      allowed: false,
      code: 'CLIENT_INACTIVE',
      contactEpoch: 19,
    });
    mockQueueFlow({
      id: 42,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Inactive queue item',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(https.request).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /SET error_code = \?, error_message = \?, sent_at = NOW/.test(sql)))
      .toBe(false);
    const outcome = mockQuery.mock.calls.find(([sql]) => /provider_message_id = \?/.test(sql));
    expect(outcome[1][3]).toBe('CLIENT_INACTIVE');
    expect(outcome[1].at(-1)).toBe('DELIVERY_CLAIMED');
  });

  test('retry refuses a deleted-client row before provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockRetryFlow({
      id: 32,
      organization_id: 7,
      organization_epoch: 8,
      client_id: null,
      message_class: 'security',
      phone_number: '+526141234567',
      message_body: 'Old code',
      channel: 'sms',
      status: 'failed',
      error_code: null,
    });

    await expect(smsTransport.retryLog(32, 7)).resolves.toMatchObject({
      claimed: true,
      success: false,
      code: 'CLIENT_NOT_FOUND',
    });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('install sweep excludes isolated rows from primary and enters isolated DBs', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM organization_database_configs/.test(sql)) return [[{ organization_id: 9 }]];
      if (/SET status = 'queued', error_code = NULL/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT \* FROM sms_logs WHERE status = 'queued'/.test(sql)) return [[]];
      throw new Error(`Unexpected isolated SMS sweep SQL: ${sql}`);
    });

    await expect(smsTransport.processQueue()).resolves.toEqual({ sent: 0, failed: 0, total: 0 });
    expect(mockWithPrimaryContext).toHaveBeenCalled();
    expect(mockWithTenantContext).toHaveBeenCalledWith(9, expect.any(Function));
    expect(mockQuery.mock.calls[1][0]).toMatch(/error_code = \?[\s\S]*organization_id NOT IN \(\?\)/);
    expect(mockQuery.mock.calls[1][1]).toEqual(['DELIVERY_CLAIMED', 9]);
    expect(mockQuery.mock.calls[2][1]).toEqual([9]);
    const recoveries = mockQuery.mock.calls.filter(([sql]) => /SET status = 'queued'/.test(sql));
    expect(recoveries.map(([, params]) => params)).toEqual([
      ['DELIVERY_CLAIMED', 9],
      ['DELIVERY_CLAIMED', 9],
    ]);
  });

  test('a competing worker that loses the durable claim performs zero provider I/O', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    mockQueueFlow({
      id: 36,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'One delivery only',
      channel: 'sms',
      status: 'queued',
    }, { claimAffected: 0 });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 0, total: 1 });
    expect(mockGetOrganizationDeliveryState).not.toHaveBeenCalled();
    expect(mockEvaluateClientCommunication).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  test('marks invocation before provider I/O and normalizes a provider-accepted status to sent', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM-ACCEPTED', status: 'accepted' }) });
    mockQueueFlow({
      id: 37,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Claimed delivery',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    const invocation = mockQuery.mock.calls.find(([sql]) => (
      /SET error_code = \?, error_message = \?, sent_at = NOW/.test(sql)
    ));
    expect(invocation[1]).toEqual([
      'DELIVERY_OUTCOME_UNKNOWN',
      'Provider invocation started; delivery outcome is unknown',
      37,
      7,
      'DELIVERY_CLAIMED',
    ]);
    const invocationOrder = mockQuery.mock.invocationCallOrder[
      mockQuery.mock.calls.indexOf(invocation)
    ];
    expect(invocationOrder).toBeLessThan(https.request.mock.invocationCallOrder[0]);
    const outcome = mockQuery.mock.calls.find(([sql]) => /provider_message_id = \?/.test(sql));
    expect(outcome[1]).toEqual([
      'sent',
      'SM-ACCEPTED',
      'sent',
      null,
      null,
      37,
      7,
      'DELIVERY_OUTCOME_UNKNOWN',
    ]);
  });

  test('queued explicit-delivered status records sent_at and counts as successful', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM-Q-DELIVERED', status: 'delivered' }) });
    mockQueueFlow({
      id: 38,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Delivered queue item',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    const [outcomeSql, outcomeParams] = mockQuery.mock.calls.find(([sql]) => /provider_message_id = \?/.test(sql));
    expect(outcomeSql).toMatch(/sent_at = IF\(\? IN \('sent','delivered'\), NOW\(\), NULL\)/);
    expect(outcomeParams).toEqual([
      'delivered',
      'SM-Q-DELIVERED',
      'delivered',
      null,
      null,
      38,
      7,
      'DELIVERY_OUTCOME_UNKNOWN',
    ]);
  });

  test('provider network failure after the invocation marker remains outcome-unknown', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    https.request.mockImplementationOnce(() => {
      throw new Error('socket failed after write');
    });
    mockQueueFlow({
      id: 39,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Ambiguous queue item',
      channel: 'sms',
      status: 'queued',
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    const outcomes = mockQuery.mock.calls.filter(([sql]) => /SET status = \?, provider_message_id = \?/.test(sql));
    expect(outcomes).toHaveLength(0);
    const invocation = mockQuery.mock.calls.find(([sql]) => /SET error_code = \?, error_message = \?/.test(sql));
    expect(invocation[1][0]).toBe('DELIVERY_OUTCOME_UNKNOWN');
  });

  test.each([
    ['throws', { outcomeError: new Error('database unavailable after acceptance') }],
    ['loses its CAS', { outcomeAffected: 0 }],
  ])('provider success remains outcome-unknown when final persistence %s', async (_label, flowOptions) => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM = '+15005550001';
    mockHttpsRequest({ body: JSON.stringify({ sid: 'SM-AMBIGUOUS', status: 'accepted' }) });
    mockQueueFlow({
      id: 40,
      organization_id: 7,
      organization_epoch: 8,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      phone_number: '+526141234567',
      message_body: 'Ambiguous persistence',
      channel: 'sms',
      status: 'queued',
    }, flowOptions);

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /SET status = \?, provider_message_id = \?/.test(sql)))
      .toHaveLength(1);
  });

  test('retry rejects an outcome-unknown SMS without provider I/O', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 41,
        organization_id: 7,
        status: 'failed',
        error_code: 'DELIVERY_OUTCOME_UNKNOWN',
      },
    ]]);

    await expect(smsTransport.retryLog(41, 7)).rejects.toThrow('not in a retryable state');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(https.request).not.toHaveBeenCalled();
  });

  test('stale recovery never requeues an outcome-unknown provider invocation', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SET status = 'queued', error_code = NULL/.test(sql)) {
        expect(params).toEqual(['DELIVERY_CLAIMED', 7]);
        expect(params).not.toContain('DELIVERY_OUTCOME_UNKNOWN');
        return [{ affectedRows: 0 }];
      }
      if (/SELECT \* FROM sms_logs WHERE status = 'queued'/.test(sql)) return [[]];
      throw new Error(`Unexpected stale SMS recovery SQL: ${sql}`);
    });

    await expect(smsTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 0, total: 0 });
    expect(https.request).not.toHaveBeenCalled();
  });
});
