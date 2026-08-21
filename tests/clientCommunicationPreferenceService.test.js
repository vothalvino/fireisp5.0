const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();
const mockGetConnection = jest.fn(async () => ({
  execute: mockExecute,
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
  release: mockRelease,
}));
const mockWithPrimaryContext = jest.fn(callback => callback());
const mockWithTenantContext = jest.fn((_organizationId, callback) => callback());

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  getConnection: mockGetConnection,
  withPrimaryContext: mockWithPrimaryContext,
  withTenantContext: mockWithTenantContext,
}));

const preferences = require('../src/services/clientCommunicationPreferenceService');

function activeOrganization() {
  mockQuery.mockResolvedValueOnce([[
    { id: 7, status: 'active', deleted_at: null, outbound_delivery_epoch: 3 },
  ]]);
}

  function clientState(overrides = {}) {
  return {
    id: 44,
      organization_id: 7,
      status: 'active',
    email: 'client@example.com',
    phone: '+52 614 123 4567',
    opted_out: 0,
    has_marketing_consent: 0,
    ...overrides,
  };
}

describe('clientCommunicationPreferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  test.each([
    ['email', 'client@example.com'],
    ['sms', '+526141234567'],
    ['whatsapp', 'whatsapp:+52 614 123 4567'],
  ])('DND vetoes transactional %s delivery', async (channel, destination) => {
    activeOrganization();
    mockQuery.mockResolvedValueOnce([[clientState({ opted_out: 1 })]]);

    await expect(preferences.evaluateClientCommunication({
      organizationId: 7,
      clientId: 44,
      channel,
      destination,
      messageClass: 'transactional',
    })).resolves.toEqual({
      allowed: false,
      code: preferences.BLOCK_CODES.OPTED_OUT,
    });
  });

  test('client-directed delivery without an organization fails closed before any query', async () => {
    await expect(preferences.evaluateClientCommunication({
      organizationId: null,
      clientId: 44,
      channel: 'email',
      destination: 'client@example.com',
      messageClass: 'transactional',
    })).resolves.toEqual({
      allowed: false,
      code: preferences.BLOCK_CODES.ORGANIZATION_REQUIRED,
    });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTenantContext).not.toHaveBeenCalled();
  });

  test.each(['email', 'sms', 'whatsapp'])('inactive client vetoes %s before consent can authorize it', async channel => {
    activeOrganization();
    mockQuery.mockResolvedValueOnce([[clientState({
      status: 'inactive',
      has_marketing_consent: 1,
    })]]);

    await expect(preferences.evaluateClientCommunication({
      organizationId: 7,
      clientId: 44,
      channel,
      destination: channel === 'email' ? 'client@example.com' : '+526141234567',
      messageClass: 'marketing',
    })).resolves.toEqual({
      allowed: false,
      code: preferences.BLOCK_CODES.CLIENT_INACTIVE,
    });
  });

  test('marketing requires affirmative consent for the current contact epoch', async () => {
    activeOrganization();
    mockQuery.mockResolvedValueOnce([[clientState({ has_marketing_consent: 0 })]]);

    await expect(preferences.evaluateClientCommunication({
      organizationId: 7,
      clientId: 44,
      channel: 'email',
      destination: 'CLIENT@example.com',
      messageClass: 'marketing',
    })).resolves.toEqual({
      allowed: false,
      code: preferences.BLOCK_CODES.CONSENT_REQUIRED,
    });

    const [eligibilitySql, eligibilityParams] = mockQuery.mock.calls[1];
    expect(eligibilitySql).toMatch(
      /communication_contact_epoch\s*=\s*CASE[\s\S]*c\.email_contact_epoch[\s\S]*c\.phone_contact_epoch/,
    );
    expect(eligibilityParams).toEqual(['email', 'email', 44, 7]);
  });

  test.each(['transactional', 'security', 'support_reply'])(
    '%s delivery does not manufacture or require marketing consent',
    async messageClass => {
      activeOrganization();
      mockQuery.mockResolvedValueOnce([[clientState({ has_marketing_consent: 0 })]]);

      await expect(preferences.evaluateClientCommunication({
        organizationId: 7,
        clientId: 44,
        channel: 'email',
        destination: 'client@example.com',
        messageClass,
      })).resolves.toEqual({ allowed: true, code: null, contactEpoch: 0 });
    },
  );

  test('a queued destination that no longer matches the client fails closed', async () => {
    activeOrganization();
    mockQuery.mockResolvedValueOnce([[clientState()]]);

    await expect(preferences.evaluateClientCommunication({
      organizationId: 7,
      clientId: 44,
      channel: 'sms',
      destination: '+526149999999',
      messageClass: 'security',
    })).resolves.toEqual({
      allowed: false,
      code: preferences.BLOCK_CODES.CONTACT_MISMATCH,
    });
  });

  test('opting out withdraws active marketing consent in the same transaction', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 44 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        organization_id: 7,
        client_id: 44,
        channel: 'email',
        opt_out: 1,
      }]]);

    await preferences.setClientPreferences({
      organizationId: 7,
      clientId: 44,
      preferences: [{ channel: 'email', optOut: true }],
    });

    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockRollback).not.toHaveBeenCalled();
    expect(mockExecute.mock.calls[1][0]).toMatch(
      /UPDATE subscriber_consents[\s\S]*purpose = 'marketing'[\s\S]*communication_channel = \?/,
    );
    expect(mockExecute.mock.calls[1][1]).toEqual([44, 7, 'email']);
  });

  test('a channel opt-in clears blanket DND while preserving the other channels', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: 44 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        organization_id: 7,
        client_id: 44,
        channel: 'email',
        opt_out: 0,
      }]]);

    await preferences.setClientPreferences({
      organizationId: 7,
      clientId: 44,
      preferences: [{ channel: 'email', optOut: false }],
    });

    const calls = mockExecute.mock.calls;
    expect(calls[1][1]).toEqual([7, 44, 'sms', 44, 7]);
    expect(calls[2][1]).toEqual([7, 44, 'whatsapp', 44, 7]);
    expect(calls[3][0]).toMatch(/channel = 'all' AND opt_out = 1/);
    expect(calls[4][1]).toEqual([7, 44, 'email', 0, null, null, null]);
    expect(calls.some(([sql]) => /INSERT INTO subscriber_consents/.test(sql))).toBe(false);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
});
