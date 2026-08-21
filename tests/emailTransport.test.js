'use strict';

const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockWithTenantContext = jest.fn(async (_organizationId, callback) => callback());
const mockWithPrimaryContext = jest.fn(async callback => callback());

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  getConnection: mockGetConnection,
  withTenantContext: mockWithTenantContext,
  withPrimaryContext: mockWithPrimaryContext,
}));

const mockFindRawByOrgId = jest.fn();
jest.mock('../src/models/EmailSettings', () => ({
  findRawByOrgId: mockFindRawByOrgId,
}));

const mockDecryptStrict = jest.fn(value => `plain:${value}`);
jest.mock('../src/utils/encryption', () => ({
  decryptStrict: mockDecryptStrict,
}));

const mockSendTenantSmtp = jest.fn();
const mockSendTrustedSmtp = jest.fn();
jest.mock('../src/utils/safeSmtpSender', () => ({
  sendTenantSmtp: mockSendTenantSmtp,
  sendTrustedSmtp: mockSendTrustedSmtp,
  DEFAULT_SMTP_CONNECTION_TIMEOUT_MS: 30000,
  DEFAULT_SMTP_GREETING_TIMEOUT_MS: 30000,
  DEFAULT_SMTP_SOCKET_TIMEOUT_MS: 60000,
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
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  CONTACT_MISMATCH: 'CLIENT_COMMUNICATION_CONTACT_MISMATCH',
  OPTED_OUT: 'CLIENT_COMMUNICATION_OPTED_OUT',
  CONSENT_REQUIRED: 'CLIENT_MARKETING_CONSENT_REQUIRED',
});
jest.mock('../src/services/clientCommunicationPreferenceService', () => ({
  getOrganizationDeliveryState: mockGetOrganizationDeliveryState,
  evaluateClientCommunication: mockEvaluateClientCommunication,
  blockedResult: mockBlockedResult,
  BLOCK_CODES: mockBlockCodes,
}));

const EmailSettings = require('../src/models/EmailSettings');
const emailTransport = require('../src/services/emailTransport');

const ACTIVE = { active: true, epoch: 12 };

function mockEmailQueueFlow(entry, {
  claimAffected = 1,
  invocationAffected = 1,
  outcomeAffected = 1,
  outcomeError = null,
} = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM organization_database_configs/.test(sql)) return [[]];
    if (/SET status = 'queued', error_message = NULL/.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    if (/SELECT \* FROM email_logs[\s\S]*status = 'queued'/.test(sql)) return [[entry]];
    if (/SET status = 'failed', error_message = \?, sent_at = NOW\(\)/.test(sql)) {
      return [{ affectedRows: claimAffected }];
    }
    if (/UPDATE email_logs SET error_message = \?, sent_at = NOW\(\)/.test(sql)) {
      return [{ affectedRows: invocationAffected }];
    }
    if (/SET status = \?, sent_at = IF/.test(sql)) {
      if (outcomeError) throw outcomeError;
      return [{ affectedRows: outcomeAffected }];
    }
    throw new Error(`Unexpected queued email SQL: ${sql}`);
  });
}

