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
// Only mocked so the "runDiagnostic itself throws" test below can force a
// real, uncaught exception out of _storeRun's own catch block (its
// logger.warn call is the one call inside runDiagnostic() that isn't
// already defensively wrapped by a per-check try/catch — see that test for
// the full explanation). `child()` always returns the same object so a test
// can grab a handle to it and override `.warn` for a single call.
jest.mock('../src/utils/logger', () => {
  const sharedChildLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return {
    child: jest.fn(() => sharedChildLogger),
    warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(),
  };
});

const db = require('../src/config/database');
const radiusService = require('../src/services/radiusService');
const wirelessService = require('../src/services/wirelessService');
const mockLoggerModule = require('../src/utils/logger');
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

// ---------------------------------------------------------------------------
// SQL-text dispatch mock for the symptom='no_internet' + accessType='fiber'
// path (_diagNoInternetFiber) — needed for the escalate-set coverage below,
// since onu_status and account_suspension (unlike onu_signal) are only ever
// emitted by this handler, never _diagSlowFiber.
// ---------------------------------------------------------------------------
function makeNoInternetFiberDbMock({
  onuDeviceId = null,
  onuDetailsRow = null,
  accountRow = null, // { status, client_status }
} = {}) {
  return jest.fn((sql) => {
    if (/FROM devices\b/i.test(sql) && /type = 'onu'/i.test(sql)) {
      return Promise.resolve([onuDeviceId ? [{ id: onuDeviceId }] : [], undefined]);
    }
    if (/FROM cpe_devices/i.test(sql) && /d\.type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    if (/FROM cpe_devices/i.test(sql) && /indoor_cpe/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    if (/FROM onu_details/i.test(sql)) {
      return Promise.resolve([onuDetailsRow ? [onuDetailsRow] : [], undefined]);
    }
    // Account suspension: SELECT c.status, cl.status AS client_status FROM
    // contracts c JOIN clients cl ...
    if (/FROM contracts c/i.test(sql) && /JOIN clients/i.test(sql)) {
      return Promise.resolve([accountRow ? [accountRow] : [], undefined]);
    }
    if (/INSERT INTO ai_diagnostic_runs/i.test(sql)) {
      return Promise.resolve([{ insertId: 1 }, undefined]);
    }
    return Promise.resolve([[], undefined]);
  });
}

// ---------------------------------------------------------------------------
// SQL-text dispatch mock for the symptom='slow' + accessType='wireless' path
// (_diagSlowWireless) — needed for the cpe_signal escalation coverage below,
// since cpe_signal is only ever emitted by this handler.
// ---------------------------------------------------------------------------
function makeSlowWirelessDbMock({
  cpeDeviceId = null,
  wirelessSignalRow = null,
} = {}) {
  return jest.fn((sql) => {
    // No ONU for this client -> access-type inference falls through to CPE.
    if (/FROM devices\b/i.test(sql) && /type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    if (/FROM cpe_devices/i.test(sql) && /d\.type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    // CPE resolver (access-type inference AND _diagSlowWireless check 1).
    if (/FROM cpe_devices/i.test(sql) && /indoor_cpe/i.test(sql)) {
      return Promise.resolve([cpeDeviceId ? [{ device_id: cpeDeviceId }] : [], undefined]);
    }
    if (/FROM wireless_client_sessions/i.test(sql)) {
      return Promise.resolve([wirelessSignalRow ? [wirelessSignalRow] : [], undefined]);
    }
    if (/INSERT INTO ai_diagnostic_runs/i.test(sql)) {
      return Promise.resolve([{ insertId: 1 }, undefined]);
    }
    return Promise.resolve([[], undefined]);
  });
}

// ---------------------------------------------------------------------------
// SQL-text dispatch mock for the symptom='no_internet' + accessType='wireless'
// path (_diagNoInternetWireless) — needed for the cpe_status non-escalation
// coverage below (offline CPE must NOT escalate — see the binding product
// decision in diagnosticEngineService.js).
// ---------------------------------------------------------------------------
function makeNoInternetWirelessDbMock({
  cpeDeviceId = null,
  cpeStatusRow = null, // { status, device_id }
  wirelessSignalRow = null,
  clientStatusRow = null, // { status }
} = {}) {
  return jest.fn((sql) => {
    if (/FROM devices\b/i.test(sql) && /type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    if (/FROM cpe_devices/i.test(sql) && /d\.type = 'onu'/i.test(sql)) {
      return Promise.resolve([[], undefined]);
    }
    // CPE resolver (access-type inference AND area_outage's site lookup).
    if (/FROM cpe_devices/i.test(sql) && /indoor_cpe/i.test(sql)) {
      return Promise.resolve([cpeDeviceId ? [{ device_id: cpeDeviceId }] : [], undefined]);
    }
    // cpe_status check: SELECT cd.status, cd.device_id FROM cpe_devices cd ...
    // (no `indoor_cpe`/`d.type` — distinct query, no `devices` join).
    if (/FROM cpe_devices cd/i.test(sql) && /cd\.status/i.test(sql)) {
      return Promise.resolve([cpeStatusRow ? [cpeStatusRow] : [], undefined]);
    }
    if (/FROM wireless_client_sessions/i.test(sql)) {
      return Promise.resolve([wirelessSignalRow ? [wirelessSignalRow] : [], undefined]);
    }
    // account_suspension check: SELECT status FROM clients WHERE id = ?
    if (/FROM clients\b/i.test(sql)) {
      return Promise.resolve([clientStatusRow ? [clientStatusRow] : [], undefined]);
    }
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
  test('healthy case (FULL coverage, all ok): reassuring but specific, not escalated', async () => {
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
    // Every check is 'ok' here (full coverage) — the ONLY scenario allowed
    // to claim a clean bill of health.
    expect(result.diagnosticResult.checks.every(c => c.status === 'ok')).toBe(true);
    expect(result.reply).toMatch(/no encontramos problemas activos/i);
    expect(result.reply).toContain('reiniciar tu router'); // self-serve tip for 'slow'
    expect(result.diagnosticResult.confidence).toBe(1);
    expect(storedSymptom(dbMock)).toBe('slow');
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('partial coverage (some ok, some unknown, no error/warning): must NOT claim a clean bill of health', async () => {
    // Common real-world fiber shape: session/signal/alerts/account all check
    // out, but OLT port utilization can't be resolved (oltPortRow: null ->
    // olt_port status 'unknown') — one unresolved check alongside four 'ok'
    // checks is neither blind nor a full pass.
    const dbMock = makeDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'online', olt_port_id: 9, rx_power_dbm: -20, tx_power_dbm: 2 },
      oltPortRow: null, // -> olt_port: 'unknown'
      alertCount: 0,
      accountActive: true,
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.5' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'mi internet está muy lento',
    });

    const statuses = result.diagnosticResult.checks.map(c => c.status);
    expect(statuses).toContain('unknown');
    expect(statuses).toContain('ok');
    expect(statuses.every(s => s !== 'error' && s !== 'warning')).toBe(true);
    expect(result.escalate).toBe(false);

    // Must NOT assert a clean bill of health — coverage was incomplete.
    expect(result.reply).not.toMatch(/no encontramos problemas activos/i);
    // Must acknowledge the diagnostic didn't fully complete.
    expect(result.reply).toMatch(/no logramos comprobar todo el diagnóstico/i);
    expect(result.reply).toContain('reiniciar tu router'); // self-serve tip still offered
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('issue-found case: names the plain-language area, not the internal check name — escalates (onu_signal is a real ESCALATABLE check on its own)', async () => {
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
    // onu_signal 'error' (bad optical dBm) is one of exactly two checks in
    // ESCALATE_WHEN — a measured fiber-plant quality fault, escalates on its
    // own.
    expect(result.escalate).toBe(true);
    expect(result.escalationReason).toBe('Signal/optical quality degraded — technician recommended');
    // Escalating -> a real ticket IS created (see #400 wiring) -> this
    // "connecting you with our team" copy is truthful here.
    expect(result.reply).toMatch(/posible falla física/i);
    expect(result.reply).toMatch(/conectando con nuestro equipo/i);
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  // ---------------------------------------------------------------------------
  // ESCALATE_WHEN coverage on the no_internet/fiber path (_diagNoInternetFiber)
  // — offline/session/account checks are only ever emitted here, never by
  // _diagSlowFiber above. Product decision: offline/disconnected states are
  // NORMAL in this service area (frequent grid outages, no UPS) and must
  // never auto-dispatch a technician — only measured signal/optical QUALITY
  // degradation (onu_signal / cpe_signal) does.
  // ---------------------------------------------------------------------------
  test('no_internet fiber: onu_status error (ONU offline) does NOT escalate — offline is normal here (power outages, no UPS)', async () => {
    const dbMock = makeNoInternetFiberDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'offline', olt_port_id: 9, rx_power_dbm: -20, tx_power_dbm: 2 },
      accountRow: { status: 'active', client_status: 'active' },
    });
    db.query.mockImplementation(dbMock);
    // pppoe_session 'ok' so onu_status is isolated as the only error check.
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.5' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'no tengo internet',
    });

    expect(result.diagnosticResult.checks.find((c) => c.name === 'onu_status').status).toBe('error');
    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    // Not escalating -> no ticket -> must not promise a technician; falls to
    // the normal issue-found reply naming the ONU status check.
    expect(result.reply).not.toMatch(/posible falla física/i);
    expect(result.reply).not.toMatch(/conectando con nuestro equipo/i);
    expect(result.reply).toContain('el estado de tu equipo ONU');
  });

  test('no_internet wireless: cpe_status error (CPE offline) does NOT escalate — offline is normal here (power outages, no UPS)', async () => {
    const dbMock = makeNoInternetWirelessDbMock({
      cpeDeviceId: 7,
      cpeStatusRow: { status: 'offline', device_id: 7 },
      clientStatusRow: { status: 'active' },
    });
    db.query.mockImplementation(dbMock);
    // radius_session 'ok' so cpe_status is isolated as the only error check.
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.7' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'no tengo internet',
    });

    expect(result.diagnosticResult.checks.find((c) => c.name === 'cpe_status').status).toBe('error');
    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    expect(result.reply).not.toMatch(/posible falla física/i);
    expect(result.reply).not.toMatch(/conectando con nuestro equipo/i);
    expect(result.reply).toContain('el estado de tu equipo (router/CPE)');
  });

  test('no_internet fiber: pppoe_session error alone does NOT escalate (reboot-first, not a truck roll)', async () => {
    const dbMock = makeNoInternetFiberDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'online', olt_port_id: 9, rx_power_dbm: -20, tx_power_dbm: 2 },
      accountRow: { status: 'active', client_status: 'active' },
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockResolvedValue(null); // no session -> pppoe_session 'error'

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'no tengo internet',
    });

    expect(result.diagnosticResult.checks.find((c) => c.name === 'pppoe_session').status).toBe('error');
    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    // Not escalating -> no ticket -> the reply must offer the self-serve
    // reboot tip instead of promising a technician.
    expect(result.reply).not.toMatch(/conectando con nuestro equipo/i);
  });

  test('no_internet fiber: account_suspension error alone does NOT escalate (billing hold, not a truck roll)', async () => {
    const dbMock = makeNoInternetFiberDbMock({
      onuDeviceId: 5,
      onuDetailsRow: { onu_state: 'online', olt_port_id: 9, rx_power_dbm: -20, tx_power_dbm: 2 },
      accountRow: { status: 'active', client_status: 'suspended' },
    });
    db.query.mockImplementation(dbMock);
    radiusService.getSessionByClientId.mockResolvedValue({ framedipaddress: '10.0.0.5' });

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'no tengo internet',
    });

    expect(result.diagnosticResult.checks.find((c) => c.name === 'account_suspension').status).toBe('error');
    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    expect(result.reply).not.toMatch(/conectando con nuestro equipo/i);
  });

  test('wireless slow: cpe_signal warning (low signal, not error) DOES escalate — names only the degraded check, not a garbled all-checks dump', async () => {
    const dbMock = makeSlowWirelessDbMock({
      cpeDeviceId: 7,
      wirelessSignalRow: { signal_dbm: -80, noise_floor_dbm: -95, ccq_pct: 60 }, // <= -75 -> 'warning', not 'error'
    });
    db.query.mockImplementation(dbMock);
    wirelessService.getInterferenceReport.mockResolvedValue([]); // channel_interference -> 'ok'
    radiusService.getSessionByClientId.mockResolvedValue({ acctstarttime: '2026-01-01' }); // radius_session -> 'ok'

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'la velocidad está muy lenta',
    });

    expect(result.diagnosticResult.checks.find((c) => c.name === 'cpe_signal').status).toBe('warning');
    // cpe_signal 'warning' is the other of exactly two ESCALATE_WHEN entries
    // — a measured wireless quality fault escalates even though its status
    // is 'warning', not 'error' (see the binding product decision).
    expect(result.escalate).toBe(true);
    expect(result.escalationReason).toBe('Signal/optical quality degraded — technician recommended');
    expect(result.reply).toMatch(/posible falla física/i);
    expect(result.reply).toMatch(/conectando con nuestro equipo/i);
    // Names exactly the check that triggered escalation...
    expect(result.reply).toContain('la señal de tu equipo (router/CPE)');
    // ...never a dump of every check (this is a 'warning', not an 'error',
    // so the old errorChecks-based naming would have found nothing and
    // fallen back to ALL checks, including the unrelated 'unknown' ones).
    expect(result.reply).not.toContain('la carga de la antena');
    expect(result.reply).not.toContain('tu consumo de datos');
    expect(result.reply).not.toContain('interferencia en el canal inalámbrico');
    expect(result.reply).not.toContain('tu sesión de conexión');
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
    expect(result.reply).toMatch(/no pudimos completar el diagnóstico automático/i);
    expect(result.reply).not.toMatch(/no encontramos problemas activos/i); // never a fake clean bill of health
    // FIX 2: must not assert a specific cause it doesn't actually know.
    expect(result.reply).not.toMatch(/monitoreo no respondieron/i);
    expect(result.reply).not.toContain('(nuestros sistemas de monitoreo no respondieron)');
    // FIX 3: escalate is false here -> no ticket exists -> must not promise
    // a human has been tasked to review it.
    expect(result.reply).not.toMatch(/técnico lo revise/i);
    expect(result.reply).not.toMatch(/registramos tu reporte/i);
    expect(result.escalate).toBe(false);
    for (const s of ENGLISH_INTERNAL_STRINGS) expect(result.reply).not.toContain(s);
  });

  test('runDiagnostic failure is caught: reply is the safe fallback, escalate:false, no throw', async () => {
    // Every check-level query inside every diagnostic handler is
    // individually try/caught by design (see file header) and swallows into
    // status:'unknown' without logging, so a total DB outage alone can't
    // make runDiagnostic() itself reject (see the next test for the one
    // call that CAN). This test instead asserts the weaker but still real
    // property: generateSupportResponse never throws given a maximally
    // hostile db mock (every query rejects) — it degrades to the honest
    // fully-blind reply instead.
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

  test('generateSupportResponse catch path (runDiagnostic itself throws): honest reply, no technician-tasked promise', async () => {
    // The ONE call inside runDiagnostic() that isn't already defensively
    // wrapped by a per-check try/catch is _storeRun's own logger.warn call
    // on a DB failure (_storeRun's catch logs and swallows — but a throw
    // FROM WITHIN that catch handler is not caught by the same try/catch,
    // and propagates out of runDiagnostic() as a real rejection). Forcing
    // logger.warn to throw exactly once is the one legitimate way to
    // exercise generateSupportResponse's own outer catch for real, rather
    // than asserting a string that's never actually reached at runtime.
    const childLogger = mockLoggerModule.child();
    childLogger.warn.mockImplementationOnce(() => { throw new Error('logger transport failure'); });

    db.query.mockImplementation((sql) => {
      if (/INSERT INTO ai_diagnostic_runs/i.test(sql)) return Promise.reject(new Error('db down for audit insert'));
      return Promise.resolve([[], undefined]);
    });
    radiusService.getSessionByClientId.mockResolvedValue(null);

    const result = await diagnosticEngineService.generateSupportResponse({
      orgId: 1, clientId: 10, conversationId: 1, content: 'está lento',
    });

    expect(result.escalate).toBe(false);
    expect(result.escalationReason).toBeNull();
    expect(result.diagnosticResult).toBeNull();
    expect(result.reply).toMatch(/no pudimos completar el diagnóstico automático/i);
    // Coordinator follow-up (FIX 3 extended to this path): must not promise
    // a technician has been tasked — escalate is always false here, so no
    // ticket exists to back that promise.
    expect(result.reply).not.toMatch(/técnico lo revisará/i);
    expect(result.reply).not.toMatch(/registramos tu reporte/i);
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
