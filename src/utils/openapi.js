// =============================================================================
// FireISP 5.0 — OpenAPI Spec Generator
// =============================================================================
// Auto-generates an OpenAPI 3.1 spec from the registered routes and schemas.
// Serves Swagger UI at /api/docs and raw spec at /api/docs/openapi.json.
// =============================================================================

const fs = require('fs');
const path = require('path');

/**
 * Build OpenAPI spec from routes and schema files.
 */
function generateSpec() {
  const schemaDir = path.join(__dirname, '../middleware/schemas');
  const schemas = {};

  // Load all schema files and convert to OpenAPI format
  if (fs.existsSync(schemaDir)) {
    for (const file of fs.readdirSync(schemaDir).filter(f => f.endsWith('.js'))) {
      const name = file.replace('.js', '');
      const mod = require(path.join(schemaDir, file));
      for (const [key, schema] of Object.entries(mod)) {
        schemas[`${name}_${key}`] = convertSchemaToOpenApi(schema);
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'FireISP 5.0 API',
      version: '5.0.0',
      description: 'Open source ISP management — customers, plans, billing, network monitoring, and Mexican fiscal compliance (CFDI 4.0).',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      { url: '/api', description: 'FireISP API' },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and user management' },
      { name: 'Billing', description: 'Billing workflow — periods, invoices, payments' },
      { name: 'CFDI', description: 'Mexican fiscal compliance — XML generation, PAC stamping, cancellation' },
      { name: 'Suspension', description: 'Contract suspension and reconnection' },
      { name: 'Dashboard', description: 'Aggregated metrics and KPIs' },
      { name: 'Export', description: 'CSV export of data' },
      { name: 'Import', description: 'Bulk CSV import' },
      { name: 'Clients', description: 'Client management' },
      { name: 'Contracts', description: 'Contract management' },
      { name: 'Invoices', description: 'Invoice management' },
      { name: 'Payments', description: 'Payment management' },
      { name: 'Devices', description: 'Network device management' },
      { name: 'Files', description: 'File upload and management' },
    ],
    paths: {
      '/auth/register': { post: { tags: ['Auth'], summary: 'Register new user', operationId: 'register', requestBody: jsonBody('auth_register'), responses: r201('User') } },
      '/auth/login': { post: { tags: ['Auth'], summary: 'Login', operationId: 'login', requestBody: jsonBody('auth_login'), responses: r200('Token + User') } },
      '/auth/logout': { post: { tags: ['Auth'], summary: 'Logout (invalidate session)', operationId: 'logout', security: [{ bearerAuth: [] }], responses: r200('Message') } },
      '/auth/me': { get: { tags: ['Auth'], summary: 'Get current user profile', operationId: 'me', security: [{ bearerAuth: [] }], responses: r200('User') } },
      '/auth/password-reset/request': { post: { tags: ['Auth'], summary: 'Request password reset email', operationId: 'requestPasswordReset', requestBody: jsonBody('email'), responses: r200('Message') } },
      '/auth/password-reset': { post: { tags: ['Auth'], summary: 'Reset password with token', operationId: 'resetPassword', requestBody: jsonBody('token + password'), responses: r200('Message') } },
      '/auth/change-password': { post: { tags: ['Auth'], summary: 'Change password (authenticated)', operationId: 'changePassword', security: [{ bearerAuth: [] }], requestBody: jsonBody('currentPassword + newPassword'), responses: r200('Message') } },
      '/auth/verify-email': { post: { tags: ['Auth'], summary: 'Verify email with token', operationId: 'verifyEmail', requestBody: jsonBody('token'), responses: r200('Message') } },
      '/billing/generate-period': { post: { tags: ['Billing'], summary: 'Generate billing period for a contract', operationId: 'generatePeriod', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('BillingPeriod') } },
      '/billing/generate-invoice': { post: { tags: ['Billing'], summary: 'Generate invoice for a contract', operationId: 'generateInvoice', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('Invoice') } },
      '/billing/allocate-payment': { post: { tags: ['Billing'], summary: 'Allocate payment to invoices', operationId: 'allocatePayment', security: [{ bearerAuth: [] }], requestBody: jsonBody('payment_id + allocations'), responses: r201('Allocations') } },
      '/billing/bulk-generate': { post: { tags: ['Billing'], summary: 'Bulk generate invoices for all active contracts', operationId: 'bulkGenerate', security: [{ bearerAuth: [] }], responses: r200('Results') } },
      '/cfdi/generate-xml': { post: { tags: ['CFDI'], summary: 'Generate CFDI 4.0 XML', operationId: 'cfdiGenerateXml', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id'), responses: r200('XML') } },
      '/cfdi/stamp': { post: { tags: ['CFDI'], summary: 'Stamp CFDI via PAC', operationId: 'cfdiStamp', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id'), responses: r200('UUID + status') } },
      '/cfdi/cancel': { post: { tags: ['CFDI'], summary: 'Cancel stamped CFDI', operationId: 'cfdiCancel', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id + reason'), responses: r200('Cancellation') } },
      '/cfdi/{id}/xml': { get: { tags: ['CFDI'], summary: 'Download CFDI XML', operationId: 'cfdiDownloadXml', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/xml') } },
      '/cfdi/{id}/pdf': { get: { tags: ['CFDI'], summary: 'Download CFDI PDF', operationId: 'cfdiDownloadPdf', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/pdf') } },
      '/suspension/evaluate': { post: { tags: ['Suspension'], summary: 'Evaluate suspension rules', operationId: 'suspensionEvaluate', security: [{ bearerAuth: [] }], responses: r200('Contracts') } },
      '/suspension/suspend': { post: { tags: ['Suspension'], summary: 'Suspend a contract', operationId: 'suspensionSuspend', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r200('Status') } },
      '/suspension/reconnect': { post: { tags: ['Suspension'], summary: 'Reconnect a suspended contract', operationId: 'suspensionReconnect', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r200('Status') } },
      '/suspension/run-auto': { post: { tags: ['Suspension'], summary: 'Run auto-suspend rules', operationId: 'suspensionRunAuto', security: [{ bearerAuth: [] }], responses: r200('Results') } },
      '/dashboard/summary': { get: { tags: ['Dashboard'], summary: 'Organization KPI summary', operationId: 'dashboardSummary', security: [{ bearerAuth: [] }], responses: r200('KPIs') } },
      '/dashboard/revenue': { get: { tags: ['Dashboard'], summary: 'Monthly revenue (12 months)', operationId: 'dashboardRevenue', security: [{ bearerAuth: [] }], responses: r200('Revenue') } },
      '/dashboard/mrr': { get: { tags: ['Dashboard'], summary: 'MRR and ARPU', operationId: 'dashboardMrr', security: [{ bearerAuth: [] }], responses: r200('MRR/ARPU') } },
      '/dashboard/device-health': { get: { tags: ['Dashboard'], summary: 'Device health overview', operationId: 'dashboardDeviceHealth', security: [{ bearerAuth: [] }], responses: r200('Health') } },
      '/dashboard/overdue': { get: { tags: ['Dashboard'], summary: 'Overdue invoices', operationId: 'dashboardOverdue', security: [{ bearerAuth: [] }], responses: r200('Invoices') } },
      '/export/invoices': { get: { tags: ['Export'], summary: 'Export invoices as CSV', operationId: 'exportInvoices', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/clients': { get: { tags: ['Export'], summary: 'Export clients as CSV', operationId: 'exportClients', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/contracts': { get: { tags: ['Export'], summary: 'Export contracts as CSV', operationId: 'exportContracts', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/payments': { get: { tags: ['Export'], summary: 'Export payments as CSV', operationId: 'exportPayments', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/import/clients': { post: { tags: ['Import'], summary: 'Bulk import clients from CSV', operationId: 'importClients', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/devices': { post: { tags: ['Import'], summary: 'Bulk import devices from CSV', operationId: 'importDevices', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/contracts': { post: { tags: ['Import'], summary: 'Bulk import contracts from CSV', operationId: 'importContracts', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/files/upload': { post: { tags: ['Files'], summary: 'Upload a file (multipart/form-data)', operationId: 'uploadFile', security: [{ bearerAuth: [] }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, entity_type: { type: 'string' }, entity_id: { type: 'integer' } } } } } }, responses: r201('File') } },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas,
    },
  };
}

// Helper functions for spec generation
function jsonBody(desc) {
  return { description: desc, content: { 'application/json': { schema: { type: 'object' } } } };
}
function r200(desc) {
  return { 200: { description: desc, content: { 'application/json': { schema: { type: 'object' } } } } };
}
function r201(desc) {
  return { 201: { description: desc, content: { 'application/json': { schema: { type: 'object' } } } } };
}
function r200File(mime) {
  return { 200: { description: 'File download', content: { [mime]: { schema: { type: 'string', format: 'binary' } } } } };
}
function idParam() {
  return { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
}

/**
 * Convert a FireISP validation schema to OpenAPI schema format.
 */
function convertSchemaToOpenApi(schema) {
  const properties = {};
  const required = [];

  for (const [field, rules] of Object.entries(schema)) {
    const prop = {};

    switch (rules.type) {
      case 'number': prop.type = 'number'; break;
      case 'email': prop.type = 'string'; prop.format = 'email'; break;
      case 'boolean': prop.type = 'boolean'; break;
      default: prop.type = 'string';
    }

    if (rules.min !== undefined) prop.minimum = rules.min;
    if (rules.max !== undefined) prop.maximum = rules.max;
    if (rules.enum) prop.enum = rules.enum;
    if (rules.pattern) prop.pattern = rules.pattern;
    if (rules.required) required.push(field);

    properties[field] = prop;
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  };
}

/**
 * Mount OpenAPI spec endpoint on an Express app.
 */
function mountApiDocs(app) {
  const spec = generateSpec();

  app.get('/api/docs/openapi.json', (_req, res) => {
    res.json(spec);
  });

  app.get('/api/docs', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>FireISP 5.0 API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head><body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs/openapi.json', dom_id: '#swagger-ui' });</script>
</body></html>`);
  });
}

module.exports = { generateSpec, convertSchemaToOpenApi, mountApiDocs };
