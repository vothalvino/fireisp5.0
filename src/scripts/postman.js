#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — Postman Collection Generator
// =============================================================================
// Reads docs/openapi.json and produces docs/postman-collection.json in Postman
// Collection v2.1 format. Run with: node src/scripts/postman.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const OPENAPI_PATH = path.resolve(__dirname, '../../docs/openapi.json');
const OUTPUT_PATH = path.resolve(__dirname, '../../docs/postman-collection.json');

function main() {
  if (!fs.existsSync(OPENAPI_PATH)) {
    console.error('Error: docs/openapi.json not found. Run `npm run openapi` first.');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
  const collection = convertToPostman(spec);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(collection, null, 2));
  console.log(`Postman collection written to ${OUTPUT_PATH}`);
  console.log(`  ${collection.item.length} folders, ${countRequests(collection)} requests`);
}

function convertToPostman(spec) {
  const baseUrl = (spec.servers && spec.servers[0] && spec.servers[0].url) || 'http://localhost:3000';

  // Group by tag
  const tagMap = new Map();
  const paths = spec.paths || {};

  for (const [pathStr, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) continue;

      const tags = operation.tags || ['Untagged'];
      const tag = tags[0];

      if (!tagMap.has(tag)) {
        tagMap.set(tag, []);
      }

      const request = buildRequest(method, pathStr, operation, baseUrl);
      tagMap.get(tag).push({
        name: operation.summary || `${method.toUpperCase()} ${pathStr}`,
        request,
        response: [],
      });
    }
  }

  // Convert tag groups to Postman folders
  const items = [];
  for (const [tag, requests] of tagMap.entries()) {
    items.push({
      name: tag,
      item: requests,
    });
  }

  return {
    info: {
      name: spec.info.title || 'FireISP 5.0 API',
      description: spec.info.description || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      version: spec.info.version || '5.0.0',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{access_token}}', type: 'string' }],
    },
    variable: [
      { key: 'base_url', value: baseUrl, type: 'string' },
      { key: 'access_token', value: '', type: 'string' },
    ],
    item: items,
  };
}

function buildRequest(method, pathStr, operation, _baseUrl) {
  // Convert OpenAPI path params {id} to Postman :id
  const postmanPath = pathStr.replace(/\{([^}]+)\}/g, ':$1');
  const urlParts = postmanPath.split('/').filter(Boolean);

  const request = {
    method: method.toUpperCase(),
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: {
      raw: `{{base_url}}${postmanPath}`,
      host: ['{{base_url}}'],
      path: urlParts,
    },
    description: operation.description || operation.summary || '',
  };

  // Add query parameters
  if (operation.parameters) {
    const queryParams = operation.parameters
      .filter(p => p.in === 'query')
      .map(p => ({
        key: p.name,
        value: '',
        description: p.description || '',
        disabled: !p.required,
      }));
    if (queryParams.length > 0) {
      request.url.query = queryParams;
    }

    // Add path variables
    const pathParams = operation.parameters
      .filter(p => p.in === 'path')
      .map(p => ({
        key: p.name,
        value: '1',
        description: p.description || '',
      }));
    if (pathParams.length > 0) {
      request.url.variable = pathParams;
    }
  }

  // Add request body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(request.method) && operation.requestBody) {
    const content = operation.requestBody.content;
    const jsonContent = content && content['application/json'];
    if (jsonContent && jsonContent.schema) {
      const exampleBody = generateExampleFromSchema(jsonContent.schema);
      request.body = {
        mode: 'raw',
        raw: JSON.stringify(exampleBody, null, 2),
        options: { raw: { language: 'json' } },
      };
    }
  }

  return request;
}

function generateExampleFromSchema(schema) {
  if (!schema) return {};

  if (schema.example) return schema.example;

  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      obj[key] = generateExampleValue(prop);
    }
    return obj;
  }

  if (schema.type === 'array') {
    return [generateExampleFromSchema(schema.items)];
  }

  return {};
}

function generateExampleValue(prop) {
  if (prop.example !== undefined) return prop.example;
  if (prop.default !== undefined) return prop.default;
  if (prop.enum && prop.enum.length > 0) return prop.enum[0];

  switch (prop.type) {
    case 'string':
      if (prop.format === 'email') return 'user@example.com';
      if (prop.format === 'date') return '2025-01-01';
      if (prop.format === 'date-time') return '2025-01-01T00:00:00Z';
      if (prop.format === 'uri') return 'https://example.com';
      return '';
    case 'integer':
    case 'number':
      return prop.minimum !== undefined ? prop.minimum : 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return generateExampleFromSchema(prop);
    default:
      return '';
  }
}

function countRequests(collection) {
  let count = 0;
  for (const folder of collection.item) {
    count += (folder.item || []).length;
  }
  return count;
}

main();
