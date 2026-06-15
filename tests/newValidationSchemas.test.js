// =============================================================================
// FireISP 5.0 — New Validation Schemas Unit Tests
// =============================================================================
// Tests all 38 new validation schema files for correctness.
// =============================================================================

const { validate } = require('../src/middleware/validate');

function run(schema, body) {
  const req = { body };
  const res = {};
  const next = jest.fn();
  validate(schema)(req, res, next);
  return next;
}

function expectReject(next) {
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
}

function expectPass(next) {
  expect(next).toHaveBeenCalledWith();
}

function errorFields(next) {
  return next.mock.calls[0][0].details.map(e => e.field);
}

// =============================================================================
// Section 1: Verify all 38 schema files load without errors & export expected keys
// =============================================================================

const schemaModules = {
  organizations: { path: '../src/middleware/schemas/organizations', expected: ['createOrganization', 'updateOrganization', 'updateSetting'] },
  users: { path: '../src/middleware/schemas/users', expected: ['createUser', 'updateUser'] },
  sites: { path: '../src/middleware/schemas/sites', expected: ['createSite', 'updateSite'] },
  nas: { path: '../src/middleware/schemas/nas', expected: ['createNas', 'updateNas'] },
  radius: { path: '../src/middleware/schemas/radius', expected: ['createRadius', 'updateRadius'] },
  creditNotes: { path: '../src/middleware/schemas/creditNotes', expected: ['createCreditNote', 'updateCreditNote', 'createCreditNoteItem'] },
  jobs: { path: '../src/middleware/schemas/jobs', expected: ['createJob', 'updateJob'] },
  warehouses: { path: '../src/middleware/schemas/warehouses', expected: ['createWarehouse', 'updateWarehouse'] },
  inventory: { path: '../src/middleware/schemas/inventory', expected: ['createInventoryItem', 'updateInventoryItem', 'createInventoryTransaction'] },
  quotes: { path: '../src/middleware/schemas/quotes', expected: ['createQuote', 'updateQuote', 'createQuoteItem'] },
  expenses: { path: '../src/middleware/schemas/expenses', expected: ['createExpense', 'updateExpense'] },
  outages: { path: '../src/middleware/schemas/outages', expected: ['createOutage', 'updateOutage'] },
  roles: { path: '../src/middleware/schemas/roles', expected: ['createRole', 'updateRole', 'assignPermission'] },
  apiTokens: { path: '../src/middleware/schemas/apiTokens', expected: ['createApiToken', 'updateApiToken'] },
  slaDefinitions: { path: '../src/middleware/schemas/slaDefinitions', expected: ['createSlaDefinition', 'updateSlaDefinition'] },
  ipPools: { path: '../src/middleware/schemas/ipPools', expected: ['createIpPool', 'updateIpPool'] },
  ipAssignments: { path: '../src/middleware/schemas/ipAssignments', expected: ['createIpAssignment', 'updateIpAssignment'] },
  networkLinks: { path: '../src/middleware/schemas/networkLinks', expected: ['createNetworkLink', 'updateNetworkLink'] },
  vlans: { path: '../src/middleware/schemas/vlans', expected: ['createVlan', 'updateVlan'] },
  speedTests: { path: '../src/middleware/schemas/speedTests', expected: ['createSpeedTest', 'updateSpeedTest'] },
  snmpProfiles: { path: '../src/middleware/schemas/snmpProfiles', expected: ['createSnmpProfile', 'updateSnmpProfile', 'createSnmpProfileOid'] },
  settings: { path: '../src/middleware/schemas/settings', expected: ['updateSetting'] },
  files: { path: '../src/middleware/schemas/files', expected: ['createFile', 'updateFile'] },
  serviceAreas: { path: '../src/middleware/schemas/serviceAreas', expected: ['createServiceArea', 'updateServiceArea'] },
  coverageZones: { path: '../src/middleware/schemas/coverageZones', expected: ['createCoverageZone', 'updateCoverageZone'] },
  webhooks: { path: '../src/middleware/schemas/webhooks', expected: ['createWebhook', 'updateWebhook'] },
  deviceConfigBackups: { path: '../src/middleware/schemas/deviceConfigBackups', expected: ['createDeviceConfigBackup', 'updateDeviceConfigBackup'] },
  paymentGateways: { path: '../src/middleware/schemas/paymentGateways', expected: ['createPaymentGateway', 'updatePaymentGateway'] },
  recurringPaymentProfiles: { path: '../src/middleware/schemas/recurringPaymentProfiles', expected: ['createRecurringPaymentProfile', 'updateRecurringPaymentProfile'] },
  suspensionRules: { path: '../src/middleware/schemas/suspensionRules', expected: ['createSuspensionRule', 'updateSuspensionRule'] },
  csdCertificates: { path: '../src/middleware/schemas/csdCertificates', expected: ['createCsdCertificate', 'updateCsdCertificate'] },
  pacProviders: { path: '../src/middleware/schemas/pacProviders', expected: ['createPacProvider', 'updatePacProvider'] },
  cfdiDocuments: { path: '../src/middleware/schemas/cfdiDocuments', expected: ['createCfdiDocument', 'updateCfdiDocument', 'cancelCfdiDocument'] },
  scheduledTasks: { path: '../src/middleware/schemas/scheduledTasks', expected: ['createScheduledTask', 'updateScheduledTask'] },
  concessionTitles: { path: '../src/middleware/schemas/concessionTitles', expected: ['createConcessionTitle', 'updateConcessionTitle'] },
  regulatoryFilings: { path: '../src/middleware/schemas/regulatoryFilings', expected: ['createRegulatoryFiling', 'updateRegulatoryFiling'] },
  iftStatisticalReports: { path: '../src/middleware/schemas/iftStatisticalReports', expected: ['createIftStatisticalReport', 'updateIftStatisticalReport'] },
  facturasPublicas: { path: '../src/middleware/schemas/facturasPublicas', expected: ['createFacturaPublica', 'updateFacturaPublica', 'addFacturaPublicaItem'] },
  promotions: { path: '../src/middleware/schemas/promotions', expected: ['createPromotion', 'updatePromotion'] },
  taxRules: { path: '../src/middleware/schemas/taxRules', expected: ['createTaxRule', 'updateTaxRule'] },
  taxRates: { path: '../src/middleware/schemas/taxRates', expected: ['createTaxRate', 'updateTaxRate'] },
};

describe('Schema module loading & exports', () => {
  for (const [name, { path: modPath, expected }] of Object.entries(schemaModules)) {
    describe(name, () => {
      let mod;

      test('requires without error', () => {
        expect(() => { mod = require(modPath); }).not.toThrow();
      });

      test(`exports ${expected.join(', ')}`, () => {
        mod = require(modPath);
        for (const key of expected) {
          expect(mod).toHaveProperty(key);
          expect(typeof mod[key]).toBe('object');
        }
      });
    });
  }
});

