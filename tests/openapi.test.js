// =============================================================================
// FireISP 5.0 — OpenAPI Spec Generation Tests
// =============================================================================

const { generateSpec, convertSchemaToOpenApi } = require('../src/utils/openapi');

describe('OpenAPI spec generation', () => {
  test('generates valid OpenAPI 3.1 spec', () => {
    const spec = generateSpec();

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('FireISP 5.0 API');
    expect(spec.info.version).toBe('5.0.0');
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
  });

  test('includes auth endpoints', () => {
    const spec = generateSpec();

    expect(spec.paths['/auth/register']).toBeDefined();
    expect(spec.paths['/auth/login']).toBeDefined();
    expect(spec.paths['/auth/logout']).toBeDefined();
    expect(spec.paths['/auth/me']).toBeDefined();
    expect(spec.paths['/auth/password-reset']).toBeDefined();
    expect(spec.paths['/auth/change-password']).toBeDefined();
    expect(spec.paths['/auth/verify-email']).toBeDefined();
  });

  test('includes billing endpoints', () => {
    const spec = generateSpec();

    expect(spec.paths['/billing/generate-period']).toBeDefined();
    expect(spec.paths['/billing/generate-invoice']).toBeDefined();
    expect(spec.paths['/billing/allocate-payment']).toBeDefined();
    expect(spec.paths['/billing/bulk-generate']).toBeDefined();
  });

  test('includes CFDI endpoints', () => {
    const spec = generateSpec();

    expect(spec.paths['/cfdi/generate-xml']).toBeDefined();
    expect(spec.paths['/cfdi/stamp']).toBeDefined();
    expect(spec.paths['/cfdi/cancel']).toBeDefined();
    expect(spec.paths['/cfdi/{id}/xml']).toBeDefined();
    expect(spec.paths['/cfdi/{id}/pdf']).toBeDefined();
  });

  test('includes dashboard endpoints', () => {
    const spec = generateSpec();

    expect(spec.paths['/dashboard/summary']).toBeDefined();
    expect(spec.paths['/dashboard/revenue']).toBeDefined();
    expect(spec.paths['/dashboard/mrr']).toBeDefined();
    expect(spec.paths['/dashboard/device-health']).toBeDefined();
    expect(spec.paths['/dashboard/overdue']).toBeDefined();
  });

  test('includes export and import endpoints', () => {
    const spec = generateSpec();

    expect(spec.paths['/export/invoices']).toBeDefined();
    expect(spec.paths['/export/clients']).toBeDefined();
    expect(spec.paths['/import/clients']).toBeDefined();
    expect(spec.paths['/import/devices']).toBeDefined();
  });

  test('includes security schemes', () => {
    const spec = generateSpec();

    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  test('generates component schemas from validation files', () => {
    const spec = generateSpec();

    // Should have at least some schemas from the schema files
    expect(Object.keys(spec.components.schemas).length).toBeGreaterThan(0);
  });

  test('convertSchemaToOpenApi converts FireISP schema to OpenAPI', () => {
    const schema = {
      name: { type: 'string', required: true, min: 1, max: 100 },
      email: { type: 'email', required: true },
      age: { type: 'number', min: 0 },
      role: { type: 'string', enum: ['admin', 'user'] },
    };

    const result = convertSchemaToOpenApi(schema);

    expect(result.type).toBe('object');
    expect(result.required).toEqual(['name', 'email']);
    expect(result.properties.name.type).toBe('string');
    expect(result.properties.email.format).toBe('email');
    expect(result.properties.age.type).toBe('number');
    expect(result.properties.role.enum).toEqual(['admin', 'user']);
  });
});
