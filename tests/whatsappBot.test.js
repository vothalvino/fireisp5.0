// =============================================================================
// FireISP 5.0 — WhatsApp bot (binding state machine) tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/whatsappService');
jest.mock('../src/services/whatsappCapabilityService');
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const wa = require('../src/services/whatsappService');
const cap = require('../src/services/whatsappCapabilityService');
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
  // Conversation-state defaults: no in-flight flow.
  wa.getConversationState.mockResolvedValue(null);
  wa.setConversationState.mockResolvedValue();
  wa.clearConversationState.mockResolvedValue();
  // Capability service defaults.
  cap.getActiveContracts.mockResolvedValue([]);
  cap.balanceText.mockResolvedValue('💳 Your account balance is *100.00 MXN*.');
  cap.planText.mockResolvedValue('📶 Your service: Fiber 100 — 100/20 Mbps — active');
  cap.invoicesText.mockResolvedValue('🧾 Your recent invoices: ...');
  cap.createProblemTicket.mockResolvedValue(555);
  cap.createHumanHandoffTicket.mockResolvedValue(777);
  cap.recentWhatsappTicketCount.mockResolvedValue(0);
  db.query.mockResolvedValue([[{ name: 'Ana Lopez' }]]);
});

it('greets an unbound number with linking instructions', async () => {
  const { reply } = await bot.handleInbound({ phone: PHONE, body: 'hello there' });
  expect(reply).toMatch(/connect you to your ISP account/i);
  expect(wa.bindNumber).not.toHaveBeenCalled();
});

it('shows the menu to an already-bound number', async () => {
  wa.resolveBinding.mockResolvedValue({ clientId: 7, organizationId: 3, linkId: 1 });
  const { reply, clientId } = await bot.handleInbound({ phone: PHONE, body: 'hi' });
  expect(reply).toMatch(/what can i help/i);
  expect(reply).toMatch(/Ana/);
  expect(reply).toMatch(/Account balance/);
  expect(clientId).toBe(7);
  expect(wa.touchBinding).toHaveBeenCalledWith(1);
});

