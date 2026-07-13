// =============================================================================
// FireISP 5.0 — supportConversationService Tests (PR F: AI support replies)
// =============================================================================
// Covers:
//  - the new {text, escalate, escalationReason, dataSources, ...} return
//    contract of _generateResponse, uniform across billing/technical/general/
//    fallback branches
//  - actual escalation side effects when the diagnostic engine returns
//    escalate:true (no fake "technician scheduled" — the reply's promise must
//    be backed by a real escalate() call)
//  - the historical "[object Object]" bug: supportBillingModule.handle /
//    supportGeneralModule.handle return { response, requiresConfirmation,
//    actionType, actionData } — an OBJECT, not a string. Tests here mock the
//    REAL module return shape (per CLAUDE.md: never the frontend's wish).
// =============================================================================
'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

jest.mock('../src/services/supportContextService', () => ({
  enrichContext: jest.fn(),
}));

jest.mock('../src/services/diagnosticEngineService', () => ({
  generateSupportResponse: jest.fn(),
  runDiagnostic: jest.fn(),
}));

jest.mock('../src/services/supportBillingModule', () => ({
  handle: jest.fn(),
}));

jest.mock('../src/services/supportGeneralModule', () => ({
  handle: jest.fn(),
}));

const db = require('../src/config/database');
const supportContextService = require('../src/services/supportContextService');
const diagnosticEngineService = require('../src/services/diagnosticEngineService');
const supportBillingModule = require('../src/services/supportBillingModule');
const supportGeneralModule = require('../src/services/supportGeneralModule');
const service = require('../src/services/supportConversationService');

const mockConversation = {
  id: 1,
  organization_id: 1,
  client_id: 10,
  channel: 'web',
  status: 'open',
  intent: 'technical',
  confidence: 0.85,
  escalation_reason: null,
  escalated_at: null,
  ticket_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockMessage = {
  id: 1,
  conversation_id: 1,
  role: 'customer',
  content: 'x',
  intent: 'technical',
  confidence: 0.85,
  data_sources: null,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation(() => Promise.resolve([[], {}]));
  supportContextService.enrichContext.mockResolvedValue({ customer: { id: 10 }, billing: {}, connection: {} });
  diagnosticEngineService.generateSupportResponse = jest.fn();
});

