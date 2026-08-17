'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateSpec } = require('../src/utils/openapi');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function acceptsNull(schema) {
  if (!schema) return false;
  if (schema.nullable === true) return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  return [...(schema.oneOf || []), ...(schema.anyOf || [])].some(part => part?.type === 'null');
}

function dereference(spec, schema) {
  let current = schema;
  const seen = new Set();
  while (current?.$ref) {
    expect(current.$ref).toMatch(/^#\/components\/schemas\//);
    expect(seen.has(current.$ref)).toBe(false);
    seen.add(current.$ref);
    current = spec.components.schemas[current.$ref.split('/').at(-1)];
  }
  return current;
}

function objectVariant(schema) {
  if (!schema) return null;
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    return schema;
  }
  return [...(schema.oneOf || []), ...(schema.anyOf || [])]
    .find(part => part?.type === 'object'
      || (Array.isArray(part?.type) && part.type.includes('object')));
}

function stringVariant(schema) {
  if (!schema) return null;
  if (schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) {
    return schema;
  }
  return [...(schema.oneOf || []), ...(schema.anyOf || [])]
    .find(part => part?.type === 'string'
      || (Array.isArray(part?.type) && part.type.includes('string')));
}

function responseSchema(spec, route, method, status) {
  const response = spec.paths[route]?.[method]?.responses?.[status];
  expect(response).toBeDefined();
  const schema = response.content?.['application/json']?.schema;
  expect(schema).toBeDefined();
  return dereference(spec, schema);
}

function dataSchema(spec, route, method, status, { array = false, meta = false } = {}) {
  const envelope = responseSchema(spec, route, method, status);
  expect(envelope).toMatchObject({
    type: 'object',
    required: expect.arrayContaining(['data']),
    properties: { data: expect.any(Object) },
  });
  if (meta) {
    expect(envelope.required).toContain('meta');
    expect(envelope.properties.meta).toEqual(expect.any(Object));
  }
  const data = dereference(spec, envelope.properties.data);
  if (!array) return data;
  expect(data).toMatchObject({ type: 'array', items: expect.any(Object) });
  return dereference(spec, data.items);
}