describe('bound-client capabilities', () => {
  beforeEach(() => {
    wa.resolveBinding.mockResolvedValue({ clientId: 7, organizationId: 3, linkId: 1 });
  });

  it('answers balance for intent 1', async () => {
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '1' });
    expect(cap.balanceText).toHaveBeenCalledWith(3, 7);
    expect(reply).toMatch(/account balance/i);
  });

  it('answers plan for the keyword "plan"', async () => {
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'plan' });
    expect(cap.planText).toHaveBeenCalledWith(7);
    expect(reply).toMatch(/your service/i);
  });

  it('answers invoices for the Spanish keyword "factura"', async () => {
    await bot.handleInbound({ phone: PHONE, body: 'factura' });
    expect(cap.invoicesText).toHaveBeenCalledWith(7);
  });

  it('opens a human-handoff ticket for intent 5', async () => {
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '5' });
    expect(cap.createHumanHandoffTicket).toHaveBeenCalledWith({ orgId: 3, clientId: 7 });
    expect(reply).toMatch(/#777/);
  });

  it('report flow (single service): prompts then opens a ticket with the description', async () => {
    cap.getActiveContracts.mockResolvedValue([{ id: 9, label: 'Fiber 100 — Main St' }]);
    // step 1: pick "report"
    const r1 = await bot.handleInbound({ phone: PHONE, body: '4' });
    expect(wa.setConversationState).toHaveBeenCalledWith(PHONE, 7, 'await_problem_desc', { contract: { id: 9, label: 'Fiber 100 — Main St' } });
    expect(r1.reply).toMatch(/describe the problem/i);
    // step 2: the description arrives
    wa.getConversationState.mockResolvedValue({ state: 'await_problem_desc', context: { contract: { id: 9, label: 'Fiber 100 — Main St' } } });
    const r2 = await bot.handleInbound({ phone: PHONE, body: 'my internet is down since morning' });
    expect(cap.createProblemTicket).toHaveBeenCalledWith(expect.objectContaining({ orgId: 3, clientId: 7, description: 'my internet is down since morning' }));
    expect(wa.clearConversationState).toHaveBeenCalledWith(PHONE);
    expect(r2.reply).toMatch(/#555/);
  });

  it('report flow (multi-service): asks which service, then advances on a valid pick', async () => {
    const contracts = [{ id: 9, label: 'Home' }, { id: 10, label: 'Office' }];
    cap.getActiveContracts.mockResolvedValue(contracts);
    const r1 = await bot.handleInbound({ phone: PHONE, body: 'reportar' });
    expect(wa.setConversationState).toHaveBeenCalledWith(PHONE, 7, 'await_contract_pick', { contracts });
    expect(r1.reply).toMatch(/which service/i);
    // pick #2
    wa.getConversationState.mockResolvedValue({ state: 'await_contract_pick', context: { contracts } });
    const r2 = await bot.handleInbound({ phone: PHONE, body: '2' });
    expect(wa.setConversationState).toHaveBeenLastCalledWith(PHONE, 7, 'await_problem_desc', { contract: contracts[1] });
    expect(r2.reply).toMatch(/describe the problem/i);
  });

  it('rejects an out-of-range service pick without advancing', async () => {
    const contracts = [{ id: 9, label: 'Home' }];
    wa.getConversationState.mockResolvedValue({ state: 'await_contract_pick', context: { contracts } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '9' });
    expect(reply).toMatch(/number of the service/i);
    expect(cap.createProblemTicket).not.toHaveBeenCalled();
  });

  it('MENU escapes an in-progress flow', async () => {
    wa.getConversationState.mockResolvedValue({ state: 'await_problem_desc', context: {} });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'MENU' });
    expect(wa.clearConversationState).toHaveBeenCalledWith(PHONE);
    expect(cap.createProblemTicket).not.toHaveBeenCalled();
    expect(reply).toMatch(/what can i help/i);
  });

  it('still unlinks on UNLINK', async () => {
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'UNLINK' });
    expect(wa.revokeLink).toHaveBeenCalledWith({ clientId: 7, linkId: 1 });
    expect(reply).toMatch(/disconnected/i);
  });

  it('ignores + clears stale flow state left by a DIFFERENT client (rebind guard)', async () => {
    // Phone re-bound to client 7, but a stale flow row belongs to client 99.
    wa.getConversationState.mockResolvedValue({ clientId: 99, state: 'await_problem_desc', context: { contract: { id: 1, label: "OTHER CLIENT'S SERVICE" } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'hello' });
    expect(wa.clearConversationState).toHaveBeenCalledWith(PHONE);
    expect(cap.createProblemTicket).not.toHaveBeenCalled(); // no cross-client ticket
    expect(reply).toMatch(/what can i help/i); // fell back to the menu, stale flow discarded
  });

  it('throttles a flooding bound thread', async () => {
    wa.recentInboundCount.mockResolvedValue(41); // > BOUND_MSG_LIMIT_PER_HOUR (40)
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '5' });
    expect(reply).toMatch(/wait a few minutes/i);
    expect(cap.createHumanHandoffTicket).not.toHaveBeenCalled();
  });

  it('caps WhatsApp ticket creation (human handoff) when the client is over the hourly cap', async () => {
    cap.recentWhatsappTicketCount.mockResolvedValue(5);
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '5' });
    expect(cap.createHumanHandoffTicket).not.toHaveBeenCalled();
    expect(reply).toMatch(/already have open requests/i);
  });

  it('caps ticket creation on the report flow too', async () => {
    cap.recentWhatsappTicketCount.mockResolvedValue(5);
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_problem_desc', context: { contract: null } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'it broke' });
    expect(cap.createProblemTicket).not.toHaveBeenCalled();
    expect(reply).toMatch(/already have open requests/i);
  });
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