// =============================================================================
// 1. _generateResponse — return-contract shape, per intent branch
// =============================================================================
describe('_generateResponse return contract', () => {
  test('other/default intent: {text, escalate:false, escalationReason:null}', async () => {
    const resp = await service._generateResponse({ intent: 'other', context: null, content: 'xyz', orgId: 1 });
    expect(resp).toEqual({
      text: 'Soy tu asistente virtual. Permíteme conectarte con el área correcta. Un momento, por favor.',
      escalate: false,
      escalationReason: null,
      dataSources: null,
      requiresConfirmation: false,
      actionType: null,
      actionData: null,
    });
  });

  test('technical intent: propagates escalate/escalationReason/dataSources from generateSupportResponse', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'Detectamos una posible falla física...',
      escalate: true,
      escalationReason: 'physical_infrastructure',
      diagnosticResult: { checks: [{ name: 'onu_signal', status: 'error' }], cause: 'x', confidence: 0.6 },
    });

    const resp = await service._generateResponse({
      intent: 'technical', context: null, content: 'está muy lento', orgId: 1, clientId: 10, conversationId: 7,
    });

    expect(resp.text).toBe('Soy tu asistente virtual. Detectamos una posible falla física...');
    expect(resp.escalate).toBe(true);
    expect(resp.escalationReason).toBe('physical_infrastructure');
    expect(resp.dataSources).toBe(JSON.stringify({ checks: [{ name: 'onu_signal', status: 'error' }], cause: 'x', confidence: 0.6 }));

    // Regression guard for the old positional-args bug: must be called with
    // the NAMED {orgId, clientId, conversationId, content} shape.
    expect(diagnosticEngineService.generateSupportResponse).toHaveBeenCalledWith({
      orgId: 1, clientId: 10, conversationId: 7, content: 'está muy lento',
    });
  });

  test('technical intent, escalate:false: reply text carries through, no escalation flagged', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'Revisamos tu conexión y no encontramos problemas activos en este momento.',
      escalate: false,
      escalationReason: null,
      diagnosticResult: { checks: [], confidence: 1 },
    });

    const resp = await service._generateResponse({
      intent: 'technical', context: null, content: 'todo bien pero algo lento', orgId: 1, clientId: 10, conversationId: 1,
    });

    expect(resp.escalate).toBe(false);
    expect(resp.text).toContain('no encontramos problemas activos');
  });

  test('technical intent falls back to the generic string when generateSupportResponse is unavailable', async () => {
    // Simulates the module failing to export the function (e.g. a load
    // error) — must not throw, must use the pre-existing static fallback.
    diagnosticEngineService.generateSupportResponse = undefined;

    const resp = await service._generateResponse({ intent: 'technical', context: null, content: 'no internet', orgId: 1 });

    expect(resp.text).toBe('Soy tu asistente virtual. Hemos registrado tu problema de conexión. Nuestro equipo técnico revisará tu servicio a la brevedad. ¿Puedes confirmar si el problema comenzó de repente o gradualmente?');
    expect(resp.escalate).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // The [object Object] regression — billing and general branches
  // ---------------------------------------------------------------------------
  test('billing intent: uses reply.response, never renders [object Object] (regression)', async () => {
    // REAL supportBillingModule.handle return shape (src/services/supportBillingModule.js).
    supportBillingModule.handle.mockResolvedValue({
      response: 'Tu saldo actual es $150.00 MXN.',
      requiresConfirmation: false,
      actionType: 'balance_query',
      actionData: { balance: '150.00' },
    });

    const resp = await service._generateResponse({ intent: 'billing', context: { customer: { id: 10 } }, content: 'cuanto debo', orgId: 1 });

    expect(resp.text).toBe('Soy tu asistente virtual. Tu saldo actual es $150.00 MXN.');
    expect(resp.text).not.toContain('[object Object]');
    expect(resp.actionType).toBe('balance_query');
    expect(resp.actionData).toEqual({ balance: '150.00' });
    expect(resp.requiresConfirmation).toBe(false);
  });

  test('billing intent with requiresConfirmation:true (e.g. plan upgrade / cancellation) threads through', async () => {
    supportBillingModule.handle.mockResolvedValue({
      response: '¿Confirmas que deseas cancelar tu servicio? Esto puede generar cargos por cancelación anticipada.',
      requiresConfirmation: true,
      actionType: 'cancellation',
      actionData: { clientId: 10 },
    });

    const resp = await service._generateResponse({ intent: 'billing', context: { customer: { id: 10 } }, content: 'quiero cancelar', orgId: 1 });

    expect(resp.text).not.toContain('[object Object]');
    expect(resp.requiresConfirmation).toBe(true);
    expect(resp.actionType).toBe('cancellation');
  });

  test('general intent: uses reply.response, never renders [object Object] (regression)', async () => {
    // REAL supportGeneralModule.handle return shape (src/services/supportGeneralModule.js).
    supportGeneralModule.handle.mockResolvedValue({
      response: 'Nuestro horario de atención es de lunes a viernes de 9am a 6pm.',
      requiresConfirmation: false,
      actionType: 'business_hours',
      actionData: { hours: 'L-V 9-18' },
    });

    const resp = await service._generateResponse({ intent: 'general', context: {}, content: 'cual es su horario', orgId: 1 });

    expect(resp.text).toBe('Soy tu asistente virtual. Nuestro horario de atención es de lunes a viernes de 9am a 6pm.');
    expect(resp.text).not.toContain('[object Object]');
    expect(resp.actionType).toBe('business_hours');
  });

  test('module.handle throwing falls back to the generic connect-me message (no crash)', async () => {
    supportBillingModule.handle.mockRejectedValue(new Error('db down'));
    const resp = await service._generateResponse({ intent: 'billing', context: null, content: 'saldo', orgId: 1 });
    expect(resp.text).toBe('Soy tu asistente virtual. Permíteme conectarte con el área correcta. Un momento, por favor.');
  });
});

