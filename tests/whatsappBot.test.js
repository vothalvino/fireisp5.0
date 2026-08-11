// =============================================================================
// FireISP 5.0 — WhatsApp bot (binding state machine) tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/whatsappService');
jest.mock('../src/services/whatsappCapabilityService');
// The §21 engine is required lazily inside the bot's AI branch.
jest.mock('../src/services/supportConversationService', () => ({
  startConversation: jest.fn(), sendMessage: jest.fn(),
}));
jest.mock('../src/services/emailTransport', () => ({ sendEmail: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../src/utils/logger', () => {
  const m = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => m) };
  return m;
});

const db = require('../src/config/database');
const wa = require('../src/services/whatsappService');
const cap = require('../src/services/whatsappCapabilityService');
const emailTransport = require('../src/services/emailTransport');
const support = require('../src/services/supportConversationService');
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
  cap.resetWifiPassword.mockResolvedValue({ ok: true, applied: true, emailMasked: 'b***@x.com', requestId: 88 });
  cap.scheduleVisit.mockResolvedValue(91);
  cap.recentServiceRequestCount.mockResolvedValue(0);
  cap.maskEmail.mockImplementation((e) => (e ? `${String(e)[0]}***@x` : ''));
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

  it('opens a human-handoff ticket for intent 7', async () => {
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '7' });
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
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '7' });
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

  // ---- Wi-Fi reset (PR 3) ----
  it('wifi: prompts for CONFIRM when an email + single service exist', async () => {
    cap.getActiveContracts.mockResolvedValue([{ id: 9, label: 'Home' }]);
    db.query.mockResolvedValueOnce([[{ email: 'bob@x.com' }]]); // clientEmailMasked lookup
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '5' });
    expect(wa.setConversationState).toHaveBeenCalledWith(PHONE, 7, 'await_wifi_confirm', expect.objectContaining({ contract: { id: 9, label: 'Home' } }));
    expect(reply).toMatch(/CONFIRM/);
  });

  it('wifi: refuses when there is no email on file (cannot deliver the new PSK)', async () => {
    cap.getActiveContracts.mockResolvedValue([{ id: 9, label: 'Home' }]);
    db.query.mockResolvedValueOnce([[{ email: null }]]);
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'wifi' });
    expect(reply).toMatch(/need an email/i);
    expect(wa.setConversationState).not.toHaveBeenCalled();
  });

  it('wifi: CONFIRM applies (resetWifiPassword delivers + applies internally)', async () => {
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 }, emailMasked: 'b***@x.com' } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'CONFIRM' });
    expect(cap.resetWifiPassword).toHaveBeenCalledWith({ orgId: 3, clientId: 7, contract: { id: 9 } });
    expect(reply).toMatch(/emailed/i);
  });

  it('wifi: files a pending request (no CPE)', async () => {
    cap.resetWifiPassword.mockResolvedValue({ ok: true, applied: false, requestId: 88 });
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'sí' });
    expect(reply).toMatch(/#88/);
  });

  it('wifi: on email failure it did NOT change the password (honest reply)', async () => {
    cap.resetWifiPassword.mockResolvedValue({ ok: false, reason: 'email_failed', requestId: 88 });
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'CONFIRM' });
    expect(reply).toMatch(/did NOT change it/i);
  });

  it('wifi: contract reassigned mid-flow -> refuses (TOCTOU)', async () => {
    cap.resetWifiPassword.mockResolvedValue({ ok: false, reason: 'contract_gone' });
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'CONFIRM' });
    expect(reply).toMatch(/active service/i);
  });

  it('wifi: a non-confirm reply asks again (no action)', async () => {
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'maybe later' });
    expect(cap.resetWifiPassword).not.toHaveBeenCalled();
    expect(reply).toMatch(/CONFIRM/);
  });

  it('wifi: caps repeated resets (anti-abuse)', async () => {
    cap.recentServiceRequestCount.mockResolvedValue(3);
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_wifi_confirm', context: { contract: { id: 9 } } });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'CONFIRM' });
    expect(cap.resetWifiPassword).not.toHaveBeenCalled();
    expect(reply).toMatch(/wait a bit/i);
  });

  // ---- Technician visit (PR 3) ----
  it('visit: walks date -> slot -> schedules', async () => {
    cap.getActiveContracts.mockResolvedValue([{ id: 9, label: 'Home' }]);
    const r1 = await bot.handleInbound({ phone: PHONE, body: '6' });
    expect(r1.reply).toMatch(/what day/i);
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_visit_date', context: { contract: { id: 9 } } });
    const r2 = await bot.handleInbound({ phone: PHONE, body: '2099-08-05' });
    expect(r2.reply).toMatch(/what time/i);
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_visit_slot', context: { contract: { id: 9 }, date: '2099-08-05' } });
    const r3 = await bot.handleInbound({ phone: PHONE, body: '1' });
    expect(cap.scheduleVisit).toHaveBeenCalledWith(expect.objectContaining({ preferredDate: '2099-08-05', slot: 'morning' }));
    expect(r3.reply).toMatch(/#91/);
  });

  it('visit: rejects an unparseable date', async () => {
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_visit_date', context: {} });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: 'next tuesday' });
    expect(reply).toMatch(/date like/i);
    expect(cap.scheduleVisit).not.toHaveBeenCalled();
  });

  it('visit: rejects an overflow date (Feb 30)', async () => {
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_visit_date', context: {} });
    const { reply } = await bot.handleInbound({ phone: PHONE, body: '2099-02-30' });
    expect(reply).toMatch(/date like/i);
  });

  it('visit: multi-service shows the picker first', async () => {
    const contracts = [{ id: 9, label: 'Home' }, { id: 10, label: 'Office' }];
    cap.getActiveContracts.mockResolvedValue(contracts);
    const r1 = await bot.handleInbound({ phone: PHONE, body: '6' });
    expect(wa.setConversationState).toHaveBeenCalledWith(PHONE, 7, 'await_visit_pick', { contracts });
    expect(r1.reply).toMatch(/which service/i);
    wa.getConversationState.mockResolvedValue({ clientId: 7, state: 'await_visit_pick', context: { contracts } });
    const r2 = await bot.handleInbound({ phone: PHONE, body: '2' });
    expect(wa.setConversationState).toHaveBeenLastCalledWith(PHONE, 7, 'await_visit_date', { contract: contracts[1] });
    expect(r2.reply).toMatch(/what day/i);
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

// ===========================================================================
// Free text reaches the §21 AI support engine (j27)
// ===========================================================================
// The bot was a fixed numbered menu, so "mi internet se cae cada noche desde el
// martes" fell through to 'menu' and got a list of numbers back — the channel
// most Mexican customers prefer had the least capable support path, while a
// full intent-classification and diagnostics engine sat unused next door.
describe('free-text support', () => {
  // The binding uses camelCase (handleBound reads binding.clientId /
  // binding.organizationId) — snake_case here silently yields undefined orgId.
  const BOUND = { clientId: 42, organizationId: 3, linkId: 11 };
  const aiConversation = (over = {}) => ({
    conversation: { id: 900, status: 'open', ...over.conversation },
    messages: over.messages ?? [
      { role: 'customer', content: 'x' },
      { role: 'assistant', content: 'Veo reintentos de PPPoE en tu enlace desde el martes.' },
    ],
  });

  beforeEach(() => {
    wa.resolveBinding.mockResolvedValue(BOUND);
    support.startConversation.mockResolvedValue(aiConversation());
    support.sendMessage.mockResolvedValue(aiConversation());
  });

  const ask = (body) => bot.handleInbound({ phone: PHONE, body });

  it('routes a real question to the engine and returns its answer', async () => {
    const { reply } = await ask('mi internet se cae cada noche desde el martes');
    expect(support.startConversation).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 3, clientId: 42, channel: 'whatsapp' }),
    );
    expect(reply).toMatch(/reintentos de PPPoE/);
  });

  it('passes channel=whatsapp — the engine was already channel-aware', async () => {
    await ask('no tengo servicio desde ayer por la tarde');
    expect(support.startConversation.mock.calls[0][0].channel).toBe('whatsapp');
  });

  it.each([
    ['hola', 'a bare greeting'],
    ['1', 'a menu selection'],
    ['gracias', 'a pleasantry'],
    ['ok', 'an acknowledgement'],
  ])('does NOT spend an LLM call on %s (%s)', async (body) => {
    await ask(body);
    expect(support.startConversation).not.toHaveBeenCalled();
  });

  it('does not spend an LLM call on a SHORT multi-word reply', async () => {
    // "voy a ver" is 9 chars / 3 words: it starts with no pleasantry keyword
    // and clears the word-count bar, so the LENGTH guard is the only thing
    // rejecting it. Without a case like this the length check is untested —
    // every other input here is caught by one of the other rules, which a
    // mutation run showed by surviving its removal.
    await ask('voy a ver');
    expect(support.startConversation).not.toHaveBeenCalled();
  });

  it('leaves the numbered menu working — 1 is still the balance', async () => {
    const { reply } = await ask('1');
    expect(support.startConversation).not.toHaveBeenCalled();
    expect(reply).toMatch(/balance/i);
  });

  it('CONTINUES one thread rather than opening a conversation per message', async () => {
    // A subscriber describes a fault across three messages. A new conversation
    // each time means a new diagnostic context each time.
    wa.getConversationState.mockResolvedValue({
      state: 'ai_support', clientId: 42, context: { supportConversationId: 900 },
    });
    await ask('y tambien se cae el wifi en el cuarto de atras');
    expect(support.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 900, orgId: 3 }),
    );
    expect(support.startConversation).not.toHaveBeenCalled();
  });

  it('remembers the thread id for the next message', async () => {
    await ask('mi internet se cae cada noche desde el martes');
    expect(wa.setConversationState).toHaveBeenCalledWith(
      PHONE, 42, 'ai_support', { supportConversationId: 900 },
    );
  });

  it('tells the customer a human is coming when the engine escalates', async () => {
    support.startConversation.mockResolvedValue(aiConversation({ conversation: { status: 'escalated' } }));
    const { reply } = await ask('esto es un fraude, me estan cobrando de mas otra vez');
    expect(reply).toMatch(/support team|follow up/i);
    // The thread is cleared so the next message starts fresh with a human involved.
    expect(wa.clearConversationState).toHaveBeenCalledWith(PHONE);
  });

  it('FALLS BACK TO THE MENU when the engine is unavailable', async () => {
    // An LLM outage must not surface as an error message to a customer.
    support.startConversation.mockRejectedValue(new Error('no AI provider configured'));
    const { reply } = await ask('mi internet se cae cada noche desde el martes');
    expect(reply).toMatch(/Account balance/);      // the menu
    expect(reply).not.toMatch(/error|sorry|unavailable/i);
  });

  it('falls back to the menu when the engine returns no assistant message', async () => {
    support.startConversation.mockResolvedValue(aiConversation({ messages: [{ role: 'customer', content: 'x' }] }));
    const { reply } = await ask('mi internet se cae cada noche desde el martes');
    expect(reply).toMatch(/Account balance/);
  });
});
