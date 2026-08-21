'use strict';

const mockQuery = jest.fn();
const mockWithTenantContext = jest.fn(async (_organizationId, callback) => callback());

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  withTenantContext: mockWithTenantContext,
}));

jest.mock('../src/config', () => ({
  whatsapp: { phoneNumberId: '', accessToken: '', graphVersion: 'v20.0' },
}));

const mockGetOrganizationDeliveryState = jest.fn();
const mockEvaluateClientCommunication = jest.fn();
jest.mock('../src/services/clientCommunicationPreferenceService', () => ({
  getOrganizationDeliveryState: mockGetOrganizationDeliveryState,
  evaluateClientCommunication: mockEvaluateClientCommunication,
  BLOCK_CODES: {
    CONTACT_MISMATCH: 'CLIENT_COMMUNICATION_CONTACT_MISMATCH',
  },
}));

jest.mock('../src/utils/logger', () => ({
  warn: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const https = require('https');
jest.spyOn(https, 'request');
const whatsappOutbound = require('../src/services/whatsappOutbound');

describe('whatsappOutbound client communication enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    https.request.mockReset();
    mockQuery.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mockGetOrganizationDeliveryState.mockReset().mockResolvedValue({ active: true, epoch: 4 });
    mockEvaluateClientCommunication.mockReset().mockResolvedValue({
      allowed: true,
      code: null,
      contactEpoch: 9,
    });
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
  });

  afterAll(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    https.request.mockRestore();
  });

  test.each([
    [null, 'CLIENT_ORGANIZATION_REQUIRED'],
    [7, 'CLIENT_INACTIVE'],
    [7, 'CLIENT_COMMUNICATION_OPTED_OUT'],
  ])('blocks bound client reply before provider I/O for org=%s code=%s', async (organizationId, code) => {
    mockEvaluateClientCommunication.mockResolvedValueOnce({ allowed: false, code });

    const result = await whatsappOutbound.sendReply({
      provider: 'twilio',
      organizationId,
      clientId: 44,
      to: '+526141234567',
      body: 'Support reply',
    });

    expect(result).toMatchObject({ success: false, skipped: true, code });
    expect(mockEvaluateClientCommunication).toHaveBeenCalledWith({
      organizationId,
      clientId: 44,
      channel: 'whatsapp',
      destination: '+526141234567',
      messageClass: 'support_reply',
    });
    expect(https.request).not.toHaveBeenCalled();
    if (organizationId === null) {
      expect(mockQuery).not.toHaveBeenCalled();
    } else {
      expect(mockWithTenantContext).toHaveBeenCalledWith(7, expect.any(Function));
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringMatching(/message_class[\s\S]*'support_reply'/),
        expect.arrayContaining([7, 44, 'failed', code]),
      );
    }
  });
});
