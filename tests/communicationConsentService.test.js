'use strict';

const service = require('../src/services/communicationConsentService');

describe('communicationConsentService', () => {
  test('requires an explicit boolean decision for every optional channel', () => {
    expect(() => service.validateChoices({ email: true, sms: false }))
      .toThrow(/whatsapp must be a boolean/i);
    expect(service.validateChoices({ email: false, sms: false, whatsapp: false }))
      .toEqual({ email: false, sms: false, whatsapp: false });
  });

  test('records affirmative consent only for granted channels and DND vetoes declines', async () => {
    const calls = [];
    const run = jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/SELECT email, phone FROM clients/.test(sql)) {
        return [[{ email: 'client@example.test', phone: '+526141234567' }]];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    });

    await service.recordSignedChoices(run, {
      organizationId: 42,
      clientId: 9,
      serviceOrderId: 16,
      workOrderId: 13,
      signedDocumentId: 77,
      capturedBy: 5,
      ipAddress: '203.0.113.9',
      notice: { version: 'default-1', hash: 'a'.repeat(64) },
      choices: { email: true, sms: false, whatsapp: true },
    });

    const consentInserts = calls.filter(call => /INSERT INTO subscriber_consents/.test(call.sql));
    expect(consentInserts).toHaveLength(2);
    expect(consentInserts.map(call => call.params[6])).toEqual(['email', 'whatsapp']);
    expect(consentInserts[0].params).toEqual(expect.arrayContaining([
      42, 9, 'default-1', '203.0.113.9', 'a'.repeat(64), 16, 13, 77, 5,
    ]));

    const dndInserts = calls.filter(call => /INSERT INTO client_dnd_preferences/.test(call.sql));
    expect(dndInserts).toHaveLength(4); // blanket reset + three exact channels
    const sms = dndInserts.find(call => call.params[2] === 'sms');
    expect(sms.params[3]).toBe(1);
    const email = dndInserts.find(call => call.params[2] === 'email');
    expect(email.params[3]).toBe(0);
  });

  test('refuses consent for a destination the client does not have', async () => {
    const run = jest.fn(async sql => (
      /SELECT email, phone FROM clients/.test(sql) ? [[{ email: null, phone: null }]] : [{ affectedRows: 1 }]
    ));

    await expect(service.recordSignedChoices(run, {
      organizationId: 42,
      clientId: 9,
      signedDocumentId: 77,
      notice: { version: 'default-1', hash: 'a'.repeat(64) },
      choices: { email: true, sms: false, whatsapp: false },
    })).rejects.toThrow(/no email address/i);
    expect(run.mock.calls.some(([sql]) => /INSERT INTO subscriber_consents/.test(sql))).toBe(false);
  });
});
