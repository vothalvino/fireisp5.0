#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — OpenAPI Spec Generator Script
// =============================================================================
// Generates the OpenAPI 3.1 JSON spec and writes it to docs/openapi.json.
// Usage: npm run openapi
// =============================================================================

const fs = require('fs');
const path = require('path');

// Load dotenv so config module works without a running server
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { generateSpec } = require('../utils/openapi');

const spec = generateSpec();
const outputPath = path.resolve(__dirname, '../../docs/openapi.json');

fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n');

console.log(`OpenAPI spec written to ${outputPath}`);
console.log(`  Paths:   ${Object.keys(spec.paths).length}`);
console.log(`  Schemas: ${Object.keys(spec.components.schemas).length}`);
