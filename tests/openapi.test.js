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

  test('documents NAS maintenance mode and localized PPPoE readiness metadata', () => {
    const spec = generateSpec();

    expect(spec.components.schemas.nas_createNas.properties.maintenance_mode).toEqual({
      type: 'boolean',
    });
    expect(spec.components.schemas.nas_updateNas.properties.maintenance_mode).toEqual({
      type: 'boolean',
    });

    const readiness = spec.paths['/pppoe/diagnostics/readiness']
      .get.responses[200].content['application/json'].schema
      .properties.data.properties.sources.properties;
    for (const source of ['authentication', 'routerEvents', 'accounting']) {
      expect(readiness[source].required).toEqual(expect.arrayContaining([
        'detail', 'detailCode', 'detailParams',
      ]));
    }
    expect(readiness.routerEvents.required).toEqual(expect.arrayContaining([
      'coveredNas', 'totalNas', 'maintenanceNas',
    ]));
  });

  test('documents the exact subscriber session, IP-attribution, readiness, and tenant-ingest contracts', () => {
    const spec = generateSpec();

    for (const path of [
      '/connection-logs', '/connection-logs/export',
      '/connection-logs/cgnat-attribution/bindings/ingest',
      '/connection-logs/cgnat-attribution/exporters',
      '/connection-logs/ip-attribution/lookup', '/connection-logs/ip-attribution/export',
      '/connection-logs/readiness', '/radius/accounting/tenant',
    ]) expect(spec.paths[path]).toBeDefined();

    const exportParameters = spec.paths['/connection-logs/export'].get.parameters;
    expect(exportParameters.find(parameter => parameter.name === 'date_from').required).toBe(true);
    expect(exportParameters.find(parameter => parameter.name === 'date_to').required).toBe(true);
    const bindingParameters = spec.paths['/connection-logs/binding-report'].get.parameters;
    expect(bindingParameters.find(parameter => parameter.name === 'from').required).toBe(true);
    expect(bindingParameters.find(parameter => parameter.name === 'to').required).toBe(true);
    expect(bindingParameters.find(parameter => parameter.name === 'format').schema.enum).toEqual(['json', 'csv']);

    const session = spec.components.schemas.ConnectionSession;
    expect(session.additionalProperties).toBe(false);
    expect(session.properties.record_kind.enum).toEqual(['session', 'legacy_event']);
    expect(session.properties).toHaveProperty('acct_input_octets_v6');
    expect(session.properties).toHaveProperty('acct_output_octets_v6');

    const bindingInput = spec.components.schemas.CgnatBindingInput;
    expect(bindingInput.additionalProperties).toBe(false);
    expect(bindingInput.required).toContain('session_instance_id');
    expect(bindingInput.properties.protocol.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'integer', enum: [6, 17] }),
    ]));
    expect(bindingInput.properties).not.toHaveProperty('destination_ip');
    const exporter = spec.components.schemas.CgnatExporterConfig;
    expect(exporter.additionalProperties).toBe(false);
    expect(exporter).not.toHaveProperty('allOf');
    expect(exporter.properties).toHaveProperty('coverage_horizon_at');
    const lookup = spec.components.schemas.IpAttributionLookupResult;
    expect(lookup.properties.attribution.oneOf).toEqual([
      { $ref: '#/components/schemas/DirectPublicAttribution' },
      { $ref: '#/components/schemas/CgnatAttribution' },
    ]);
    expect(spec.components.schemas.DirectPublicAttribution.additionalProperties).toBe(false);
    expect(spec.components.schemas.CgnatAttribution.additionalProperties).toBe(false);

    const readiness = spec.components.schemas.ConnectionLoggingReadiness.properties;
    expect(readiness.session_logger.properties).toHaveProperty('lifecycle_evidence_24h');
    expect(readiness.session_logger.properties).toHaveProperty('source_coverage_complete');
    expect(readiness.cgnat_attribution.oneOf[1].properties).toHaveProperty('coverage_horizon_at');
    expect(readiness.retention.properties).toHaveProperty('effective_policies');
    expect(readiness.retention.properties).toHaveProperty('event_scheduler_status');
    expect(spec.paths['/reports/interception-readiness'].get.summary).toBe('Operational connection-logging readiness');
    expect(spec.paths['/reports/interception-readiness'].get.description).toMatch(/not a legal-compliance certification/i);
  });

  test('convertSchemaToOpenApi converts FireISP schema to OpenAPI', () => {
    const schema = {
      name: { type: 'string', required: true, min: 1, max: 100 },
      email: { type: 'email', required: true },
      age: { type: 'number', min: 0 },
      role: { type: 'string', enum: ['admin', 'user'] },
      choices: {
        type: 'object',
        properties: { email: { type: 'boolean' } },
        requiredProperties: ['email'],
      },
      digest: { type: 'string', pattern: /^[a-f0-9]{64}$/ },
    };

    const result = convertSchemaToOpenApi(schema);

    expect(result.type).toBe('object');
    expect(result.required).toEqual(['name', 'email']);
    expect(result.properties.name.type).toBe('string');
    expect(result.properties.email.format).toBe('email');
    expect(result.properties.age.type).toBe('number');
    expect(result.properties.role.enum).toEqual(['admin', 'user']);
    expect(result.properties.choices).toEqual({
      type: 'object', properties: { email: { type: 'boolean' } }, required: ['email'],
    });
    expect(result.properties.digest.pattern).toBe('^[a-f0-9]{64}$');
  });
});
