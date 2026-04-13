// =============================================================================
// FireISP 5.0 — E2E Workflow: Alert → Outage → Notification
// =============================================================================
// Tests the full monitoring pipeline: device goes offline → alert rule triggers →
// outage auto-created → notification dispatched via event bus.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const alertService = require('../src/services/alertService');
const eventBus = require('../src/services/eventBus');

describe('E2E Workflow: Alert → Outage → Notification', () => {
  const ORG = 1;
  let alertEvents;

  beforeEach(() => {
    jest.clearAllMocks();
    alertEvents = [];
    eventBus.removeAllListeners();
    eventBus.on('alert.triggered', (data) => alertEvents.push(data));
  });

  afterAll(() => { eventBus.removeAllListeners(); });

  test('evaluates alert rules and triggers events for breached thresholds', async () => {
    // Active rule: CPU > 90%
    const rule = {
      id: 1,
      organization_id: ORG,
      name: 'High CPU',
      metric: 'cpu_usage',
      operator: '>',
      threshold: 90,
      is_enabled: true,
      auto_create_outage: true,
      severity: 'critical',
    };

    // Latest SNMP metric shows CPU at 95%
    const metricRow = {
      device_id: 42,
      avg_value: 95,
      max_value: 97,
    };

    // Mock: get active rules, SNMP query, record alert, outage
    db.query
      .mockResolvedValueOnce([[rule]])           // SELECT alert_rules
      .mockResolvedValueOnce([[metricRow]])       // SELECT SNMP metric for checkRule
      .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT alert_event (recordAlert)
      .mockResolvedValueOnce([{ insertId: 1 }]); // INSERT outage (autoCreateOutage)

    const result = await alertService.evaluateAlerts(ORG);

    // evaluateAlerts returns {evaluated, triggered, alerts}
    expect(result).toBeDefined();
    expect(result.evaluated).toBe(1);
    expect(result.triggered).toBe(1);
    expect(result.alerts.length).toBe(1);
    expect(result.alerts[0].rule_id).toBe(1);

    // Event bus should have emitted alert.triggered
    expect(alertEvents.length).toBe(1);
    expect(alertEvents[0].rule.name).toBe('High CPU');
    expect(alertEvents[0].organizationId).toBe(ORG);
  });

  test('does not trigger alert when metric is within threshold', async () => {
    const rule = {
      id: 2,
      organization_id: ORG,
      name: 'Low Signal',
      metric: 'signal_strength',
      operator: '<',
      threshold: -80,
      is_enabled: true,
      auto_create_outage: false,
    };

    // Signal avg is -60 (good, not below -80)
    const metricRow = { device_id: 10, avg_value: -60, max_value: -55 };

    db.query
      .mockResolvedValueOnce([[rule]])        // rules
      .mockResolvedValueOnce([[metricRow]]);   // SNMP metric

    const result = await alertService.evaluateAlerts(ORG);
    expect(result.triggered).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(alertEvents.length).toBe(0);
  });

  test('handles no active rules gracefully', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await alertService.evaluateAlerts(ORG);
    expect(result).toEqual({ evaluated: 0, triggered: 0, alerts: [] });
  });
});

describe('E2E Workflow: Event Bus Fan-Out', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  afterAll(() => { eventBus.removeAllListeners(); });

  test('multiple listeners receive the same event', async () => {
    const received = [];
    eventBus.on('device.offline', (data) => received.push({ handler: 'A', ...data }));
    eventBus.on('device.offline', (data) => received.push({ handler: 'B', ...data }));

    await eventBus.emit('device.offline', { deviceId: 99, organizationId: 1 });

    expect(received.length).toBe(2);
    expect(received[0].handler).toBe('A');
    expect(received[1].handler).toBe('B');
    expect(received[0].deviceId).toBe(99);
  });

  test('wildcard listener receives all events', async () => {
    const all = [];
    eventBus.on('*', (data) => all.push(data));

    await eventBus.emit('invoice.created', { invoiceId: 1 });
    await eventBus.emit('payment.received', { paymentId: 2 });

    expect(all.length).toBe(2);
    expect(all[0].event).toBe('invoice.created');
    expect(all[1].event).toBe('payment.received');
  });

  test('handler errors do not propagate to caller', async () => {
    eventBus.on('test.error', () => { throw new Error('handler fail'); });

    // Should not throw
    await expect(eventBus.emit('test.error', {})).resolves.not.toThrow();
  });
});
