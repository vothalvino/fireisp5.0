// =============================================================================
// FireISP 5.0 - Remaining Model Unit Tests
// =============================================================================
// Covers the 26 thin BaseModel subclasses that have no other test coverage.
// Each model is verified for: tableName, fillable array, hasOrgScope, and the
// optional softDelete flag where it exists.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const BillingPeriod          = require('../src/models/BillingPeriod');
const CfdiConcepto           = require('../src/models/CfdiConcepto');
const CfdiPaymentComplement  = require('../src/models/CfdiPaymentComplement');
const CfdiRelatedDocument    = require('../src/models/CfdiRelatedDocument');
const ClientMxProfile        = require('../src/models/ClientMxProfile');
const ContractAddon          = require('../src/models/ContractAddon');
const ContractTemplateMx     = require('../src/models/ContractTemplateMx');
const CreditNoteItem         = require('../src/models/CreditNoteItem');
const FacturaPublicaInvoice  = require('../src/models/FacturaPublicaInvoice');
const FacturaPublicaInvoiceItem = require('../src/models/FacturaPublicaInvoiceItem');
const InventoryStock         = require('../src/models/InventoryStock');
const InventoryTransaction   = require('../src/models/InventoryTransaction');
const InvoiceItem            = require('../src/models/InvoiceItem');
const NetworkHealthSnapshot  = require('../src/models/NetworkHealthSnapshot');
const OrganizationMxProfile  = require('../src/models/OrganizationMxProfile');
const OrganizationUser       = require('../src/models/OrganizationUser');
const PlanAddon              = require('../src/models/PlanAddon');
const Promotion              = require('../src/models/Promotion');
const QuoteItem              = require('../src/models/QuoteItem');
const RevenueSummary         = require('../src/models/RevenueSummary');
const RolePermission         = require('../src/models/RolePermission');
const SnmpMetric             = require('../src/models/SnmpMetric');
const SnmpProfileOid         = require('../src/models/SnmpProfileOid');
const TaxRate                = require('../src/models/TaxRate');
const TaxRule                = require('../src/models/TaxRule');
const TicketSlaEvent         = require('../src/models/TicketSlaEvent');

// Helper: assert common model properties
function expectModel(Model, { tableName, fillableIncludes, hasOrgScope, softDelete = false }) {
  expect(Model.tableName).toBe(tableName);
  expect(Model.hasOrgScope).toBe(hasOrgScope);
  expect(Model.softDelete).toBe(softDelete);
  for (const field of fillableIncludes) {
    expect(Model.fillable).toContain(field);
  }
}

describe('BillingPeriod', () => {
  test('has correct metadata', () => {
    expectModel(BillingPeriod, {
      tableName: 'billing_periods',
      fillableIncludes: ['organization_id', 'contract_id', 'period_start', 'period_end', 'invoice_id', 'status'],
      hasOrgScope: true,
    });
  });
});

describe('CfdiConcepto', () => {
  test('has correct metadata', () => {
    expectModel(CfdiConcepto, {
      tableName: 'cfdi_conceptos',
      fillableIncludes: ['cfdi_document_id', 'clave_prod_serv', 'descripcion', 'valor_unitario', 'importe'],
      hasOrgScope: false,
    });
  });
});

describe('CfdiPaymentComplement', () => {
  test('has correct metadata', () => {
    expectModel(CfdiPaymentComplement, {
      tableName: 'cfdi_payment_complements',
      fillableIncludes: ['cfdi_document_id', 'payment_id', 'fecha_pago', 'monto'],
      hasOrgScope: false,
    });
  });
});

describe('CfdiRelatedDocument', () => {
  test('has correct metadata', () => {
    expectModel(CfdiRelatedDocument, {
      tableName: 'cfdi_related_documents',
      fillableIncludes: ['cfdi_document_id', 'related_uuid', 'tipo_relacion'],
      hasOrgScope: false,
    });
  });
});

