// =============================================================================
// FireISP 5.0 — Validation Schemas for Missing Routes
// =============================================================================
// Tests the 11 new validation schema files added for routes that previously
// lacked schemas: paymentTransactions, auditLogs, connectionLogs, dashboard,
// events, export, metrics, networkHealth, pdf, revenueSummary, satCatalogs.
// =============================================================================

const schemaModules = {
  paymentTransactions: {
    path: '../src/middleware/schemas/paymentTransactions',
    expected: ['listPaymentTransactions'],
  },
  auditLogs: {
    path: '../src/middleware/schemas/auditLogs',
    expected: ['listAuditLogs'],
  },
  connectionLogs: {
    path: '../src/middleware/schemas/connectionLogs',
    expected: ['listConnectionLogs'],
  },
  dashboard: {
    path: '../src/middleware/schemas/dashboard',
    expected: ['summaryQuery', 'revenueQuery', 'overdueQuery'],
  },
  events: {
    path: '../src/middleware/schemas/events',
    expected: ['ticketStream'],
  },
  export: {
    path: '../src/middleware/schemas/export',
    expected: ['exportQuery'],
  },
  metrics: {
    path: '../src/middleware/schemas/metrics',
    expected: ['metricsQuery'],
  },
  networkHealth: {
    path: '../src/middleware/schemas/networkHealth',
    expected: ['listNetworkHealth'],
  },
  pdf: {
    path: '../src/middleware/schemas/pdf',
    expected: ['pdfById'],
  },
  revenueSummary: {
    path: '../src/middleware/schemas/revenueSummary',
    expected: ['listRevenueSummary'],
  },
  satCatalogs: {
    path: '../src/middleware/schemas/satCatalogs',
    expected: ['catalogSearch'],
  },
};

// ---------------------------------------------------------------------------
// Section 1: Verify all 11 schema files load without errors
// ---------------------------------------------------------------------------
describe('Missing Route Validation Schemas — Module Loading', () => {
  for (const [name, { path, expected }] of Object.entries(schemaModules)) {
    test(`${name} schema loads and exports expected keys`, () => {
      const mod = require(path);
      expect(mod).toBeDefined();
      for (const key of expected) {
        expect(mod).toHaveProperty(key);
        expect(typeof mod[key]).toBe('object');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Section 2: Validate representative schema shapes
// ---------------------------------------------------------------------------
describe('Missing Route Validation Schemas — Shape Verification', () => {
  test('paymentTransactions.listPaymentTransactions has gateway_status enum', () => {
    const { listPaymentTransactions } = require('../src/middleware/schemas/paymentTransactions');
    expect(listPaymentTransactions.gateway_status.enum).toContain('pending');
    expect(listPaymentTransactions.gateway_status.enum).toContain('succeeded');
    expect(listPaymentTransactions.gateway_status.enum).toContain('failed');
    expect(listPaymentTransactions.gateway_status.enum).toContain('refunded');
  });

  test('auditLogs.listAuditLogs has action enum', () => {
    const { listAuditLogs } = require('../src/middleware/schemas/auditLogs');
    expect(listAuditLogs.action.enum).toEqual(['create', 'update', 'delete']);
  });

  test('connectionLogs.listConnectionLogs has event_type enum', () => {
    const { listConnectionLogs } = require('../src/middleware/schemas/connectionLogs');
    expect(listConnectionLogs.event_type.enum).toContain('start');
    expect(listConnectionLogs.event_type.enum).toContain('stop');
  });

  test('connectionLogs.listConnectionLogs has ip_address field', () => {
    const { listConnectionLogs } = require('../src/middleware/schemas/connectionLogs');
    expect(listConnectionLogs.ip_address.type).toBe('string');
    expect(listConnectionLogs.ip_address.max).toBe(45);
  });

  test('dashboard schemas exist for all endpoints', () => {
    const dash = require('../src/middleware/schemas/dashboard');
    expect(dash.summaryQuery).toBeDefined();
    expect(dash.revenueQuery).toBeDefined();
    expect(dash.overdueQuery).toBeDefined();
  });

  test('events.ticketStream requires id', () => {
    const { ticketStream } = require('../src/middleware/schemas/events');
    expect(ticketStream.id.required).toBe(true);
    expect(ticketStream.id.type).toBe('number');
  });

  test('export.exportQuery has date range fields', () => {
    const { exportQuery } = require('../src/middleware/schemas/export');
    expect(exportQuery.date_from.type).toBe('string');
    expect(exportQuery.date_to.type).toBe('string');
    expect(exportQuery.currency.max).toBe(3);
  });

  test('networkHealth.listNetworkHealth has device_id and link_id', () => {
    const { listNetworkHealth } = require('../src/middleware/schemas/networkHealth');
    expect(listNetworkHealth.device_id.type).toBe('number');
    expect(listNetworkHealth.network_link_id.type).toBe('number');
  });

  test('pdf.pdfById requires numeric id', () => {
    const { pdfById } = require('../src/middleware/schemas/pdf');
    expect(pdfById.id.required).toBe(true);
    expect(pdfById.id.type).toBe('number');
    expect(pdfById.id.min).toBe(1);
  });

  test('revenueSummary.listRevenueSummary has currency field', () => {
    const { listRevenueSummary } = require('../src/middleware/schemas/revenueSummary');
    expect(listRevenueSummary.currency.max).toBe(3);
    expect(listRevenueSummary.period_date.type).toBe('string');
  });

  test('satCatalogs.catalogSearch has search field', () => {
    const { catalogSearch } = require('../src/middleware/schemas/satCatalogs');
    expect(catalogSearch.search.type).toBe('string');
    expect(catalogSearch.search.max).toBe(200);
  });
});