// =============================================================================
// 2. sendMessage — end-to-end wiring: call-shape + escalate side effects
// =============================================================================
describe('sendMessage — technical intent wiring', () => {
  test('passes {orgId, clientId, conversationId, content} to generateSupportResponse and persists dataSources', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'Revisamos tu conexión y no encontramos problemas activos en este momento.',
      escalate: false,
      escalationReason: null,
      diagnosticResult: { checks: [{ name: 'pppoe_session', status: 'ok' }], confidence: 1 },
    });

    db.query
      .mockResolvedValueOnce([[mockConversation], undefined])       // 1. conv lookup
      .mockResolvedValueOnce([{ insertId: 30 }, undefined])          // 2. insert customer message
      .mockResolvedValueOnce([[mockMessage], undefined])             // 3. history
      .mockResolvedValueOnce([{ insertId: 31 }, undefined])          // 4. insert assistant message
      .mockResolvedValueOnce([[mockConversation], undefined])        // 5. _loadConversation: conv
      .mockResolvedValueOnce([[mockMessage], undefined]);            // 6. _loadConversation: messages

    const result = await service.sendMessage({
      conversationId: 1, orgId: 1, clientId: 10, content: 'mi internet está muy lento',
    });

    expect(result.conversation).toBeDefined();
    expect(diagnosticEngineService.generateSupportResponse).toHaveBeenCalledWith({
      orgId: 1, clientId: 10, conversationId: 1, content: 'mi internet está muy lento',
    });

    // 4th db.query call is the assistant-message INSERT — assert its bound
    // params carry the real text (prefixed) and the JSON dataSources.
    const insertAssistantCall = db.query.mock.calls[3];
    expect(insertAssistantCall[0]).toMatch(/INSERT INTO support_messages/);
    expect(insertAssistantCall[1][2]).toBe('Soy tu asistente virtual. Revisamos tu conexión y no encontramos problemas activos en este momento.');
    expect(insertAssistantCall[1][5]).toBe(JSON.stringify({ checks: [{ name: 'pppoe_session', status: 'ok' }], confidence: 1 }));

    // escalate:false -> no UPDATE ... SET status = 'escalated' anywhere.
    const escalateCalls = db.query.mock.calls.filter(([sql]) => /status = 'escalated'/.test(sql));
    expect(escalateCalls).toHaveLength(0);
  });

  test('escalate:true actually creates the escalation — no fake "technician scheduled"', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'Detectamos una posible falla física relacionada con la señal óptica de tu equipo ONU que puede requerir la visita de un técnico. Te estamos conectando con nuestro equipo para coordinar la revisión.',
      escalate: true,
      escalationReason: 'diagnostic_escalation',
      diagnosticResult: { checks: [{ name: 'onu_signal', status: 'error' }], confidence: 0.8 },
    });

    db.query
      .mockResolvedValueOnce([[mockConversation], undefined])        // 1. conv lookup
      .mockResolvedValueOnce([{ insertId: 40 }, undefined])           // 2. insert customer message
      .mockResolvedValueOnce([[mockMessage], undefined])              // 3. history
      .mockResolvedValueOnce([{ insertId: 41 }, undefined])           // 4. insert assistant message (reply text)
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])        // 5. escalate: UPDATE status='escalated'
      .mockResolvedValueOnce([{ insertId: 500 }, undefined])          // 6. escalate: INSERT ticket
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])        // 7. escalate: UPDATE ticket_id
      .mockResolvedValueOnce([{ insertId: 42 }, undefined])           // 8. escalate: INSERT system message
      .mockResolvedValueOnce([[{ ...mockConversation, status: 'escalated' }], undefined]) // 9. escalate's own _loadConversation: conv
      .mockResolvedValueOnce([[mockMessage], undefined])              // 10. escalate's own _loadConversation: messages
      .mockResolvedValueOnce([[{ ...mockConversation, status: 'escalated' }], undefined]) // 11. sendMessage's final _loadConversation: conv
      .mockResolvedValueOnce([[mockMessage], undefined]);             // 12. sendMessage's final _loadConversation: messages

    const result = await service.sendMessage({
      conversationId: 1, orgId: 1, clientId: 10, content: 'la señal de mi fibra está muy mal',
    });

    expect(result.conversation.status).toBe('escalated');

    const calls = db.query.mock.calls;
    const assistantInsertIdx = calls.findIndex(([sql, params]) =>
      /INSERT INTO support_messages/.test(sql) && params[1] === 'assistant');
    const escalateUpdateIdx = calls.findIndex(([sql]) => /SET status = 'escalated'/.test(sql));
    const ticketInsertIdx = calls.findIndex(([sql]) => /INSERT INTO tickets/.test(sql));
    const systemMsgIdx = calls.findIndex(([sql, params]) =>
      /INSERT INTO support_messages/.test(sql) && params[1] === 'system');

    expect(assistantInsertIdx).toBeGreaterThanOrEqual(0);
    expect(escalateUpdateIdx).toBeGreaterThan(assistantInsertIdx); // assistant reply persisted BEFORE escalation fires
    expect(ticketInsertIdx).toBeGreaterThan(escalateUpdateIdx);
    expect(systemMsgIdx).toBeGreaterThan(ticketInsertIdx);
  });
});

