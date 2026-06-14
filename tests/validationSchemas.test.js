// =============================================================================
// FireISP 5.0 — Validation Schemas Unit Tests
// =============================================================================
// Tests validation schema definitions for correctness.
// =============================================================================

const { validate } = require('../src/middleware/validate');

function run(schema, body) {
  const req = { body };
  const res = {};
  const next = jest.fn();
  validate(schema)(req, res, next);
  return next;
}

describe('Client validation schemas', () => {
  const { createClient, updateClient, createContact, updateMxProfile } = require('../src/middleware/schemas/clients');

  test('createClient requires name', () => {
    const next = run(createClient, {});
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createClient accepts valid residential client', () => {
    const next = run(createClient, { name: 'John Doe', client_type: 'residential', locale: 'MX' });
    expect(next).toHaveBeenCalledWith();
  });

  test('createClient rejects invalid locale', () => {
    const next = run(createClient, { name: 'Test', locale: 'US' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('updateClient allows partial updates', () => {
    const next = run(updateClient, { status: 'inactive' });
    expect(next).toHaveBeenCalledWith();
  });

  test('updateClient rejects invalid status', () => {
    const next = run(updateClient, { status: 'deleted' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createContact requires name', () => {
    const next = run(createContact, { email: 'test@example.com' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createContact accepts valid data', () => {
    const next = run(createContact, { name: 'Jane', email: 'jane@example.com' });
    expect(next).toHaveBeenCalledWith();
  });

  test('updateMxProfile requires rfc, razon_social, regimen_fiscal, codigo_postal_fiscal', () => {
    const next = run(updateMxProfile, { rfc: 'XAXX010101000' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('updateMxProfile accepts valid MX data', () => {
    const next = run(updateMxProfile, {
      rfc: 'XAXX010101000',
      razon_social: 'Test SA de CV',
      regimen_fiscal: '601',
      codigo_postal_fiscal: '06600',
    });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('Contract validation schemas', () => {
  const { createContract, updateContract, createContractAddon } = require('../src/middleware/schemas/contracts');

  test('createContract requires client_id, plan_id, start_date', () => {
    const next = run(createContract, {});
    const errorDetails = next.mock.calls[0][0].details;
    const fields = errorDetails.map(e => e.field);
    expect(fields).toContain('client_id');
    expect(fields).toContain('plan_id');
    expect(fields).toContain('start_date');
  });

  test('createContract rejects invalid connection_type', () => {
    const next = run(createContract, {
      client_id: 1, plan_id: 1, start_date: '2026-01-01', connection_type: 'fiber',
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createContract accepts valid pppoe_dual', () => {
    const next = run(createContract, {
      client_id: 1, plan_id: 1, start_date: '2026-01-01', connection_type: 'pppoe_dual',
    });
    expect(next).toHaveBeenCalledWith();
  });

  test('updateContract allows partial updates', () => {
    const next = run(updateContract, { status: 'suspended' });
    expect(next).toHaveBeenCalledWith();
  });

  test('createContractAddon requires plan_addon_id', () => {
    const next = run(createContractAddon, {});
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('billing_day rejects > 28', () => {
    const next = run(createContract, {
      client_id: 1, plan_id: 1, start_date: '2026-01-01', billing_day: 31,
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});

describe('Invoice validation schemas', () => {
  const { createInvoice, addInvoiceItem, generateInvoice } = require('../src/middleware/schemas/invoices');

  test('createInvoice requires client_id, subtotal, total, due_date', () => {
    const next = run(createInvoice, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('client_id');
    expect(fields).toContain('subtotal');
    expect(fields).toContain('total');
    expect(fields).toContain('due_date');
  });

  test('createInvoice rejects invalid status', () => {
    const next = run(createInvoice, {
      client_id: 1, subtotal: 500, total: 580, due_date: '2026-04-30', status: 'deleted',
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('addInvoiceItem requires description, quantity, unit_price, amount', () => {
    const next = run(addInvoiceItem, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('description');
    expect(fields).toContain('quantity');
    expect(fields).toContain('unit_price');
    expect(fields).toContain('amount');
  });

  test('generateInvoice requires contract_id', () => {
    const next = run(generateInvoice, {});
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});

describe('Payment validation schemas', () => {
  const { createPayment, allocatePayment } = require('../src/middleware/schemas/payments');

  test('createPayment requires client_id and amount', () => {
    const next = run(createPayment, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('client_id');
    expect(fields).toContain('amount');
  });

  test('createPayment rejects invalid payment_method', () => {
    const next = run(createPayment, { client_id: 1, amount: 500, payment_method: 'bitcoin' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createPayment accepts valid payment', () => {
    const next = run(createPayment, { client_id: 1, amount: 500, payment_method: 'cash' });
    expect(next).toHaveBeenCalledWith();
  });

  test('allocatePayment requires invoice_id and amount', () => {
    const next = run(allocatePayment, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('invoice_id');
    expect(fields).toContain('amount');
  });
});

describe('Device validation schemas', () => {
  const { createDevice, updateDevice } = require('../src/middleware/schemas/devices');

  test('createDevice requires name and type', () => {
    const next = run(createDevice, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('type');
  });

  test('createDevice rejects invalid type', () => {
    const next = run(createDevice, { name: 'Router-01', type: 'modem' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createDevice accepts valid device types', () => {
    const types = ['router', 'switch', 'olt', 'onu', 'ap', 'antenna', 'server', 'cpe', 'other'];
    for (const type of types) {
      const next = run(createDevice, { name: 'Dev-01', type });
      expect(next).toHaveBeenCalledWith();
    }
  });

  test('updateDevice allows partial updates', () => {
    const next = run(updateDevice, { status: 'maintenance' });
    expect(next).toHaveBeenCalledWith();
  });

  test('snmp_port rejects out of range', () => {
    const next = run(createDevice, { name: 'Dev-01', type: 'router', snmp_port: 70000 });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});

describe('Ticket validation schemas', () => {
  const { createTicket, updateTicket, createComment } = require('../src/middleware/schemas/tickets');

  test('createTicket requires subject', () => {
    const next = run(createTicket, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('subject');
  });

  test('createTicket rejects invalid priority', () => {
    const next = run(createTicket, { subject: 'Test', priority: 'urgent' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createTicket accepts all valid priorities', () => {
    const priorities = ['low', 'medium', 'high', 'critical'];
    for (const priority of priorities) {
      const next = run(createTicket, { subject: 'Test', priority });
      expect(next).toHaveBeenCalledWith();
    }
  });

  test('updateTicket allows partial updates', () => {
    const next = run(updateTicket, { status: 'resolved' });
    expect(next).toHaveBeenCalledWith();
  });

  test('createComment requires body', () => {
    const next = run(createComment, {});
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createComment accepts valid comment', () => {
    const next = run(createComment, { body: 'This is a comment', is_internal: true });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('Plan validation schemas', () => {
  const { createPlan, updatePlan, createPlanAddon } = require('../src/middleware/schemas/plans');

  test('createPlan requires name, download_speed_mbps, upload_speed_mbps, price', () => {
    const next = run(createPlan, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('download_speed_mbps');
    expect(fields).toContain('upload_speed_mbps');
    expect(fields).toContain('price');
  });

  test('createPlan rejects invalid billing_cycle', () => {
    const next = run(createPlan, {
      name: 'Basic', download_speed_mbps: 50, upload_speed_mbps: 10, price: 500,
      billing_cycle: 'weekly',
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createPlan accepts valid plan', () => {
    const next = run(createPlan, {
      name: 'Basic 50', download_speed_mbps: 50, upload_speed_mbps: 10, price: 500,
      billing_cycle: 'monthly',
    });
    expect(next).toHaveBeenCalledWith();
  });

  test('updatePlan allows partial updates', () => {
    const next = run(updatePlan, { price: 600 });
    expect(next).toHaveBeenCalledWith();
  });

  test('createPlanAddon requires name, addon_type, price', () => {
    const next = run(createPlanAddon, {});
    const fields = next.mock.calls[0][0].details.map(e => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('addon_type');
    expect(fields).toContain('price');
  });

  test('createPlanAddon rejects invalid addon_type', () => {
    const next = run(createPlanAddon, { name: 'Extra', addon_type: 'invalid', price: 100 });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  test('createPlanAddon accepts valid addon types', () => {
    const types = ['static_ip', 'extra_ip_block', 'extra_bandwidth', 'equipment_rental', 'other'];
    for (const addon_type of types) {
      const next = run(createPlanAddon, { name: 'Addon', addon_type, price: 100 });
      expect(next).toHaveBeenCalledWith();
    }
  });
});
