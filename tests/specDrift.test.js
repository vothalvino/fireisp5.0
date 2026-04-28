// =============================================================================
// FireISP 5.0 — Spec Drift Detector Tests (P3.11)
// =============================================================================

const fs   = require('fs');
const path = require('path');

const {
  toExpressPath,
  normaliseSpec,
  findDuplicateOperationIds,
  findPathDrift,
  findMetaDrift,
} = require('../src/scripts/spec-drift');

const {
  toPascal,
  toCamel,
  extractResourcePaths,
  generateRouteFile,
  generateSchemaFile,
  generateTestFile,
} = require('../src/scripts/gen-route');

// Load dotenv so generateSpec() works during tests
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { generateSpec } = require('../src/utils/openapi');

// ---------------------------------------------------------------------------
// spec-drift.js — unit helpers
// ---------------------------------------------------------------------------

describe('toExpressPath', () => {
  it('converts {id} to :id', () => {
    expect(toExpressPath('/clients/{id}')).toBe('/clients/:id');
  });

  it('converts multiple params', () => {
    expect(toExpressPath('/a/{foo}/b/{bar}')).toBe('/a/:foo/b/:bar');
  });

  it('leaves paths without params unchanged', () => {
    expect(toExpressPath('/auth/login')).toBe('/auth/login');
  });
});

describe('normaliseSpec', () => {
  it('sorts top-level path keys alphabetically', () => {
    const spec = { paths: { '/z': { get: {} }, '/a': { get: {} } } };
    const norm = normaliseSpec(spec);
    expect(Object.keys(norm.paths)).toEqual(['/a', '/z']);
  });

  it('sorts HTTP method keys within each path', () => {
    const spec = { paths: { '/x': { post: {}, get: {} } } };
    const norm = normaliseSpec(spec);
    expect(Object.keys(norm.paths['/x'])).toEqual(['get', 'post']);
  });

  it('does not mutate the original spec', () => {
    const spec = { paths: { '/z': {}, '/a': {} } };
    normaliseSpec(spec);
    expect(Object.keys(spec.paths)[0]).toBe('/z'); // original unchanged
  });
});

describe('findDuplicateOperationIds', () => {
  it('returns empty array when all operationIds are unique', () => {
    const spec = {
      paths: {
        '/a': { get: { operationId: 'listA' }, post: { operationId: 'createA' } },
        '/b': { get: { operationId: 'listB' } },
      },
    };
    expect(findDuplicateOperationIds(spec)).toEqual([]);
  });

  it('detects a single duplicate', () => {
    const spec = {
      paths: {
        '/a': { get: { operationId: 'listItems' } },
        '/b': { get: { operationId: 'listItems' } },
      },
    };
    expect(findDuplicateOperationIds(spec)).toEqual(['listItems']);
  });

  it('reports each duplicate only once even if it appears 3+ times', () => {
    const spec = {
      paths: {
        '/a': { get: { operationId: 'dup' } },
        '/b': { get: { operationId: 'dup' } },
        '/c': { get: { operationId: 'dup' } },
      },
    };
    expect(findDuplicateOperationIds(spec)).toEqual(['dup']);
  });

  it('returns empty array for an empty paths object', () => {
    expect(findDuplicateOperationIds({ paths: {} })).toEqual([]);
  });
});

describe('findPathDrift', () => {
  const base = {
    paths: {
      '/clients':     { get: {}, post: {} },
      '/clients/{id}': { get: {}, put: {}, delete: {} },
    },
  };

  it('returns all-empty arrays when specs are identical', () => {
    const drift = findPathDrift(base, base);
    expect(drift.missingPaths).toEqual([]);
    expect(drift.extraPaths).toEqual([]);
    expect(drift.missingMethods).toEqual([]);
    expect(drift.extraMethods).toEqual([]);
  });

  it('detects a path present in generated but missing from committed', () => {
    const committed = { paths: { '/clients': { get: {}, post: {} } } }; // no {id} path
    const drift = findPathDrift(base, committed);
    expect(drift.missingPaths).toContain('/clients/{id}');
  });

  it('detects a path present in committed but not in generated (extra)', () => {
    const generated = { paths: { '/clients': { get: {}, post: {} } } };
    const drift = findPathDrift(generated, base);
    expect(drift.extraPaths).toContain('/clients/{id}');
  });

  it('detects a missing HTTP method on an otherwise-matching path', () => {
    const committed = { paths: { '/clients': { get: {} } } }; // post missing
    const generated = { paths: { '/clients': { get: {}, post: {} } } };
    const drift = findPathDrift(generated, committed);
    expect(drift.missingMethods).toContainEqual({ path: '/clients', method: 'post' });
  });

  it('detects an extra HTTP method in committed that is not in generated', () => {
    const generated = { paths: { '/clients': { get: {} } } };
    const committed = { paths: { '/clients': { get: {}, post: {} } } };
    const drift = findPathDrift(generated, committed);
    expect(drift.extraMethods).toContainEqual({ path: '/clients', method: 'post' });
  });
});

