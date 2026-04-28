#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — Route Stub Generator from OpenAPI Spec (P3.11)
// =============================================================================
// Reads docs/openapi.json and generates skeleton files for a new resource:
//   • src/routes/<resource>.js        — Express route file
//   • src/middleware/schemas/<resource>.js  — Zod-style validation schema
//   • tests/<resource>.test.js        — Jest integration test stub
//
// Usage:
//   pnpm run spec:gen -- --resource <name> [--tag <Tag>] [--force]
//
//   --resource  kebab-case resource name (e.g. widgets, payment-plans)
//   --tag       OpenAPI tag used in the spec (defaults to Title-cased resource)
//   --force     Overwrite existing files (default: skip if already present)
//
// Example:
//   pnpm run spec:gen -- --resource widgets --tag Widgets
// =============================================================================

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { resource: null, tag: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--resource' && argv[i + 1]) args.resource = argv[++i];
    else if (argv[i] === '--tag' && argv[i + 1]) args.tag = argv[++i];
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case to PascalCase (e.g. "payment-plans" → "PaymentPlan"). */
function toPascal(kebab) {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Convert kebab-case to camelCase (e.g. "payment-plans" → "paymentPlans"). */
function toCamel(kebab) {
  const parts = kebab.split('-');
  return parts[0] + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** Convert OpenAPI path params ({id}) to Express params (:id). */
function toExpressPath(p) {
  return p.replace(/\{([^}]+)\}/g, ':$1');
}

/**
 * Extract all paths from the spec that start with /<resource>.
 * Returns an array of { specPath, expressPath, methods } sorted by specificity
 * (collection paths before item paths).
 */
function extractResourcePaths(spec, resource) {
  const prefix = `/${resource}`;
  const result = [];

  for (const [specPath, pathObj] of Object.entries(spec.paths || {})) {
    if (specPath === prefix || specPath.startsWith(prefix + '/') || specPath.startsWith(prefix + '{')) {
      const methods = [];
      for (const [method, op] of Object.entries(pathObj)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          methods.push({ method, operationId: op.operationId || '', summary: op.summary || '' });
        }
      }
      if (methods.length > 0) {
        result.push({ specPath, expressPath: toExpressPath(specPath), methods });
      }
    }
  }

  // Collection routes before item routes
  result.sort((a, b) => {
    const aHasParam = a.specPath.includes('{');
    const bHasParam = b.specPath.includes('{');
    if (aHasParam === bHasParam) return a.specPath.localeCompare(b.specPath);
    return aHasParam ? 1 : -1;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

/**
 * Generate the content of src/routes/<resource>.js.
 */
function generateRouteFile(resource, paths, modelName) {
  const camel = toCamel(resource);
  const lines = [
    '// =============================================================================',
    `// FireISP 5.0 — ${modelName} Routes  [GENERATED — fill in implementation]`,
    '// =============================================================================',
    '',
    "const { Router } = require('express');",
    `const ${modelName} = require('../models/${modelName}');  // TODO: create this model`,
    "const { crudController } = require('../controllers/crudController');",
    "const { authenticate } = require('../middleware/auth');",
    "const { orgScope } = require('../middleware/orgScope');",
    "const { requirePermission } = require('../middleware/rbac');",
    "const { validate } = require('../middleware/validate');",
    `const { create${modelName}, update${modelName} } = require('../middleware/schemas/${resource}');`,
    '',
    'const router = Router();',
    `const ctrl = crudController(${modelName}, { cacheResource: '${resource}' });`,
    '',
    'router.use(authenticate);',
    'router.use(orgScope);',
    '',
  ];

  for (const { expressPath, methods } of paths) {
    // Derive the sub-path relative to /<resource>
    const sub = expressPath === `/${resource}` ? '/' : expressPath.slice(`/${resource}`.length);

    for (const { method, operationId, summary } of methods) {
      const comment = summary ? ` // ${summary}` : '';
      let handler;

      // Map known operationId patterns to standard ctrl methods
      if (/^list/i.test(operationId)) handler = 'ctrl.list';
      else if (/^get/i.test(operationId)) handler = 'ctrl.get';
      else if (/^create/i.test(operationId)) handler = method === 'post' && sub === '/' ? `validate(create${modelName}), ctrl.create` : 'ctrl.create';
      else if (/^update/i.test(operationId)) handler = method === 'put' ? `validate(update${modelName}), ctrl.update` : `validate(update${modelName}), ctrl.partialUpdate`;
      else if (/^delete/i.test(operationId)) handler = 'ctrl.destroy';
      else if (/^restore/i.test(operationId)) handler = 'ctrl.restore';
      else handler = `async (req, res, next) => {\n  try {\n    // TODO: implement ${operationId}\n    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: '${operationId} not yet implemented' } });\n  } catch (err) { next(err); }\n}`;

      const perm = /^list|^get/i.test(operationId)
        ? `requirePermission('${camel}.view'), `
        : /^create/i.test(operationId)
          ? `requirePermission('${camel}.create'), `
          : /^update/i.test(operationId)
            ? `requirePermission('${camel}.update'), `
            : /^delete/i.test(operationId)
              ? `requirePermission('${camel}.delete'), `
              : '';

      lines.push(`router.${method}('${sub}', ${perm}${handler});${comment}`);
    }
  }

  lines.push('', 'module.exports = router;', '');
  return lines.join('\n');
}

/**
 * Generate the content of src/middleware/schemas/<resource>.js.
 */
function generateSchemaFile(resource, modelName) {
  return [
    '// =============================================================================',
    `// FireISP 5.0 — ${modelName} Validation Schemas  [GENERATED — fill in fields]`,
    '// =============================================================================',
    '',
    `const create${modelName} = {`,
    '  // TODO: add required and optional field definitions',
    '  // Example:',
    "  //   name: { type: 'string', required: true, min: 1, max: 200 },",
    '};',
    '',
    `const update${modelName} = {`,
    '  // TODO: add updatable field definitions (same fields as create, without required)',
    '};',
    '',
    `module.exports = { create${modelName}, update${modelName} };`,
    '',
  ].join('\n');
}

/**
 * Generate the content of tests/<resource>.test.js.
 */
function generateTestFile(resource, paths, modelName) {
  const lines = [
    '// =============================================================================',
    `// FireISP 5.0 — ${modelName} Route Tests  [GENERATED stub — fill in test cases]`,
    '// =============================================================================',
    '',
    "const request = require('supertest');",
    "const app = require('../src/app');",
    '',
    `describe('${modelName} API', () => {`,
    '  // TODO: set up JWT token + mock DB if needed',
    '',
    "  it('returns 401 without authentication', async () => {",
    `    const res = await request(app).get('/api/v1/${resource}');`,
    '    expect(res.status).toBe(401);',
    '  });',
    '',
  ];

  for (const { expressPath, methods } of paths) {
    const apiPath = `/api/v1${expressPath}`.replace(':id', '999');
    for (const { method, operationId, summary } of methods) {
      if (method === 'get' && !expressPath.includes(':')) continue; // already covered above
      lines.push(
        `  // TODO: test ${method.toUpperCase()} ${apiPath} — ${summary || operationId}`,
        `  // it('${operationId} — <description>', async () => { ... });`,
        '',
      );
    }
  }

  lines.push('});', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly
// ---------------------------------------------------------------------------

/* istanbul ignore next */
if (require.main === module) {
  const args = parseArgs(process.argv);

  if (!args.resource) {
    console.error('Usage: pnpm run spec:gen -- --resource <name> [--tag <Tag>] [--force]');
    process.exit(1);
  }

  const specPath = path.resolve(__dirname, '../../docs/openapi.json');
  if (!fs.existsSync(specPath)) {
    console.error('✗  docs/openapi.json not found — run `pnpm run openapi` first.');
    process.exit(1);
  }

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (err) {
    console.error(`✗  Failed to parse docs/openapi.json: ${err.message}`);
    process.exit(1);
  }

  const resource  = args.resource;
  const modelName = toPascal(resource);
  const paths     = extractResourcePaths(spec, resource);

  if (paths.length === 0) {
    console.warn(`⚠  No paths found in spec for resource "/${resource}".`);
    console.warn('   Add the paths to src/utils/openapi.js then run `pnpm run openapi`.');
    process.exit(0);
  }

  console.log(`Generating stubs for /${resource} (${paths.length} path(s), ${paths.reduce((n, p) => n + p.methods.length, 0)} operation(s)):`);
  for (const { specPath: sp, methods } of paths) {
    console.log(`  ${sp}: ${methods.map(m => m.method.toUpperCase()).join(', ')}`);
  }

  // Determine output paths
  const routeFile  = path.resolve(__dirname, `../routes/${resource}.js`);
  const schemaFile = path.resolve(__dirname, `../middleware/schemas/${resource}.js`);
  const testFile   = path.resolve(__dirname, `../../tests/${resource}.test.js`);

  const files = [
    { dest: routeFile,  content: generateRouteFile(resource, paths, modelName),  label: 'route' },
    { dest: schemaFile, content: generateSchemaFile(resource, modelName),         label: 'schema' },
    { dest: testFile,   content: generateTestFile(resource, paths, modelName),    label: 'test stub' },
  ];

  let wrote = 0;
  for (const { dest, content, label } of files) {
    if (fs.existsSync(dest) && !args.force) {
      console.log(`  skip  ${label}: ${path.relative(process.cwd(), dest)} (already exists — use --force to overwrite)`);
    } else {
      fs.writeFileSync(dest, content, 'utf8');
      console.log(`  wrote ${label}: ${path.relative(process.cwd(), dest)}`);
      wrote++;
    }
  }

  if (wrote > 0) {
    console.log('\nNext steps:');
    console.log('  1. Mount the route in src/app.js:');
    console.log(`       const ${toCamel(resource)}Routes = require('./routes/${resource}');`);
    console.log(`       v1.use('/${resource}', ${toCamel(resource)}Routes);`);
    console.log(`  2. Create src/models/${modelName}.js (extend BaseModel)`);
    console.log(`  3. Fill in the validation schemas in src/middleware/schemas/${resource}.js`);
    console.log(`  4. Implement any non-CRUD handlers in src/routes/${resource}.js`);
    console.log(`  5. Write tests in tests/${resource}.test.js`);
  }

  process.exit(0);
}

module.exports = { parseArgs, toPascal, toCamel, toExpressPath, extractResourcePaths, generateRouteFile, generateSchemaFile, generateTestFile };