// =============================================================================
// Section 2: Detailed validation tests — representative schemas per group
// =============================================================================

// --- Organizations ---
describe('Organization validation schemas', () => {
  const { createOrganization, updateOrganization, updateSetting } = require('../src/middleware/schemas/organizations');

  test('createOrganization requires name', () => {
    const next = run(createOrganization, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createOrganization rejects invalid locale', () => {
    const next = run(createOrganization, { name: 'Acme', locale: 'US' });
    expectReject(next);
  });

  test('createOrganization accepts valid data', () => {
    const next = run(createOrganization, { name: 'Acme ISP', locale: 'MX', email: 'info@acme.mx' });
    expectPass(next);
  });

  test('createOrganization rejects name > 255 chars', () => {
    const next = run(createOrganization, { name: 'A'.repeat(256) });
    expectReject(next);
  });

  test('updateOrganization allows partial updates', () => {
    const next = run(updateOrganization, { status: 'inactive' });
    expectPass(next);
  });

  test('updateOrganization rejects invalid status', () => {
    const next = run(updateOrganization, { status: 'deleted' });
    expectReject(next);
  });

  test('updateSetting requires value', () => {
    const next = run(updateSetting, {});
    expectReject(next);
    expect(errorFields(next)).toContain('value');
  });

  test('updateSetting accepts valid value', () => {
    const next = run(updateSetting, { value: 'dark_mode' });
    expectPass(next);
  });

  test('updateSetting rejects value > 5000 chars', () => {
    const next = run(updateSetting, { value: 'x'.repeat(5001) });
    expectReject(next);
  });
});

// --- Users ---
describe('User validation schemas', () => {
  const { createUser, updateUser } = require('../src/middleware/schemas/users');

  test('createUser requires first_name, last_name, email, password', () => {
    const next = run(createUser, {});
    const fields = errorFields(next);
    expect(fields).toContain('first_name');
    expect(fields).toContain('last_name');
    expect(fields).toContain('email');
    expect(fields).toContain('password');
  });

  test('createUser rejects invalid role', () => {
    const next = run(createUser, {
      first_name: 'John', last_name: 'Doe', email: 'john@test.com', password: 'securePass1', role: 'superadmin',
    });
    expectReject(next);
  });

  test('createUser accepts all valid roles', () => {
    for (const role of ['admin', 'billing', 'support', 'technician']) {
      const next = run(createUser, {
        first_name: 'John', last_name: 'Doe', email: 'john@test.com', password: 'securePass1', role,
      });
      expectPass(next);
    }
  });

  test('createUser rejects password < 8 chars', () => {
    const next = run(createUser, {
      first_name: 'John', last_name: 'Doe', email: 'john@test.com', password: 'short',
    });
    expectReject(next);
  });

  test('updateUser allows partial updates', () => {
    const next = run(updateUser, { first_name: 'Jane' });
    expectPass(next);
  });
});

// --- Sites ---
describe('Site validation schemas', () => {
  const { createSite, updateSite } = require('../src/middleware/schemas/sites');

  test('createSite requires name', () => {
    const next = run(createSite, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createSite rejects latitude > 90', () => {
    const next = run(createSite, { name: 'Tower-1', latitude: 91 });
    expectReject(next);
  });

  test('createSite rejects longitude < -180', () => {
    const next = run(createSite, { name: 'Tower-1', longitude: -181 });
    expectReject(next);
  });

  test('createSite accepts valid data with coords', () => {
    const next = run(createSite, { name: 'POP-Central', latitude: 19.43, longitude: -99.13, site_type: 'pop' });
    expectPass(next);
  });

  test('createSite rejects invalid site_type', () => {
    const next = run(createSite, { name: 'T1', site_type: 'headquarters' });
    expectReject(next);
  });

  test('updateSite allows partial updates', () => {
    const next = run(updateSite, { status: 'inactive' });
    expectPass(next);
  });
});

// --- NAS ---
describe('NAS validation schemas', () => {
  const { createNas, updateNas } = require('../src/middleware/schemas/nas');

  test('createNas requires name, ip_address, secret', () => {
    const next = run(createNas, {});
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('ip_address');
    expect(fields).toContain('secret');
  });

  test('createNas accepts valid data', () => {
    const next = run(createNas, { name: 'NAS-01', ip_address: '10.0.0.1', secret: 'mySecret123' });
    expectPass(next);
  });

  test('updateNas allows partial updates', () => {
    const next = run(updateNas, { status: 'inactive' });
    expectPass(next);
  });
});

// --- RADIUS ---
describe('RADIUS validation schemas', () => {
  const { createRadius, updateRadius } = require('../src/middleware/schemas/radius');

  test('createRadius requires client_id, username, password', () => {
    const next = run(createRadius, {});
    const fields = errorFields(next);
    expect(fields).toContain('client_id');
    expect(fields).toContain('username');
    expect(fields).toContain('password');
  });

  test('createRadius rejects invalid status', () => {
    const next = run(createRadius, {
      client_id: 1, username: 'user1', password: 'pass123', status: 'deleted',
    });
    expectReject(next);
  });

  test('createRadius accepts valid statuses', () => {
    for (const status of ['active', 'inactive', 'suspended']) {
      const next = run(createRadius, { client_id: 1, username: 'user1', password: 'pass123', status });
      expectPass(next);
    }
  });

  test('updateRadius allows partial updates', () => {
    const next = run(updateRadius, { profile: 'premium' });
    expectPass(next);
  });
});

// --- Credit Notes ---
describe('CreditNote validation schemas', () => {
  const { createCreditNote, updateCreditNote, createCreditNoteItem } = require('../src/middleware/schemas/creditNotes');

  test('createCreditNote requires client_id', () => {
    const next = run(createCreditNote, {});
    expectReject(next);
    expect(errorFields(next)).toContain('client_id');
  });

  test('createCreditNote rejects invalid reason', () => {
    const next = run(createCreditNote, { client_id: 1, reason: 'customer_request' });
    expectReject(next);
  });

  test('createCreditNote rejects tax_rate > 1', () => {
    const next = run(createCreditNote, { client_id: 1, tax_rate: 1.5 });
    expectReject(next);
  });

  test('createCreditNote accepts valid data', () => {
    const next = run(createCreditNote, { client_id: 1, reason: 'billing_error', total: 100 });
    expectPass(next);
  });

  test('createCreditNoteItem requires description, quantity, unit_price, amount', () => {
    const next = run(createCreditNoteItem, {});
    const fields = errorFields(next);
    expect(fields).toContain('description');
    expect(fields).toContain('quantity');
    expect(fields).toContain('unit_price');
    expect(fields).toContain('amount');
  });

  test('updateCreditNote allows partial updates', () => {
    const next = run(updateCreditNote, { status: 'applied' });
    expectPass(next);
  });
});

// --- Jobs ---
describe('Job validation schemas', () => {
  const { createJob, updateJob } = require('../src/middleware/schemas/jobs');

  test('createJob requires title', () => {
    const next = run(createJob, {});
    expectReject(next);
    expect(errorFields(next)).toContain('title');
  });

  test('createJob rejects invalid type', () => {
    const next = run(createJob, { title: 'Install', type: 'deployment' });
    expectReject(next);
  });

  test('createJob accepts valid data', () => {
    const next = run(createJob, { title: 'Install FTTH', type: 'installation', priority: 'high' });
    expectPass(next);
  });

  test('updateJob allows partial updates', () => {
    const next = run(updateJob, { status: 'completed' });
    expectPass(next);
  });
});

// --- Warehouses ---
describe('Warehouse validation schemas', () => {
  const { createWarehouse, updateWarehouse } = require('../src/middleware/schemas/warehouses');

  test('createWarehouse requires name', () => {
    const next = run(createWarehouse, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createWarehouse accepts valid data', () => {
    const next = run(createWarehouse, { name: 'Main Warehouse', city: 'CDMX' });
    expectPass(next);
  });

  test('updateWarehouse allows partial updates', () => {
    const next = run(updateWarehouse, { status: 'inactive' });
    expectPass(next);
  });
});

// --- Inventory ---
describe('Inventory validation schemas', () => {
  const { createInventoryItem, updateInventoryItem, createInventoryTransaction } = require('../src/middleware/schemas/inventory');

  test('createInventoryItem requires name', () => {
    const next = run(createInventoryItem, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createInventoryItem rejects invalid category', () => {
    const next = run(createInventoryItem, { name: 'Cable', category: 'radio' });
    expectReject(next);
  });

  test('createInventoryItem accepts valid categories', () => {
    for (const category of ['router', 'olt', 'onu', 'cable', 'sfp', 'other']) {
      const next = run(createInventoryItem, { name: 'Item', category });
      expectPass(next);
    }
  });

  test('createInventoryTransaction requires item_id, warehouse_id, transaction_type, quantity', () => {
    const next = run(createInventoryTransaction, {});
    const fields = errorFields(next);
    expect(fields).toContain('item_id');
    expect(fields).toContain('warehouse_id');
    expect(fields).toContain('transaction_type');
    expect(fields).toContain('quantity');
  });

  test('createInventoryTransaction rejects invalid transaction_type', () => {
    const next = run(createInventoryTransaction, {
      item_id: 1, warehouse_id: 1, transaction_type: 'borrow', quantity: 5,
    });
    expectReject(next);
  });

  test('updateInventoryItem allows partial updates', () => {
    const next = run(updateInventoryItem, { unit_price: 299 });
    expectPass(next);
  });
});

// --- Quotes ---
describe('Quote validation schemas', () => {
  const { createQuote, updateQuote, createQuoteItem } = require('../src/middleware/schemas/quotes');

  test('createQuote requires client_id', () => {
    const next = run(createQuote, {});
    expectReject(next);
    expect(errorFields(next)).toContain('client_id');
  });

  test('createQuote rejects invalid status', () => {
    const next = run(createQuote, { client_id: 1, status: 'archived' });
    expectReject(next);
  });

  test('createQuote accepts valid data', () => {
    const next = run(createQuote, { client_id: 1, status: 'draft', total: 1000 });
    expectPass(next);
  });

  test('createQuoteItem requires description, quantity, unit_price, amount', () => {
    const next = run(createQuoteItem, {});
    const fields = errorFields(next);
    expect(fields).toContain('description');
    expect(fields).toContain('quantity');
    expect(fields).toContain('unit_price');
    expect(fields).toContain('amount');
  });

  test('updateQuote allows partial updates', () => {
    const next = run(updateQuote, { status: 'accepted' });
    expectPass(next);
  });
});

// --- Expenses ---
describe('Expense validation schemas', () => {
  const { createExpense, updateExpense } = require('../src/middleware/schemas/expenses');

  test('createExpense requires category and amount', () => {
    const next = run(createExpense, {});
    const fields = errorFields(next);
    expect(fields).toContain('category');
    expect(fields).toContain('amount');
  });

  test('createExpense rejects invalid status', () => {
    const next = run(createExpense, { category: 'office', amount: 500, status: 'paid' });
    expectReject(next);
  });

  test('createExpense accepts valid data', () => {
    const next = run(createExpense, { category: 'office', amount: 500, status: 'pending' });
    expectPass(next);
  });

  test('createExpense rejects currency > 3 chars', () => {
    const next = run(createExpense, { category: 'office', amount: 100, currency: 'USDX' });
    expectReject(next);
  });

  test('updateExpense allows partial updates', () => {
    const next = run(updateExpense, { status: 'approved' });
    expectPass(next);
  });
});

// --- Outages ---
describe('Outage validation schemas', () => {
  const { createOutage, updateOutage } = require('../src/middleware/schemas/outages');

  test('createOutage requires title', () => {
    const next = run(createOutage, {});
    expectReject(next);
    expect(errorFields(next)).toContain('title');
  });

  test('createOutage rejects invalid severity', () => {
    const next = run(createOutage, { title: 'Fiber cut', severity: 'extreme' });
    expectReject(next);
  });

  test('createOutage accepts all severities', () => {
    for (const severity of ['minor', 'major', 'critical']) {
      const next = run(createOutage, { title: 'Outage', started_at: '2026-01-01T00:00:00Z', severity });
      expectPass(next);
    }
  });

  test('updateOutage allows partial updates', () => {
    const next = run(updateOutage, { status: 'resolved' });
    expectPass(next);
  });
});

// --- Roles ---
describe('Role validation schemas', () => {
  const { createRole, updateRole, assignPermission } = require('../src/middleware/schemas/roles');

  test('createRole requires name', () => {
    const next = run(createRole, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createRole rejects name > 100 chars', () => {
    const next = run(createRole, { name: 'R'.repeat(101) });
    expectReject(next);
  });

  test('createRole accepts valid data', () => {
    const next = run(createRole, { name: 'Network Admin', description: 'Manages network devices' });
    expectPass(next);
  });

  test('assignPermission requires permission_id', () => {
    const next = run(assignPermission, {});
    expectReject(next);
    expect(errorFields(next)).toContain('permission_id');
  });

  test('assignPermission rejects permission_id < 1', () => {
    const next = run(assignPermission, { permission_id: 0 });
    expectReject(next);
  });

  test('updateRole allows partial updates', () => {
    const next = run(updateRole, { description: 'Updated desc' });
    expectPass(next);
  });
});

// --- API Tokens ---
describe('ApiToken validation schemas', () => {
  const { createApiToken, updateApiToken } = require('../src/middleware/schemas/apiTokens');

  test('createApiToken requires name', () => {
    const next = run(createApiToken, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createApiToken accepts valid data', () => {
    const next = run(createApiToken, { name: 'CI Token', scopes: ['clients:read', 'invoices:write'] });
    expectPass(next);
  });

  test('createApiToken rejects scopes as non-array', () => {
    const next = run(createApiToken, { name: 'Token', scopes: 'clients:read' });
    expectReject(next);
  });

  test('updateApiToken allows partial updates', () => {
    const next = run(updateApiToken, { revoked_at: '2026-01-01' });
    expectPass(next);
  });
});

// --- SLA Definitions ---
describe('SlaDefinition validation schemas', () => {
  const { createSlaDefinition, updateSlaDefinition } = require('../src/middleware/schemas/slaDefinitions');

  test('createSlaDefinition requires name', () => {
    const next = run(createSlaDefinition, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createSlaDefinition rejects uptime_pct > 100', () => {
    const next = run(createSlaDefinition, { name: 'Gold SLA', uptime_pct: 101 });
    expectReject(next);
  });

  test('createSlaDefinition rejects invalid measurement_period', () => {
    const next = run(createSlaDefinition, { name: 'SLA', measurement_period: 'weekly' });
    expectReject(next);
  });

  test('createSlaDefinition accepts valid data', () => {
    const next = run(createSlaDefinition, {
      name: 'Gold SLA', uptime_pct: 99.9, measurement_period: 'monthly',
      compensation_type: 'credit_percentage', priority: 'high',
    });
    expectPass(next);
  });

  test('updateSlaDefinition allows partial updates', () => {
    const next = run(updateSlaDefinition, { status: 'inactive' });
    expectPass(next);
  });
});

// --- IP Pools ---
describe('IpPool validation schemas', () => {
  const { createIpPool, updateIpPool } = require('../src/middleware/schemas/ipPools');

  test('createIpPool requires name and network', () => {
    const next = run(createIpPool, {});
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('network');
  });

  test('createIpPool rejects invalid ip_version', () => {
    const next = run(createIpPool, { name: 'Pool1', network: '10.0.0.0', ip_version: '5' });
    expectReject(next);
  });

  test('createIpPool accepts valid data', () => {
    const next = run(createIpPool, { name: 'Pool1', network: '10.0.0.0', ip_version: '4', gateway: '10.0.0.1' });
    expectPass(next);
  });

  test('updateIpPool allows partial updates', () => {
    const next = run(updateIpPool, { dns_primary: '8.8.8.8' });
    expectPass(next);
  });
});

// --- IP Assignments ---
describe('IpAssignment validation schemas', () => {
  const { createIpAssignment, updateIpAssignment } = require('../src/middleware/schemas/ipAssignments');

  test('createIpAssignment requires pool_id and ip_address', () => {
    const next = run(createIpAssignment, {});
    const fields = errorFields(next);
    expect(fields).toContain('pool_id');
    expect(fields).toContain('ip_address');
  });

  test('createIpAssignment rejects prefix_len > 128', () => {
    const next = run(createIpAssignment, { pool_id: 1, ip_address: '10.0.0.5', prefix_len: 129 });
    expectReject(next);
  });

  test('createIpAssignment rejects invalid type', () => {
    const next = run(createIpAssignment, { pool_id: 1, ip_address: '10.0.0.5', type: 'floating' });
    expectReject(next);
  });

  test('createIpAssignment accepts valid data', () => {
    const next = run(createIpAssignment, { pool_id: 1, ip_address: '10.0.0.5', type: 'static', prefix_len: 32 });
    expectPass(next);
  });

  test('updateIpAssignment allows partial updates', () => {
    const next = run(updateIpAssignment, { status: 'expired' });
    expectPass(next);
  });
});

// --- Network Links ---
describe('NetworkLink validation schemas', () => {
  const { createNetworkLink, updateNetworkLink } = require('../src/middleware/schemas/networkLinks');

  test('createNetworkLink requires device_a_id and device_b_id', () => {
    const next = run(createNetworkLink, {});
    const fields = errorFields(next);
    expect(fields).toContain('device_a_id');
    expect(fields).toContain('device_b_id');
  });

  test('createNetworkLink rejects invalid link_type', () => {
    const next = run(createNetworkLink, { device_a_id: 1, device_b_id: 2, link_type: 'satellite' });
    expectReject(next);
  });

  test('createNetworkLink accepts all valid link_types', () => {
    for (const link_type of ['fiber', 'wireless', 'copper', 'virtual', 'other']) {
      const next = run(createNetworkLink, { device_a_id: 1, device_b_id: 2, link_type });
      expectPass(next);
    }
  });

  test('updateNetworkLink allows partial updates', () => {
    const next = run(updateNetworkLink, { status: 'down' });
    expectPass(next);
  });
});

// --- VLANs ---
describe('VLAN validation schemas', () => {
  const { createVlan, updateVlan } = require('../src/middleware/schemas/vlans');

  test('createVlan requires vlan_id and name', () => {
    const next = run(createVlan, {});
    const fields = errorFields(next);
    expect(fields).toContain('vlan_id');
    expect(fields).toContain('name');
  });

  test('createVlan rejects vlan_id > 4094', () => {
    const next = run(createVlan, { vlan_id: 4095, name: 'VLAN-X' });
    expectReject(next);
  });

  test('createVlan rejects vlan_id < 1', () => {
    const next = run(createVlan, { vlan_id: 0, name: 'VLAN-0' });
    expectReject(next);
  });

  test('createVlan accepts valid data', () => {
    const next = run(createVlan, { vlan_id: 100, name: 'Management', status: 'active' });
    expectPass(next);
  });

  test('updateVlan allows partial updates', () => {
    const next = run(updateVlan, { status: 'deprecated' });
    expectPass(next);
  });
});

// --- Speed Tests ---
describe('SpeedTest validation schemas', () => {
  const { createSpeedTest, updateSpeedTest } = require('../src/middleware/schemas/speedTests');

  test('createSpeedTest requires download_mbps and upload_mbps', () => {
    const next = run(createSpeedTest, {});
    const fields = errorFields(next);
    expect(fields).toContain('download_mbps');
    expect(fields).toContain('upload_mbps');
  });

  test('createSpeedTest rejects packet_loss_pct > 100', () => {
    const next = run(createSpeedTest, { download_mbps: 50, upload_mbps: 10, packet_loss_pct: 101 });
    expectReject(next);
  });

  test('createSpeedTest rejects invalid test_source', () => {
    const next = run(createSpeedTest, { download_mbps: 50, upload_mbps: 10, test_source: 'manual' });
    expectReject(next);
  });

  test('createSpeedTest accepts valid data', () => {
    const next = run(createSpeedTest, {
      download_mbps: 100, upload_mbps: 25, latency_ms: 12, test_source: 'automated_probe',
    });
    expectPass(next);
  });

  test('updateSpeedTest allows partial updates', () => {
    const next = run(updateSpeedTest, { notes: 'Retested' });
    expectPass(next);
  });
});

// --- SNMP Profiles ---
describe('SnmpProfile validation schemas', () => {
  const { createSnmpProfile, updateSnmpProfile, createSnmpProfileOid } = require('../src/middleware/schemas/snmpProfiles');

  test('createSnmpProfile requires name', () => {
    const next = run(createSnmpProfile, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createSnmpProfile rejects invalid snmp_version', () => {
    const next = run(createSnmpProfile, { name: 'Profile', snmp_version: 'v4' });
    expectReject(next);
  });

  test('createSnmpProfile rejects poll_interval_sec < 10', () => {
    const next = run(createSnmpProfile, { name: 'Profile', poll_interval_sec: 5 });
    expectReject(next);
  });

  test('createSnmpProfile rejects poll_interval_sec > 86400', () => {
    const next = run(createSnmpProfile, { name: 'Profile', poll_interval_sec: 86401 });
    expectReject(next);
  });

  test('createSnmpProfile accepts valid data', () => {
    const next = run(createSnmpProfile, {
      name: 'Ubiquiti AC', device_type: 'outdoor_cpe', snmp_version: 'v2c', poll_interval_sec: 300,
    });
    expectPass(next);
  });

  test('createSnmpProfileOid requires oid and label', () => {
    const next = run(createSnmpProfileOid, {});
    const fields = errorFields(next);
    expect(fields).toContain('oid');
    expect(fields).toContain('label');
  });

  test('createSnmpProfileOid rejects invalid oid_type', () => {
    const next = run(createSnmpProfileOid, { oid: '1.3.6.1', label: 'uptime', oid_type: 'float' });
    expectReject(next);
  });

  test('updateSnmpProfile allows partial updates', () => {
    const next = run(updateSnmpProfile, { status: 'inactive' });
    expectPass(next);
  });
});

// --- Settings ---
describe('Settings validation schemas', () => {
  const { updateSetting } = require('../src/middleware/schemas/settings');

  test('updateSetting requires value', () => {
    const next = run(updateSetting, {});
    expectReject(next);
    expect(errorFields(next)).toContain('value');
  });

  test('updateSetting accepts valid data', () => {
    const next = run(updateSetting, { value: 'true', description: 'Enable feature' });
    expectPass(next);
  });

  test('updateSetting rejects value > 5000 chars', () => {
    const next = run(updateSetting, { value: 'x'.repeat(5001) });
    expectReject(next);
  });
});

// --- Files ---
describe('File validation schemas', () => {
  const { createFile, updateFile } = require('../src/middleware/schemas/files');

  test('createFile requires entity_type, entity_id, filename', () => {
    const next = run(createFile, {});
    const fields = errorFields(next);
    expect(fields).toContain('entity_type');
    expect(fields).toContain('entity_id');
    expect(fields).toContain('filename');
  });

  test('createFile rejects invalid entity_type', () => {
    const next = run(createFile, { entity_type: 'invoice', entity_id: 1, filename: 'doc.pdf' });
    expectReject(next);
  });

  test('createFile accepts valid data', () => {
    const next = run(createFile, {
      entity_type: 'device', entity_id: 5, filename: 'config.rsc', category: 'config_backup',
    });
    expectPass(next);
  });

  test('updateFile allows partial updates', () => {
    const next = run(updateFile, { notes: 'Updated file' });
    expectPass(next);
  });
});

// --- Service Areas ---
describe('ServiceArea validation schemas', () => {
  const { createServiceArea, updateServiceArea } = require('../src/middleware/schemas/serviceAreas');

  test('createServiceArea requires name', () => {
    const next = run(createServiceArea, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createServiceArea rejects invalid status', () => {
    const next = run(createServiceArea, { name: 'Area 1', status: 'disabled' });
    expectReject(next);
  });

  test('createServiceArea accepts valid data', () => {
    const next = run(createServiceArea, { name: 'Centro', status: 'active', color: '#FF0000' });
    expectPass(next);
  });

  test('updateServiceArea allows partial updates', () => {
    const next = run(updateServiceArea, { status: 'retired' });
    expectPass(next);
  });
});

// --- Coverage Zones ---
describe('CoverageZone validation schemas', () => {
  const { createCoverageZone, updateCoverageZone } = require('../src/middleware/schemas/coverageZones');

  test('createCoverageZone requires name', () => {
    const next = run(createCoverageZone, {});
    expectReject(next);
    expect(errorFields(next)).toContain('name');
  });

  test('createCoverageZone rejects invalid zone_type', () => {
    const next = run(createCoverageZone, { name: 'Z1', zone_type: 'dial_up' });
    expectReject(next);
  });

  test('createCoverageZone accepts all valid zone_types', () => {
    for (const zone_type of ['fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other']) {
      const next = run(createCoverageZone, { name: 'Zone', zone_type });
      expectPass(next);
    }
  });

  test('updateCoverageZone allows partial updates', () => {
    const next = run(updateCoverageZone, { status: 'degraded' });
    expectPass(next);
  });
});

// --- Webhooks ---
describe('Webhook validation schemas', () => {
  const { createWebhook, updateWebhook } = require('../src/middleware/schemas/webhooks');

  test('createWebhook requires url and events', () => {
    const next = run(createWebhook, {});
    const fields = errorFields(next);
    expect(fields).toContain('url');
    expect(fields).toContain('events');
  });

  test('createWebhook rejects max_retries > 10', () => {
    const next = run(createWebhook, {
      url: 'https://example.com/hook', events: 'invoice.created', max_retries: 11,
    });
    expectReject(next);
  });

  test('createWebhook rejects timeout_seconds > 60', () => {
    const next = run(createWebhook, {
      url: 'https://example.com/hook', events: 'invoice.created', timeout_seconds: 61,
    });
    expectReject(next);
  });

  test('createWebhook rejects timeout_seconds < 1', () => {
    const next = run(createWebhook, {
      url: 'https://example.com/hook', events: 'invoice.created', timeout_seconds: 0,
    });
    expectReject(next);
  });

  test('createWebhook accepts valid data', () => {
    const next = run(createWebhook, {
      url: 'https://example.com/hook', events: 'invoice.created,payment.received', max_retries: 3, timeout_seconds: 30,
    });
    expectPass(next);
  });

  test('updateWebhook allows partial updates', () => {
    const next = run(updateWebhook, { is_enabled: false });
    expectPass(next);
  });
});

// --- Device Config Backups ---
describe('DeviceConfigBackup validation schemas', () => {
  const { createDeviceConfigBackup, updateDeviceConfigBackup } = require('../src/middleware/schemas/deviceConfigBackups');

  test('createDeviceConfigBackup requires device_id and config_data', () => {
    const next = run(createDeviceConfigBackup, {});
    const fields = errorFields(next);
    expect(fields).toContain('device_id');
    expect(fields).toContain('config_data');
  });

  test('createDeviceConfigBackup rejects invalid config_type', () => {
    const next = run(createDeviceConfigBackup, {
      device_id: 1, config_data: '/ip address print', config_type: 'juniper_backup',
    });
    expectReject(next);
  });

  test('createDeviceConfigBackup accepts valid data', () => {
    const next = run(createDeviceConfigBackup, {
      device_id: 1, config_data: '/ip address print', config_type: 'mikrotik_export',
      capture_method: 'scheduled',
    });
    expectPass(next);
  });

  test('updateDeviceConfigBackup allows partial updates', () => {
    const next = run(updateDeviceConfigBackup, { version_label: 'v2' });
    expectPass(next);
  });
});

// --- Payment Gateways ---
describe('PaymentGateway validation schemas', () => {
  const { createPaymentGateway, updatePaymentGateway } = require('../src/middleware/schemas/paymentGateways');

  test('createPaymentGateway requires provider', () => {
    const next = run(createPaymentGateway, {});
    expectReject(next);
    expect(errorFields(next)).toContain('provider');
  });

  test('createPaymentGateway rejects invalid provider', () => {
    const next = run(createPaymentGateway, { provider: 'bitcoin' });
    expectReject(next);
  });

  test('createPaymentGateway rejects invalid environment', () => {
    const next = run(createPaymentGateway, { provider: 'stripe', environment: 'staging' });
    expectReject(next);
  });

  test('createPaymentGateway accepts valid data', () => {
    const next = run(createPaymentGateway, {
      provider: 'conekta', environment: 'sandbox', label: 'Conekta Test',
    });
    expectPass(next);
  });

  test('updatePaymentGateway allows partial updates', () => {
    const next = run(updatePaymentGateway, { status: 'inactive' });
    expectPass(next);
  });
});

// --- Recurring Payment Profiles ---
describe('RecurringPaymentProfile validation schemas', () => {
  const { createRecurringPaymentProfile, updateRecurringPaymentProfile } = require('../src/middleware/schemas/recurringPaymentProfiles');

  test('createRecurringPaymentProfile requires client_id, payment_gateway_id, token_reference', () => {
    const next = run(createRecurringPaymentProfile, {});
    const fields = errorFields(next);
    expect(fields).toContain('client_id');
    expect(fields).toContain('payment_gateway_id');
    expect(fields).toContain('token_reference');
  });

  test('createRecurringPaymentProfile rejects card_exp_month > 12', () => {
    const next = run(createRecurringPaymentProfile, {
      client_id: 1, payment_gateway_id: 1, token_reference: 'tok_abc123', card_exp_month: 13,
    });
    expectReject(next);
    expect(errorFields(next)).toContain('card_exp_month');
  });

  test('createRecurringPaymentProfile rejects card_exp_month < 1', () => {
    const next = run(createRecurringPaymentProfile, {
      client_id: 1, payment_gateway_id: 1, token_reference: 'tok_abc123', card_exp_month: 0,
    });
    expectReject(next);
    expect(errorFields(next)).toContain('card_exp_month');
  });

  test('createRecurringPaymentProfile rejects card_exp_year > 2099', () => {
    const next = run(createRecurringPaymentProfile, {
      client_id: 1, payment_gateway_id: 1, token_reference: 'tok_abc123', card_exp_year: 2100,
    });
    expectReject(next);
    expect(errorFields(next)).toContain('card_exp_year');
  });

  test('createRecurringPaymentProfile accepts valid data', () => {
    const next = run(createRecurringPaymentProfile, {
      client_id: 1, payment_gateway_id: 1, token_reference: 'tok_abc123',
      card_brand: 'visa', card_last_four: '4242',
      card_exp_month: 12, card_exp_year: 2028, is_default: true, status: 'active',
    });
    expectPass(next);
  });

  test('updateRecurringPaymentProfile allows partial updates', () => {
    const next = run(updateRecurringPaymentProfile, { status: 'revoked' });
    expectPass(next);
  });
});

// --- Suspension Rules ---
describe('SuspensionRule validation schemas', () => {
  const { createSuspensionRule, updateSuspensionRule } = require('../src/middleware/schemas/suspensionRules');

  test('createSuspensionRule requires name, days_past_due, action', () => {
    const next = run(createSuspensionRule, {});
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('days_past_due');
    expect(fields).toContain('action');
  });

  test('createSuspensionRule rejects invalid action', () => {
    const next = run(createSuspensionRule, { name: 'Rule 1', days_past_due: 30, action: 'delete_account' });
    expectReject(next);
  });

  test('createSuspensionRule rejects days_past_due < 1', () => {
    const next = run(createSuspensionRule, { name: 'Rule', days_past_due: 0, action: 'auto_suspend' });
    expectReject(next);
  });

  test('createSuspensionRule accepts valid data', () => {
    const next = run(createSuspensionRule, {
      name: '30-day suspend', days_past_due: 30, action: 'auto_suspend', notify_days_before: 5,
    });
    expectPass(next);
  });

  test('updateSuspensionRule allows partial updates', () => {
    const next = run(updateSuspensionRule, { is_enabled: false });
    expectPass(next);
  });
});

// --- CSD Certificates ---
describe('CsdCertificate validation schemas', () => {
  const { createCsdCertificate, updateCsdCertificate } = require('../src/middleware/schemas/csdCertificates');

  test('createCsdCertificate requires rfc, certificate_pem, private_key_encrypted', () => {
    const next = run(createCsdCertificate, {});
    const fields = errorFields(next);
    expect(fields).toContain('rfc');
    expect(fields).toContain('certificate_pem');
    expect(fields).toContain('private_key_encrypted');
  });

  test('createCsdCertificate rejects rfc < 12 chars', () => {
    const next = run(createCsdCertificate, {
      rfc: 'SHORT', certificate_pem: 'pem-data', private_key_encrypted: 'key-data',
    });
    expectReject(next);
  });

  test('createCsdCertificate rejects rfc > 13 chars', () => {
    const next = run(createCsdCertificate, {
      rfc: 'TOOLONGSTRING14', certificate_pem: 'pem-data', private_key_encrypted: 'key-data',
    });
    expectReject(next);
  });

  test('createCsdCertificate accepts valid 12/13 char rfc', () => {
    const next = run(createCsdCertificate, {
      rfc: 'XAXX010101AA', certificate_pem: 'pem-data', private_key_encrypted: 'key-data',
    });
    expectPass(next);

    const next13 = run(createCsdCertificate, {
      rfc: 'XAXX0101010A0', certificate_pem: 'pem-data', private_key_encrypted: 'key-data',
    });
    expectPass(next13);
  });

  test('updateCsdCertificate allows partial updates', () => {
    const next = run(updateCsdCertificate, { status: 'expired' });
    expectPass(next);
  });
});

// --- PAC Providers ---
describe('PacProvider validation schemas', () => {
  const { createPacProvider, updatePacProvider } = require('../src/middleware/schemas/pacProviders');

  test('createPacProvider requires provider_name', () => {
    const next = run(createPacProvider, {});
    expectReject(next);
    expect(errorFields(next)).toContain('provider_name');
  });

  test('createPacProvider rejects invalid provider_name', () => {
    const next = run(createPacProvider, { provider_name: 'custom_pac' });
    expectReject(next);
  });

  test('createPacProvider accepts all valid providers', () => {
    for (const prov of ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other']) {
      const next = run(createPacProvider, { provider_name: prov });
      expectPass(next);
    }
  });

  test('updatePacProvider allows partial updates', () => {
    const next = run(updatePacProvider, { status: 'inactive' });
    expectPass(next);
  });
});

// --- CFDI Documents ---
describe('CfdiDocument validation schemas', () => {
  const { createCfdiDocument, updateCfdiDocument, cancelCfdiDocument } = require('../src/middleware/schemas/cfdiDocuments');

  test('createCfdiDocument requires tipo_comprobante', () => {
    const next = run(createCfdiDocument, {});
    expectReject(next);
    expect(errorFields(next)).toContain('tipo_comprobante');
  });

  test('createCfdiDocument rejects invalid exportacion', () => {
    const next = run(createCfdiDocument, { tipo_comprobante: 'I', exportacion: '04' });
    expectReject(next);
  });

  test('createCfdiDocument accepts valid data', () => {
    const next = run(createCfdiDocument, {
      tipo_comprobante: 'I', exportacion: '01', moneda: 'MXN', total: 1160,
    });
    expectPass(next);
  });

  test('cancelCfdiDocument requires cancellation_reason', () => {
    const next = run(cancelCfdiDocument, {});
    expectReject(next);
    expect(errorFields(next)).toContain('cancellation_reason');
  });

  test('cancelCfdiDocument rejects invalid reason', () => {
    const next = run(cancelCfdiDocument, { cancellation_reason: '05' });
    expectReject(next);
  });

  test('cancelCfdiDocument accepts valid reason', () => {
    for (const reason of ['01', '02', '03', '04']) {
      const next = run(cancelCfdiDocument, { cancellation_reason: reason });
      expectPass(next);
    }
  });

  test('updateCfdiDocument allows partial updates', () => {
    const next = run(updateCfdiDocument, { notes: 'Updated' });
    expectPass(next);
  });
});

// --- Scheduled Tasks ---
describe('ScheduledTask validation schemas', () => {
  const { createScheduledTask, updateScheduledTask } = require('../src/middleware/schemas/scheduledTasks');

  test('createScheduledTask requires task_name, task_type, cron_expression', () => {
    const next = run(createScheduledTask, {});
    const fields = errorFields(next);
    expect(fields).toContain('task_name');
    expect(fields).toContain('task_type');
    expect(fields).toContain('cron_expression');
  });

  test('createScheduledTask rejects invalid task_type', () => {
    const next = run(createScheduledTask, {
      task_name: 'Nightly', task_type: 'backup', cron_expression: '0 0 * * *',
    });
    expectReject(next);
  });

  test('createScheduledTask accepts valid data', () => {
    const next = run(createScheduledTask, {
      task_name: 'Invoice Gen', task_type: 'generate_invoice', cron_expression: '0 3 1 * *',
      priority: 'high', is_enabled: true,
    });
    expectPass(next);
  });

  test('updateScheduledTask allows partial updates', () => {
    const next = run(updateScheduledTask, { is_enabled: false });
    expectPass(next);
  });
});

// --- Concession Titles ---
describe('ConcessionTitle validation schemas', () => {
  const { createConcessionTitle, updateConcessionTitle } = require('../src/middleware/schemas/concessionTitles');

  test('createConcessionTitle requires title_number', () => {
    const next = run(createConcessionTitle, {});
    expectReject(next);
    expect(errorFields(next)).toContain('title_number');
  });

  test('createConcessionTitle rejects invalid concession_type', () => {
    const next = run(createConcessionTitle, { title_number: 'CT-001', concession_type: 'military' });
    expectReject(next);
  });

  test('createConcessionTitle rejects invalid regulatory_body', () => {
    const next = run(createConcessionTitle, { title_number: 'CT-001', regulatory_body: 'FCC' });
    expectReject(next);
  });

  test('createConcessionTitle accepts valid data', () => {
    const next = run(createConcessionTitle, {
      title_number: 'CT-2024-001', concession_type: 'commercial', regulatory_body: 'IFT',
      status: 'active',
    });
    expectPass(next);
  });

  test('updateConcessionTitle allows partial updates', () => {
    const next = run(updateConcessionTitle, { status: 'pending_renewal' });
    expectPass(next);
  });
});

// --- Regulatory Filings ---
describe('RegulatoryFiling validation schemas', () => {
  const { createRegulatoryFiling, updateRegulatoryFiling } = require('../src/middleware/schemas/regulatoryFilings');

  test('createRegulatoryFiling requires filing_type', () => {
    const next = run(createRegulatoryFiling, {});
    expectReject(next);
    expect(errorFields(next)).toContain('filing_type');
  });

  test('createRegulatoryFiling rejects invalid filing_type', () => {
    const next = run(createRegulatoryFiling, { filing_type: 'tax_return' });
    expectReject(next);
  });

  test('createRegulatoryFiling accepts valid data', () => {
    const next = run(createRegulatoryFiling, {
      filing_type: 'annual_report', concession_title_id: 1, status: 'pending',
    });
    expectPass(next);
  });

  test('updateRegulatoryFiling allows partial updates', () => {
    const next = run(updateRegulatoryFiling, { status: 'filed' });
    expectPass(next);
  });
});

// --- IFT Statistical Reports ---
describe('IftStatisticalReport validation schemas', () => {
  const { createIftStatisticalReport, updateIftStatisticalReport } = require('../src/middleware/schemas/iftStatisticalReports');

  const validBase = {
    report_period: '2025-Q1',
    period_start: '2025-01-01',
    period_end: '2025-03-31',
  };

  test('createIftStatisticalReport requires report_period', () => {
    const next = run(createIftStatisticalReport, {});
    expectReject(next);
    expect(errorFields(next)).toContain('report_period');
  });

  test('createIftStatisticalReport requires period_start and period_end', () => {
    const next = run(createIftStatisticalReport, { report_period: '2025-Q1' });
    expectReject(next);
    const fields = errorFields(next);
    expect(fields).toContain('period_start');
    expect(fields).toContain('period_end');
  });

  test('createIftStatisticalReport rejects invalid status', () => {
    const next = run(createIftStatisticalReport, { ...validBase, status: 'pending' });
    expectReject(next);
  });

  test('createIftStatisticalReport rejects total_subscribers < 0', () => {
    const next = run(createIftStatisticalReport, { ...validBase, total_subscribers: -1 });
    expectReject(next);
  });

  test('createIftStatisticalReport rejects malformed report_period', () => {
    const next = run(createIftStatisticalReport, { ...validBase, report_period: '2025/Q1' });
    expectReject(next);
    expect(errorFields(next)).toContain('report_period');
  });

  test('createIftStatisticalReport rejects malformed period_start', () => {
    const next = run(createIftStatisticalReport, { ...validBase, period_start: '01-01-2025' });
    expectReject(next);
    expect(errorFields(next)).toContain('period_start');
  });

  test('createIftStatisticalReport accepts valid data with renamed fields', () => {
    const next = run(createIftStatisticalReport, {
      ...validBase,
      total_subscribers: 5000,
      avg_download_speed_mbps: 75.5,
      avg_upload_speed_mbps: 20,
      revenue_total: 500000,
      subscribers_by_state: '{"01":120,"02":340}',
      subscribers_by_municipality: '{"01001":50,"01002":70}',
      subscribers_by_customer_type: '{"residential":4500,"business":500}',
      subscribers_by_payment_modality: '{"pospago":4000,"prepago":1000}',
      coverage_localities: '["010010001","010020001"]',
      coverage_municipalities: 12,
      concession_title_id: 1,
      filing_id: 2,
      notes: 'Q1 2025 snapshot',
      status: 'draft',
    });
    expectPass(next);
  });

  test('updateIftStatisticalReport allows partial updates', () => {
    const next = run(updateIftStatisticalReport, { status: 'filed' });
    expectPass(next);
  });
});

// --- Facturas Públicas ---
describe('FacturaPublica validation schemas', () => {
  const { createFacturaPublica, updateFacturaPublica, addFacturaPublicaItem } = require('../src/middleware/schemas/facturasPublicas');

  test('createFacturaPublica requires periodicidad', () => {
    const next = run(createFacturaPublica, {});
    expectReject(next);
    expect(errorFields(next)).toContain('periodicidad');
  });

  test('createFacturaPublica rejects invalid periodicidad', () => {
    const next = run(createFacturaPublica, { periodicidad: '06' });
    expectReject(next);
  });

  test('createFacturaPublica rejects anio > 2099', () => {
    const next = run(createFacturaPublica, { periodicidad: '01', anio: 2100 });
    expectReject(next);
  });

  test('createFacturaPublica rejects anio < 2020', () => {
    const next = run(createFacturaPublica, { periodicidad: '01', anio: 2019 });
    expectReject(next);
  });

  test('createFacturaPublica accepts valid data', () => {
    const next = run(createFacturaPublica, {
      periodicidad: '02', meses: '01', anio: 2025, status: 'draft',
    });
    expectPass(next);
  });

  test('addFacturaPublicaItem requires invoice_id', () => {
    const next = run(addFacturaPublicaItem, {});
    expectReject(next);
    expect(errorFields(next)).toContain('invoice_id');
  });

  test('updateFacturaPublica allows partial updates', () => {
    const next = run(updateFacturaPublica, { status: 'stamped' });
    expectPass(next);
  });
});

// --- Promotions / Tax Rules / Tax Rates (M7) ---
describe('Promotion validation schemas', () => {
  const { createPromotion, updatePromotion } = require('../src/middleware/schemas/promotions');

  test('createPromotion requires name, discount_type, discount_value', () => {
    const next = run(createPromotion, {});
    expectReject(next);
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('discount_type');
    expect(fields).toContain('discount_value');
  });

  test('createPromotion rejects invalid discount_type', () => {
    const next = run(createPromotion, { name: 'Promo', discount_type: 'half_off', discount_value: 10 });
    expectReject(next);
  });

  test('createPromotion accepts valid data', () => {
    const next = run(createPromotion, {
      name: 'Summer Sale', code: 'SUMMER', discount_type: 'percentage',
      discount_value: 20, promotion_type: 'coupon', applies_to: 'invoice', is_active: true,
    });
    expectPass(next);
  });

  test('updatePromotion allows partial updates', () => {
    const next = run(updatePromotion, { is_active: false });
    expectPass(next);
  });
});

describe('Tax Rule validation schemas', () => {
  const { createTaxRule, updateTaxRule } = require('../src/middleware/schemas/taxRules');

  test('createTaxRule requires name and rate', () => {
    const next = run(createTaxRule, {});
    expectReject(next);
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('rate');
  });

  test('createTaxRule rejects invalid tax_type', () => {
    const next = run(createTaxRule, { name: 'IVA', rate: 0.16, tax_type: 'tariff' });
    expectReject(next);
  });

  test('createTaxRule rejects rate above 1', () => {
    const next = run(createTaxRule, { name: 'IVA', rate: 16 });
    expectReject(next);
  });

  test('createTaxRule accepts valid data', () => {
    const next = run(createTaxRule, { name: 'IVA 16%', region: 'MX', tax_type: 'vat', rate: 0.16, is_default: true, status: 'active' });
    expectPass(next);
  });
});

describe('Tax Rate validation schemas', () => {
  const { createTaxRate, updateTaxRate } = require('../src/middleware/schemas/taxRates');

  test('createTaxRate requires name and rate', () => {
    const next = run(createTaxRate, {});
    expectReject(next);
    const fields = errorFields(next);
    expect(fields).toContain('name');
    expect(fields).toContain('rate');
  });

  test('createTaxRate accepts valid data', () => {
    const next = run(createTaxRate, { name: 'IVA 16%', rate: 0.16, description: 'Standard MX VAT', is_default: true, status: 'active' });
    expectPass(next);
  });

  test('updateTaxRate allows partial updates', () => {
    const next = run(updateTaxRate, { status: 'inactive' });
    expectPass(next);
  });
});
