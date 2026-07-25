// =============================================================================
// FireISP 5.0 — WhatsApp bot (binding state machine) tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/whatsappService');
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const wa = require('../src/services/whatsappService');
const emailTransport = require('../src/services/emailTransport');
const bot = require('../src/services/whatsappBotService');

const PHONE = '+525512345678';

beforeEach(() => {
  jest.clearAllMocks();
  // Safe defaults: unbound, not throttled, nothing matches.
  wa.resolveBinding.mockResolvedValue(null);
  wa.touchBinding.mockResolvedValue();
  wa.recentInboundCount.mockResolvedValue(1);
  wa.verifyPhoneCode.mockResolvedValue({ ok: false, reason: 'no_pending' });
  wa.verifyPortalCode.mockResolvedValue({ ok: false, reason: 'no_match' });
  wa.bindNumber.mockResolvedValue({ id: 1 });
  wa.revokeLink.mockResolvedValue(true);
  wa.emailCodeBudgetExceeded.mockResolvedValue(false);
  wa.clientEmailCodeBudgetExceeded.mockResolvedValue(false);
  wa.createVerification.mockResolvedValue('654321');
  wa.EMAIL_CODE_LENGTH = 6;
  db.query.mockResolvedValue([[{ name: 'Ana Lopez' }]]);
});

it('greets an unbound number with linking instructions', async () => {
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'hello there' });
  expect(reply).toMatch(/connect you to your ISP account/i);
  expect(wa.bindNumber).not.toHaveBeenCalled();
});

it('recognizes an already-bound number', async () => {
  wa.resolveBinding.mockResolvedValue({ clientId: 7, organizationId: 3, linkId: 1 });
  const { reply, clientId } = await bot.handleInbound({ phone: PHONE, body: 'hi' });
  expect(reply).toMatch(/already connected/i);
  expect(reply).toMatch(/Ana/);
  expect(clientId).toBe(7);
  expect(wa.touchBinding).toHaveBeenCalledWith(1);
});

it('unlinks a bound number on the UNLINK command', async () => {
  wa.resolveBinding.mockResolvedValue({ clientId: 7, organizationId: 3, linkId: 1 });
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'UNLINK' });
  expect(wa.revokeLink).toHaveBeenCalledWith({ clientId: 7, linkId: 1 });
  expect(reply).toMatch(/disconnected/i);
});

it('starts email-OTP and sends a code for a unique email match (uniform reply)', async () => {
  db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 2, name: 'Bob', email: 'bob@x.com' }]]);
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'bob@x.com' });
  expect(reply).toMatch(/if that email is on file/i);
  expect(wa.createVerification).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'link_email', clientId: 5, phone: PHONE }));
  expect(emailTransport.sendEmail).toHaveBeenCalled();
});

it('does not re-send when the target inbox is over its OTP budget', async () => {
  db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 2, name: 'Bob', email: 'bob@x.com' }]]);
  wa.clientEmailCodeBudgetExceeded.mockResolvedValue(true);
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'bob@x.com' });
  expect(reply).toMatch(/if that email is on file/i); // still uniform
  expect(wa.createVerification).not.toHaveBeenCalled();
});

it('gives the same reply but sends nothing when the email is not on file', async () => {
  db.query.mockResolvedValueOnce([[]]); // no client
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'ghost@x.com' });
  expect(reply).toMatch(/if that email is on file/i);
  expect(wa.createVerification).not.toHaveBeenCalled();
  expect(emailTransport.sendEmail).not.toHaveBeenCalled();
});

it('does not send when >1 client shares the email (cross-tenant ambiguity)', async () => {
  db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 2, name: 'A', email: 'x@x.com' }, { id: 6, organization_id: 3, name: 'B', email: 'x@x.com' }]]);
  await bot.handleInbound({ phone: PHONE, body: 'x@x.com' });
  expect(wa.createVerification).not.toHaveBeenCalled();
});

it('binds via email OTP when a code matches the pending email verification', async () => {
  wa.verifyPhoneCode.mockResolvedValue({ ok: true, clientId: 5, organizationId: 2 });
  const { reply, clientId } = await bot.handleInbound({ phone: PHONE, body: '654321' });
  expect(wa.bindNumber).toHaveBeenCalledWith(expect.objectContaining({ clientId: 5, phone: PHONE, via: 'email_otp' }));
  expect(reply).toMatch(/connected/i);
  expect(clientId).toBe(5);
});

it('binds an 8-digit portal code without touching a pending email OTP', async () => {
  // A pending email OTP would mismatch an 8-digit code; routing by length means
  // verifyPhoneCode is never even called, so the portal code still works.
  wa.verifyPhoneCode.mockResolvedValue({ ok: false, reason: 'mismatch' });
  wa.verifyPortalCode.mockResolvedValue({ ok: true, clientId: 9, organizationId: 4 });
  const { reply } = await bot.handleInbound({ phone: PHONE, body: '12345678' });
  expect(wa.bindNumber).toHaveBeenCalledWith(expect.objectContaining({ clientId: 9, via: 'portal' }));
  expect(wa.verifyPhoneCode).not.toHaveBeenCalled();
  expect(reply).toMatch(/connected/i);
});

it('treats a numeric-suffixed email as an email, not a code (regression)', async () => {
  db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 2, name: 'Carlos', email: 'carlos123456@hotmail.com' }]]);
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'carlos123456@hotmail.com' });
  expect(reply).toMatch(/if that email is on file/i);
  expect(wa.verifyPortalCode).not.toHaveBeenCalled();
  expect(wa.createVerification).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'link_email', clientId: 5 }));
});

it('reports a mismatch (and does NOT try a portal code) mid email-OTP', async () => {
  wa.verifyPhoneCode.mockResolvedValue({ ok: false, reason: 'mismatch' });
  const { reply } = await bot.handleInbound({ phone: PHONE, body: '000000' });
  expect(reply).toMatch(/doesn't match/i);
  expect(wa.verifyPortalCode).not.toHaveBeenCalled();
  expect(wa.bindNumber).not.toHaveBeenCalled();
});

it('locks out after too many code attempts', async () => {
  wa.verifyPhoneCode.mockResolvedValue({ ok: false, reason: 'locked' });
  const { reply } = await bot.handleInbound({ phone: PHONE, body: '111111' });
  expect(reply).toMatch(/too many/i);
});

it('throttles an unbound number that floods messages', async () => {
  wa.recentInboundCount.mockResolvedValue(bot.UNBOUND_MSG_LIMIT_PER_HOUR + 1);
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'test@x.com' });
  expect(reply).toMatch(/wait a few minutes/i);
  expect(wa.createVerification).not.toHaveBeenCalled();
});