describe('emailTransport — one-shot SMTP and client-communication enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrganizationDeliveryState.mockReset().mockResolvedValue(ACTIVE);
    mockEvaluateClientCommunication.mockReset().mockResolvedValue({ allowed: true, code: null, contactEpoch: 19 });
    mockFindRawByOrgId.mockReset().mockResolvedValue(null);
    mockSendTenantSmtp.mockReset().mockResolvedValue({ messageId: '<tenant@test>' });
    mockSendTrustedSmtp.mockReset().mockResolvedValue({ messageId: '<trusted@test>' });
    mockQuery.mockReset().mockResolvedValue([{ affectedRows: 1, insertId: 1 }]);
  });

  test('uses the one-shot trusted relay and records the authoritative epoch', async () => {
    const result = await emailTransport.sendEmail({
      organizationId: 7,
      to: 'operator@example.com',
      subject: 'Operational notice',
      text: 'hello',
      installTransportOnly: true,
      operationalRecipient: true,
    });

    expect(result).toEqual({ success: true, messageId: '<trusted@test>' });
    expect(mockSendTrustedSmtp).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ to: 'operator@example.com', subject: 'Operational notice' }),
    }));
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockFindRawByOrgId).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('organization_epoch'),
      expect.arrayContaining(['operator@example.com', 'Operational notice', 7, 12]),
    );
  });

  test('uses fresh tenant settings, strict decryption, mandatory-safe tenant sender', async () => {
    mockFindRawByOrgId.mockResolvedValueOnce({
      organization_id: 7,
      email_function: 'billing',
      enabled: 1,
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_secure: 1,
      smtp_user: 'billing-user',
      smtp_password_encrypted: 'ciphertext',
      from_email: 'billing@example.com',
      from_name: 'Billing',
    });

    const result = await emailTransport.sendEmail({
      organizationId: 7,
      emailFunction: 'billing',
      to: 'staff@example.net',
      subject: 'Invoice report',
      text: 'hello',
      operationalRecipient: true,
    });

    expect(result.success).toBe(true);
    expect(mockDecryptStrict).toHaveBeenCalledWith('ciphertext');
    expect(mockSendTenantSmtp).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'billing-user', pass: 'plain:ciphertext' },
      message: expect.objectContaining({ from: 'Billing <billing@example.com>' }),
    }));
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test('falls back requested function to the general tenant identity', async () => {
    mockFindRawByOrgId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        enabled: 1,
        smtp_host: 'general.smtp.example',
        smtp_port: 587,
        smtp_secure: 0,
        smtp_user: null,
        smtp_password_encrypted: null,
        from_email: 'general@example.com',
      });

    await emailTransport.sendEmail({
      organizationId: 7,
      emailFunction: 'noc',
      to: 'staff@example.net',
      subject: 'NOC',
      text: 'hello',
      operationalRecipient: true,
    });

    expect(EmailSettings.findRawByOrgId).toHaveBeenNthCalledWith(1, 7, 'noc');
    expect(EmailSettings.findRawByOrgId).toHaveBeenNthCalledWith(2, 7, 'general');
    expect(mockSendTenantSmtp).toHaveBeenCalledWith(expect.objectContaining({
      host: 'general.smtp.example',
    }));
  });

  test('DND blocks transactional client email before either SMTP sender', async () => {
    mockEvaluateClientCommunication.mockResolvedValueOnce({
      allowed: false,
      code: 'CLIENT_COMMUNICATION_OPTED_OUT',
    });

    const result = await emailTransport.sendEmail({
      organizationId: 7,
      clientId: 44,
      messageClass: 'transactional',
      to: 'client@example.com',
      subject: 'Invoice',
      text: 'hello',
    });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      code: 'CLIENT_COMMUNICATION_OPTED_OUT',
    });
    expect(mockEvaluateClientCommunication).toHaveBeenCalledWith({
      organizationId: 7,
      clientId: 44,
      channel: 'email',
      destination: 'client@example.com',
      messageClass: 'transactional',
    });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test.each([
    [null, 'CLIENT_ORGANIZATION_REQUIRED'],
    [7, 'CLIENT_INACTIVE'],
  ])('client email is blocked before SMTP for unavailable ownership/lifecycle (%s)', async (organizationId, code) => {
    mockEvaluateClientCommunication.mockResolvedValueOnce({ allowed: false, code });

    const result = await emailTransport.sendEmail({
      organizationId,
      clientId: 44,
      messageClass: 'transactional',
      to: 'client@example.com',
      subject: 'Client notice',
      text: 'hello',
    });

    expect(result).toMatchObject({ success: false, skipped: true, code });
    expect(mockEvaluateClientCommunication).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      clientId: 44,
    }));
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test('a lifecycle change during preparation prevents SMTP I/O', async () => {
    mockGetOrganizationDeliveryState
      .mockResolvedValueOnce({ active: true, epoch: 12 })
      .mockResolvedValueOnce({ active: true, epoch: 13 });

    const result = await emailTransport.sendEmail({
      organizationId: 7,
      to: 'staff@example.net',
      subject: 'Stale work',
      text: 'hello',
      installTransportOnly: true,
      operationalRecipient: true,
    });

    expect(result).toMatchObject({ success: false, code: 'ORGANIZATION_INACTIVE' });
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
  });

  test('sanitized delivery failures neither return nor persist raw socket details', async () => {
    const sentinel = 'ECONNREFUSED 10.0.0.5:25 SECRET_SOCKET_DETAIL';
    mockSendTrustedSmtp.mockRejectedValueOnce(Object.assign(new Error(sentinel), {
      code: 'ECONNREFUSED',
    }));

    const result = await emailTransport.sendEmail({
      organizationId: 7,
      to: 'staff@example.net',
      subject: 'Test',
      text: 'hello',
      installTransportOnly: true,
      operationalRecipient: true,
      sanitizeFailure: true,
    });

    expect(result).toEqual({
      success: false,
      error: 'Email delivery failed.',
      code: 'EMAIL_DELIVERY_FAILED',
    });
    expect(JSON.stringify(mockQuery.mock.calls)).not.toContain(sentinel);
  });

  test.each([
    [{ organizationId: 7, to: 'nobody@example.test', subject: 'Missing lane' }],
    [{ organizationId: 7, clientId: 44, operationalRecipient: true, messageClass: 'transactional', to: 'client@example.test', subject: 'Mixed lane' }],
    [{ organizationId: 7, messageClass: 'transactional', to: 'client@example.test', subject: 'Missing client' }],
  ])('rejects ambiguous client/operational lane pairing before SMTP I/O', async options => {
    await expect(emailTransport.sendEmail(options)).resolves.toMatchObject({
      success: false,
      code: 'CLIENT_ATTRIBUTION_REQUIRED',
    });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test('deleted-client queued work is terminalized without provider I/O', async () => {
    mockEmailQueueFlow({
      id: 90,
      organization_id: 7,
      organization_epoch: 12,
      client_id: null,
      message_class: 'transactional',
      recipient: 'former-client@example.com',
      subject: 'Old invoice',
      body: 'old',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
    const outcome = mockQuery.mock.calls.find(([sql]) => /sent_at = IF/.test(sql));
    expect(outcome[1]).toEqual([
      'failed',
      'failed',
      'Client delivery authorization is unavailable; message skipped.',
      90,
      7,
      'Delivery claimed; awaiting provider result',
    ]);
  });

  test('legacy queued client work with lost provenance fails closed without SMTP I/O', async () => {
    mockEmailQueueFlow({
      id: 93,
      organization_id: 7,
      organization_epoch: 12,
      client_id: null,
      client_contact_epoch: 0,
      message_class: null,
      recipient: 'legacy-former-client@example.com',
      subject: 'Legacy invoice',
      body: 'old',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test('inactive-to-active epoch mismatch terminalizes old queued work', async () => {
    mockEmailQueueFlow({
      id: 91,
      organization_id: 7,
      organization_epoch: 11,
      client_id: 44,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Old invoice',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockEvaluateClientCommunication).not.toHaveBeenCalled();
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
    const outcome = mockQuery.mock.calls.find(([sql]) => /sent_at = IF/.test(sql));
    expect(outcome[1][2]).toMatch(/authorization changed/i);
  });

  test('client delete/restore epoch mismatch terminalizes old queued work', async () => {
    mockEmailQueueFlow({
      id: 92,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 18,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Old invoice',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    const outcome = mockQuery.mock.calls.find(([sql]) => /sent_at = IF/.test(sql));
    expect(outcome[1][2]).toMatch(/preference blocks/i);
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test.each([
    [null, 'CLIENT_ORGANIZATION_REQUIRED'],
    [7, 'CLIENT_INACTIVE'],
  ])('queued client email with unavailable ownership/lifecycle is terminalized (%s)', async (organizationId, code) => {
    mockEvaluateClientCommunication.mockResolvedValueOnce({ allowed: false, code });
    mockEmailQueueFlow({
      id: 96,
      organization_id: organizationId,
      organization_epoch: organizationId === null ? 0 : 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Queued client notice',
      body: 'hello',
      status: 'queued',
    });

    const result = organizationId === null
      ? await emailTransport.processQueue()
      : await emailTransport.processQueue(organizationId);

    expect(result).toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE email_logs SET error_message/.test(sql))).toBe(false);
    const outcome = mockQuery.mock.calls.find(([sql]) => /sent_at = IF/.test(sql));
    expect(outcome[1].at(-1)).toBe('Delivery claimed; awaiting provider result');
  });

  test('install sweep excludes isolated org rows from primary and enters each isolated DB', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM organization_database_configs/.test(sql)) return [[{ organization_id: 9 }]];
      if (/SET status = 'queued', error_message = NULL/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT \* FROM email_logs[\s\S]*status = 'queued'/.test(sql)) return [[]];
      throw new Error(`Unexpected isolated email sweep SQL: ${sql}`);
    });

    await expect(emailTransport.processQueue()).resolves.toEqual({ sent: 0, failed: 0, total: 0 });

    expect(mockWithPrimaryContext).toHaveBeenCalled();
    expect(mockWithTenantContext).toHaveBeenCalledWith(9, expect.any(Function));
    const primaryQueueSql = mockQuery.mock.calls[1][0];
    expect(primaryQueueSql).toMatch(/organization_id NOT IN \(\?\)/);
    expect(mockQuery.mock.calls[1][1]).toEqual(['Delivery claimed; awaiting provider result', 9]);
    expect(mockQuery.mock.calls[2][1]).toEqual([9]);
    const recoveries = mockQuery.mock.calls.filter(([sql]) => /SET status = 'queued'/.test(sql));
    expect(recoveries.map(([, params]) => params)).toEqual([
      ['Delivery claimed; awaiting provider result', 9],
      ['Delivery claimed; awaiting provider result', 9],
    ]);
  });

  test('a competing queue worker that loses the claim performs zero SMTP I/O', async () => {
    mockEmailQueueFlow({
      id: 94,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'One delivery only',
      status: 'queued',
    }, { claimAffected: 0 });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 0, total: 1 });
    expect(mockGetOrganizationDeliveryState).not.toHaveBeenCalled();
    expect(mockEvaluateClientCommunication).not.toHaveBeenCalled();
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });

  test('marks provider invocation as outcome-unknown before SMTP and guards the final outcome', async () => {
    mockEmailQueueFlow({
      id: 95,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Claimed delivery',
      body: 'hello',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    const invocation = mockQuery.mock.calls.find(([sql]) => (
      /UPDATE email_logs SET error_message = \?, sent_at = NOW/.test(sql)
    ));
    expect(invocation[1]).toEqual([
      'Provider invocation started; delivery outcome is unknown',
      95,
      7,
      'Delivery claimed; awaiting provider result',
    ]);
    expect(invocation.invocationCallOrder?.[0] ?? mockQuery.mock.invocationCallOrder[
      mockQuery.mock.calls.indexOf(invocation)
    ]).toBeLessThan(mockSendTrustedSmtp.mock.invocationCallOrder[0]);
    const outcome = mockQuery.mock.calls.find(([sql]) => /sent_at = IF/.test(sql));
    expect(outcome[1].at(-1)).toBe('Provider invocation started; delivery outcome is unknown');
  });

  test('SMTP/network failure after the invocation marker remains outcome-unknown', async () => {
    mockSendTrustedSmtp.mockRejectedValueOnce(new Error('socket closed after DATA'));
    mockEmailQueueFlow({
      id: 97,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Ambiguous delivery',
      body: 'hello',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockSendTrustedSmtp).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /SET status = \?, sent_at = IF/.test(sql)))
      .toHaveLength(0);
    const invocation = mockQuery.mock.calls.find(([sql]) => /UPDATE email_logs SET error_message/.test(sql));
    expect(invocation[1][0]).toBe('Provider invocation started; delivery outcome is unknown');
  });

  test('a policy skip after the invocation marker may become an ordinary terminal failure', async () => {
    mockEvaluateClientCommunication
      .mockResolvedValueOnce({ allowed: true, code: null, contactEpoch: 19 })
      .mockResolvedValueOnce({ allowed: false, code: 'CLIENT_INACTIVE' });
    mockEmailQueueFlow({
      id: 98,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Revoked delivery',
      status: 'queued',
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 1, total: 1 });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
    const outcome = mockQuery.mock.calls.find(([sql]) => /SET status = \?, sent_at = IF/.test(sql));
    expect(outcome[1][0]).toBe('failed');
    expect(outcome[1].at(-1)).toBe('Provider invocation started; delivery outcome is unknown');
  });

  test.each([
    ['throws', { outcomeError: new Error('database unavailable after SMTP acceptance') }, 0],
    ['loses its CAS', { outcomeAffected: 0 }, 1],
  ])('provider success remains outcome-unknown when final persistence %s', async (_label, flowOptions, failed) => {
    mockEmailQueueFlow({
      id: 99,
      organization_id: 7,
      organization_epoch: 12,
      client_id: 44,
      client_contact_epoch: 19,
      message_class: 'transactional',
      recipient: 'client@example.com',
      subject: 'Ambiguous persistence',
      status: 'queued',
    }, flowOptions);

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed, total: 1 });
    expect(mockSendTrustedSmtp).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /SET status = \?, sent_at = IF/.test(sql)))
      .toHaveLength(1);
  });

  test('stale recovery only requeues claims proven to precede SMTP invocation', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SET status = 'queued', error_message = NULL/.test(sql)) {
        expect(params).toEqual(['Delivery claimed; awaiting provider result', 7]);
        expect(sql).not.toMatch(/Provider invocation started/);
        return [{ affectedRows: 0 }];
      }
      if (/SELECT \* FROM email_logs[\s\S]*status = 'queued'/.test(sql)) return [[]];
      throw new Error(`Unexpected stale email recovery SQL: ${sql}`);
    });

    await expect(emailTransport.processQueue(7)).resolves.toEqual({ sent: 0, failed: 0, total: 0 });
    expect(mockSendTenantSmtp).not.toHaveBeenCalled();
    expect(mockSendTrustedSmtp).not.toHaveBeenCalled();
  });
});