describe('findMetaDrift', () => {
  it('returns empty when info, servers, components are identical', () => {
    const spec = { info: { title: 'Test' }, servers: [], components: {} };
    expect(findMetaDrift(spec, spec)).toEqual([]);
  });

  it('detects a changed info section', () => {
    const gen = { info: { version: '1.0.0' }, servers: [], components: {} };
    const com = { info: { version: '2.0.0' }, servers: [], components: {} };
    expect(findMetaDrift(gen, com)).toContain('info');
  });

  it('detects a changed components section', () => {
    const gen = { info: {}, servers: [], components: { securitySchemes: { x: {} } } };
    const com = { info: {}, servers: [], components: {} };
    expect(findMetaDrift(gen, com)).toContain('components');
  });
});

// ---------------------------------------------------------------------------
// generateSpec() — live checks against the actual codebase
// ---------------------------------------------------------------------------

describe('generateSpec() — generated spec integrity', () => {
  let spec;

  beforeAll(() => {
    spec = generateSpec();
  });

  it('returns a valid OpenAPI 3.x object', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it('defines at least 150 paths', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(150);
  });

  it('contains no duplicate operationIds', () => {
    expect(findDuplicateOperationIds(spec)).toEqual([]);
  });

  it('every path has at least one HTTP method entry', () => {
    for (const [p, methods] of Object.entries(spec.paths)) {
      const httpMethods = Object.keys(methods).filter(m =>
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m),
      );
      if (httpMethods.length === 0) {
        throw new Error(`path ${p} has no HTTP methods`);
      }
      expect(httpMethods.length).toBeGreaterThan(0);
    }
  });

  it('docs/openapi.json is in sync with src/utils/openapi.js (no drift)', () => {
    const specPath = path.resolve(__dirname, '../docs/openapi.json');
    expect(fs.existsSync(specPath)).toBe(true);

    const committed = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const drift = findPathDrift(spec, committed);

    if (drift.missingPaths.length > 0) {
      throw new Error(`paths in generator but not in docs/openapi.json: ${drift.missingPaths.join(', ')}`);
    }
    if (drift.extraPaths.length > 0) {
      throw new Error(`paths in docs/openapi.json but not in generator: ${drift.extraPaths.join(', ')}`);
    }
    if (drift.missingMethods.length > 0) {
      throw new Error(`methods in generator but missing from docs/openapi.json: ${JSON.stringify(drift.missingMethods)}`);
    }
    if (drift.extraMethods.length > 0) {
      throw new Error(`methods in docs/openapi.json but not in generator: ${JSON.stringify(drift.extraMethods)}`);
    }

    expect(drift.missingPaths).toEqual([]);
    expect(drift.extraPaths).toEqual([]);
    expect(drift.missingMethods).toEqual([]);
    expect(drift.extraMethods).toEqual([]);

    const metaDiffs = findMetaDrift(spec, committed);
    if (metaDiffs.length > 0) {
      throw new Error(`meta sections differ: ${metaDiffs.join(', ')}`);
    }
    expect(metaDiffs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// gen-route.js — unit helpers
// ---------------------------------------------------------------------------

describe('toPascal / toCamel', () => {
  it('converts simple kebab to PascalCase', () => {
    expect(toPascal('widgets')).toBe('Widgets');
  });

  it('converts compound kebab to PascalCase', () => {
    expect(toPascal('payment-plans')).toBe('PaymentPlans');
  });

  it('converts kebab to camelCase', () => {
    expect(toCamel('payment-plans')).toBe('paymentPlans');
  });

  it('leaves single-word unchanged for PascalCase', () => {
    expect(toPascal('client')).toBe('Client');
  });
});

describe('extractResourcePaths', () => {
  const mockSpec = {
    paths: {
      '/widgets':            { get: { operationId: 'listWidgets' }, post: { operationId: 'createWidget' } },
      '/widgets/{id}':       { get: { operationId: 'getWidget' }, put: { operationId: 'updateWidget' }, delete: { operationId: 'deleteWidget' } },
      '/clients':            { get: { operationId: 'listClients' } },
      '/clients/{id}':       { get: { operationId: 'getClient' } },
      '/widgets/{id}/items': { get: { operationId: 'listWidgetItems' } },
    },
  };

  it('returns only paths that start with /<resource>', () => {
    const results = extractResourcePaths(mockSpec, 'widgets');
    const paths = results.map(r => r.specPath);
    expect(paths).toContain('/widgets');
    expect(paths).toContain('/widgets/{id}');
    expect(paths).toContain('/widgets/{id}/items');
    expect(paths).not.toContain('/clients');
  });

  it('sorts collection paths before item paths', () => {
    const results = extractResourcePaths(mockSpec, 'widgets');
    expect(results[0].specPath).toBe('/widgets');
  });

  it('returns empty array for unknown resource', () => {
    expect(extractResourcePaths(mockSpec, 'nonexistent')).toEqual([]);
  });

  it('converts {id} to :id in expressPath', () => {
    const results = extractResourcePaths(mockSpec, 'widgets');
    const item = results.find(r => r.specPath === '/widgets/{id}');
    expect(item.expressPath).toBe('/widgets/:id');
  });
});

describe('generateRouteFile', () => {
  const paths = [
    { specPath: '/widgets', expressPath: '/widgets', methods: [{ method: 'get', operationId: 'listWidgets', summary: 'List widgets' }, { method: 'post', operationId: 'createWidget', summary: 'Create widget' }] },
    { specPath: '/widgets/{id}', expressPath: '/widgets/:id', methods: [{ method: 'get', operationId: 'getWidget', summary: '' }, { method: 'delete', operationId: 'deleteWidget', summary: '' }] },
  ];

  it('includes standard route boilerplate', () => {
    const content = generateRouteFile('widgets', paths, 'Widget');
    expect(content).toContain("require('express')");
    expect(content).toContain("require('../middleware/auth')");
    expect(content).toContain("require('../middleware/rbac')");
    expect(content).toContain('module.exports = router');
  });

  it('registers GET / for list operation', () => {
    const content = generateRouteFile('widgets', paths, 'Widget');
    expect(content).toContain("router.get('/', ");
  });

  it('registers POST / for create operation', () => {
    const content = generateRouteFile('widgets', paths, 'Widget');
    expect(content).toContain("router.post('/', ");
  });

  it('registers DELETE /:id for delete operation', () => {
    const content = generateRouteFile('widgets', paths, 'Widget');
    expect(content).toContain("router.delete('/:id', ");
  });
});

describe('generateSchemaFile', () => {
  it('exports createX and updateX schemas', () => {
    const content = generateSchemaFile('widgets', 'Widget');
    expect(content).toContain('const createWidget =');
    expect(content).toContain('const updateWidget =');
    expect(content).toContain('module.exports = { createWidget, updateWidget }');
  });
});

describe('generateTestFile', () => {
  const paths = [
    { specPath: '/widgets', expressPath: '/widgets', methods: [{ method: 'get', operationId: 'listWidgets', summary: 'List widgets' }] },
  ];

  it('includes a 401 without auth test', () => {
    const content = generateTestFile('widgets', paths, 'Widget');
    expect(content).toContain("returns 401 without authentication");
    expect(content).toContain('/api/v1/widgets');
  });

  it('includes describe block for the resource', () => {
    const content = generateTestFile('widgets', paths, 'Widget');
    expect(content).toContain("describe('Widget API'");
  });
});