describe('trap forwarding OpenAPI and generated client contract', () => {
  const spec = generateSpec();

  test('documents every operational route with typed create/update bodies', () => {
    for (const [route, method] of [
      ['/trap-forwarding-rules', 'get'],
      ['/trap-forwarding-rules', 'post'],
      ['/trap-forwarding-rules/readiness', 'get'],
      ['/trap-forwarding-rules/{id}', 'get'],
      ['/trap-forwarding-rules/{id}', 'put'],
      ['/trap-forwarding-rules/{id}', 'delete'],
      ['/trap-forwarding-rules/destinations', 'get'],
      ['/trap-forwarding-rules/{id}/configuration', 'get'],
      ['/trap-forwarding-rules/{id}/deliveries', 'get'],
      ['/trap-forwarding-rules/{id}/test', 'post'],
    ]) {
      expect(spec.paths[route]?.[method]).toBeDefined();
    }

    expect(spec.paths['/trap-forwarding-rules'].post.requestBody
      .content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/trapForwardingRules_createTrapForwardingRule',
    });
    expect(spec.paths['/trap-forwarding-rules/{id}'].put.requestBody
      .content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/trapForwardingRules_updateTrapForwardingRule',
    });
  });

  test('documents the pagination query used by both privacy-safe list endpoints', () => {
    for (const route of ['/trap-forwarding-rules', '/webhooks']) {
      const parameters = spec.paths[route].get.parameters;
      expect(parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ type: 'integer' }),
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ type: 'integer' }),
        }),
      ]));
    }
  });

  test('documents explicit null for every matcher clear and destination switch', () => {
    for (const componentName of [
      'trapForwardingRules_createTrapForwardingRule',
      'trapForwardingRules_updateTrapForwardingRule',
    ]) {
      const component = spec.components.schemas[componentName];
      for (const field of [
        'match_trap_type',
        'match_source_ip',
        'match_oid_prefix',
        'forward_to_url',
        'forward_to_email',
        'forward_to_webhook_id',
      ]) {
        expect({ componentName, field, schema: component.properties[field] }).toEqual(expect.objectContaining({
          schema: expect.any(Object),
        }));
        expect(acceptsNull(component.properties[field])).toBe(true);
      }
      expect(component.properties).not.toHaveProperty('transform_template');
    }
  });

  test('documents the exact safe DTO envelopes used by every forwarding endpoint', () => {
    const safeRuleSchemas = [
      dataSchema(spec, '/trap-forwarding-rules', 'get', 200, { array: true, meta: true }),
      dataSchema(spec, '/trap-forwarding-rules', 'post', 201),
      dataSchema(spec, '/trap-forwarding-rules/{id}', 'get', 200),
      dataSchema(spec, '/trap-forwarding-rules/{id}', 'put', 200),
      dataSchema(spec, '/trap-forwarding-rules/{id}/restore', 'post', 200),
    ];
    for (const schema of safeRuleSchemas) {
      expect(schema).toMatchObject({
        type: 'object',
        properties: expect.objectContaining({
          id: expect.any(Object),
          name: expect.any(Object),
          target_type: expect.any(Object),
          target_display: expect.any(Object),
          target_display_code: expect.any(Object),
          target_needs_attention: expect.any(Object),
          configuration_reviewed: expect.any(Object),
          transform_supported: expect.any(Object),
        }),
      });
      expect(schema.required).toEqual(expect.arrayContaining([
        'target_type',
        'target_display',
        'target_display_code',
        'target_needs_attention',
      ]));
      expect(acceptsNull(schema.properties.target_display)).toBe(true);
      expect(schema.properties.target_display_code).toMatchObject({
        type: 'string',
        enum: [
          'direct_https_url',
          'email_recipient',
          'registered_webhook',
          'review_destination',
        ],
      });
      for (const hidden of [
        'forward_to_url', 'forward_to_email', 'forward_to_webhook_id', 'transform_template',
      ]) {
        expect(schema.properties).not.toHaveProperty(hidden);
      }
    }

    const destination = dataSchema(
      spec,
      '/trap-forwarding-rules/destinations',
      'get',
      200,
      { array: true },
    );
    expect(destination.properties).toEqual(expect.objectContaining({
      id: expect.any(Object), label: expect.any(Object), url: expect.any(Object),
    }));

    const configuration = dataSchema(
      spec,
      '/trap-forwarding-rules/{id}/configuration',
      'get',
      200,
    );
    expect(configuration.properties).toEqual(expect.objectContaining({
      id: expect.any(Object),
      forward_to_url: expect.any(Object),
      forward_to_email: expect.any(Object),
      forward_to_webhook_id: expect.any(Object),
    }));
    for (const field of ['forward_to_url', 'forward_to_email', 'forward_to_webhook_id']) {
      expect(acceptsNull(configuration.properties[field])).toBe(true);
    }

    const delivery = dataSchema(
      spec,
      '/trap-forwarding-rules/{id}/deliveries',
      'get',
      200,
      { array: true, meta: true },
    );
    expect(delivery.properties).toEqual(expect.objectContaining({
      id: expect.any(Object), status: expect.any(Object), is_test: expect.any(Object),
    }));
    for (const hidden of ['payload', 'target_url', 'target_email', 'webhook_id']) {
      expect(delivery.properties).not.toHaveProperty(hidden);
    }

    const testDelivery = dataSchema(
      spec,
      '/trap-forwarding-rules/{id}/test',
      'post',
      202,
    );
    expect(testDelivery.properties).toEqual(expect.objectContaining({
      id: expect.any(Object), status: expect.any(Object), is_test: expect.any(Object),
    }));

    const readiness = dataSchema(
      spec,
      '/trap-forwarding-rules/readiness',
      'get',
      200,
    );
    expect(readiness).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['ready', 'status', 'reason', 'ingest']),
      properties: {
        ready: { type: 'boolean' },
        status: { type: 'string', enum: ['ready', 'unavailable'] },
        reason: expect.any(Object),
        ingest: expect.any(Object),
      },
    });
    expect(acceptsNull(readiness.properties.reason)).toBe(true);
    expect(readiness.properties.reason.enum).toEqual(expect.arrayContaining([
      'primary_schema_unavailable',
      'listener_not_ready',
      'isolated_tenant_attribution_unsupported',
      'multi_organization_attribution_unsupported',
    ]));
    expect(acceptsNull(readiness.properties.ingest)).toBe(true);
    const ingest = objectVariant(readiness.properties.ingest);
    expect(ingest).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'usage_date',
        'trap_count',
        'trap_limit',
        'varbind_bytes',
        'varbind_byte_limit',
        'delivery_count',
        'delivery_limit',
        'metadata_only_count',
        'dropped_trap_count',
        'forwarding_skipped_count',
      ]),
    });
    expect(acceptsNull(ingest.properties.usage_date)).toBe(true);
    for (const field of [
      'trap_count',
      'trap_limit',
      'varbind_bytes',
      'varbind_byte_limit',
      'delivery_count',
      'delivery_limit',
      'metadata_only_count',
      'dropped_trap_count',
      'forwarding_skipped_count',
    ]) {
      expect(ingest.properties[field]).toMatchObject({ type: 'integer', minimum: 0 });
    }
  });

  test('documents the bounded raw trap payload shape without a community field', () => {
    const detail = dereference(spec, spec.components.schemas.SnmpTrapDetail);
    expect(detail).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['varbinds']),
    });
    expect(detail.properties).not.toHaveProperty('community');

    const varbinds = detail.properties.varbinds;
    expect(varbinds).toMatchObject({ type: 'array', maxItems: 64, items: expect.any(Object) });
    const item = dereference(spec, varbinds.items);
    expect(item).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['oid', 'type', 'value']),
      properties: expect.objectContaining({
        truncated: { type: 'boolean' },
      }),
    });
    expect(stringVariant(item.properties.oid)).toMatchObject({ maxLength: 255 });
    expect(stringVariant(item.properties.type)).toMatchObject({ maxLength: 32 });
    expect(stringVariant(item.properties.value)).toMatchObject({ maxLength: 512 });
    expect(acceptsNull(item.properties.type)).toBe(true);
    expect(acceptsNull(item.properties.value)).toBe(true);
  });

  test('generated TypeScript exposes the new routes and nullable request fields', () => {
    const generated = read('frontend/src/api/schema.d.ts');
    for (const route of [
      '/trap-forwarding-rules/destinations',
      '/trap-forwarding-rules/readiness',
      '/trap-forwarding-rules/{id}/configuration',
      '/trap-forwarding-rules/{id}/deliveries',
      '/trap-forwarding-rules/{id}/test',
    ]) {
      expect(generated).toContain(`"${route}"`);
    }
    for (const field of [
      'match_trap_type',
      'match_source_ip',
      'match_oid_prefix',
      'forward_to_url',
      'forward_to_email',
    ]) {
      expect(generated).toMatch(new RegExp(`${field}\\?: string \\| null;`));
    }
    expect(generated).toMatch(/forward_to_webhook_id\?: number \| null;/);
    expect(generated).toMatch(/target_display: string \| null;/);
    expect(generated).toMatch(/target_display_code: "direct_https_url" \| "email_recipient" \| "registered_webhook" \| "review_destination";/);
    expect(generated).toMatch(
      /ingest: \{[\s\S]*?delivery_count: number;[\s\S]*?delivery_limit: number;[\s\S]*?metadata_only_count: number;[\s\S]*?dropped_trap_count: number;[\s\S]*?forwarding_skipped_count: number;[\s\S]*?\} \| null;/,
    );

    for (const operationId of ['listTrapForwardingRules', 'listWebhooks']) {
      const start = generated.indexOf(`    ${operationId}: {`);
      expect(start).toBeGreaterThan(-1);
      const parameters = generated.slice(start, start + 500);
      expect(parameters).toMatch(/query\?: \{[\s\S]*?page\?: number;[\s\S]*?limit\?: number;/);
      expect(parameters).not.toMatch(/query\?: never/);
    }

    const trapComponents = generated.slice(
      generated.indexOf('trapForwardingRules_createTrapForwardingRule'),
      generated.indexOf('twoFactor_verifyCode'),
    );
    expect(trapComponents).not.toContain('transform_template');
  });

  test('frontend calls the generated paths without stale never-casts', () => {
    const page = read('frontend/src/pages/TrapForwardingRuleList.tsx');
    expect(page).not.toMatch(/["']\/trap-forwarding-rules[^"']*["']\s+as never/);
  });
});
