// =============================================================================
// FireISP 5.0 — diagnosticEngineService.generateSupportResponse Tests
// =============================================================================
// generateSupportResponse() is the bridge between supportConversationService's
// technical-intent branch and this file's real diagnostic handlers. These
// tests drive it end-to-end through the REAL runDiagnostic/_diagSlowFiber
// pipeline (db.query mocked by SQL-text dispatch, matching the convention
// already used by tests/section21.test.js's diagnosticEngineService block),
// never by stubbing out generateSupportResponse's own internals.
// =============================================================================
'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/radiusService', () => ({
  getSessionByClientId: jest.fn(),
}));
jest.mock('../src/services/wirelessService', () => ({
  getInterferenceReport: jest.fn(),
}));

const db = require('../src/config/database');
const radiusService = require('../src/services/radiusService');
const diagnosticEngineService = require('../src/services/diagnosticEngineService');

// ---------------------------------------------------------------------------
// SQL-text dispatch mock for db.query — mirrors the resolver/check queries in
// _resolveOnuDeviceId / _getOnuStatus / _diagSlowFiber (see
// src/services/diagnosticEngineService.js). Every scenario below drives the
// symptom='slow' + accessType='fiber' path (_diagSlowFiber) since it is the
// only handler with a settable 'error' check (onu_signal), which is what the
// issue-found / blind scenarios need.
// ---------------------------------------------------------------------------
function makeDbMock({
  onuDeviceId = null,
  onuDetailsRow = null,
  onuDetailsThrows = false,
  oltPortRow = null,
  alertCount = 0,
  alertThrows = false,
  accountActive = true,
  accountThrows = false,
} = {}) {
  return jest.fn((sql) => {
    // Direct ONU resolver: SELECT id FROM devices WHERE client_id = ? ... type = 'onu'
    if (/FROM devices\b/i.test(sql) && /type = 'onu'/i.test(sql)) {
      return Promise.resolve([onuDeviceId ? [{ id: onuDeviceId }] : [], undefined]);
    }
    // Bridge ONU resolver fallback (only reached if the direct lookup above
    // returned nothing) — keep it empty; every scenario here either resolves
    // directly or is intentionally fully unresolved.
    if (/FROM cpe_devices/i.test(sql) && /d\.type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    // CPE resolver (wireless) — unused by the fiber scenarios below.
    if (/FROM cpe_devices/i.test(sql) && /indoor_cpe/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    // ONU state + optical metrics
    if (/FROM onu_details/i.test(sql)) {
      if (onuDetailsThrows) return Promise.reject(new Error('onu telemetry unavailable'));
      return Promise.resolve([onuDetailsRow ? [onuDetailsRow] : [], undefined]);
    }
    // OLT port utilization
    if (/FROM olt_ports/i.test(sql)) {
      return Promise.resolve([oltPortRow ? [oltPortRow] : [], undefined]);
    }
    // Active alerts count
    if (/FROM alert_events/i.test(sql)) {
      if (alertThrows) return Promise.reject(new Error('alert service unavailable'));
      return Promise.resolve([[{ cnt: alertCount }], undefined]);
    }
    // Account/contract status
    if (/FROM contracts c/i.test(sql) && /JOIN clients/i.test(sql)) {
      if (accountThrows) return Promise.reject(new Error('account lookup failed'));
      return Promise.resolve([accountActive ? [{ status: 'active' }] : [], undefined]);
    }
    // ai_diagnostic_runs audit insert (_storeRun) — always succeeds; failures
    // there are independently swallowed by _storeRun's own try/catch.
    if (/INSERT INTO ai_diagnostic_runs/i.test(sql)) {
      return Promise.resolve([{ insertId: 1 }, undefined]);
    }
    return Promise.resolve([[], undefined]);
  });
}

// Extract the `symptom` argument (5th bound param) of the ai_diagnostic_runs
// INSERT so symptom-inference can be asserted without spying on an internal
// (non-exported, same-module) function call.
function storedSymptom(mockDb) {
  const call = mockDb.mock.calls.find(([sql]) => /INSERT INTO ai_diagnostic_runs/i.test(sql));
  return call ? call[1][4] : undefined;
}

const ENGLISH_INTERNAL_STRINGS = [
  'Check fiber connections',
  'Unable to determine specific cause',
  'Please contact technical support',
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('diagnosticEngineService.generateSupportResponse', () => {
  test('healthy case: reassuring but specific, not escalated', async () => {
    const dbMock = makeDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'online', olt_port_id: 9, rx_power_dbm: -20, tx_power_dbm: 2 },
      oltPortRow: { port_no: 1, onu_count: 5, max_onus: 64 },
      alertCount: 0,
      accountActive: true,
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.5' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'mi internet está muy lento',
    });

    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    expect(result.reply).toMatch(/no encontramos problemas activos/i);
    expect(result.reply).toContain('reiniciar tu router'); // self-serve tip for 'slow'
    expect(result.diagnosticResult.confidence).toBe(1);
    expect(storedSymptom(dbMock)).toBe('slow');
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('issue-found case: names the plain-language area, not the internal check name', async () => {
    const dbMock = makeDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'online', olt_port_id: 9, rx_power_dbm: -30, tx_power_dbm: 2 }, // below -27 threshold
      oltPortRow: { port_no: 1, onu_count: 5, max_onus: 64 },
      alertCount: 0,
      accountActive: true,
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.5' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'la velocidad está muy lenta',
    });

    // Not the raw check name 'onu_signal' — the Spanish plain-language label.
    expect(result.reply).toContain('la señal óptica de tu equipo ONU');
    expect(result.reply).not.toContain('onu_signal');
    expect(result.reply).toMatch(/encontramos un problema/i);
    // A single onu_signal error (no paired onu_status) never satisfies
    // _buildResult's escalate condition — see report for the flagged
    // dead-condition finding.
    expect(result.escalate).toBe(false);
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('blind case: honest non-reassuring reply, never a fabricated clean bill of health', async () => {
    const dbMock = makeDbMock({
      onuDeviceId: 5, // resolves so accessType is 'fiber' and _diagSlowFiber runs
      onuDetailsThrows: true, // onu_signal AND olt_port checks both go 'unknown'
      alertThrows: true, // active_alerts -> 'unknown'
      accountThrows: true, // account_status -> 'unknown'
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockRejectedValue(new Error('radius unavailable')); // pppoe_session -> 'unknown'

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'internet lento',
    });

    expect(result.diagnosticResult.confidence).toBe(0);
    expect(result.diagnosticResult.checks.every(c => c.status === 'unknown')).toBe(true);
    expect(result.reply).toMatch(/no pudimos verificar automáticamente/i);
    expect(result.reply).not.toMatch(/no encontramos problemas activos/i); // never a fake clean bill of health
    expect(result.escalate).toBe(false);
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('runDiagnostic failure is caught: reply is the safe fallback, escalate:false, no throw', async () => {
    // _storeRun/_buildResult/every check-level query is individually
    // try/caught inside runDiagnostic by design (see file header), so this
    // exercises generateSupportResponse's own outer catch by making the
    // FIRST unprotected call it makes — none exist today — impossible to
    // simulate without a real service outage. Instead, assert the function
    // never throws given a maximally hostile db mock (every query rejects).
    db.query.mockImplementation(() => Promise.reject(new Error('total db outage')));
    radiusService.getSessionByClientId.mockRejectedValue(new Error('radius down'));

    await expect(diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'internet lento',
    })).resolves.toBeDefined();

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'internet lento',
    });
    expect(result.escalate).toBe(false);
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Symptom inference (priority order: no_internet > wifi > disconnects >
  // slow_at_night > slow > general), asserted via the symptom bound param
  // persisted to ai_diagnostic_runs by _storeRun.
  // ---------------------------------------------------------------------------
  describe('symptom inference', () => {
    const table = [
      ['se cayó el internet por completo', 'no_internet'],
      ['no tengo internet desde ayer', 'no_internet'],
      ['mi wifi anda mal', 'wifi'],
      ['se desconecta a cada rato', 'disconnects'],
      ['internet lento en la noche', 'slow_at_night'],
      ['está lento', 'slow'],
      ['quiero saber sobre mi router nuevo', 'wifi'], // 'router' keyword
      ['hola, tengo una pregunta', 'general'], // unrelated text — no crash, honest fallback
    ];

    test.each(table)('%s -> %s', async (content, expectedSymptom) => {
      const dbMock = makeDbMock({}); // nothing resolves; fine for every non-slow/no_internet handler too
      db.query.mockImplementation(dbMock);
      radiusService.getSessionByClientId.mockResolvedValue(null);

      const result = await diagnosticEngineService.generateSupportResponse({
        orgId: 1, clientId: 10, conversationId: 1, content,
      });

      expect(storedSymptom(dbMock)).toBe(expectedSymptom);
      expect(typeof result.reply).toBe('string');
      expect(result.reply.length).toBeGreaterThan(0);
    });
  });
});
