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
      { name: 'Organizations', description: 'Organization management' },
      { name: 'Users', description: 'User management' },
      { name: 'Roles', description: 'Role and permission management' },
      { name: 'Two-Factor', description: 'TOTP two-factor authentication' },
      { name: 'API Tokens', description: 'API token management' },
      { name: 'Clients', description: 'Client management' },
      { name: 'Contracts', description: 'Contract management' },
      { name: 'Plans', description: 'Service plan management' },
      { name: 'Invoices', description: 'Invoice management' },
      { name: 'Payments', description: 'Payment management' },
      { name: 'Credit Notes', description: 'Credit note management' },
      { name: 'Quotes', description: 'Quote management' },
      { name: 'Billing', description: 'Billing workflow — periods, invoices, payments' },
      { name: 'Bulk', description: 'Bulk/batch operations' },
      { name: 'CFDI', description: 'Mexican fiscal compliance — XML generation, PAC stamping, cancellation' },
      { name: 'CFDI Documents', description: 'CFDI document CRUD' },
      { name: 'SAT Catalogs', description: 'SAT tax authority reference catalogs' },
      { name: 'Facturas Publicas', description: 'Public invoice (factura pública) management' },
      { name: 'CSD Certificates', description: 'Digital seal certificate management' },
      { name: 'PAC Providers', description: 'PAC provider configuration' },
      { name: 'Suspension', description: 'Contract suspension and reconnection' },
      { name: 'Suspension Rules', description: 'Auto-suspension rule configuration' },
      { name: 'Devices', description: 'Network device management' },
      { name: 'NAS', description: 'Network Access Server management' },
      { name: 'RADIUS', description: 'RADIUS account management' },
      { name: 'SNMP Profiles', description: 'SNMP polling profile management' },
      { name: 'Network Health', description: 'Network health snapshots' },
      { name: 'Network Links', description: 'Network link management' },
      { name: 'IP Pools', description: 'IP address pool management' },
      { name: 'IP Assignments', description: 'IP address assignments' },
      { name: 'VLANs', description: 'VLAN management' },
      { name: 'Speed Tests', description: 'Speed test results' },
      { name: 'Connection Logs', description: 'RADIUS accounting logs' },
      { name: 'Device Config Backups', description: 'Device configuration backups' },
      { name: 'Sites', description: 'Physical site management' },
      { name: 'Service Areas', description: 'Service area management' },
      { name: 'Coverage Zones', description: 'Coverage zone management' },
      { name: 'Tickets', description: 'Support ticket management' },
      { name: 'SLA Definitions', description: 'Service level agreement definitions' },
      { name: 'Alerts', description: 'Alert rules and event history' },
      { name: 'Outages', description: 'Outage tracking' },
      { name: 'Events', description: 'Server-Sent Events for real-time updates' },
      { name: 'Dashboard', description: 'Aggregated metrics and KPIs' },
      { name: 'Reports', description: 'Report generation' },
      { name: 'Usage', description: 'Data usage tracking' },
      { name: 'Checkout', description: 'Self-service checkout' },
      { name: 'Expenses', description: 'Expense tracking' },
      { name: 'Revenue Summary', description: 'Revenue summaries' },
      { name: 'Jobs', description: 'Background job management' },
      { name: 'Scheduled Tasks', description: 'Cron task management' },
      { name: 'Warehouses', description: 'Warehouse management' },
      { name: 'Inventory', description: 'Inventory and stock management' },
      { name: 'Webhooks', description: 'Webhook subscription management' },
      { name: 'Payment Gateways', description: 'Payment gateway configuration' },
      { name: 'Payment Transactions', description: 'Payment transaction history' },
      { name: 'Payment Webhooks', description: 'Payment provider webhooks' },
      { name: 'Recurring Payments', description: 'Recurring payment profiles' },
      { name: 'Settings', description: 'Organization settings' },
      { name: 'Audit Logs', description: 'Audit trail' },
      { name: 'Export', description: 'CSV export of data' },
      { name: 'Import', description: 'Bulk CSV import' },
      { name: 'Files', description: 'File upload and management' },
      { name: 'PDF', description: 'PDF document generation' },
      { name: 'Metrics', description: 'Prometheus metrics' },
      { name: 'FireRelay', description: 'Multi-node cluster management' },
      { name: 'Regulatory', description: 'Regulatory compliance filings' },
    ],
    paths: {
      // ---- Auth ----
      '/auth/register': { post: { tags: ['Auth'], summary: 'Register new user', operationId: 'register', requestBody: jsonBody('auth_register'), responses: r201('User') } },
      '/auth/login': { post: { tags: ['Auth'], summary: 'Login', operationId: 'login', requestBody: jsonBody('auth_login'), responses: r200('Token + User') } },
      '/auth/logout': { post: { tags: ['Auth'], summary: 'Logout (invalidate session)', operationId: 'logout', security: [{ bearerAuth: [] }], responses: r200('Message') } },
      '/auth/me': { get: { tags: ['Auth'], summary: 'Get current user profile', operationId: 'me', security: [{ bearerAuth: [] }], responses: r200('User') } },
      '/auth/password-reset/request': { post: { tags: ['Auth'], summary: 'Request password reset email', operationId: 'requestPasswordReset', requestBody: jsonBody('email'), responses: r200('Message') } },
      '/auth/password-reset': { post: { tags: ['Auth'], summary: 'Reset password with token', operationId: 'resetPassword', requestBody: jsonBody('token + password'), responses: r200('Message') } },
      '/auth/change-password': { post: { tags: ['Auth'], summary: 'Change password (authenticated)', operationId: 'changePassword', security: [{ bearerAuth: [] }], requestBody: jsonBody('currentPassword + newPassword'), responses: r200('Message') } },
      '/auth/verify-email': { post: { tags: ['Auth'], summary: 'Verify email with token', operationId: 'verifyEmail', requestBody: jsonBody('token'), responses: r200('Message') } },
      '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate access token using refresh token', operationId: 'refreshToken', requestBody: jsonBody('auth_refreshToken'), responses: r200('Token pair') } },
      '/auth/switch-organization': { post: { tags: ['Auth'], summary: 'Switch the active organization for a multi-tenant user', operationId: 'switchOrganization', security: [{ bearerAuth: [] }], requestBody: jsonBody('auth_switchOrganization'), responses: { 200: { description: 'New token pair bound to the requested organization', content: { 'application/json': { schema: { type: 'object' } } } }, 403: { description: 'User is not a member of the requested organization' } } } },

      // ---- Organizations ----
      ...crudPaths('organizations', 'Organizations', 'Organization'),

      // ---- Users ----
      ...crudPaths('users', 'Users', 'User'),

      // ---- Roles ----
      '/roles': {
        get: { tags: ['Roles'], summary: 'List all roles', operationId: 'listRoles', security: [{ bearerAuth: [] }], responses: r200('Role[]') },
        post: { tags: ['Roles'], summary: 'Create a role', operationId: 'createRole', security: [{ bearerAuth: [] }], requestBody: jsonBody('roles_createRole'), responses: r201('Role') },
      },
      '/roles/{id}': {
        get: { tags: ['Roles'], summary: 'Get a role with permissions', operationId: 'getRole', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Role') },
        put: { tags: ['Roles'], summary: 'Update a role', operationId: 'updateRole', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('roles_updateRole'), responses: r200('Role') },
        delete: { tags: ['Roles'], summary: 'Delete a role', operationId: 'deleteRole', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/roles/{id}/permissions': {
        post: { tags: ['Roles'], summary: 'Assign a permission to a role', operationId: 'assignPermission', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('permission_id'), responses: r201('Permission[]') },
      },
      '/roles/{id}/permissions/{permissionId}': {
        delete: { tags: ['Roles'], summary: 'Remove a permission from a role', operationId: 'removePermission', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'permissionId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- Two-Factor Auth ----
      '/2fa/status': { get: { tags: ['Two-Factor'], summary: 'Check 2FA status', operationId: 'twoFactorStatus', security: [{ bearerAuth: [] }], responses: r200('Status') } },
      '/2fa/setup': { post: { tags: ['Two-Factor'], summary: 'Generate TOTP secret', operationId: 'twoFactorSetup', security: [{ bearerAuth: [] }], responses: r200('Secret + QR URI') } },
      '/2fa/verify': { post: { tags: ['Two-Factor'], summary: 'Verify and enable 2FA', operationId: 'twoFactorVerify', security: [{ bearerAuth: [] }], requestBody: jsonBody('code'), responses: r200('Status + backup codes') } },
      '/2fa/validate': { post: { tags: ['Two-Factor'], summary: 'Validate a 2FA code', operationId: 'twoFactorValidate', security: [{ bearerAuth: [] }], requestBody: jsonBody('code'), responses: r200('Valid') } },
      '/2fa/disable': { post: { tags: ['Two-Factor'], summary: 'Disable 2FA', operationId: 'twoFactorDisable', security: [{ bearerAuth: [] }], requestBody: jsonBody('code'), responses: r200('Status') } },
      '/2fa/backup-codes': { post: { tags: ['Two-Factor'], summary: 'Regenerate backup codes', operationId: 'twoFactorBackupCodes', security: [{ bearerAuth: [] }], requestBody: jsonBody('code'), responses: r200('Codes') } },

      // ---- API Tokens ----
      ...crudPaths('api-tokens', 'API Tokens', 'ApiToken'),

      // ---- Clients ----
      ...crudPaths('clients', 'Clients', 'Client'),
      '/clients/{id}/contacts': {
        get: { tags: ['Clients'], summary: 'List client contacts', operationId: 'listClientContacts', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Contact[]') },
        post: { tags: ['Clients'], summary: 'Add a contact', operationId: 'createClientContact', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('clients_createContact'), responses: r201('Contact') },
      },
      '/clients/{id}/mx-profile': {
        get: { tags: ['Clients'], summary: 'Get MX fiscal profile', operationId: 'getClientMxProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('MxProfile') },
        put: { tags: ['Clients'], summary: 'Update MX fiscal profile', operationId: 'updateClientMxProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('clients_updateMxProfile'), responses: r200('MxProfile') },
      },
      '/clients/{id}/contracts': { get: { tags: ['Clients'], summary: 'List client contracts', operationId: 'listClientContracts', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Contract[]') } },
      '/clients/{id}/invoices': { get: { tags: ['Clients'], summary: 'List client invoices', operationId: 'listClientInvoices', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Invoice[]') } },
      '/clients/{id}/balance-ledger': { get: { tags: ['Clients'], summary: 'Get client balance ledger', operationId: 'getClientBalanceLedger', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('LedgerEntry[]') } },

      // ---- Plans ----
      ...crudPaths('plans', 'Plans', 'Plan'),

      // ---- Contracts ----
      ...crudPaths('contracts', 'Contracts', 'Contract'),
      '/contracts/{id}/suspend': { post: { tags: ['Contracts'], summary: 'Suspend a contract and kick active RADIUS session via CoA Disconnect-Request', operationId: 'suspendContract', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('rule_id + invoice_id'), responses: { 200: { description: 'Contract suspended', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is already suspended' } } } },
      '/contracts/{id}/unsuspend': { post: { tags: ['Contracts'], summary: 'Unsuspend a contract and restore RADIUS access via CoA-Request', operationId: 'unsuspendContract', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('invoice_id'), responses: { 200: { description: 'Contract unsuspended', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is not suspended' } } } },

      // ---- Invoices ----
      ...crudPaths('invoices', 'Invoices', 'Invoice'),
      '/invoices/{id}/items': {
        get: { tags: ['Invoices'], summary: 'List invoice line items', operationId: 'listInvoiceItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('InvoiceItem[]') },
        post: { tags: ['Invoices'], summary: 'Add invoice line item', operationId: 'addInvoiceItem', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('invoices_addInvoiceItem'), responses: r201('InvoiceItem') },
      },
      '/invoices/generate': { post: { tags: ['Invoices'], summary: 'Generate invoice from contract', operationId: 'generateContractInvoice', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('Invoice') } },
      '/invoices/{id}/payments': { get: { tags: ['Invoices'], summary: 'List invoice payments', operationId: 'listInvoicePayments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PaymentAllocation[]') } },

      // ---- Payments ----
      ...crudPaths('payments', 'Payments', 'Payment'),
      '/payments/{id}/allocate': { post: { tags: ['Payments'], summary: 'Allocate payment to invoice', operationId: 'allocatePaymentToInvoice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('payments_allocatePayment'), responses: r201('Allocation') } },
      '/payments/{id}/allocations': { get: { tags: ['Payments'], summary: 'List payment allocations', operationId: 'listPaymentAllocations', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Allocation[]') } },

      // ---- Credit Notes ----
      ...crudPaths('credit-notes', 'Credit Notes', 'CreditNote'),

      // ---- Quotes ----
      ...crudPaths('quotes', 'Quotes', 'Quote'),
      '/quotes/{id}/items': {
        get: { tags: ['Quotes'], summary: 'List quote line items', operationId: 'listQuoteItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('QuoteItem[]') },
        post: { tags: ['Quotes'], summary: 'Add quote line item', operationId: 'addQuoteItem', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('quotes_createQuoteItem'), responses: r201('QuoteItem') },
      },
      '/quotes/{id}/convert-to-invoice': { post: { tags: ['Quotes'], summary: 'Convert quote to invoice', operationId: 'convertQuoteToInvoice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r201('Invoice') } },

      // ---- Billing ----
      '/billing/generate-period': { post: { tags: ['Billing'], summary: 'Generate billing period for a contract', operationId: 'generatePeriod', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('BillingPeriod') } },
      '/billing/generate-invoice': { post: { tags: ['Billing'], summary: 'Generate invoice for a contract', operationId: 'generateInvoice', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('Invoice') } },
      '/billing/allocate-payment': { post: { tags: ['Billing'], summary: 'Allocate payment to invoices', operationId: 'allocatePayment', security: [{ bearerAuth: [] }], requestBody: jsonBody('payment_id + allocations'), responses: r201('Allocations') } },
      '/billing/bulk-generate': { post: { tags: ['Billing'], summary: 'Bulk generate invoices for all active contracts', operationId: 'bulkGenerate', security: [{ bearerAuth: [] }], responses: r200('Results') } },

      // ---- Bulk Operations ----
      '/bulk/invoices/generate': { post: { tags: ['Bulk'], summary: 'Mass-generate invoices', operationId: 'bulkGenerateInvoices', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_ids'), responses: r200('Results') } },
      '/bulk/suspend': { post: { tags: ['Bulk'], summary: 'Mass-suspend contracts', operationId: 'bulkSuspend', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_ids + reason'), responses: r200('Results') } },
      '/bulk/email': { post: { tags: ['Bulk'], summary: 'Mass-send emails to clients', operationId: 'bulkEmail', security: [{ bearerAuth: [] }], requestBody: jsonBody('client_ids + subject + body'), responses: r200('Results') } },

      // ---- CFDI ----
      '/cfdi/generate-xml': { post: { tags: ['CFDI'], summary: 'Generate CFDI 4.0 XML', operationId: 'cfdiGenerateXml', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id'), responses: r200('XML') } },
      '/cfdi/stamp': { post: { tags: ['CFDI'], summary: 'Stamp CFDI via PAC', operationId: 'cfdiStamp', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id'), responses: r200('UUID + status') } },
      '/cfdi/cancel': { post: { tags: ['CFDI'], summary: 'Cancel stamped CFDI', operationId: 'cfdiCancel', security: [{ bearerAuth: [] }], requestBody: jsonBody('cfdi_document_id + reason'), responses: r200('Cancellation') } },
      '/cfdi/{id}/xml': { get: { tags: ['CFDI'], summary: 'Download CFDI XML', operationId: 'cfdiDownloadXml', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/xml') } },
      '/cfdi/{id}/pdf': { get: { tags: ['CFDI'], summary: 'Download CFDI PDF', operationId: 'cfdiDownloadPdf', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/pdf') } },

      // ---- CFDI Documents ----
      ...crudPaths('cfdi-documents', 'CFDI Documents', 'CfdiDocument'),

      // ---- SAT Catalogs ----
      '/sat-catalogs/regimen-fiscal': { get: { tags: ['SAT Catalogs'], summary: 'List fiscal regimens', operationId: 'listRegimenFiscal', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/uso-cfdi': { get: { tags: ['SAT Catalogs'], summary: 'List CFDI usage types', operationId: 'listUsoCfdi', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/forma-pago': { get: { tags: ['SAT Catalogs'], summary: 'List payment forms', operationId: 'listFormaPago', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/metodo-pago': { get: { tags: ['SAT Catalogs'], summary: 'List payment methods', operationId: 'listMetodoPago', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/tipo-comprobante': { get: { tags: ['SAT Catalogs'], summary: 'List voucher types', operationId: 'listTipoComprobante', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/moneda': { get: { tags: ['SAT Catalogs'], summary: 'List currencies', operationId: 'listMoneda', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') } },
      '/sat-catalogs/clave-prod-serv': { get: { tags: ['SAT Catalogs'], summary: 'Search product/service codes', operationId: 'listClaveProdServ', security: [{ bearerAuth: [] }], parameters: [searchParam()], responses: r200('Catalog[]') } },
      '/sat-catalogs/clave-unidad': { get: { tags: ['SAT Catalogs'], summary: 'Search unit codes', operationId: 'listClaveUnidad', security: [{ bearerAuth: [] }], parameters: [searchParam()], responses: r200('Catalog[]') } },

      // ---- Facturas Publicas ----
      ...crudPaths('facturas-publicas', 'Facturas Publicas', 'FacturaPublica'),
      '/facturas-publicas/{id}/items': {
        get: { tags: ['Facturas Publicas'], summary: 'List linked invoices', operationId: 'listFacturaPublicaItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Item[]') },
        post: { tags: ['Facturas Publicas'], summary: 'Link an invoice', operationId: 'addFacturaPublicaItem', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('invoice_id'), responses: r201('Item') },
      },

      // ---- CSD Certificates ----
      ...crudPaths('csd-certificates', 'CSD Certificates', 'CsdCertificate'),

      // ---- PAC Providers ----
      ...crudPaths('pac-providers', 'PAC Providers', 'PacProvider'),

      // ---- Suspension ----
      '/suspension/evaluate': { post: { tags: ['Suspension'], summary: 'Evaluate suspension rules', operationId: 'suspensionEvaluate', security: [{ bearerAuth: [] }], responses: r200('Contracts') } },
      '/suspension/suspend': { post: { tags: ['Suspension'], summary: 'Suspend a contract', operationId: 'suspensionSuspend', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r200('Status') } },
      '/suspension/reconnect': { post: { tags: ['Suspension'], summary: 'Reconnect a suspended contract', operationId: 'suspensionReconnect', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r200('Status') } },
      '/suspension/run-auto': { post: { tags: ['Suspension'], summary: 'Run auto-suspend rules', operationId: 'suspensionRunAuto', security: [{ bearerAuth: [] }], responses: r200('Results') } },

      // ---- Suspension Rules ----
      ...crudPaths('suspension-rules', 'Suspension Rules', 'SuspensionRule'),

      // ---- Devices ----
      ...crudPaths('devices', 'Devices', 'Device'),

      // ---- NAS ----
      ...crudPaths('nas', 'NAS', 'Nas'),

      // ---- RADIUS ----
      ...crudPaths('radius', 'RADIUS', 'RadiusAccount'),
      '/radius/{id}/disconnect': { post: { tags: ['RADIUS'], summary: 'Disconnect active PPPoE session for a RADIUS account', operationId: 'disconnectRadiusSession', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Disconnect result') } },

      // ---- SNMP Profiles ----
      ...crudPaths('snmp-profiles', 'SNMP Profiles', 'SnmpProfile'),

      // ---- Network Health ----
      '/network-health': { get: { tags: ['Network Health'], summary: 'List network health snapshots', operationId: 'listNetworkHealth', security: [{ bearerAuth: [] }], responses: r200('Snapshot[]') } },

      // ---- Network Links ----
      ...crudPaths('network-links', 'Network Links', 'NetworkLink'),

      // ---- IP Pools ----
      ...crudPaths('ip-pools', 'IP Pools', 'IpPool'),

      // ---- IP Assignments ----
      ...crudPaths('ip-assignments', 'IP Assignments', 'IpAssignment'),

      // ---- VLANs ----
      ...crudPaths('vlans', 'VLANs', 'Vlan'),

      // ---- Speed Tests ----
      ...crudPaths('speed-tests', 'Speed Tests', 'SpeedTest'),

      // ---- Connection Logs ----
      '/connection-logs': { get: { tags: ['Connection Logs'], summary: 'List connection logs', operationId: 'listConnectionLogs', security: [{ bearerAuth: [] }], responses: r200('ConnectionLog[]') } },
      '/connection-logs/active': { get: { tags: ['Connection Logs'], summary: 'List active PPPoE sessions (start events with no stop)', operationId: 'listActiveRadiusSessions', security: [{ bearerAuth: [] }], responses: r200('Session[]') } },
      '/connection-logs/daily-usage': { get: { tags: ['Connection Logs'], summary: 'Daily data usage aggregated per client', operationId: 'getDailyUsage', security: [{ bearerAuth: [] }], responses: r200('DailyUsage[]') } },
      '/connection-logs/top-consumers': { get: { tags: ['Connection Logs'], summary: 'Top N clients by data usage in a period', operationId: 'getTopConsumers', security: [{ bearerAuth: [] }], responses: r200('TopConsumer[]') } },

      // ---- Device Config Backups ----
      ...crudPaths('device-config-backups', 'Device Config Backups', 'DeviceConfigBackup'),

      // ---- Sites ----
      ...crudPaths('sites', 'Sites', 'Site'),

      // ---- Service Areas ----
      ...crudPaths('service-areas', 'Service Areas', 'ServiceArea'),

      // ---- Coverage Zones ----
      ...crudPaths('coverage-zones', 'Coverage Zones', 'CoverageZone'),

      // ---- Tickets ----
      ...crudPaths('tickets', 'Tickets', 'Ticket'),

      // ---- SLA Definitions ----
      ...crudPaths('sla-definitions', 'SLA Definitions', 'SlaDefinition'),

      // ---- Alerts ----
      '/alerts/rules': {
        get: { tags: ['Alerts'], summary: 'List alert rules', operationId: 'listAlertRules', security: [{ bearerAuth: [] }], responses: r200('AlertRule[]') },
        post: { tags: ['Alerts'], summary: 'Create alert rule', operationId: 'createAlertRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('alerts_createRule'), responses: r201('AlertRule') },
      },
      '/alerts/rules/{id}': {
        put: { tags: ['Alerts'], summary: 'Update alert rule', operationId: 'updateAlertRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('alerts_updateRule'), responses: r200('AlertRule') },
        delete: { tags: ['Alerts'], summary: 'Delete alert rule', operationId: 'deleteAlertRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/alerts/events': { get: { tags: ['Alerts'], summary: 'Alert event history', operationId: 'listAlertEvents', security: [{ bearerAuth: [] }], responses: r200('AlertEvent[]') } },
      '/alerts/events/{id}/acknowledge': { post: { tags: ['Alerts'], summary: 'Acknowledge an alert', operationId: 'acknowledgeAlert', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Status') } },
      '/alerts/evaluate': { post: { tags: ['Alerts'], summary: 'Trigger alert evaluation', operationId: 'evaluateAlerts', security: [{ bearerAuth: [] }], responses: r200('Results') } },

      // ---- Outages ----
      ...crudPaths('outages', 'Outages', 'Outage'),

      // ---- Events (SSE) ----
      '/events/stream': { get: { tags: ['Events'], summary: 'Organization notification stream (SSE)', operationId: 'eventStream', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSE event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
      '/events/metrics': { get: { tags: ['Events'], summary: 'Live SNMP metrics stream (SSE)', operationId: 'eventMetrics', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSE event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
      '/events/tickets/{id}': { get: { tags: ['Events'], summary: 'Ticket update stream (SSE)', operationId: 'eventTicket', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { 200: { description: 'SSE event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
      '/events/outages': { get: { tags: ['Events'], summary: 'Outage alert stream (SSE)', operationId: 'eventOutages', security: [{ bearerAuth: [] }], responses: { 200: { description: 'SSE event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
      '/events/stats': { get: { tags: ['Events'], summary: 'SSE connection stats', operationId: 'eventStats', security: [{ bearerAuth: [] }], responses: r200('Stats') } },

      // ---- Dashboard ----
      '/dashboard/summary': { get: { tags: ['Dashboard'], summary: 'Organization KPI summary', operationId: 'dashboardSummary', security: [{ bearerAuth: [] }], responses: r200('KPIs') } },
      '/dashboard/revenue': { get: { tags: ['Dashboard'], summary: 'Monthly revenue (12 months)', operationId: 'dashboardRevenue', security: [{ bearerAuth: [] }], responses: r200('Revenue') } },
      '/dashboard/mrr': { get: { tags: ['Dashboard'], summary: 'MRR and ARPU', operationId: 'dashboardMrr', security: [{ bearerAuth: [] }], responses: r200('MRR/ARPU') } },
      '/dashboard/device-health': { get: { tags: ['Dashboard'], summary: 'Device health overview', operationId: 'dashboardDeviceHealth', security: [{ bearerAuth: [] }], responses: r200('Health') } },
      '/dashboard/overdue': { get: { tags: ['Dashboard'], summary: 'Overdue invoices', operationId: 'dashboardOverdue', security: [{ bearerAuth: [] }], responses: r200('Invoices') } },

      // ---- Reports ----
      '/reports/revenue': { get: { tags: ['Reports'], summary: 'Revenue report', operationId: 'revenueReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/clients': { get: { tags: ['Reports'], summary: 'Client report', operationId: 'clientReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/usage': { get: { tags: ['Reports'], summary: 'Usage report', operationId: 'usageReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/financial': { get: { tags: ['Reports'], summary: 'Financial summary report', operationId: 'financialReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/aging': { get: { tags: ['Reports'], summary: 'Accounts receivable aging report', operationId: 'agingReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/subscriber-growth': { get: { tags: ['Reports'], summary: 'Subscriber growth and churn report', operationId: 'subscriberGrowthReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/technicians': { get: { tags: ['Reports'], summary: 'Technician productivity report', operationId: 'technicianReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },

      // ---- Usage ----
      '/usage': { get: { tags: ['Usage'], summary: 'List usage records', operationId: 'listUsage', security: [{ bearerAuth: [] }], responses: r200('Usage[]') } },
      '/usage/{contractId}': { get: { tags: ['Usage'], summary: 'Get usage for a contract', operationId: 'getContractUsage', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Usage') } },

      // ---- Checkout ----
      '/checkout/create-session': { post: { tags: ['Checkout'], summary: 'Create checkout session', operationId: 'createCheckoutSession', security: [{ bearerAuth: [] }], requestBody: jsonBody('invoice_id + gateway'), responses: r201('Session') } },

      // ---- Expenses ----
      ...crudPaths('expenses', 'Expenses', 'Expense'),

      // ---- Revenue Summary ----
      '/revenue-summary': { get: { tags: ['Revenue Summary'], summary: 'List revenue summaries', operationId: 'listRevenueSummaries', security: [{ bearerAuth: [] }], responses: r200('RevenueSummary[]') } },

      // ---- Jobs ----
      ...crudPaths('jobs', 'Jobs', 'Job'),

      // ---- Scheduled Tasks ----
      ...crudPaths('scheduled-tasks', 'Scheduled Tasks', 'ScheduledTask'),

      // ---- Warehouses ----
      ...crudPaths('warehouses', 'Warehouses', 'Warehouse'),

      // ---- Inventory ----
      ...crudPaths('inventory', 'Inventory', 'InventoryItem'),

      // ---- Webhooks ----
      ...crudPaths('webhooks', 'Webhooks', 'Webhook'),

      // ---- Payment Gateways ----
      ...crudPaths('payment-gateways', 'Payment Gateways', 'PaymentGateway'),

      // ---- Payment Transactions ----
      '/payment-transactions': { get: { tags: ['Payment Transactions'], summary: 'List payment transactions', operationId: 'listPaymentTransactions', security: [{ bearerAuth: [] }], responses: r200('PaymentTransaction[]') } },

      // ---- Payment Webhooks ----
      '/payment-webhooks/stripe': { post: { tags: ['Payment Webhooks'], summary: 'Stripe webhook endpoint', operationId: 'stripeWebhook', responses: r200('OK') } },
      '/payment-webhooks/conekta': { post: { tags: ['Payment Webhooks'], summary: 'Conekta webhook endpoint', operationId: 'conektaWebhook', responses: r200('OK') } },

      // ---- Recurring Payment Profiles ----
      ...crudPaths('recurring-payment-profiles', 'Recurring Payments', 'RecurringPaymentProfile'),

      // ---- Settings ----
      '/settings': {
        get: { tags: ['Settings'], summary: 'List settings', operationId: 'listSettings', security: [{ bearerAuth: [] }], responses: r200('Setting[]') },
        put: { tags: ['Settings'], summary: 'Update settings', operationId: 'updateSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('settings'), responses: r200('Setting[]') },
      },

      // ---- Audit Logs ----
      '/audit-logs': { get: { tags: ['Audit Logs'], summary: 'List audit log entries', operationId: 'listAuditLogs', security: [{ bearerAuth: [] }], responses: r200('AuditLog[]') } },

      // ---- Export ----
      '/export/invoices': { get: { tags: ['Export'], summary: 'Export invoices as CSV', operationId: 'exportInvoices', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/clients': { get: { tags: ['Export'], summary: 'Export clients as CSV', operationId: 'exportClients', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/contracts': { get: { tags: ['Export'], summary: 'Export contracts as CSV', operationId: 'exportContracts', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/payments': { get: { tags: ['Export'], summary: 'Export payments as CSV', operationId: 'exportPayments', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },

      // ---- Import ----
      '/import/clients': { post: { tags: ['Import'], summary: 'Bulk import clients from CSV', operationId: 'importClients', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/devices': { post: { tags: ['Import'], summary: 'Bulk import devices from CSV', operationId: 'importDevices', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/contracts': { post: { tags: ['Import'], summary: 'Bulk import contracts from CSV', operationId: 'importContracts', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },

      // ---- Files ----
      '/files/upload': { post: { tags: ['Files'], summary: 'Upload a file (multipart/form-data)', operationId: 'uploadFile', security: [{ bearerAuth: [] }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, entity_type: { type: 'string' }, entity_id: { type: 'integer' } } } } } }, responses: r201('File') } },

      // ---- PDF ----
      '/pdf/invoices/{id}': { get: { tags: ['PDF'], summary: 'Download invoice PDF', operationId: 'pdfInvoice', security: [{ bearerAuth: [] }], parameters: [idParam(), localeParam()], responses: r200File('application/pdf') } },
      '/pdf/credit-notes/{id}': { get: { tags: ['PDF'], summary: 'Download credit note PDF', operationId: 'pdfCreditNote', security: [{ bearerAuth: [] }], parameters: [idParam(), localeParam()], responses: r200File('application/pdf') } },
      '/pdf/quotes/{id}': { get: { tags: ['PDF'], summary: 'Download quote PDF', operationId: 'pdfQuote', security: [{ bearerAuth: [] }], parameters: [idParam(), localeParam()], responses: r200File('application/pdf') } },
      '/pdf/cfdi/{id}': { get: { tags: ['PDF'], summary: 'Download CFDI PDF', operationId: 'pdfCfdi', security: [{ bearerAuth: [] }], parameters: [idParam(), localeParam()], responses: r200File('application/pdf') } },

      // ---- Metrics ----
      '/metrics': { get: { tags: ['Metrics'], summary: 'Prometheus metrics', operationId: 'getMetrics', responses: { 200: { description: 'Prometheus exposition format', content: { 'text/plain': { schema: { type: 'string' } } } } } } },

      // ---- FireRelay ----
      '/firerelay/health': { get: { tags: ['FireRelay'], summary: 'Node health (no auth)', operationId: 'firerelayHealth', responses: r200('NodeHealth') } },
      '/firerelay/nodes': {
        get: { tags: ['FireRelay'], summary: 'List cluster nodes', operationId: 'listFirerelayNodes', security: [{ bearerAuth: [] }], responses: r200('Node[]') },
        post: { tags: ['FireRelay'], summary: 'Register a node', operationId: 'registerFirerelayNode', security: [{ bearerAuth: [] }], requestBody: jsonBody('firerelay_firerelayNode'), responses: r201('Node') },
      },
      '/firerelay/nodes/{id}': {
        put: { tags: ['FireRelay'], summary: 'Update node status', operationId: 'updateFirerelayNode', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('firerelay_firerelayNodeUpdate'), responses: r200('Node') },
        delete: { tags: ['FireRelay'], summary: 'Deregister a node', operationId: 'deleteFirerelayNode', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- Regulatory ----
      ...crudPaths('concession-titles', 'Regulatory', 'ConcessionTitle'),
      ...crudPaths('regulatory-filings', 'Regulatory', 'RegulatoryFiling'),
      ...crudPaths('ift-statistical-reports', 'Regulatory', 'IftStatisticalReport'),
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
function r204() {
  return { 204: { description: 'No content' } };
}
function r200File(mime) {
  return { 200: { description: 'File download', content: { [mime]: { schema: { type: 'string', format: 'binary' } } } } };
}
function idParam() {
  return { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
}
function searchParam() {
  return { name: 'search', in: 'query', required: false, schema: { type: 'string' }, description: 'Search filter' };
}
function localeParam() {
  return { name: 'locale', in: 'query', required: false, schema: { type: 'string', enum: ['en', 'es'], default: 'en' }, description: 'PDF language' };
}

/**
 * Generate standard CRUD paths for a resource.
 */
function crudPaths(basePath, tag, modelName) {
  return {
    [`/${basePath}`]: {
      get: { tags: [tag], summary: `List ${basePath}`, operationId: `list${modelName}s`, security: [{ bearerAuth: [] }], responses: r200(`${modelName}[]`) },
      post: { tags: [tag], summary: `Create a ${modelName}`, operationId: `create${modelName}`, security: [{ bearerAuth: [] }], requestBody: jsonBody(modelName), responses: r201(modelName) },
    },
    [`/${basePath}/{id}`]: {
      get: { tags: [tag], summary: `Get a ${modelName}`, operationId: `get${modelName}`, security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200(modelName) },
      put: { tags: [tag], summary: `Update a ${modelName}`, operationId: `update${modelName}`, security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody(modelName), responses: r200(modelName) },
      delete: { tags: [tag], summary: `Delete a ${modelName}`, operationId: `delete${modelName}`, security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
    },
  };
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