describe('ClientMxProfile', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(ClientMxProfile, {
      tableName: 'client_mx_profiles',
      fillableIncludes: ['client_id', 'rfc', 'razon_social', 'regimen_fiscal'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('ContractAddon', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(ContractAddon, {
      tableName: 'contract_addons',
      fillableIncludes: ['organization_id', 'contract_id', 'plan_addon_id', 'quantity', 'unit_price', 'status'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('ContractTemplateMx', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(ContractTemplateMx, {
      tableName: 'contract_templates_mx',
      fillableIncludes: ['organization_id', 'name', 'template_body', 'version', 'status'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('CreditNoteItem', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(CreditNoteItem, {
      tableName: 'credit_note_items',
      fillableIncludes: ['credit_note_id', 'description', 'quantity', 'unit_price', 'amount'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('FacturaPublicaInvoice', () => {
  test('has correct metadata', () => {
    expectModel(FacturaPublicaInvoice, {
      tableName: 'factura_publica_invoices',
      fillableIncludes: ['organization_id', 'cfdi_document_id', 'periodicidad', 'meses', 'anio', 'status'],
      hasOrgScope: true,
    });
  });
});

describe('FacturaPublicaInvoiceItem', () => {
  test('has correct metadata', () => {
    expectModel(FacturaPublicaInvoiceItem, {
      tableName: 'factura_publica_invoice_items',
      fillableIncludes: ['factura_publica_invoice_id', 'invoice_id'],
      hasOrgScope: false,
    });
  });
});

describe('InventoryStock', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(InventoryStock, {
      tableName: 'inventory_stock',
      fillableIncludes: ['organization_id', 'item_id', 'warehouse_id', 'quantity_on_hand', 'quantity_reserved'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('InventoryTransaction', () => {
  test('has correct metadata', () => {
    expectModel(InventoryTransaction, {
      tableName: 'inventory_transactions',
      fillableIncludes: ['organization_id', 'item_id', 'warehouse_id', 'transaction_type', 'quantity'],
      hasOrgScope: true,
    });
  });
});

describe('InvoiceItem', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(InvoiceItem, {
      tableName: 'invoice_items',
      fillableIncludes: ['invoice_id', 'description', 'quantity', 'unit_price', 'amount', 'tax_rate', 'tax_amount'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('NetworkHealthSnapshot', () => {
  test('has correct metadata', () => {
    expectModel(NetworkHealthSnapshot, {
      tableName: 'network_health_snapshots',
      fillableIncludes: ['organization_id', 'snapshot_date', 'total_devices', 'online_devices', 'offline_devices'],
      hasOrgScope: true,
    });
  });
});

describe('OrganizationMxProfile', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(OrganizationMxProfile, {
      tableName: 'organization_mx_profiles',
      fillableIncludes: ['organization_id', 'rfc', 'razon_social', 'regimen_fiscal'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('OrganizationUser', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(OrganizationUser, {
      tableName: 'organization_users',
      fillableIncludes: ['organization_id', 'user_id', 'role'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('PlanAddon', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(PlanAddon, {
      tableName: 'plan_addons',
      fillableIncludes: ['organization_id', 'plan_id', 'name', 'addon_type', 'price', 'billing_cycle', 'status'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('Promotion', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(Promotion, {
      tableName: 'promotions',
      fillableIncludes: ['organization_id', 'name', 'code', 'discount_type', 'discount_value', 'is_active'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('QuoteItem', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(QuoteItem, {
      tableName: 'quote_items',
      fillableIncludes: ['quote_id', 'description', 'quantity', 'unit_price', 'amount', 'tax_rate', 'tax_amount'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('RevenueSummary', () => {
  test('has correct metadata', () => {
    expectModel(RevenueSummary, {
      tableName: 'revenue_summary',
      fillableIncludes: ['organization_id', 'period_date', 'total_invoiced', 'total_collected', 'total_outstanding'],
      hasOrgScope: true,
    });
  });
});

describe('RolePermission', () => {
  test('has correct metadata', () => {
    expectModel(RolePermission, {
      tableName: 'role_permissions',
      fillableIncludes: ['role_id', 'permission_id'],
      hasOrgScope: false,
    });
  });
});

describe('SnmpMetric', () => {
  test('has correct metadata', () => {
    expectModel(SnmpMetric, {
      tableName: 'snmp_metrics',
      fillableIncludes: ['device_id', 'profile_oid_id', 'value_gauge', 'value_counter', 'value_string', 'polled_at'],
      hasOrgScope: false,
    });
  });
});

describe('SnmpProfileOid', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(SnmpProfileOid, {
      tableName: 'snmp_profile_oids',
      fillableIncludes: ['profile_id', 'oid', 'label', 'oid_type', 'metric_column', 'status', 'aggregate', 'transform'],
      hasOrgScope: false,
      softDelete: true,
    });
  });
});

describe('TaxRate', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(TaxRate, {
      tableName: 'tax_rates',
      fillableIncludes: ['organization_id', 'name', 'rate', 'description', 'is_default', 'status'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('TaxRule', () => {
  test('has correct metadata with soft-delete', () => {
    expectModel(TaxRule, {
      tableName: 'tax_rules',
      fillableIncludes: ['organization_id', 'name', 'tax_type', 'rate', 'region', 'is_default', 'status'],
      hasOrgScope: true,
      softDelete: true,
    });
  });
});

describe('TicketSlaEvent', () => {
  test('has correct metadata', () => {
    expectModel(TicketSlaEvent, {
      tableName: 'ticket_sla_events',
      fillableIncludes: ['organization_id', 'ticket_id', 'sla_definition_id', 'event_type', 'occurred_at', 'notes'],
      hasOrgScope: true,
    });
  });
});