describe('startConversation — technical intent wiring', () => {
  test('passes {orgId, clientId, conversationId, content} to generateSupportResponse', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'No pudimos verificar automáticamente el estado de tu conexión en este momento...',
      escalate: false,
      escalationReason: null,
      diagnosticResult: null,
    });

    db.query
      .mockResolvedValueOnce([{ insertId: 10 }, undefined])   // insert conversation
      .mockResolvedValueOnce([{ insertId: 11 }, undefined])   // system greeting
      .mockResolvedValueOnce([{ insertId: 12 }, undefined])   // customer message
      .mockResolvedValueOnce([{ insertId: 13 }, undefined])   // assistant message
      .mockResolvedValueOnce([[mockConversation], undefined]) // _loadConversation: conv
      .mockResolvedValueOnce([[mockMessage], undefined]);     // _loadConversation: messages

    const result = await service.startConversation({ orgId: 1, clientId: 10, channel: 'web', message: 'no me funciona el internet' });

    expect(result.conversation).toBeDefined();
    expect(diagnosticEngineService.generateSupportResponse).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 1, clientId: 10, conversationId: 10 }),
    );
  });

  test('escalate:true on the opening message actually escalates', async () => {
    diagnosticEngineService.generateSupportResponse.mockResolvedValue({
      reply: 'Detectamos una posible falla física... Te estamos conectando con nuestro equipo.',
      escalate: true,
      escalationReason: 'diagnostic_escalation',
      diagnosticResult: { checks: [{ name: 'onu_signal', status: 'error' }], confidence: 0.7 },
    });

    db.query
      .mockResolvedValueOnce([{ insertId: 20 }, undefined])   // insert conversation
      .mockResolvedValueOnce([{ insertId: 21 }, undefined])   // system greeting
      .mockResolvedValueOnce([{ insertId: 22 }, undefined])   // customer message
      .mockResolvedValueOnce([{ insertId: 23 }, undefined])   // assistant message
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])// escalate: UPDATE status
      .mockResolvedValueOnce([{ insertId: 600 }, undefined])  // escalate: INSERT ticket
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])// escalate: UPDATE ticket_id
      .mockResolvedValueOnce([{ insertId: 24 }, undefined])   // escalate: INSERT system message
      .mockResolvedValueOnce([[{ ...mockConversation, status: 'escalated' }], undefined])
      .mockResolvedValueOnce([[mockMessage], undefined])
      .mockResolvedValueOnce([[{ ...mockConversation, status: 'escalated' }], undefined])
      .mockResolvedValueOnce([[mockMessage], undefined]);

    const result = await service.startConversation({ orgId: 1, clientId: 10, message: 'la señal de mi fibra falló' });

    expect(result.conversation.status).toBe('escalated');
    const escalateUpdateCalls = db.query.mock.calls.filter(([sql]) => /SET status = 'escalated'/.test(sql));
    expect(escalateUpdateCalls).toHaveLength(1);
  });
});
