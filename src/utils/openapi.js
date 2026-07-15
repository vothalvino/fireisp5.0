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
    // Sort so component schema order is deterministic across filesystems
    // (readdir order differs between Windows and Linux → spec-drift CI failures)
    for (const file of fs.readdirSync(schemaDir).filter(f => f.endsWith('.js')).sort()) {
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
      { name: 'Client Groups', description: 'Family/account grouping (shared billing)' },
      { name: 'Leads', description: 'Lead capture and prospect pipeline' },
      { name: 'Service Orders', description: 'Service order workflow — new → in_process → done, or cancelled' },
      { name: 'Win-back Campaigns', description: 'Win-back campaigns for cancelled customers' },
      { name: 'Lifecycle', description: 'Customer lifecycle analytics — churn and at-risk' },
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
      { name: 'Interactions', description: 'Client interaction log and activity timeline' },
      { name: 'Follow-up Reminders', description: 'Scheduled client follow-ups with automated due notifications' },
      { name: 'Satisfaction Surveys', description: 'NPS / CSAT surveys and metrics' },
      { name: 'Escalations', description: 'Ticket escalation management for unresolved issues' },
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
      { name: 'Scheduled Tasks', description: 'Cron task management' },
      { name: 'Warehouses', description: 'Warehouse management' },
      { name: 'Inventory', description: 'Inventory and stock management' },
      { name: 'Webhooks', description: 'Webhook subscription management' },
      { name: 'Payment Gateways', description: 'Payment gateway configuration' },
      { name: 'Payment Transactions', description: 'Payment transaction history' },
      { name: 'Payment Webhooks', description: 'Payment provider webhooks' },
      { name: 'Recurring Payments', description: 'Recurring payment profiles' },
      { name: 'Promotions', description: 'Promotion and coupon management' },
      { name: 'Tax Rules', description: 'Regional tax rule configuration' },
      { name: 'Tax Rates', description: 'Tax rate configuration' },
      { name: 'Settings', description: 'Organization settings' },
      { name: 'Audit Logs', description: 'Audit trail' },
      { name: 'Export', description: 'CSV export of data' },
      { name: 'Import', description: 'Bulk CSV import' },
      { name: 'Files', description: 'File upload and management' },
      { name: 'PDF', description: 'PDF document generation' },
      { name: 'Metrics', description: 'Prometheus metrics' },
      { name: 'FireRelay', description: 'Multi-node cluster management' },
      { name: 'Regulatory', description: 'Regulatory compliance filings' },
      { name: 'PROFECO Complaints', description: 'PROFECO consumer complaint register and export' },
      { name: 'Communication', description: 'Bulk campaigns, delivery tracking, and DND preferences — §1.4' },
      { name: 'AI Assistant', description: 'AI reply assistant — policy, providers, phrase library, reply generation, audit logs' },
      { name: 'DSAR', description: 'Data subject access requests (LFPDPPP / GDPR)' },
      { name: 'DR Drill', description: 'Disaster-recovery drill status' },
      { name: 'Invoice Settings', description: 'Per-org invoice branding — logo, color, footer legal text, payment instructions — §2.2B' },
      { name: 'Email Settings', description: 'Per-org outbound SMTP configuration — password never returned, write-only three-state contract' },
      { name: 'Late Fee Rules', description: 'Configurable late fee rules applied to overdue invoices — §2.2B' },
      { name: 'Payment Reminders', description: 'Automated payment reminder schedule settings — §2.2B' },
      { name: 'Payment Plans', description: 'Payment plan / installment management for overdue invoices — §2.3' },
      { name: 'Cash Reconciliation', description: 'Field agent cash collection reconciliation sessions — §2.3' },
      { name: 'Refund Requests', description: 'Refund request workflow — create, review, and process refunds — §2.5.1' },
      { name: 'Billing Disputes', description: 'Dispute tracking with evidence attachment — §2.5.2' },
      { name: 'Chargebacks', description: 'Chargeback management with gateway webhook integration — §2.5.3' },
      { name: 'Billing Adjustments', description: 'Billing adjustment log with audit trail — §2.5.4' },
      { name: 'Subscriber Certificates', description: 'EAP-TLS subscriber certificate metadata registry — §3.1' },
      { name: 'PPPoE Service Profiles', description: 'PPPoE service profile management — MTU, DNS, rate-limit, address-list — §4B' },
      { name: 'PPPoE', description: 'PPPoE diagnostics (auth failures, MTU issues) and M2M event log ingest — §4B' },
      { name: 'DHCP Servers', description: 'DHCP server integrations (ISC Kea, MikroTik) and static reservations — §5.1' },
      { name: 'NAT Management', description: 'CGNAT/NAT pool management — §5.1' },
      { name: 'PTR Records', description: 'Reverse DNS PTR record management — §5.1' },
      { name: 'IPv6 Management', description: 'DHCPv6, SLAAC, RA management, RA Guard, subnet visualization — §5.2' },
      { name: 'Transition Mechanisms', description: 'IPv6 transition mechanisms: 6rd, DS-Lite, MAP-E/MAP-T, 464XLAT — §5.4' },
      { name: 'Device Groups', description: 'Device group management — logical grouping by type/location/region/OLT — §6.1' },
      { name: 'Discovery Scans', description: 'Network device discovery via SNMP scan — §6.1' },
      { name: 'Trap Forwarding Rules', description: 'SNMP trap forwarding rule management — §6.1' },
      { name: 'SNMP Metrics', description: 'Bandwidth graphs, top talkers, interface utilization, error counters — §6.2/6.3' },
      { name: 'Config Templates', description: 'Configuration template management — §6.6' },
      { name: 'Config Backup Schedules', description: 'Per-device/org backup schedule management — §6.6' },
      { name: 'Config Compliance Rules', description: 'Configuration compliance rules and audit — §6.6' },
      { name: 'OLT Management', description: 'FTTH OLT device management: PON ports, chassis metrics, splitter inventory, vendor capabilities — §7.1' },
      { name: 'ONU Management', description: 'FTTH ONU provisioning, profiles, optical diagnostics, whitelist, OMCI/Wi-Fi config, firmware jobs — §7.2' },
      { name: 'CPE Management', description: 'CWMP/TR-069 CPE device registry, task queue, firmware versions and campaigns — §8.1' },
      { name: 'CPE Profiles', description: 'CPE provisioning profile templates with inheritance, parameter mappings, vendor seeds — §8.2' },
      { name: 'Wireless AP Sectors', description: 'AP sector RF configuration management — azimuth, frequency, channel, power, encryption — §9.1' },
      { name: 'Wireless Channel Plans', description: 'AP channel assignment registry per site for frequency conflict avoidance — §9.1' },
      { name: 'Wireless Clients', description: 'Wireless CPE client session snapshots per AP poll — §9.1' },
      { name: 'Wireless Channel Interference', description: 'Detected RF channel interference records per sector/site — §9.1' },
      { name: 'AP Command Jobs', description: 'AP remote command jobs for power/frequency/reboot adjustments — §9.1' },
      { name: 'PTP Links', description: 'PTP/PTMP link monitoring — signal, modulation, throughput, failover state — §9.2' },
      { name: 'Link Planning', description: 'Link budget calculator — haversine distance, FSPL, Fresnel zone, saved runs — §9.2' },
      { name: 'RF Metrics', description: 'RF metric dashboards — noise floor, air utilization, GPS sync, signal distribution — §9.3' },
      { name: 'Spectrum Scans', description: 'AP spectrum scan results — raw scan data, peak interference, channel recommendations — §9.3' },
      { name: 'Quality Classes', description: 'QoS priority class registry (VoIP/Video/Web/Download) with DSCP marks and MikroTik queue kind — §10.1' },
      { name: 'Queue Tree Nodes', description: 'Hierarchical queue tree node definitions (MikroTik Queue Tree / Simple Queue) with export to RouterOS script — §10.1' },
      { name: 'Rate Limit Templates', description: 'Named rate-limit templates per service type (PPPoE/DHCP/hotspot) with vendor-specific rate-string generation — §10.2' },
      { name: 'Protocol Shaping Rules', description: 'Per-protocol/port traffic shaping rules (torrent throttling, VoIP priority) with MikroTik mangle export — §10.2' },
      { name: 'Data Packs', description: 'Add-on data pack catalog: pricing, GB allowance, validity — §10.3' },
      { name: 'Data Rollover', description: 'Monthly unused-data carry-forward balances per subscriber contract — §10.3' },
      { name: 'Interface QoS Policies', description: 'Per-interface hierarchical QoS policy bindings (HTB/CBQ/HFSC/PCQ) — §10.4' },
      { name: 'MPLS VLAN Prioritization', description: 'MPLS EXP / 802.1p CoS / DSCP re-marking rules — §10.4' },
      { name: 'DSCP Marking Policies', description: 'DSCP/ToS marking policy catalog with MikroTik mangle export — §10.4' },
      { name: 'Bandwidth Test Servers', description: 'iperf3 / speedtest node registry for subscriber speed testing — §10.4' },
      { name: 'Subscriber Speed Test Jobs', description: 'Scheduled and on-demand per-subscriber speed test job queue — §10.4' },
      { name: 'Portal Auth', description: 'Client self-service portal authentication — login, refresh, logout, password change — §11' },
      { name: 'Portal Dashboard', description: 'Portal account overview: plan, balance, session status, usage graph — §11.1' },
      { name: 'Portal Billing', description: 'Portal invoice history, PDF/CFDI download, online payment, payment history — §11.2' },
      { name: 'Portal Service Requests', description: 'Self-service requests: plan upgrade, Wi-Fi/PPPoE password change, static IP, cancellation, visit schedule — §11.3' },
      { name: 'Portal Support', description: 'Portal support: tickets, knowledge base, callback request, speed test, AI chatbot — §11.4' },
      { name: 'Portal Push', description: 'Web Push notification subscription management — §11.5' },
      { name: 'NOC Dashboard', description: 'Network Operations Center dashboard — health, alarms, outages, ticket queue, SLA compliance — §12.2' },
      { name: 'Work Orders', description: 'Field work order management with GPS scheduling and material tracking — §12.3' },
      { name: 'Technician Tracking', description: 'Real-time technician GPS breadcrumbs, last-known positions, and route optimization — §12.3' },
      { name: 'Topology Map', description: 'Network topology map — device graph, link utilization, geographic layers, geofences, dependency analysis — §13' },
      { name: 'Inventory & Asset Management', description: 'Vendor management, purchase orders, asset tracking, assignments, and RMA workflow' },
      { name: 'Analytics Dashboard', description: 'Drag/drop analytics dashboard — §15.5' },
      { name: 'Regulatory Compliance MX', description: '§16 consent, DSAR workflow, identity verification, gov data requests' },
      { name: 'Numbering Management', description: '§16.4 phone number inventory, portability, numbering blocks' },
      { name: 'Universal Service', description: '§16.6 USO obligations and rural coverage reporting' },
      { name: 'Consumer Protection MX', description: '§16.7 service modification notices and contract templates (MX)' },
      { name: 'Data Residency', description: '§16.8 data localization and residency compliance config' },
      { name: 'Security', description: '§17 security & access control — WebAuthn, IP allowlist, password policy, firewall, DDoS, DNS blocklists, CPE scans, encryption keys, data masking, secure deletion, webhook signing' },
      { name: 'Automation', description: '§18.1 workflow automation rules, batch subscriber operations, provisioning pipelines, auto-remediation' },
      { name: 'Scripting', description: '§18.2 script storage, library, execution logging (STUB — no live dispatch)' },
      { name: 'Router Drivers', description: '§18.3 vendor router API integration — MikroTik live, Cisco/Juniper/ZTE/Huawei/REST stubbed' },
      { name: 'Analytics', description: '§18.4 heuristic analytics — z-score anomaly detection, predictive failure, alert correlation, bandwidth forecast, churn scoring' },
      { name: 'Resellers', description: '§19 Multi-Tenancy / Reseller Support — hierarchy, pricing, commissions, resource allocation, and reseller portal' },
      { name: 'Reseller Portal', description: '§19.3 Reseller portal endpoints — dashboard, customer management, invoices, inventory' },
      { name: 'Integration Providers', description: '§20.2 Third-party integration provider catalog — read-only list of supported providers seeded at migration 348' },
      { name: 'Integration Connections', description: '§20.2 Per-org configured integration connections — credentials encrypted at rest, never returned in responses' },
      { name: 'AI Support', description: '§21 AI customer support — conversations, knowledge base, channel configs, diagnostics, and KPI metrics' },
      { name: 'NOC AI', description: '§21.11 NOC AI insights — alert explanation, capacity warnings, interference detection, shift summaries, runbook suggestions' },
      { name: 'WireGuard Peers', description: 'WireGuard user peer self-service, admin oversight, and network scope assignment management — §6d' },
    ],
    paths: {
      // ---- Auth ----
      '/auth/register': { post: { tags: ['Auth'], summary: 'Register new user', operationId: 'register', requestBody: jsonBody('auth_register'), responses: r201('User') } },
      '/auth/login': { post: { tags: ['Auth'], summary: 'Login', operationId: 'login', requestBody: jsonBody('auth_login'), responses: r200('Token + User') } },
      '/auth/logout': { post: { tags: ['Auth'], summary: 'Logout — revokes the presented refresh token (cookie or body) and clears auth cookies; no bearer required, so it still works after the access token expires', operationId: 'logout', requestBody: jsonBody('auth_refreshToken'), responses: r200('Message') } },
      '/auth/me': { get: { tags: ['Auth'], summary: 'Get current user profile', operationId: 'me', security: [{ bearerAuth: [] }], responses: r200('User') } },
      '/auth/password-reset/request': { post: { tags: ['Auth'], summary: 'Request password reset email', operationId: 'requestPasswordReset', requestBody: jsonBody('email'), responses: r200('Message') } },
      '/auth/password-reset': { post: { tags: ['Auth'], summary: 'Reset password with token', operationId: 'resetPassword', requestBody: jsonBody('token + password'), responses: r200('Message') } },
      '/auth/change-password': { post: { tags: ['Auth'], summary: 'Change password (authenticated)', operationId: 'changePassword', security: [{ bearerAuth: [] }], requestBody: jsonBody('currentPassword + newPassword'), responses: r200('Message') } },
      '/auth/verify-email': { post: { tags: ['Auth'], summary: 'Verify email with token', operationId: 'verifyEmail', requestBody: jsonBody('token'), responses: r200('Message') } },
      '/auth/verify-email/resend': { post: { tags: ['Auth'], summary: 'Resend the email verification link (authenticated); no-op if already verified', operationId: 'resendVerificationEmail', security: [{ bearerAuth: [] }], responses: r200('Message') } },
      '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate access token using refresh token', operationId: 'refreshToken', requestBody: jsonBody('auth_refreshToken'), responses: r200('Token pair') } },
      '/auth/switch-organization': { post: { tags: ['Auth'], summary: 'Switch the active organization for a multi-tenant user', operationId: 'switchOrganization', security: [{ bearerAuth: [] }], requestBody: jsonBody('auth_switchOrganization'), responses: { 200: { description: 'New token pair bound to the requested organization', content: { 'application/json': { schema: { type: 'object' } } } }, 403: { description: 'User is not a member of the requested organization' } } } },

      // ---- Organizations ----
      ...crudPaths('organizations', 'Organizations', 'Organization'),
      '/organizations/{id}/restore': { post: { tags: ['Organizations'], summary: 'Restore a soft-deleted organization', operationId: 'restoreOrganization', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Organization') } },
      '/organizations/{id}/settings': {
        get: { tags: ['Organizations'], summary: 'Get organization settings', operationId: 'getOrganizationSettings', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Settings map') },
      },
      '/organizations/{id}/settings/{key}': {
        put: { tags: ['Organizations'], summary: 'Update a single organization setting', operationId: 'updateOrganizationSetting', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'key', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody('Setting value'), responses: r200('Settings map') },
      },
      '/organizations/{id}/quota': {
        get: { tags: ['Organizations'], summary: 'Get organization quota and usage', operationId: 'getOrganizationQuota', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Quota + usage') },
        put: { tags: ['Organizations'], summary: 'Update organization quota limits', operationId: 'updateOrganizationQuota', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('Quota limits'), responses: r200('Quota + usage') },
      },

      // ---- Users ----
      ...crudPaths('users', 'Users', 'User'),
      '/users/{id}/permissions': {
        get: { tags: ['Users'], summary: "Resolved permission slugs for the user's active org", operationId: 'getUserPermissions', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('string[]') },
      },
      '/users/{id}/organizations': {
        get: { tags: ['Users'], summary: 'Organizations the user can access (memberships)', operationId: 'getUserOrganizations', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('UserOrganization[]') },
      },
      '/users/{id}/group': {
        patch: { tags: ['Users'], summary: "Reassign an ARCHIVED user's group without restoring (422 for active users)", operationId: 'setArchivedUserGroup', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('users_setArchivedGroup'), responses: r200('User') },
      },

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
      '/roles/permissions': {
        get: { tags: ['Roles'], summary: 'List all assignable permissions', operationId: 'listPermissions', security: [{ bearerAuth: [] }], responses: r200('Permission[]') },
      },
      '/roles/{id}/permissions': {
        post: { tags: ['Roles'], summary: 'Assign a permission to a role', operationId: 'assignPermission', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('permission_id'), responses: r201('Permission[]') },
        put: { tags: ['Roles'], summary: "Bulk-replace a role's entire permission set", operationId: 'setRolePermissions', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('roles_setPermissions'), responses: r200('Permission[]') },
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
      '/clients/{id}/portal-password': { put: { tags: ['Clients'], summary: 'Set or reset the client portal password', operationId: 'setClientPortalPassword', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('password'), responses: r200('Message') } },
      '/clients/{id}/restore': { post: { tags: ['Clients'], summary: 'Restore a soft-deleted client', operationId: 'restoreClient', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Client') } },
      '/clients/{id}/custom-fields': {
        get: { tags: ['Clients'], summary: 'List client custom fields', operationId: 'listClientCustomFields', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CustomField[]') },
        put: { tags: ['Clients'], summary: 'Create or update a custom field', operationId: 'setClientCustomField', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('clients_setCustomField'), responses: r200('CustomField') },
      },
      '/clients/{id}/custom-fields/{key}': {
        delete: { tags: ['Clients'], summary: 'Delete a custom field by key', operationId: 'deleteClientCustomField', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'key', in: 'path', required: true, schema: { type: 'string' } }], responses: r204() },
      },
      '/clients/{id}/documents': {
        get: { tags: ['Clients'], summary: 'List client ID documents / photos', operationId: 'listClientDocuments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Document[]') },
        post: { tags: ['Clients'], summary: 'Upload a client ID document / photo (multipart/form-data)', operationId: 'uploadClientDocument', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, category: { type: 'string', enum: ['client_file', 'notification_log'] }, notes: { type: 'string' } } } } } }, responses: r201('Document') },
      },
      '/clients/{id}/documents/{fileId}': {
        delete: { tags: ['Clients'], summary: 'Delete a client document', operationId: 'deleteClientDocument', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'fileId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/clients/{id}/documents/{fileId}/download': {
        get: { tags: ['Clients'], summary: 'Download a client document', operationId: 'downloadClientDocument', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'fileId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200File('application/octet-stream') },
      },
      '/clients/{id}/geocode': { post: { tags: ['Clients'], summary: 'Geocode the client service address to GPS coordinates', operationId: 'geocodeClient', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('clients_geocodeClient'), responses: r200('Client') } },
      '/clients/duplicates/scan': { get: { tags: ['Clients'], summary: 'Scan for duplicate clients by email/phone/tax_id', operationId: 'scanClientDuplicates', security: [{ bearerAuth: [] }], parameters: [{ name: 'email', in: 'query', schema: { type: 'string' } }, { name: 'phone', in: 'query', schema: { type: 'string' } }, { name: 'tax_id', in: 'query', schema: { type: 'string' } }], responses: r200('Client[]') } },
      '/clients/{id}/duplicates': { get: { tags: ['Clients'], summary: 'Find potential duplicates of this client', operationId: 'listClientDuplicates', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Client[]') } },
      '/clients/{id}/merge': { post: { tags: ['Clients'], summary: 'Merge another client (source_id) into this client', operationId: 'mergeClient', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('clients_mergeClient'), responses: r200('Merge result') } },

      // ---- Client Groups ----
      ...crudPaths('client-groups', 'Client Groups', 'ClientGroup'),
      '/client-groups/{id}/members': { get: { tags: ['Client Groups'], summary: 'List member clients of a group', operationId: 'listClientGroupMembers', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Client[]') } },
      '/client-groups/{id}/restore': { post: { tags: ['Client Groups'], summary: 'Restore a soft-deleted client group', operationId: 'restoreClientGroup', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ClientGroup') } },

      // ---- Leads (prospect pipeline) ----
      ...crudPaths('leads', 'Leads', 'Lead'),
      // Override the crudPaths-generated GET to document the optional `search`
      // query param (partial name/email/phone/company + exact id match — see
      // routes/leads.js); falls through to the generic list when omitted.
      '/leads': {
        get: { tags: ['Leads'], summary: 'List leads (optional free-text search)', operationId: 'listLeads', security: [{ bearerAuth: [] }], parameters: [searchParam()], responses: r200('Lead[]') },
        post: { tags: ['Leads'], summary: 'Create a Lead', operationId: 'createLead', security: [{ bearerAuth: [] }], requestBody: jsonBody('Lead'), responses: r201('Lead') },
      },
      '/leads/pipeline': { get: { tags: ['Leads'], summary: 'Lead counts grouped by pipeline stage', operationId: 'getLeadPipeline', security: [{ bearerAuth: [] }], responses: r200('Pipeline counts') } },
      '/leads/{id}/restore': { post: { tags: ['Leads'], summary: 'Restore a soft-deleted lead', operationId: 'restoreLead', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Lead') } },
      '/leads/{id}/convert': { post: { tags: ['Leads'], summary: 'Convert a lead into a client', operationId: 'convertLead', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('leads_convertLead'), responses: r201('Lead + Client') } },

      // ---- Service Orders (workflow) ----
      ...crudPaths('service-orders', 'Service Orders', 'ServiceOrder'),
      // Override the crudPaths-generated GET (list is a dedicated JOIN handler
      // in routes/serviceOrders.js — carries client_name/lead_name — not the
      // generic crudController.list); POST stays exactly as crudPaths defines it.
      '/service-orders': {
        get: { tags: ['Service Orders'], summary: 'List service orders (includes client_name/lead_name from a LEFT JOIN)', operationId: 'listServiceOrders', security: [{ bearerAuth: [] }], responses: r200('ServiceOrder[]') },
        post: { tags: ['Service Orders'], summary: 'Create a ServiceOrder', operationId: 'createServiceOrder', security: [{ bearerAuth: [] }], requestBody: jsonBody('ServiceOrder'), responses: r201('ServiceOrder') },
      },
      '/service-orders/{id}/restore': { post: { tags: ['Service Orders'], summary: 'Restore a soft-deleted service order', operationId: 'restoreServiceOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ServiceOrder') } },
      '/service-orders/{id}/start': { post: { tags: ['Service Orders'], summary: 'Start a service order (new -> in_process); auto-creates + provisions the contract for new_install orders', operationId: 'startServiceOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ServiceOrder') } },
      '/service-orders/{id}/complete': { post: { tags: ['Service Orders'], summary: 'Complete a service order (in_process -> done); already-paid or raises an installation-fee invoice (sends welcome notification)', operationId: 'completeServiceOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('serviceOrders_completeServiceOrder'), responses: r200('ServiceOrder') } },
      '/service-orders/{id}/cancel': { post: { tags: ['Service Orders'], summary: 'Cancel a service order', operationId: 'cancelServiceOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ServiceOrder') } },
      '/service-orders/{id}/tasks': {
        get: { tags: ['Service Orders'], summary: 'List onboarding checklist tasks', operationId: 'listServiceOrderTasks', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ServiceOrderTask[]') },
        post: { tags: ['Service Orders'], summary: 'Add an onboarding checklist task', operationId: 'createServiceOrderTask', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('serviceOrders_createServiceOrderTask'), responses: r201('ServiceOrderTask') },
      },
      '/service-orders/{id}/tasks/{taskId}': {
        patch: { tags: ['Service Orders'], summary: 'Update an onboarding checklist task', operationId: 'updateServiceOrderTask', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'taskId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('serviceOrders_updateServiceOrderTask'), responses: r200('ServiceOrderTask') },
      },

      // ---- Win-back Campaigns ----
      ...crudPaths('winback-campaigns', 'Win-back Campaigns', 'WinbackCampaign'),
      '/winback-campaigns/{id}/restore': { post: { tags: ['Win-back Campaigns'], summary: 'Restore a soft-deleted win-back campaign', operationId: 'restoreWinbackCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('WinbackCampaign') } },
      '/winback-campaigns/{id}/targets': { get: { tags: ['Win-back Campaigns'], summary: 'Preview cancelled-customer cohort for a campaign', operationId: 'getWinbackTargets', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Target[]') } },

      // ---- Lifecycle analytics ----
      '/lifecycle/churn': { get: { tags: ['Lifecycle'], summary: 'Monthly churn report', operationId: 'getChurnReport', security: [{ bearerAuth: [] }], parameters: [{ name: 'months', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('Churn report') } },
      '/lifecycle/at-risk': { get: { tags: ['Lifecycle'], summary: 'Predictive at-risk (churn) client alerts', operationId: 'getAtRiskClients', security: [{ bearerAuth: [] }], parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('At-risk clients') } },

      // ---- Plans ----
      ...crudPaths('plans', 'Plans', 'Plan'),
      '/plans/addons/catalog': { get: { tags: ['Plans'], summary: 'Product/add-on catalog for invoice & quote generation — inventory-linked entries include quantity_on_hand (SUM of stock across the org\'s warehouses)', operationId: 'getAddonCatalog', security: [{ bearerAuth: [] }], responses: r200('PlanAddon[]') } },
      '/plans/addons': { post: { tags: ['Plans'], summary: 'Create a plan add-on catalog entry, optionally linked to an inventory item', operationId: 'createPlanAddon', security: [{ bearerAuth: [] }], requestBody: jsonBody('plans_createPlanAddon'), responses: r201('PlanAddon') } },
      '/plans/{id}/radius-attributes': { get: { tags: ['Plans'], summary: 'Preview RADIUS attributes for a plan', operationId: 'getPlanRadiusAttributes', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RadiusAttributes') } },
      '/plans/{id}/speed-windows': {
        get:  { tags: ['Plans'], summary: 'List time-based speed windows for a plan', operationId: 'listPlanSpeedWindows', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SpeedWindow[]') },
        post: { tags: ['Plans'], summary: 'Create a speed window for a plan', operationId: 'createPlanSpeedWindow', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('plans_createSpeedWindow'), responses: r201('SpeedWindow') },
      },
      '/plans/{id}/speed-windows/{windowId}': {
        put:    { tags: ['Plans'], summary: 'Update a speed window', operationId: 'updatePlanSpeedWindow', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'windowId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('plans_createSpeedWindow'), responses: r200('SpeedWindow') },
        delete: { tags: ['Plans'], summary: 'Soft-delete a speed window', operationId: 'deletePlanSpeedWindow', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'windowId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/plans/{id}/access-windows': {
        get:  { tags: ['Plans'], summary: 'List time-based access restriction windows for a plan', operationId: 'listPlanAccessWindows', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AccessWindow[]') },
        post: { tags: ['Plans'], summary: 'Create an access window for a plan', operationId: 'createPlanAccessWindow', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('plans_createAccessWindow'), responses: r201('AccessWindow') },
      },
      '/plans/{id}/access-windows/{windowId}': {
        put:    { tags: ['Plans'], summary: 'Update an access window', operationId: 'updatePlanAccessWindow', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'windowId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('plans_createAccessWindow'), responses: r200('AccessWindow') },
        delete: { tags: ['Plans'], summary: 'Soft-delete an access window', operationId: 'deletePlanAccessWindow', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'windowId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- Contracts ----
      ...crudPaths('contracts', 'Contracts', 'Contract'),
      '/contracts/{id}/suspend': { post: { tags: ['Contracts'], summary: 'Suspend a contract and kick active RADIUS session via CoA Disconnect-Request', operationId: 'suspendContract', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('rule_id + invoice_id'), responses: { 200: { description: 'Contract suspended', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is already suspended' } } } },
      '/contracts/{id}/unsuspend': { post: { tags: ['Contracts'], summary: 'Unsuspend a contract and restore RADIUS access via CoA-Request', operationId: 'unsuspendContract', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('invoice_id'), responses: { 200: { description: 'Contract unsuspended', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is not suspended' } } } },
      '/contracts/{id}/renew': { post: { tags: ['Contracts'], summary: 'Renew (reactivate) a suspended, expired, or cancelled contract', operationId: 'renewContract', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('end_date + plan_id'), responses: { 200: { description: 'Contract renewed', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is not in a renewable state' } } } },
      '/contracts/{id}/terminate': { post: { tags: ['Contracts'], summary: 'Permanently terminate an active or suspended contract and send RADIUS disconnect', operationId: 'terminateContract', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { 200: { description: 'Contract terminated', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract cannot be terminated from its current state' } } } },
      '/contracts/{id}/regenerate-pppoe': { post: { tags: ['Contracts'], summary: 'Regenerate (rotate) the PPPoE password for a contract’s RADIUS account; keeps the username and best-effort pushes the new secret to the NAS', operationId: 'regenerateContractPppoe', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { 200: { description: 'New PPPoE credentials', content: { 'application/json': { schema: { type: 'object' } } } }, 404: { description: 'Contract not found' }, 422: { description: 'Contract is not PPPoE or has no RADIUS account' } } } },

      // ---- Invoices ----
      ...crudPaths('invoices', 'Invoices', 'Invoice'),
      '/invoices/{id}/items': {
        get: { tags: ['Invoices'], summary: 'List invoice line items', operationId: 'listInvoiceItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('InvoiceItem[]') },
        post: {
          tags: ['Invoices'],
          summary: 'Add invoice line item; inventory_item_id-linked lines draw down stock atomically',
          operationId: 'addInvoiceItem',
          security: [{ bearerAuth: [] }],
          parameters: [idParam()],
          requestBody: jsonBody('invoices_addInvoiceItem'),
          responses: {
            ...r201('InvoiceItem'),
            404: { description: 'Invoice not found' },
            422: { description: 'Validation error, cross-organization inventory_item_id, fractional quantity on an inventory-linked line (INTEGER required), or the invoice is void (INVOICE_VOID)' },
          },
        },
      },
      '/invoices/generate': { post: { tags: ['Invoices'], summary: 'Generate invoice from contract', operationId: 'generateContractInvoice', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id (legacy) OR client_id + items[] — items[].inventory_item_id is optional on type:"product" lines and draws down stock in the same transaction as the invoice'), responses: r201('Invoice') } },
      '/invoices/{id}/payments': { get: { tags: ['Invoices'], summary: 'List invoice payments', operationId: 'listInvoicePayments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PaymentAllocation[]') } },
      '/invoices/{id}/receipt': {
        get: {
          tags: ['Invoices'],
          summary: 'Get thermal receipt for an invoice (plain text, 58mm or 80mm)',
          operationId: 'getInvoiceThermalReceipt',
          security: [{ bearerAuth: [] }],
          parameters: [
            idParam(),
            { name: 'width', in: 'query', schema: { type: 'string', enum: ['58', '80'] }, description: 'Printer width in mm (default: 80)' },
          ],
          responses: { 200: { description: 'Plain-text thermal receipt', content: { 'text/plain': { schema: { type: 'string' } } } } },
        },
      },

      // ---- Payments ----
      ...crudPaths('payments', 'Payments', 'Payment'),
      '/payments/{id}/allocate': { post: { tags: ['Payments'], summary: 'Allocate payment to invoice', operationId: 'allocatePaymentToInvoice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('payments_allocatePayment'), responses: r201('Allocation') } },
      '/payments/{id}/allocations': { get: { tags: ['Payments'], summary: 'List payment allocations', operationId: 'listPaymentAllocations', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Allocation[]') } },
      '/payments/{id}/reallocate': { post: { tags: ['Payments'], summary: 'Move a payment allocation from one invoice to another (same client only)', operationId: 'reallocatePayment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('from_invoice_id + to_invoice_id + optional amount'), responses: r201('Allocation') } },
      '/payments/{id}/reassign': { post: { tags: ['Payments'], summary: 'Reassign an unallocated payment to a different client', operationId: 'reassignPayment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('new_client_id'), responses: r200('Payment') } },
      '/payments/{id}/unapply': { post: { tags: ['Payments'], summary: 'Remove (soft-delete) a payment allocation from a specific invoice', operationId: 'unapplyPayment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('invoice_id'), responses: r200('UnapplyResult') } },
      '/payments/{id}/receipt': {
        get: {
          tags: ['Payments'],
          summary: 'Get thermal receipt for a payment (plain text, 58mm or 80mm)',
          operationId: 'getPaymentThermalReceipt',
          security: [{ bearerAuth: [] }],
          parameters: [
            idParam(),
            { name: 'width', in: 'query', schema: { type: 'string', enum: ['58', '80'] }, description: 'Printer width in mm (default: 80)' },
          ],
          responses: { 200: { description: 'Plain-text thermal receipt', content: { 'text/plain': { schema: { type: 'string' } } } } },
        },
      },

      // ---- Credit Notes ----
      ...crudPaths('credit-notes', 'Credit Notes', 'CreditNote'),

      // ---- Quotes ----
      ...crudPaths('quotes', 'Quotes', 'Quote'),
      '/quotes/{id}/items': {
        get: { tags: ['Quotes'], summary: 'List quote line items', operationId: 'listQuoteItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('QuoteItem[]') },
        post: {
          tags: ['Quotes'],
          summary: 'Add quote line item',
          operationId: 'addQuoteItem',
          security: [{ bearerAuth: [] }],
          parameters: [idParam()],
          requestBody: jsonBody('quotes_createQuoteItem'),
          responses: {
            ...r201('QuoteItem'),
            422: { description: 'Validation error, cross-organization inventory_item_id, or fractional quantity on an inventory-linked line (INTEGER required)' },
          },
        },
      },
      '/quotes/generate': { post: { tags: ['Quotes'], summary: 'Generate a quote with line items (client_id + items[], mirrors /invoices/generate)', operationId: 'generateQuote', security: [{ bearerAuth: [] }], requestBody: jsonBody('client_id + items[] — items[].inventory_item_id is optional on type:"product" lines; carried through to quote_items with no stock drawdown (quotes never draw down — only conversion to an invoice does)'), responses: r201('Quote') } },
      '/quotes/{id}/convert-to-invoice': {
        post: {
          tags: ['Quotes'],
          summary: 'Convert an accepted quote to an invoice (idempotent — a quote can only ever convert once)',
          operationId: 'convertQuoteToInvoice',
          security: [{ bearerAuth: [] }],
          parameters: [idParam()],
          responses: {
            ...r201('Invoice'),
            404: { description: 'Quote not found' },
            409: { description: 'Quote is not accepted (QUOTE_NOT_ACCEPTED), or has already been converted to an invoice — see quotes.converted_invoice_id (CONVERSION_EXISTS)' },
          },
        },
      },
      '/quotes/{id}/approve': { post: { tags: ['Quotes'], summary: 'Approve a quote (sets status to accepted)', operationId: 'approveQuote', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Quote') } },
      '/quotes/{id}/reject': { post: { tags: ['Quotes'], summary: 'Reject a quote (sets status to rejected)', operationId: 'rejectQuote', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Quote') } },

      // ---- Billing ----
      '/billing/generate-period': { post: { tags: ['Billing'], summary: 'Generate billing period for a contract', operationId: 'generatePeriod', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('BillingPeriod') } },
      '/billing/generate-invoice': { post: { tags: ['Billing'], summary: 'Generate invoice for a contract', operationId: 'generateInvoice', security: [{ bearerAuth: [] }], requestBody: jsonBody('contract_id'), responses: r201('Invoice') } },
      '/billing/allocate-payment': { post: { tags: ['Billing'], summary: 'Allocate payment to invoices', operationId: 'allocatePayment', security: [{ bearerAuth: [] }], requestBody: jsonBody('payment_id + allocations'), responses: r201('Allocations') } },
      '/billing/bulk-generate': { post: { tags: ['Billing'], summary: 'Bulk generate invoices for all active contracts', operationId: 'bulkGenerate', security: [{ bearerAuth: [] }], responses: r200('Results') } },
      '/billing/tax-reports': {
        get: {
          tags: ['Billing'],
          summary: 'Export tax report (invoices, payments, or credit notes)',
          operationId: 'exportTaxReports',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'from',   in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date (inclusive)' },
            { name: 'to',     in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date (inclusive)' },
            { name: 'type',   in: 'query', schema: { type: 'string', enum: ['invoices', 'payments', 'credit_notes'] }, description: 'Document type (default: invoices)' },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] }, description: 'Output format (default: json)' },
          ],
          responses: {
            200: {
              description: 'Tax report data',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/csv': { schema: { type: 'string' } },
              },
            },
          },
        },
      },

      // ---- Bulk Operations ----
      '/bulk/invoices/void': { post: { tags: ['Bulk'], summary: 'Mass-void invoices', operationId: 'bulkVoidInvoices', security: [{ bearerAuth: [] }], requestBody: jsonBody('invoice_ids'), responses: r200('Results') } },
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
      '/devices': crudPaths('devices', 'Devices', 'Device')['/devices'],
      '/devices/{id}': {
        ...crudPaths('devices', 'Devices', 'Device')['/devices/{id}'],
        // Hand-added: crudPaths() has no `patch` case (it would falsely document
        // PATCH for ~40 other resources that don't have the route). Only /devices
        // actually registers PATCH /:id (src/routes/devices.js) — used to
        // assign/clear the client_id link from the UI without a full PUT.
        patch: { tags: ['Devices'], summary: 'Partially update a device (e.g. assign/clear client_id)', operationId: 'patchDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('devices_patchDevice'), responses: r200('Device') },
      },
      '/devices/{id}/restore': { post: { tags: ['Devices'], summary: 'Restore a soft-deleted device', operationId: 'restoreDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Device') } },

      // ---- NAS ----
      ...crudPaths('nas', 'NAS', 'Nas'),
      '/nas/{id}/health': { get: { tags: ['NAS'], summary: 'Get health status for a NAS device', operationId: 'getNasHealth', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('NAS health status') } },
      '/nas/{id}/health-check': { post: { tags: ['NAS'], summary: 'Trigger manual health check probe for org NAS devices', operationId: 'triggerNasHealthCheck', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Health check results') } },
      '/nas/{id}/test-connection': { post: { tags: ['NAS'], summary: 'Test the direct RouterOS API connection to a NAS (uses its configured api_port/credentials)', operationId: 'testNasConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Connection result (version, board, identity)') } },
      '/nas/{id}/seed': { post: { tags: ['NAS'], summary: 'Seed a MikroTik NAS: configure FireISP RADIUS client, PPP AAA, CoA incoming, and optionally fq-codel queue types, a queue-tree skeleton, Business/Residential priority simple queues, a PPPoE server + base profile, a suspended-subscriber walled garden, and real-time/VoIP traffic prioritisation (idempotent, non-destructive)', operationId: 'seedNasDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('nas_seedNas'), responses: r200('Seed result — per-step report') } },
      '/nas/{id}/voip/refresh': { post: { tags: ['NAS'], summary: 'Reconcile the fireisp-voip RTC/VoIP address-list on this NAS from the configured provider ranges (voipRangesService). Idempotent; skips NAS without real-time priority seeded', operationId: 'refreshNasVoipRanges', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Reconcile result — added/removed/kept + sources') } },

      // ---- NAS WireGuard ----
      '/nas/{id}/wg': { get: { tags: ['NAS'], summary: 'Get WireGuard tunnel state for a NAS (redacted — private key never returned)', operationId: 'getNasWgTunnel', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('NasWgTunnel (redacted)') } },
      '/nas/{id}/wg/bootstrap': { post: { tags: ['NAS'], summary: 'Bootstrap WireGuard on a NAS via RouterOS API; falls back to a paste-once RouterOS CLI snippet if the device is unreachable', operationId: 'bootstrapNasWg', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Bootstrap result — method:api|snippet + steps[]') } },
      '/nas/{id}/wg/discover': { post: { tags: ['NAS'], summary: 'Probe a NAS for connected subnets (read-only topology scan); returns proposed CIDRs to route through the WireGuard tunnel', operationId: 'discoverNasWgSubnets', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { 200: { description: 'Proposed CIDRs and the raw RouterOS topology read', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', required: ['proposed'], properties: {
        proposed: { type: 'array', items: { type: 'string' }, description: 'Connected device subnets to route (CIDR); excludes the WG server pool, the NAS WAN/management subnet, and /32 & /128 host-routes' },
        topology: { type: 'object', description: 'Raw read-only RouterOS topology', properties: {
          interfaces: { type: 'array', items: { type: 'object', additionalProperties: true } },
          addresses: { type: 'array', items: { type: 'object', additionalProperties: true } },
          routes: { type: 'array', items: { type: 'object', additionalProperties: true } },
        } },
      } } } } } } } } } },
      '/nas/{id}/wg/routes': { put: { tags: ['NAS'], summary: 'Confirm routed CIDRs for a NAS WireGuard tunnel and re-sync the server-side peer on wg-fireisp', operationId: 'confirmNasWgRoutes', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('nas_confirmWgRoutes'), responses: r200('Updated NasWgTunnel') } },

      // ---- RADIUS ----
      ...crudPaths('radius', 'RADIUS', 'RadiusAccount'),
      '/radius/{id}/disconnect': { post: { tags: ['RADIUS'], summary: 'Disconnect active PPPoE session for a RADIUS account', operationId: 'disconnectRadiusSession', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Disconnect result') } },
      '/radius/contract/{contractId}': { get: { tags: ['RADIUS'], summary: 'List RADIUS accounts for a contract (response excludes the cleartext `password` column — see /credentials for that)', operationId: 'listRadiusByContract', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('RadiusAccount[] (no password field)') } },
      '/radius/contract/{contractId}/credentials': { get: { tags: ['RADIUS'], summary: 'View cleartext PPPoE credentials (username+password) for a contract’s RADIUS account(s); requires radius.credentials.view', operationId: 'getRadiusContractCredentials', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('RadiusAccount[] (includes cleartext password)') } },
      '/radius/{id}/credentials': { get: { tags: ['RADIUS'], summary: 'View cleartext PPPoE credentials (username+password) for a single RADIUS account; requires radius.credentials.view', operationId: 'getRadiusCredentials', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RadiusAccount (includes cleartext password)') } },
      '/radius/sync-freeradius': { post: { tags: ['RADIUS'], summary: 'Trigger FreeRADIUS SQL table sync (radcheck, radreply, radusergroup, radgroupcheck, radgroupreply)', operationId: 'syncFreeradiusTables', security: [{ bearerAuth: [] }], responses: r200('Sync result') } },
      '/radius/{id}/push': { post: { tags: ['RADIUS'], summary: 'Push a RADIUS subscriber (PPPoE secret) directly to its NAS RouterOS device over the API', operationId: 'pushRadiusToRouter', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Push result (router secret id, created/updated)') } },
      '/radius/server-status': { get: { tags: ['RADIUS'], summary: 'Status of the embedded RADIUS server (enabled, running, ports, request counters)', operationId: 'getRadiusServerStatus', security: [{ bearerAuth: [] }], responses: r200('Embedded RADIUS server status') } },
      '/radius/{id}/routes': {
        get:  { tags: ['RADIUS'], summary: 'List per-account injected routes (Framed-Route)', operationId: 'listRadiusAccountRoutes', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RadiusAccountRoute[]') },
        post: { tags: ['RADIUS'], summary: 'Add a per-account injected route', operationId: 'createRadiusAccountRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('radius_createRoute'), responses: r201('RadiusAccountRoute') },
      },
      '/radius/{id}/routes/{routeId}': {
        put:    { tags: ['RADIUS'], summary: 'Update a per-account injected route', operationId: 'updateRadiusAccountRoute', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'routeId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('radius_updateRoute'), responses: r200('RadiusAccountRoute') },
        delete: { tags: ['RADIUS'], summary: 'Delete a per-account injected route', operationId: 'deleteRadiusAccountRoute', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'routeId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/radius/walled-garden': {
        get: { tags: ['RADIUS'], summary: 'Get org walled garden settings', operationId: 'getWalledGardenSettings', security: [{ bearerAuth: [] }], responses: r200('WalledGardenSettings') },
        put: { tags: ['RADIUS'], summary: 'Update org walled garden settings', operationId: 'updateWalledGardenSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('radius_updateWalledGarden'), responses: r200('WalledGardenSettings') },
      },
      '/radius/kick-sessions': { post: { tags: ['RADIUS'], summary: 'Trigger manual duplicate-session kick for org', operationId: 'kickDuplicateSessions', security: [{ bearerAuth: [] }], responses: r200('Kick result') } },
      '/radius/accounting': { post: { tags: ['RADIUS'], summary: 'Ingest FreeRADIUS accounting record (Start/Stop/Interim-Update) — machine-to-machine, secret auth', operationId: 'ingestRadiusAccounting', responses: r200('Ingest result') } },
      '/radius/cdr': { get: { tags: ['RADIUS'], summary: 'Export CDR session records from connection_logs', operationId: 'exportRadiusCdr', security: [{ bearerAuth: [] }], parameters: [{ name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'username', in: 'query', schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } }], responses: r200('CDR rows or CSV') } },
      '/radius/coa': { post: { tags: ['RADIUS'], summary: 'Send dynamic CoA-Request to NAS for a subscriber', operationId: 'sendDynamicCoA', security: [{ bearerAuth: [] }], requestBody: jsonBody('Dynamic CoA request'), responses: r200('CoA result') } },
      '/radius/mac-move-events': { get: { tags: ['RADIUS'], summary: 'List MAC move events detected during accounting ingest', operationId: 'listMacMoveEvents', security: [{ bearerAuth: [] }], responses: r200('MacMoveEvent[]') } },
      '/radius/sessions/disconnect-batch': { post: { tags: ['RADIUS'], summary: 'Batch force-disconnect PPPoE sessions by session ID or username', operationId: 'batchDisconnectSessions', security: [{ bearerAuth: [] }], requestBody: jsonBody('BatchDisconnect request'), responses: r200('BatchDisconnect result') } },

      // ---- Subscriber Certificates ----
      ...crudPaths('subscriber-certificates', 'Subscriber Certificates', 'SubscriberCertificate'),
      '/subscriber-certificates/radius-account/{radiusAccountId}': { get: { tags: ['Subscriber Certificates'], summary: 'List certificates for a RADIUS account', operationId: 'listCertsByRadiusAccount', security: [{ bearerAuth: [] }], parameters: [{ name: 'radiusAccountId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('SubscriberCertificate[]') } },
      '/subscriber-certificates/client/{clientId}': { get: { tags: ['Subscriber Certificates'], summary: 'List certificates for a client', operationId: 'listCertsByClient', security: [{ bearerAuth: [] }], parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('SubscriberCertificate[]') } },
      '/subscriber-certificates/{id}/revoke': { post: { tags: ['Subscriber Certificates'], summary: 'Revoke a subscriber certificate', operationId: 'revokeSubscriberCertificate', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('subscriberCertificates_revokeSubscriberCertificate'), responses: r200('SubscriberCertificate') } },

      // ---- SNMP Profiles ----
      ...crudPaths('snmp-profiles', 'SNMP Profiles', 'SnmpProfile'),

      // ---- Network Health ----
      '/network-health': { get: { tags: ['Network Health'], summary: 'List network health snapshots', operationId: 'listNetworkHealth', security: [{ bearerAuth: [] }], responses: r200('Snapshot[]') } },

      // ---- Network Links ----
      ...crudPaths('network-links', 'Network Links', 'NetworkLink'),

      // ---- IP Pools ----
      ...crudPaths('ip-pools', 'IP Pools', 'IpPool'),
      '/ip-pools/utilization': { get: { tags: ['IP Pools'], summary: 'List utilization for all IP pools in the org', operationId: 'listIpPoolUtilization', security: [{ bearerAuth: [] }], responses: r200('IpPoolUtilization[]') } },
      '/ip-pools/{id}/utilization': { get: { tags: ['IP Pools'], summary: 'Get utilization for a single IP pool', operationId: 'getIpPoolUtilization', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('IpPoolUtilization') } },
      '/ip-pools/{id}/assign-next': { post: { tags: ['IP Pools'], summary: 'Dynamically assign the next free IP from a pool', operationId: 'assignNextFreeIp', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('Assign-next request'), responses: { 201: { description: 'IP assignment created', content: { 'application/json': { schema: { type: 'object' } } } }, ...r200('IpAssignment') } } },

      // ---- IP Assignments ----
      ...crudPaths('ip-assignments', 'IP Assignments', 'IpAssignment'),

      // ---- VLANs ----
      ...crudPaths('vlans', 'VLANs', 'Vlan'),

      // ---- Speed Tests ----
      ...crudPaths('speed-tests', 'Speed Tests', 'SpeedTest'),

      // ---- Connection Logs ----
      '/connection-logs': { get: { tags: ['Connection Logs'], summary: 'List connection logs', operationId: 'listConnectionLogs', security: [{ bearerAuth: [] }], responses: r200('ConnectionLog[]') } },
      '/connection-logs/active': { get: { tags: ['Connection Logs'], summary: 'List active PPPoE sessions (start events with no stop)', operationId: 'listActiveRadiusSessions', security: [{ bearerAuth: [] }], responses: r200('Session[]') } },
      '/connection-logs/active/summary': { get: { tags: ['Connection Logs'], summary: 'Active session counts grouped by NAS and port', operationId: 'getActiveSessionSummary', security: [{ bearerAuth: [] }], responses: r200('ActiveSessionSummary') } },
      '/connection-logs/binding-report': { get: { tags: ['Connection Logs'], summary: 'IP binding history export (JSON or CSV)', operationId: 'getBindingReport', security: [{ bearerAuth: [] }], responses: r200('BindingReport[]') } },
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

      // ---- Interactions (§1.3) ----
      ...crudPaths('interactions', 'Interactions', 'Interaction'),
      '/interactions/{id}/restore': { post: { tags: ['Interactions'], summary: 'Restore a soft-deleted interaction', operationId: 'restoreInteraction', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Interaction') } },
      '/clients/{id}/timeline': { get: { tags: ['Interactions'], summary: 'Unified client activity timeline (interactions, tickets, payments, emails, SMS)', operationId: 'getClientTimeline', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('Timeline') } },

      // ---- Follow-up Reminders (§1.3) ----
      ...crudPaths('follow-up-reminders', 'Follow-up Reminders', 'FollowUpReminder'),
      '/follow-up-reminders/due': { get: { tags: ['Follow-up Reminders'], summary: 'List pending reminders that are due', operationId: 'listDueFollowUpReminders', security: [{ bearerAuth: [] }], parameters: [{ name: 'assigned_to', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('FollowUpReminder[]') } },
      '/follow-up-reminders/{id}/restore': { post: { tags: ['Follow-up Reminders'], summary: 'Restore a soft-deleted reminder', operationId: 'restoreFollowUpReminder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('FollowUpReminder') } },
      '/follow-up-reminders/{id}/complete': { post: { tags: ['Follow-up Reminders'], summary: 'Mark a reminder as completed', operationId: 'completeFollowUpReminder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('FollowUpReminder') } },

      // ---- Satisfaction Surveys (§1.3) ----
      ...crudPaths('satisfaction-surveys', 'Satisfaction Surveys', 'SatisfactionSurvey'),
      '/satisfaction-surveys/metrics': { get: { tags: ['Satisfaction Surveys'], summary: 'Aggregate NPS score and CSAT average', operationId: 'getSatisfactionSurveyMetrics', security: [{ bearerAuth: [] }], parameters: [{ name: 'months', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('Survey metrics') } },
      '/satisfaction-surveys/{id}/restore': { post: { tags: ['Satisfaction Surveys'], summary: 'Restore a soft-deleted survey', operationId: 'restoreSatisfactionSurvey', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SatisfactionSurvey') } },
      '/satisfaction-surveys/{id}/send': { post: { tags: ['Satisfaction Surveys'], summary: 'Send (or re-send) a survey to the client', operationId: 'sendSatisfactionSurvey', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SatisfactionSurvey') } },
      '/satisfaction-surveys/{id}/respond': { post: { tags: ['Satisfaction Surveys'], summary: 'Record the client response (NPS: 0-10, CSAT: 1-5)', operationId: 'respondSatisfactionSurvey', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('interactions_respondSurvey'), responses: r200('SatisfactionSurvey') } },

      // ---- Escalations (§1.3) ----
      '/escalations': {
        get: { tags: ['Escalations'], summary: 'List ticket escalations', operationId: 'listEscalations', security: [{ bearerAuth: [] }], responses: r200('Escalation[]') },
        post: { tags: ['Escalations'], summary: 'Escalate a ticket (level auto-increments)', operationId: 'createEscalation', security: [{ bearerAuth: [] }], requestBody: jsonBody('interactions_createEscalation'), responses: r201('Escalation') },
      },
      '/escalations/candidates': { get: { tags: ['Escalations'], summary: 'Unresolved tickets without an open escalation', operationId: 'listEscalationCandidates', security: [{ bearerAuth: [] }], parameters: [{ name: 'hours', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('Candidate[]') } },
      '/escalations/{id}': { get: { tags: ['Escalations'], summary: 'Get an escalation', operationId: 'getEscalation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Escalation') } },
      '/escalations/{id}/transition': { post: { tags: ['Escalations'], summary: 'Acknowledge or resolve an escalation', operationId: 'transitionEscalation', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('interactions_transitionEscalation'), responses: r200('Escalation') } },

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
      '/alerts/escalation-chains': {
        get:  { tags: ['Alerts'], summary: 'List escalation chains',    operationId: 'listEscalationChains',   security: [{ bearerAuth: [] }], responses: r200('EscalationChain[]') },
        post: { tags: ['Alerts'], summary: 'Create escalation chain',   operationId: 'createEscalationChain',  security: [{ bearerAuth: [] }], requestBody: jsonBody('alertEscalations_createChain'), responses: r201('EscalationChain') },
      },
      '/alerts/escalation-chains/{id}': {
        put:    { tags: ['Alerts'], summary: 'Update escalation chain',  operationId: 'updateEscalationChain',  security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('alertEscalations_updateChain'), responses: r200('EscalationChain') },
        delete: { tags: ['Alerts'], summary: 'Delete escalation chain',  operationId: 'deleteEscalationChain',  security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/alerts/escalation-chains/{id}/steps': {
        get:  { tags: ['Alerts'], summary: 'List escalation steps',     operationId: 'listEscalationSteps',    security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('EscalationStep[]') },
        post: { tags: ['Alerts'], summary: 'Add escalation step',       operationId: 'createEscalationStep',   security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('alertEscalations_createStep'), responses: r201('EscalationStep') },
      },
      '/alerts/escalation-chains/{id}/steps/{stepId}': {
        delete: { tags: ['Alerts'], summary: 'Delete escalation step',   operationId: 'deleteEscalationStep',   security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'stepId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/alerts/maintenance-windows': {
        get:  { tags: ['Alerts'], summary: 'List maintenance windows',  operationId: 'listMaintenanceWindows',  security: [{ bearerAuth: [] }], responses: r200('MaintenanceWindow[]') },
        post: { tags: ['Alerts'], summary: 'Create maintenance window', operationId: 'createMaintenanceWindow', security: [{ bearerAuth: [] }], requestBody: jsonBody('maintenanceWindows_createWindow'), responses: r201('MaintenanceWindow') },
      },
      '/alerts/maintenance-windows/active': {
        get: { tags: ['Alerts'], summary: 'List active maintenance windows', operationId: 'listActiveMaintenanceWindows', security: [{ bearerAuth: [] }], responses: r200('MaintenanceWindow[]') },
      },
      '/alerts/maintenance-windows/{id}': {
        put:    { tags: ['Alerts'], summary: 'Update maintenance window', operationId: 'updateMaintenanceWindow', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('maintenanceWindows_updateWindow'), responses: r200('MaintenanceWindow') },
        delete: { tags: ['Alerts'], summary: 'Delete maintenance window', operationId: 'deleteMaintenanceWindow', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/alerts/notification-channels': {
        get:  { tags: ['Alerts'], summary: 'List notification channels',  operationId: 'listAlertNotificationChannels',  security: [{ bearerAuth: [] }], responses: r200('AlertNotificationChannel[]') },
        post: { tags: ['Alerts'], summary: 'Create notification channel', operationId: 'createAlertNotificationChannel', security: [{ bearerAuth: [] }], requestBody: jsonBody('alertNotificationChannels_createChannel'), responses: r201('AlertNotificationChannel') },
      },
      '/alerts/notification-channels/{id}': {
        put:    { tags: ['Alerts'], summary: 'Update notification channel', operationId: 'updateAlertNotificationChannel', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('alertNotificationChannels_updateChannel'), responses: r200('AlertNotificationChannel') },
        delete: { tags: ['Alerts'], summary: 'Delete notification channel', operationId: 'deleteAlertNotificationChannel', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/alerts/suppression-rules': {
        get:  { tags: ['Alerts'], summary: 'List alert suppression rules',  operationId: 'listAlertSuppressionRules',  security: [{ bearerAuth: [] }], responses: r200('AlertSuppressionRule[]') },
        post: { tags: ['Alerts'], summary: 'Create alert suppression rule', operationId: 'createAlertSuppressionRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('alertSuppressionRules_createRule'), responses: r201('AlertSuppressionRule') },
      },
      '/alerts/suppression-rules/{id}': {
        put:    { tags: ['Alerts'], summary: 'Update alert suppression rule', operationId: 'updateAlertSuppressionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('alertSuppressionRules_updateRule'), responses: r200('AlertSuppressionRule') },
        delete: { tags: ['Alerts'], summary: 'Delete alert suppression rule', operationId: 'deleteAlertSuppressionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/alerts/evaluate-v2': {
        post: { tags: ['Alerts'], summary: 'Trigger enhanced alert evaluation (v2)', operationId: 'evaluateAlertsV2', security: [{ bearerAuth: [] }], responses: r200('Results') },
      },

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
      '/reports/revenue-by-period': { get: { tags: ['Reports'], summary: 'Revenue by period (daily/weekly/monthly/quarterly/annually)', operationId: 'revenueByPeriod', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/revenue-by-plan': { get: { tags: ['Reports'], summary: 'Revenue by service plan', operationId: 'revenueByPlan', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/revenue-by-region': { get: { tags: ['Reports'], summary: 'Revenue by region/city', operationId: 'revenueByRegion', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/revenue-by-agent': { get: { tags: ['Reports'], summary: 'Revenue by sales agent', operationId: 'revenueByAgent', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/cash-flow': { get: { tags: ['Reports'], summary: 'Cash flow (inflow vs outflow by month)', operationId: 'cashFlow', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/payment-methods': { get: { tags: ['Reports'], summary: 'Payment method breakdown', operationId: 'paymentMethodBreakdown', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/churn-revenue': { get: { tags: ['Reports'], summary: 'Churn revenue impact', operationId: 'churnRevenue', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/agent-commissions': { get: { tags: ['Reports'], summary: 'Agent commission calculations', operationId: 'agentCommissions', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/tax-summary': { get: { tags: ['Reports'], summary: 'Tax summary (IVA/ISR)', operationId: 'taxSummary', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/sat-export': { get: { tags: ['Reports'], summary: 'SAT-compliant export for Mexico', operationId: 'satExport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/subscriber-counts': { get: { tags: ['Reports'], summary: 'Subscriber counts over time', operationId: 'subscriberCounts', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/arpu': { get: { tags: ['Reports'], summary: 'Average revenue per user (ARPU)', operationId: 'arpuReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/bandwidth-utilization': { get: { tags: ['Reports'], summary: 'Bandwidth utilization per device', operationId: 'bandwidthUtilization', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/top-consumers': { get: { tags: ['Reports'], summary: 'Top consumers by bandwidth', operationId: 'topConsumers', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/uptime-by-area': { get: { tags: ['Reports'], summary: 'Uptime/downtime by service area', operationId: 'uptimeByArea', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/mttr': { get: { tags: ['Reports'], summary: 'Mean Time To Repair (MTTR)', operationId: 'mttrReport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/installation-completion': { get: { tags: ['Reports'], summary: 'Installation completion rate', operationId: 'installationCompletion', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/congested-links': { get: { tags: ['Reports'], summary: 'Top congested network links', operationId: 'congestedLinks', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/sfp-lifespan': { get: { tags: ['Reports'], summary: 'SFP lifespan and replacement forecast', operationId: 'sfpLifespan', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/optical-degradation': { get: { tags: ['Reports'], summary: 'Optical power degradation trends', operationId: 'opticalDegradation', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/device-reboots': { get: { tags: ['Reports'], summary: 'Reboot frequency per device', operationId: 'deviceReboots', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/snmp-poll-success': { get: { tags: ['Reports'], summary: 'SNMP polling success rate', operationId: 'snmpPollSuccess', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/alert-frequency': { get: { tags: ['Reports'], summary: 'Alert frequency and resolution time', operationId: 'alertFrequency', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/capacity-forecast': { get: { tags: ['Reports'], summary: 'Capacity planning forecast', operationId: 'capacityForecast', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/pon-utilization': { get: { tags: ['Reports'], summary: 'PON port utilization forecast', operationId: 'ponUtilization', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/data-retention-compliance': { get: { tags: ['Reports'], summary: 'Data retention compliance report', operationId: 'dataRetentionCompliance', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/ip-assignment-log': { get: { tags: ['Reports'], summary: 'IP assignment log', operationId: 'ipAssignmentLog', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/subscriber-identity': { get: { tags: ['Reports'], summary: 'Subscriber identity verification report', operationId: 'subscriberIdentity', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/interception-readiness': { get: { tags: ['Reports'], summary: 'Traffic interception readiness', operationId: 'interceptionReadiness', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/regulatory-export': { get: { tags: ['Reports'], summary: 'Regulatory filing data export', operationId: 'regulatoryExport', security: [{ bearerAuth: [] }], responses: r200('Report') } },
      '/reports/{report}/export': { get: { tags: ['Reports'], summary: 'Export any report as CSV/XLSX/PDF', operationId: 'exportReport', security: [{ bearerAuth: [] }], parameters: [{ name: 'report', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'xlsx', 'pdf'] } }], responses: r200File('application/octet-stream') } },
      '/reports/generate': { post: { tags: ['Reports'], summary: 'Generate a report on-demand', operationId: 'generateReport', security: [{ bearerAuth: [] }], requestBody: jsonBody('report_def_name + format + parameters'), responses: { '202': { description: 'Accepted — generated_reports record created', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/report-definitions': {
        get: { tags: ['Reports'], summary: 'List report definitions (built-in + org)', operationId: 'listReportDefinitions', security: [{ bearerAuth: [] }], responses: r200('ReportDefinition[]') },
        post: { tags: ['Reports'], summary: 'Create a report definition', operationId: 'createReportDefinition', security: [{ bearerAuth: [] }], requestBody: jsonBody('ReportDefinition'), responses: r201('ReportDefinition') },
      },
      '/report-definitions/{id}': {
        get: { tags: ['Reports'], summary: 'Get a report definition', operationId: 'getReportDefinition', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ReportDefinition') },
        put: { tags: ['Reports'], summary: 'Update a report definition', operationId: 'updateReportDefinition', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ReportDefinition'), responses: r200('ReportDefinition') },
        delete: { tags: ['Reports'], summary: 'Delete a report definition', operationId: 'deleteReportDefinition', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/scheduled-reports': {
        get: { tags: ['Reports'], summary: 'List scheduled reports', operationId: 'listScheduledReports', security: [{ bearerAuth: [] }], responses: r200('ScheduledReport[]') },
        post: { tags: ['Reports'], summary: 'Create a scheduled report', operationId: 'createScheduledReport', security: [{ bearerAuth: [] }], requestBody: jsonBody('ScheduledReport'), responses: r201('ScheduledReport') },
      },
      '/scheduled-reports/{id}': {
        get: { tags: ['Reports'], summary: 'Get a scheduled report', operationId: 'getScheduledReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ScheduledReport') },
        put: { tags: ['Reports'], summary: 'Update a scheduled report', operationId: 'updateScheduledReport', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ScheduledReport'), responses: r200('ScheduledReport') },
        delete: { tags: ['Reports'], summary: 'Delete a scheduled report', operationId: 'deleteScheduledReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/scheduled-reports/{id}/run': { post: { tags: ['Reports'], summary: 'Manually trigger a scheduled report now', operationId: 'runScheduledReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { '202': { description: 'Accepted — generated_reports record created', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/dashboard-widgets': {
        get: { tags: ['Reports'], summary: 'List dashboard widgets', operationId: 'listDashboardWidgets', security: [{ bearerAuth: [] }], responses: r200('DashboardWidget[]') },
        post: { tags: ['Reports'], summary: 'Create a dashboard widget', operationId: 'createDashboardWidget', security: [{ bearerAuth: [] }], requestBody: jsonBody('DashboardWidget'), responses: r201('DashboardWidget') },
      },
      '/dashboard-widgets/batch': { put: { tags: ['Reports'], summary: 'Bulk update widget positions', operationId: 'batchUpdateWidgets', security: [{ bearerAuth: [] }], requestBody: jsonBody('Widget positions'), responses: r200('DashboardWidget[]') } },
      '/dashboard-widgets/{id}': {
        put: { tags: ['Reports'], summary: 'Update a dashboard widget', operationId: 'updateDashboardWidget', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('DashboardWidget'), responses: r200('DashboardWidget') },
        delete: { tags: ['Reports'], summary: 'Delete a dashboard widget', operationId: 'deleteDashboardWidget', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/custom-reports': {
        get: { tags: ['Reports'], summary: 'List custom reports', operationId: 'listCustomReports', security: [{ bearerAuth: [] }], responses: r200('CustomReport[]') },
        post: { tags: ['Reports'], summary: 'Create a custom report', operationId: 'createCustomReport', security: [{ bearerAuth: [] }], requestBody: jsonBody('CustomReport'), responses: r201('CustomReport') },
      },
      '/custom-reports/{id}': {
        get: { tags: ['Reports'], summary: 'Get a custom report', operationId: 'getCustomReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CustomReport') },
        put: { tags: ['Reports'], summary: 'Update a custom report', operationId: 'updateCustomReport', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('CustomReport'), responses: r200('CustomReport') },
        delete: { tags: ['Reports'], summary: 'Delete a custom report', operationId: 'deleteCustomReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/custom-reports/{id}/execute': { post: { tags: ['Reports'], summary: 'Execute a custom SQL report', operationId: 'executeCustomReport', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Query results') } },

      // ---- Usage ----
      '/usage': { get: { tags: ['Usage'], summary: 'List usage records', operationId: 'listUsage', security: [{ bearerAuth: [] }], responses: r200('Usage[]') } },
      '/usage/{contractId}': { get: { tags: ['Usage'], summary: 'Get usage for a contract', operationId: 'getContractUsage', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Usage') } },

      // ---- Checkout ----
      '/checkout/create-session': { post: { tags: ['Checkout'], summary: 'Create checkout session', operationId: 'createCheckoutSession', security: [{ bearerAuth: [] }], requestBody: jsonBody('invoice_id + gateway'), responses: r201('Session') } },

      // ---- Expenses ----
      ...crudPaths('expenses', 'Expenses', 'Expense'),

      // ---- Revenue Summary ----
      '/revenue-summary': { get: { tags: ['Revenue Summary'], summary: 'List revenue summaries', operationId: 'listRevenueSummaries', security: [{ bearerAuth: [] }], responses: r200('RevenueSummary[]') } },

      // ---- Scheduled Tasks ----
      ...crudPaths('scheduled-tasks', 'Scheduled Tasks', 'ScheduledTask'),

      // ---- Queue Stats ----
      '/queue-stats': { get: { tags: ['Queue Stats'], summary: 'Get background job queue statistics', operationId: 'getQueueStats', security: [{ bearerAuth: [] }], responses: r200('QueueStats') } },

      // ---- Warehouses ----
      ...crudPaths('warehouses', 'Warehouses', 'Warehouse'),

      // ---- Inventory ----
      // NOTE: crudPaths('inventory', ...) below documents /inventory + /inventory/{id},
      // which do not match the real routes (/inventory/items, /inventory/items/{id},
      // /inventory/items/{id}/stock, /inventory/transactions) — a pre-existing drift
      // flagged in Inventory Phase 1, not fixed here (out of scope for this PR).
      ...crudPaths('inventory', 'Inventory', 'InventoryItem'),
      '/inventory/transactions': {
        get: {
          tags: ['Inventory'],
          summary: 'List inventory stock-movement ledger entries (org-scoped, paginated, newest first)',
          operationId: 'listInventoryTransactions',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'item_id', in: 'query', required: false, schema: { type: 'integer' }, description: 'Filter by inventory_items.id' },
            { name: 'stock_id', in: 'query', required: false, schema: { type: 'integer' }, description: 'Filter by inventory_stock.id' },
            { name: 'transaction_type', in: 'query', required: false, schema: { type: 'string', enum: ['receive', 'assign_to_job', 'sell_to_client', 'transfer_out', 'transfer_in', 'return', 'adjustment'] } },
            limitParam(),
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: r200('InventoryTransaction[]'),
        },
      },

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

      // ---- Promotions ----
      ...crudPaths('promotions', 'Promotions', 'Promotion'),

      // ---- Tax Rules ----
      ...crudPaths('tax-rules', 'Tax Rules', 'TaxRule'),

      // ---- Tax Rates ----
      ...crudPaths('tax-rates', 'Tax Rates', 'TaxRate'),

      // ---- Settings ----
      '/settings': {
        get: { tags: ['Settings'], summary: 'List settings', operationId: 'listSettings', security: [{ bearerAuth: [] }], responses: r200('Setting[]') },
        put: { tags: ['Settings'], summary: 'Update settings', operationId: 'updateSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('settings'), responses: r200('Setting[]') },
      },

      // ---- Message Templates ----
      ...crudPaths('message-templates', 'Settings', 'MessageTemplate'),
      '/message-templates/{id}/restore': { post: { tags: ['Settings'], summary: 'Restore a soft-deleted message template', operationId: 'restoreMessageTemplate', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('MessageTemplate') } },

      // ---- Audit Logs ----
      '/audit-logs': { get: { tags: ['Audit Logs'], summary: 'List audit log entries', operationId: 'listAuditLogs', security: [{ bearerAuth: [] }], responses: r200('AuditLog[]') } },

      // ---- DSAR ----
      '/dsar/clients/{id}': { get: { tags: ['DSAR'], summary: 'Export all personal data held for a client', operationId: 'exportClientDsar', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DSAR export document') } },

      // ---- DR Drill ----
      '/dr-drill/status': { get: { tags: ['DR Drill'], summary: 'Get latest disaster-recovery drill status', operationId: 'getDrDrillStatus', security: [{ bearerAuth: [] }], responses: r200('DR drill status') } },

      // ---- Export ----
      '/export/invoices': { get: { tags: ['Export'], summary: 'Export invoices as CSV', operationId: 'exportInvoices', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/clients': { get: { tags: ['Export'], summary: 'Export clients as CSV', operationId: 'exportClients', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/contracts': { get: { tags: ['Export'], summary: 'Export contracts as CSV', operationId: 'exportContracts', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },
      '/export/payments': { get: { tags: ['Export'], summary: 'Export payments as CSV', operationId: 'exportPayments', security: [{ bearerAuth: [] }], responses: r200File('text/csv') } },

      // ---- Import ----
      '/import/clients': { post: { tags: ['Import'], summary: 'Bulk import clients from CSV', operationId: 'importClients', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/devices': { post: { tags: ['Import'], summary: 'Bulk import devices from CSV', operationId: 'importDevices', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },
      '/import/contracts': { post: { tags: ['Import'], summary: 'Bulk import contracts from CSV (optional pppoe_username/pppoe_password columns carry over pre-existing PPPoE credentials instead of auto-generating them)', operationId: 'importContracts', security: [{ bearerAuth: [] }], requestBody: jsonBody('csv'), responses: r200('ImportResult') } },

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

      // ---- PROFECO Complaints ----
      ...crudPaths('profeco-complaints', 'PROFECO Complaints', 'ProfecoComplaint'),
      '/profeco-complaints/export': {
        get: {
          tags: ['PROFECO Complaints'],
          summary: 'Export complaints as JSON or CSV',
          operationId: 'exportProfecoComplaints',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date (inclusive)' },
            { name: 'date_to',   in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date (inclusive)' },
            { name: 'status',    in: 'query', schema: { type: 'string', enum: ['recibida', 'en_tramite', 'resuelta', 'archivada'] } },
            { name: 'format',    in: 'query', schema: { type: 'string', enum: ['json', 'csv'] }, description: 'Output format (default: json)' },
          ],
          responses: {
            200: {
              description: 'Complaint export',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/csv':         { schema: { type: 'string' } },
              },
            },
          },
        },
      },

      // ---- AI Assistant ----
      '/ai/policy': {
        get:  { tags: ['AI Assistant'], summary: 'Get AI reply policy', operationId: 'getAiPolicy', security: [{ bearerAuth: [] }], responses: r200('AiPolicy') },
        put:  { tags: ['AI Assistant'], summary: 'Upsert AI reply policy', operationId: 'upsertAiPolicy', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_updateAiPolicy'), responses: r200('AiPolicy') },
      },
      '/ai/providers/catalog': {
        get: { tags: ['AI Assistant'], summary: 'List supported LLM provider kinds', operationId: 'getAiProviderCatalog', security: [{ bearerAuth: [] }], responses: r200('Catalog[]') },
      },
      '/ai/providers': {
        get:  { tags: ['AI Assistant'], summary: 'List LLM providers', operationId: 'listAiProviders', security: [{ bearerAuth: [] }], responses: r200('AiProvider[]') },
        post: { tags: ['AI Assistant'], summary: 'Create LLM provider', operationId: 'createAiProvider', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_createAiProvider'), responses: r201('AiProvider') },
      },
      '/ai/providers/{id}': {
        put:    { tags: ['AI Assistant'], summary: 'Update LLM provider', operationId: 'updateAiProvider', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ai_updateAiProvider'), responses: r200('AiProvider') },
        delete: { tags: ['AI Assistant'], summary: 'Delete LLM provider', operationId: 'deleteAiProvider', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/ai/providers/{id}/verify': {
        post: { tags: ['AI Assistant'], summary: 'Test provider connectivity', operationId: 'verifyAiProvider', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('VerifyResult') },
      },
      '/ai/phrases': {
        get:  { tags: ['AI Assistant'], summary: 'List phrase library entries', operationId: 'listAiPhrases', security: [{ bearerAuth: [] }], responses: r200('AiPhrase[]') },
        post: { tags: ['AI Assistant'], summary: 'Add a phrase', operationId: 'createAiPhrase', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_createAiPhrase'), responses: r201('AiPhrase') },
      },
      '/ai/phrases/{id}': {
        put:    { tags: ['AI Assistant'], summary: 'Update a phrase', operationId: 'updateAiPhrase', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ai_updateAiPhrase'), responses: r200('AiPhrase') },
        delete: { tags: ['AI Assistant'], summary: 'Delete a phrase', operationId: 'deleteAiPhrase', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/ai/forbidden-terms': {
        get:  { tags: ['AI Assistant'], summary: 'List forbidden terms', operationId: 'listAiForbiddenTerms', security: [{ bearerAuth: [] }], responses: r200('AiForbiddenTerm[]') },
        post: { tags: ['AI Assistant'], summary: 'Add a forbidden term', operationId: 'createAiForbiddenTerm', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_createForbiddenTerm'), responses: r201('AiForbiddenTerm') },
      },
      '/ai/forbidden-terms/{id}': {
        delete: { tags: ['AI Assistant'], summary: 'Remove a forbidden term', operationId: 'deleteAiForbiddenTerm', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/ai/reply/draft': {
        post: { tags: ['AI Assistant'], summary: 'Generate a draft reply (never auto-sends)', operationId: 'aiReplyDraft', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_replyDraft'), responses: r200('AiDraftResult') },
      },
      '/ai/reply/send': {
        post: { tags: ['AI Assistant'], summary: 'Record reviewer decision and optionally send reply', operationId: 'aiReplySend', security: [{ bearerAuth: [] }], requestBody: jsonBody('ai_replySend'), responses: r200('AiSendResult') },
      },
      '/ai/logs': {
        get: {
          tags: ['AI Assistant'],
          summary: 'List AI reply audit logs',
          operationId: 'listAiReplyLogs',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ticket_id', in: 'query', schema: { type: 'integer' }, description: 'Filter by ticket' },
            { name: 'action',    in: 'query', schema: { type: 'string', enum: ['proposed', 'edited', 'sent', 'auto_sent', 'discarded', 'failed'] } },
            { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'date_to',   in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'limit',     in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset',    in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: r200('AiReplyLog[]'),
        },
      },
      // ---- Invoice Settings — §2.2B ----
      '/invoice-settings': {
        get: { tags: ['Invoice Settings'], summary: 'Get invoice branding settings for current org', operationId: 'getInvoiceSettings', security: [{ bearerAuth: [] }], responses: r200('InvoiceSettings') },
        put: { tags: ['Invoice Settings'], summary: 'Upsert invoice branding settings', operationId: 'updateInvoiceSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('InvoiceSettings'), responses: r200('InvoiceSettings') },
      },

      // ---- Email Settings — per-org outbound SMTP (migration 386) ----
      '/email-settings': {
        get: { tags: ['Email Settings'], summary: 'Get per-org outbound email (SMTP) configuration (password masked)', operationId: 'getEmailSettings', security: [{ bearerAuth: [] }], responses: r200('EmailSettings') },
        put: { tags: ['Email Settings'], summary: 'Update per-org outbound email (SMTP) configuration', operationId: 'updateEmailSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('EmailSettingsUpdate'), responses: r200('EmailSettings') },
      },
      '/email-settings/test': {
        post: { tags: ['Email Settings'], summary: "Send a test email using the org's (or global fallback) SMTP config", operationId: 'testEmailSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('EmailSettingsTest'), responses: r200('EmailTestResult') },
      },

      // ---- Late Fee Rules — §2.2B ----
      ...crudPaths('late-fee-rules', 'Late Fee Rules', 'LateFeeRule'),

      // ---- Payment Reminders — §2.2B ----
      '/payment-reminder-settings': {
        get: { tags: ['Payment Reminders'], summary: 'Get payment reminder schedule settings', operationId: 'getPaymentReminderSettings', security: [{ bearerAuth: [] }], responses: r200('PaymentReminderSettings') },
        put: { tags: ['Payment Reminders'], summary: 'Upsert payment reminder schedule settings', operationId: 'updatePaymentReminderSettings', security: [{ bearerAuth: [] }], requestBody: jsonBody('PaymentReminderSettings'), responses: r200('PaymentReminderSettings') },
      },

      // ---- Payment Plans — §2.3 ----
      ...crudPaths('payment-plans', 'Payment Plans', 'PaymentPlan'),
      '/payment-plans/{id}/installments/{seq}/pay': { post: { tags: ['Payment Plans'], summary: 'Record payment for a specific installment', operationId: 'payPlanInstallment', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'seq', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('paymentPlans_payInstallmentSchema'), responses: r200('Installment') } },

      // ---- Cash Reconciliation — §2.3 ----
      '/cash-reconciliation/sessions': {
        get: { tags: ['Cash Reconciliation'], summary: 'List cash reconciliation sessions', operationId: 'listCashReconciliationSessions', security: [{ bearerAuth: [] }], responses: r200('CashReconciliationSession[]') },
        post: { tags: ['Cash Reconciliation'], summary: 'Open a new cash reconciliation session', operationId: 'openCashReconciliationSession', security: [{ bearerAuth: [] }], requestBody: jsonBody('cashReconciliation_openSessionSchema'), responses: r201('CashReconciliationSession') },
      },
      '/cash-reconciliation/sessions/{id}': {
        get: { tags: ['Cash Reconciliation'], summary: 'Get session detail with included cash payments', operationId: 'getCashReconciliationSession', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CashReconciliationSession') },
      },
      '/cash-reconciliation/sessions/{id}/close': { post: { tags: ['Cash Reconciliation'], summary: 'Close a session with counted total', operationId: 'closeCashReconciliationSession', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cashReconciliation_closeSessionSchema'), responses: r200('CashReconciliationSession') } },
      '/cash-reconciliation/sessions/{id}/approve': { post: { tags: ['Cash Reconciliation'], summary: 'Approve a closed reconciliation session', operationId: 'approveCashReconciliationSession', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CashReconciliationSession') } },

      // ---- Communication — §1.4 ----
      ...crudPaths('communication-campaigns', 'Communication', 'CommunicationCampaign'),
      '/communication-campaigns/{id}/restore': { post: { tags: ['Communication'], summary: 'Restore a soft-deleted campaign', operationId: 'restoreCommunicationCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CommunicationCampaign') } },
      '/communication-campaigns/{id}/dispatch': { post: { tags: ['Communication'], summary: 'Dispatch a campaign — build recipient list and queue messages', operationId: 'dispatchCommunicationCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DispatchResult') } },
      '/communication-campaigns/{id}/messages': {
        get: {
          tags: ['Communication'],
          summary: 'List per-recipient messages for a campaign',
          operationId: 'listCampaignMessages',
          security: [{ bearerAuth: [] }],
          parameters: [
            idParam(),
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['queued', 'sent', 'delivered', 'opened', 'bounced', 'failed'] } },
            { name: 'page',   in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit',  in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: r200('CampaignMessage[]'),
        },
      },
      '/clients/{clientId}/dnd': {
        get: {
          tags: ['Communication'],
          summary: 'Get DND preferences for a client',
          operationId: 'getClientDnd',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: r200('DndPreference[]'),
        },
        put: {
          tags: ['Communication'],
          summary: 'Upsert all DND channel preferences for a client',
          operationId: 'putClientDnd',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: jsonBody('DndPreference[]'),
          responses: r200('DndPreference[]'),
        },
      },
      '/clients/{clientId}/dnd/{channel}': {
        patch: {
          tags: ['Communication'],
          summary: 'Upsert DND preference for a single channel',
          operationId: 'patchClientDndChannel',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'clientId', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'channel',  in: 'path', required: true, schema: { type: 'string', enum: ['email', 'sms', 'whatsapp', 'all'] } },
          ],
          requestBody: jsonBody('DndPreference'),
          responses: r200('DndPreference'),
        },
      },
      '/communication/delivery-webhook': {
        post: {
          tags: ['Communication'],
          summary: 'Delivery status callback from provider (webhook)',
          operationId: 'communicationDeliveryWebhook',
          requestBody: jsonBody('DeliveryStatus'),
          responses: r200('updated or skipped'),
        },
      },

      // ---- Refund Requests — §2.5.1 ----
      ...crudPaths('refund-requests', 'Refund Requests', 'RefundRequest'),
      '/refund-requests/{id}/review': { post: { tags: ['Refund Requests'], summary: 'Approve or reject a refund request', operationId: 'reviewRefundRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('refundRequests_reviewRefundRequestSchema'), responses: r200('RefundRequest') } },
      '/refund-requests/{id}/process': { post: { tags: ['Refund Requests'], summary: 'Process an approved refund request (issue credit, credit_note, or mark gateway refund)', operationId: 'processRefundRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('refundRequests_processRefundRequestSchema'), responses: r200('RefundRequest') } },

      // ---- Billing Disputes — §2.5.2 ----
      ...crudPaths('billing-disputes', 'Billing Disputes', 'BillingDispute'),
      '/billing-disputes/{id}/transition': { post: { tags: ['Billing Disputes'], summary: 'Transition dispute status (open → investigating → resolved)', operationId: 'transitionBillingDispute', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('billingDisputes_transitionBillingDisputeSchema'), responses: r200('BillingDispute') } },
      '/billing-disputes/{id}/evidence': {
        get: { tags: ['Billing Disputes'], summary: 'List evidence files for a dispute', operationId: 'listDisputeEvidence', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DisputeEvidence[]') },
        post: { tags: ['Billing Disputes'], summary: 'Upload evidence file (multipart/form-data)', operationId: 'uploadDisputeEvidence', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } } } } } }, responses: r201('DisputeEvidence') } },
      '/billing-disputes/{id}/evidence/{evidenceId}/download': { get: { tags: ['Billing Disputes'], summary: 'Download evidence file', operationId: 'downloadDisputeEvidence', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'evidenceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200File('application/octet-stream') } },

      // ---- Chargebacks — §2.5.3 ----
      ...crudPaths('chargebacks', 'Chargebacks', 'Chargeback'),

      // ---- Billing Adjustments — §2.5.4 ----
      '/billing-adjustments': {
        get: { tags: ['Billing Adjustments'], summary: 'List billing adjustments with filters', operationId: 'listBillingAdjustments', security: [{ bearerAuth: [] }], parameters: [{ name: 'client_id', in: 'query', schema: { type: 'integer' } }, { name: 'entity_type', in: 'query', schema: { type: 'string', enum: ['invoice', 'payment', 'credit_note', 'balance'] } }, { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } }], responses: r200('BillingAdjustment[]') },
        post: { tags: ['Billing Adjustments'], summary: 'Record a billing adjustment (also mirrors to audit_logs)', operationId: 'createBillingAdjustment', security: [{ bearerAuth: [] }], requestBody: jsonBody('billingAdjustments_createBillingAdjustmentSchema'), responses: r201('BillingAdjustment') },
      },
      '/billing-adjustments/{id}': {
        get: { tags: ['Billing Adjustments'], summary: 'Get a billing adjustment', operationId: 'getBillingAdjustment', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BillingAdjustment') },
      },

      '/ai/metrics': {
        get: {
          tags: ['AI Assistant'],
          summary: 'Aggregate AI usage metrics for the current org',
          operationId: 'getAiMetrics',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'month', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, description: 'YYYY-MM (defaults to current UTC month)' },
          ],
          responses: r200('AiMetrics'),
        },
      },

      // ---- PPPoE Service Profiles — §4B ----
      ...crudPaths('pppoe-service-profiles', 'PPPoE Service Profiles', 'PppoeServiceProfile'),
      '/pppoe-service-profiles/{id}/restore': { post: { tags: ['PPPoE Service Profiles'], summary: 'Restore a soft-deleted PPPoE service profile', operationId: 'restorePppoeServiceProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PppoeServiceProfile') } },

      // ---- PPPoE Diagnostics + Event Ingest — §4B ----
      '/pppoe/diagnostics/auth-failures': {
        get: {
          tags: ['PPPoE'],
          summary: 'Classify auth failures from radpostauth',
          operationId: 'getPppoeAuthFailures',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start datetime filter' },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End datetime filter' },
            { name: 'username', in: 'query', schema: { type: 'string' }, description: 'Filter by username' },
          ],
          responses: r200('PppoeAuthFailures'),
        },
      },
      '/pppoe/diagnostics/mtu-issues': {
        get: {
          tags: ['PPPoE'],
          summary: 'Detect MTU misconfiguration advisories',
          operationId: 'getPppoeMtuIssues',
          security: [{ bearerAuth: [] }],
          responses: r200('PppoeMtuAdvisories'),
        },
      },
      '/pppoe/events': {
        get: {
          tags: ['PPPoE'],
          summary: 'List PPPoE event log entries',
          operationId: 'listPppoeEvents',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'username', in: 'query', schema: { type: 'string' } },
            { name: 'mac', in: 'query', schema: { type: 'string' } },
            { name: 'stage', in: 'query', schema: { type: 'string', enum: ['PADI','PADO','PADR','PADS','PADT','LCP','IPCP','IPV6CP','AUTH','OTHER'] } },
            { name: 'severity', in: 'query', schema: { type: 'string', enum: ['info','warning','error'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: r200('PppoeEventLog[]'),
        },
        post: {
          tags: ['PPPoE'],
          summary: 'Ingest PPPoE event log entry (machine-to-machine, no JWT)',
          operationId: 'ingestPppoeEvent',
          security: [],
          requestBody: jsonBody('PPPoE event payload'),
          responses: { 201: { description: 'Accepted', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { description: 'Invalid or missing X-Pppoe-Secret' } },
        },
      },

      // ---- DHCP Servers — §5.1 ----
      ...crudPaths('dhcp-servers', 'DHCP Servers', 'DhcpServer'),
      '/dhcp-servers/{id}/reservations': {
        get: { tags: ['DHCP Servers'], summary: 'List static reservations for a DHCP server', operationId: 'listDhcpReservations', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DhcpReservation[]') },
        post: { tags: ['DHCP Servers'], summary: 'Create a static DHCP reservation', operationId: 'createDhcpReservation', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('dhcpServers_createDhcpReservation'), responses: r201('DhcpReservation') },
      },
      '/dhcp-servers/reservations/{rid}': {
        put: { tags: ['DHCP Servers'], summary: 'Update a static DHCP reservation', operationId: 'updateDhcpReservation', security: [{ bearerAuth: [] }], parameters: [{ name: 'rid', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('dhcpServers_updateDhcpReservation'), responses: r200('DhcpReservation') },
        delete: { tags: ['DHCP Servers'], summary: 'Delete a static DHCP reservation', operationId: 'deleteDhcpReservation', security: [{ bearerAuth: [] }], parameters: [{ name: 'rid', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- NAT Management — §5.1 ----
      ...crudPaths('nat-pools', 'NAT Management', 'NatPool'),

      // ---- PTR Records — §5.1 ----
      ...crudPaths('ptr-records', 'PTR Records', 'PtrRecord'),

      // ---- IPv6 Management — §5.2 ----
      '/ipv6/ra-guard': {
        get: { tags: ['IPv6 Management'], summary: 'List RA Guard policies', operationId: 'listRaGuardPolicies', security: [{ bearerAuth: [] }], parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } }, { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } }], responses: r200('RaGuardPolicy[]') },
        post: { tags: ['IPv6 Management'], summary: 'Create an RA Guard policy', operationId: 'createRaGuardPolicy', security: [{ bearerAuth: [] }], requestBody: jsonBody('raGuardPolicies_createRaGuardPolicy'), responses: r201('RaGuardPolicy') },
      },
      '/ipv6/ra-guard/{id}': {
        get: { tags: ['IPv6 Management'], summary: 'Get an RA Guard policy', operationId: 'getRaGuardPolicy', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RaGuardPolicy') },
        put: { tags: ['IPv6 Management'], summary: 'Update an RA Guard policy', operationId: 'updateRaGuardPolicy', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('raGuardPolicies_updateRaGuardPolicy'), responses: r200('RaGuardPolicy') },
        delete: { tags: ['IPv6 Management'], summary: 'Delete an RA Guard policy', operationId: 'deleteRaGuardPolicy', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/ipv6/subnet-plan': {
        get: { tags: ['IPv6 Management'], summary: 'Plan subnets from a network CIDR', operationId: 'planSubnets', security: [{ bearerAuth: [] }], parameters: [{ name: 'network', in: 'query', required: true, schema: { type: 'string' }, description: 'Network CIDR e.g. 2001:db8::/32' }, { name: 'prefix_len', in: 'query', required: true, schema: { type: 'integer' }, description: 'Parent prefix length' }, { name: 'sub_prefix_len', in: 'query', required: true, schema: { type: 'integer' }, description: 'Subnet prefix length' }], responses: r200('string[]') },
      },
      '/ipv6/pool-conflicts': {
        get: { tags: ['IPv6 Management'], summary: 'Detect overlapping IP pools', operationId: 'detectPoolConflicts', security: [{ bearerAuth: [] }], responses: r200('PoolConflict[]') },
      },

      // ---- Transition Mechanisms — §5.4 ----
      '/transition-mechanisms/6rd': {
        get: { tags: ['Transition Mechanisms'], summary: 'List 6rd configurations', operationId: 'list6rdConfigs', security: [{ bearerAuth: [] }], responses: r200('Tunnel6rdConfig[]') },
        post: { tags: ['Transition Mechanisms'], summary: 'Create a 6rd configuration', operationId: 'create6rdConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('transitionMechanisms_createTransitionMechanism'), responses: r201('Tunnel6rdConfig') },
      },
      '/transition-mechanisms/6rd/{id}': {
        get: { tags: ['Transition Mechanisms'], summary: 'Get a 6rd configuration', operationId: 'get6rdConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Tunnel6rdConfig') },
        put: { tags: ['Transition Mechanisms'], summary: 'Update a 6rd configuration', operationId: 'update6rdConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('transitionMechanisms_updateTransitionMechanism'), responses: r200('Tunnel6rdConfig') },
        delete: { tags: ['Transition Mechanisms'], summary: 'Delete a 6rd configuration', operationId: 'delete6rdConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/transition-mechanisms/ds-lite': {
        get: { tags: ['Transition Mechanisms'], summary: 'List DS-Lite configurations', operationId: 'listDsLiteConfigs', security: [{ bearerAuth: [] }], responses: r200('DsLiteConfig[]') },
        post: { tags: ['Transition Mechanisms'], summary: 'Create a DS-Lite configuration', operationId: 'createDsLiteConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('transitionMechanisms_createTransitionMechanism'), responses: r201('DsLiteConfig') },
      },
      '/transition-mechanisms/ds-lite/{id}': {
        get: { tags: ['Transition Mechanisms'], summary: 'Get a DS-Lite configuration', operationId: 'getDsLiteConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DsLiteConfig') },
        put: { tags: ['Transition Mechanisms'], summary: 'Update a DS-Lite configuration', operationId: 'updateDsLiteConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('transitionMechanisms_updateTransitionMechanism'), responses: r200('DsLiteConfig') },
        delete: { tags: ['Transition Mechanisms'], summary: 'Delete a DS-Lite configuration', operationId: 'deleteDsLiteConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/transition-mechanisms/map-rules': {
        get: { tags: ['Transition Mechanisms'], summary: 'List MAP rules', operationId: 'listMapRules', security: [{ bearerAuth: [] }], responses: r200('MapRule[]') },
        post: { tags: ['Transition Mechanisms'], summary: 'Create a MAP rule', operationId: 'createMapRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('transitionMechanisms_createTransitionMechanism'), responses: r201('MapRule') },
      },
      '/transition-mechanisms/map-rules/{id}': {
        get: { tags: ['Transition Mechanisms'], summary: 'Get a MAP rule', operationId: 'getMapRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('MapRule') },
        put: { tags: ['Transition Mechanisms'], summary: 'Update a MAP rule', operationId: 'updateMapRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('transitionMechanisms_updateTransitionMechanism'), responses: r200('MapRule') },
        delete: { tags: ['Transition Mechanisms'], summary: 'Delete a MAP rule', operationId: 'deleteMapRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/transition-mechanisms/464xlat': {
        get: { tags: ['Transition Mechanisms'], summary: 'List 464XLAT configurations', operationId: 'list464XlatConfigs', security: [{ bearerAuth: [] }], responses: r200('Xlat464Config[]') },
        post: { tags: ['Transition Mechanisms'], summary: 'Create a 464XLAT configuration', operationId: 'create464XlatConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('transitionMechanisms_createTransitionMechanism'), responses: r201('Xlat464Config') },
      },
      '/transition-mechanisms/464xlat/{id}': {
        get: { tags: ['Transition Mechanisms'], summary: 'Get a 464XLAT configuration', operationId: 'get464XlatConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Xlat464Config') },
        put: { tags: ['Transition Mechanisms'], summary: 'Update a 464XLAT configuration', operationId: 'update464XlatConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('transitionMechanisms_updateTransitionMechanism'), responses: r200('Xlat464Config') },
        delete: { tags: ['Transition Mechanisms'], summary: 'Delete a 464XLAT configuration', operationId: 'delete464XlatConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- Device Groups §6.1 ----
      ...crudPaths('device-groups', 'Device Groups', 'DeviceGroup'),
      '/device-groups/{id}/restore': { post: { tags: ['Device Groups'], summary: 'Restore a soft-deleted device group', operationId: 'restoreDeviceGroup', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DeviceGroup') } },
      '/device-groups/{id}/members': {
        get: { tags: ['Device Groups'], summary: 'List devices in a group', operationId: 'listDeviceGroupMembers', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Device[]') },
        post: { tags: ['Device Groups'], summary: 'Add devices to a group', operationId: 'addDeviceGroupMembers', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('deviceGroups_addGroupMembers'), responses: r200('Added count') },
      },
      '/device-groups/{id}/members/{deviceId}': {
        delete: { tags: ['Device Groups'], summary: 'Remove a device from a group', operationId: 'removeDeviceGroupMember', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'deviceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- Discovery Scans §6.1 ----
      ...crudPaths('discovery-scans', 'Discovery Scans', 'DiscoveryScan'),
      '/discovery-scans/{id}/restore': { post: { tags: ['Discovery Scans'], summary: 'Restore a soft-deleted scan', operationId: 'restoreDiscoveryScan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DiscoveryScan') } },
      '/discovery-scans/{id}/results': {
        get: { tags: ['Discovery Scans'], summary: 'List discovery results for a scan', operationId: 'listDiscoveryResults', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DiscoveryResult[]') },
      },
      '/discovery-scans/{id}/results/{resultId}/onboard': {
        post: { tags: ['Discovery Scans'], summary: 'Onboard a discovered device', operationId: 'onboardDiscoveryResult', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'resultId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('Device override fields'), responses: r201('Device') },
      },
      '/discovery-scans/{id}/results/{resultId}/ignore': {
        post: { tags: ['Discovery Scans'], summary: 'Ignore a discovery result', operationId: 'ignoreDiscoveryResult', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'resultId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Message') },
      },

      // ---- Trap Forwarding Rules §6.1 ----
      ...crudPaths('trap-forwarding-rules', 'Trap Forwarding Rules', 'TrapForwardingRule'),
      '/trap-forwarding-rules/{id}/restore': { post: { tags: ['Trap Forwarding Rules'], summary: 'Restore a soft-deleted trap forwarding rule', operationId: 'restoreTrapForwardingRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TrapForwardingRule') } },

      // ---- SNMP Metrics §6.2/6.3 ----
      '/snmp-metrics': {
        get: { tags: ['SNMP Metrics'], summary: 'Time-series metrics for a device', operationId: 'getSnmpMetrics', security: [{ bearerAuth: [] }], parameters: [{ name: 'device_id', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'resolution', in: 'query', schema: { type: 'string', enum: ['raw', '1hr', '1day'], default: '1hr' } }, { name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 8760 } }, { name: 'interface_id', in: 'query', schema: { type: 'string' } }], responses: r200('SnmpMetricsResponse') },
      },
      '/snmp-metrics/devices': {
        get: { tags: ['SNMP Metrics'], summary: 'List SNMP-enabled devices', operationId: 'listSnmpDevices', security: [{ bearerAuth: [] }], responses: r200('Device[]') },
      },
      '/snmp-metrics/top-talkers': {
        get: { tags: ['SNMP Metrics'], summary: 'Top interfaces by total bytes', operationId: 'getTopTalkers', security: [{ bearerAuth: [] }], parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 100 } }], responses: r200('TopTalkersResponse') },
      },
      '/snmp-metrics/interfaces/{deviceId}': {
        get: { tags: ['SNMP Metrics'], summary: 'Per-interface utilization stats for a device', operationId: 'getInterfaceStats', security: [{ bearerAuth: [] }], parameters: [{ name: 'deviceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('InterfaceStatsResponse') },
      },
      '/snmp-metrics/errors': {
        get: { tags: ['SNMP Metrics'], summary: 'Error and discard counters per interface', operationId: 'getInterfaceErrors', security: [{ bearerAuth: [] }], parameters: [{ name: 'device_id', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }], responses: r200('InterfaceErrorsResponse') },
      },

      // ---- Poller Nodes §6.4 ----
      ...crudPaths('poller-nodes', 'Poller Nodes', 'PollerNode'),
      '/poller-nodes/{id}/performance': {
        get: { tags: ['Poller Nodes'], summary: 'Performance history for a poller node', operationId: 'getPollerNodePerformance', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }], responses: r200('PollerPerformanceHistory') },
      },

      // ---- Device Polling Configs §6.4 ----
      ...crudPaths('device-polling-configs', 'Device Polling Configs', 'DevicePollingConfig'),

      // ---- Poller Performance §6.4 ----
      '/poller-performance': {
        get: { tags: ['Poller Performance'], summary: 'List poller performance snapshots', operationId: 'listPollerPerformanceSnapshots', security: [{ bearerAuth: [] }], parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }, { name: 'node_id', in: 'query', schema: { type: 'integer' } }, { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }], responses: r200('PollerPerformanceSnapshot[]') },
      },
      '/poller-performance/dashboard': {
        get: { tags: ['Poller Performance'], summary: 'Aggregated poller performance dashboard', operationId: 'getPollerPerformanceDashboard', security: [{ bearerAuth: [] }], parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }], responses: r200('PollerPerformanceDashboard') },
      },

      // ---- Device Config Backup Extensions §6.6 ----
      '/device-config-backups/diff/{id}': { get: { tags: ['Device Config Backups'], summary: 'Get diff from previous version', operationId: 'getConfigBackupDiff', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ConfigDiff') } },
      '/device-config-backups/compliance-run': { post: { tags: ['Device Config Backups'], summary: 'Run compliance audit on a backup', operationId: 'runBackupComplianceAudit', security: [{ bearerAuth: [] }], requestBody: jsonBody('ComplianceRunRequest'), responses: r200('ComplianceRunResult') } },
      '/device-config-backups/compliance-results': { get: { tags: ['Device Config Backups'], summary: 'List compliance audit results', operationId: 'listBackupComplianceResults', security: [{ bearerAuth: [] }], responses: r200('ComplianceResult[]') } },

      // ---- Config Templates §6.6 ----
      ...crudPaths('config-templates', 'Config Templates', 'ConfigTemplate'),
      '/config-templates/{id}/deploy': { post: { tags: ['Config Templates'], summary: 'Deploy config template to a device', operationId: 'deployConfigTemplate', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('DeployRequest'), responses: r201('ConfigDeploymentRecord') } },

      // ---- Config Backup Schedules §6.6 ----
      ...crudPaths('config-backup-schedules', 'Config Backup Schedules', 'ConfigBackupSchedule'),

      // ---- Config Compliance Rules §6.6 ----
      ...crudPaths('config-compliance-rules', 'Config Compliance Rules', 'ConfigComplianceRule'),
      '/config-compliance-rules/results': { get: { tags: ['Config Compliance Rules'], summary: 'List compliance audit results', operationId: 'listComplianceRulesResults', security: [{ bearerAuth: [] }], responses: r200('ComplianceResult[]') } },
      '/config-compliance-rules/run': { post: { tags: ['Config Compliance Rules'], summary: 'Run compliance audit on a backup', operationId: 'runComplianceAudit', security: [{ bearerAuth: [] }], requestBody: jsonBody('ComplianceRunRequest'), responses: r200('ComplianceRunResult') } },

      // ---- OLT Management §7.1 ----
      '/olt-management/{id}/ports': {
        get: { tags: ['OLT Management'], summary: 'List PON/uplink ports for an OLT', operationId: 'listOltPorts', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OltPort[]') },
        post: { tags: ['OLT Management'], summary: 'Create a port record for an OLT', operationId: 'createOltPort', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('oltPorts_createOltPort'), responses: r201('OltPort') },
      },
      '/olt-management/{id}/chassis': {
        get: { tags: ['OLT Management'], summary: 'Get latest SNMP chassis metrics for an OLT (CPU, memory, temperature)', operationId: 'getOltChassisSummary', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OltChassisSummary') },
      },
      '/olt-management/{id}/onus': {
        get: { tags: ['OLT Management'], summary: 'List ONUs registered on an OLT (with status and profile)', operationId: 'listOltOnus', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'state', in: 'query', schema: { type: 'string' } }, { name: 'port_id', in: 'query', schema: { type: 'integer' } }], responses: r200('OnuSummary[]') },
      },
      '/olt-management/{id}/vendor-caps': {
        get: { tags: ['OLT Management'], summary: 'Get vendor capability record for an OLT device', operationId: 'getOltVendorCaps', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OltVendorCapability') },
      },
      '/olt-management/ports': {
        get: { tags: ['OLT Management'], summary: 'List all OLT ports for the org', operationId: 'listAllOltPorts', security: [{ bearerAuth: [] }], responses: r200('OltPort[]') },
      },
      '/olt-management/ports/{portId}': {
        get: { tags: ['OLT Management'], summary: 'Get an OLT port', operationId: 'getOltPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('OltPort') },
        put: { tags: ['OLT Management'], summary: 'Update an OLT port', operationId: 'updateOltPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('oltPorts_updateOltPort'), responses: r200('OltPort') },
        patch: { tags: ['OLT Management'], summary: 'Partially update an OLT port', operationId: 'patchOltPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('oltPorts_patchOltPort'), responses: r200('OltPort') },
        delete: { tags: ['OLT Management'], summary: 'Soft-delete an OLT port', operationId: 'deleteOltPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/olt-management/splitters': {
        get: { tags: ['OLT Management'], summary: 'List splitter inventory for the org', operationId: 'listOltSplitters', security: [{ bearerAuth: [] }], responses: r200('OltSplitter[]') },
        post: { tags: ['OLT Management'], summary: 'Create a splitter record', operationId: 'createOltSplitter', security: [{ bearerAuth: [] }], requestBody: jsonBody('oltSplitters_createOltSplitter'), responses: r201('OltSplitter') },
      },
      '/olt-management/splitters/{splitterId}': {
        get: { tags: ['OLT Management'], summary: 'Get a splitter', operationId: 'getOltSplitter', security: [{ bearerAuth: [] }], parameters: [{ name: 'splitterId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('OltSplitter') },
        put: { tags: ['OLT Management'], summary: 'Update a splitter', operationId: 'updateOltSplitter', security: [{ bearerAuth: [] }], parameters: [{ name: 'splitterId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('oltSplitters_updateOltSplitter'), responses: r200('OltSplitter') },
        patch: { tags: ['OLT Management'], summary: 'Partially update a splitter', operationId: 'patchOltSplitter', security: [{ bearerAuth: [] }], parameters: [{ name: 'splitterId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('oltSplitters_patchOltSplitter'), responses: r200('OltSplitter') },
        delete: { tags: ['OLT Management'], summary: 'Soft-delete a splitter', operationId: 'deleteOltSplitter', security: [{ bearerAuth: [] }], parameters: [{ name: 'splitterId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- ONU Management §7.2 ----
      '/onu-management/profiles': {
        get: { tags: ['ONU Management'], summary: 'List ONU service profile templates', operationId: 'listOnuProfiles', security: [{ bearerAuth: [] }], responses: r200('OnuProfile[]') },
        post: { tags: ['ONU Management'], summary: 'Create an ONU service profile', operationId: 'createOnuProfile', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuProfiles_createOnuProfile'), responses: r201('OnuProfile') },
      },
      '/onu-management/profiles/{id}': {
        get: { tags: ['ONU Management'], summary: 'Get an ONU service profile', operationId: 'getOnuProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuProfile') },
        put: { tags: ['ONU Management'], summary: 'Update an ONU service profile', operationId: 'updateOnuProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuProfiles_updateOnuProfile'), responses: r200('OnuProfile') },
        patch: { tags: ['ONU Management'], summary: 'Partially update an ONU service profile', operationId: 'patchOnuProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuProfiles_patchOnuProfile'), responses: r200('OnuProfile') },
        delete: { tags: ['ONU Management'], summary: 'Delete an ONU service profile', operationId: 'deleteOnuProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/onu-management/details': {
        get: { tags: ['ONU Management'], summary: 'List ONU provisioning detail records', operationId: 'listOnuDetails', security: [{ bearerAuth: [] }], responses: r200('OnuDetail[]') },
        post: { tags: ['ONU Management'], summary: 'Create an ONU detail record', operationId: 'createOnuDetail', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuDetails_createOnuDetail'), responses: r201('OnuDetail') },
      },
      '/onu-management/details/{id}': {
        get: { tags: ['ONU Management'], summary: 'Get an ONU detail record', operationId: 'getOnuDetail', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuDetail') },
        put: { tags: ['ONU Management'], summary: 'Update an ONU detail record', operationId: 'updateOnuDetail', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuDetails_updateOnuDetail'), responses: r200('OnuDetail') },
        patch: { tags: ['ONU Management'], summary: 'Partially update an ONU detail record', operationId: 'patchOnuDetail', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuDetails_patchOnuDetail'), responses: r200('OnuDetail') },
        delete: { tags: ['ONU Management'], summary: 'Delete an ONU detail record', operationId: 'deleteOnuDetail', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/onu-management/details/{id}/optical-metrics': {
        get: { tags: ['ONU Management'], summary: 'Get optical diagnostic history for an ONU (Tx/Rx power, temperature, voltage, bias current)', operationId: 'getOnuOpticalMetrics', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }], responses: r200('OnuOpticalMetric[]') },
      },
      '/onu-management/details/{id}/provision': {
        post: { tags: ['ONU Management'], summary: 'Trigger ONU provisioning (records intent; dispatched by background processor)', operationId: 'provisionOnu', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ProvisionOnuRequest'), responses: { 202: { description: 'Provision job queued', content: { 'application/json': { schema: { type: 'object' } } } } } },
      },
      '/onu-management/details/{id}/reboot': {
        post: { tags: ['ONU Management'], summary: 'Schedule remote ONU reboot (job dispatched by background processor)', operationId: 'rebootOnu', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: { 202: { description: 'Reboot job queued', content: { 'application/json': { schema: { type: 'object' } } } } } },
      },
      '/onu-management/whitelist': {
        get: { tags: ['ONU Management'], summary: 'List ONU MAC/SN allow-block list entries', operationId: 'listOnuWhitelist', security: [{ bearerAuth: [] }], responses: r200('OnuWhitelistEntry[]') },
        post: { tags: ['ONU Management'], summary: 'Add an entry to the ONU allow-block list', operationId: 'createOnuWhitelistEntry', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuWhitelist_createOnuWhitelistEntry'), responses: r201('OnuWhitelistEntry') },
      },
      '/onu-management/whitelist/{id}': {
        get: { tags: ['ONU Management'], summary: 'Get a whitelist entry', operationId: 'getOnuWhitelistEntry', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuWhitelistEntry') },
        put: { tags: ['ONU Management'], summary: 'Update a whitelist entry', operationId: 'updateOnuWhitelistEntry', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuWhitelist_updateOnuWhitelistEntry'), responses: r200('OnuWhitelistEntry') },
        delete: { tags: ['ONU Management'], summary: 'Remove a whitelist entry', operationId: 'deleteOnuWhitelistEntry', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/onu-management/omci-configs': {
        get: { tags: ['ONU Management'], summary: 'List OMCI/TR-069 config records', operationId: 'listOnuOmciConfigs', security: [{ bearerAuth: [] }], responses: r200('OnuOmciConfig[]') },
        post: { tags: ['ONU Management'], summary: 'Create an OMCI/TR-069 config record (Wi-Fi SSID/password, WAN mode)', operationId: 'createOnuOmciConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuOmciConfigs_createOnuOmciConfig'), responses: r201('OnuOmciConfig') },
      },
      '/onu-management/omci-configs/{id}': {
        get: { tags: ['ONU Management'], summary: 'Get an OMCI/TR-069 config record', operationId: 'getOnuOmciConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuOmciConfig') },
        put: { tags: ['ONU Management'], summary: 'Update an OMCI/TR-069 config record', operationId: 'updateOnuOmciConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuOmciConfigs_updateOnuOmciConfig'), responses: r200('OnuOmciConfig') },
        delete: { tags: ['ONU Management'], summary: 'Delete an OMCI/TR-069 config record', operationId: 'deleteOnuOmciConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/onu-management/firmware-jobs': {
        get: { tags: ['ONU Management'], summary: 'List ONU firmware upgrade and reboot jobs', operationId: 'listOnuFirmwareJobs', security: [{ bearerAuth: [] }], responses: r200('OnuFirmwareJob[]') },
        post: { tags: ['ONU Management'], summary: 'Schedule a firmware upgrade or batch reboot job', operationId: 'createOnuFirmwareJob', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuFirmwareJobs_createOnuFirmwareJob'), responses: r201('OnuFirmwareJob') },
      },
      '/onu-management/firmware-jobs/{id}': {
        get: { tags: ['ONU Management'], summary: 'Get a firmware/reboot job', operationId: 'getOnuFirmwareJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuFirmwareJob') },
        put: { tags: ['ONU Management'], summary: 'Update a firmware/reboot job (reschedule or add notes)', operationId: 'updateOnuFirmwareJob', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('onuFirmwareJobs_updateOnuFirmwareJob'), responses: r200('OnuFirmwareJob') },
        delete: { tags: ['ONU Management'], summary: 'Delete a firmware/reboot job', operationId: 'deleteOnuFirmwareJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/onu-management/firmware-jobs/{id}/cancel': {
        post: { tags: ['ONU Management'], summary: 'Cancel a pending/queued firmware or reboot job', operationId: 'cancelOnuFirmwareJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OnuFirmwareJob') },
      },

      // ---- PON Port Management §7.3 ----
      '/olt-management/ports/{portId}/utilization': {
        get: { tags: ['PON Port Management'], summary: 'PON port utilization dashboard (ONU counts, optical power spread, bandwidth)', operationId: 'getPonPortUtilization', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('PonPortUtilization') },
      },
      '/olt-management/ports/{portId}/onus': {
        get: { tags: ['PON Port Management'], summary: 'List ONUs on a PON port (filter by state: online/offline/los/…)', operationId: 'listOnusForPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'state', in: 'query', schema: { type: 'string' } }], responses: r200('OnuSummary[]') },
      },
      '/olt-management/power-budget': {
        post: { tags: ['PON Port Management'], summary: 'Calculate optical power budget (splitter loss + fiber distance + margin)', operationId: 'calculatePowerBudget', security: [{ bearerAuth: [] }], requestBody: jsonBody('PowerBudgetRequest'), responses: r200('PowerBudgetResult') },
      },
      '/olt-management/ports/{portId}/shutdown': {
        post: { tags: ['PON Port Management'], summary: 'Set or clear maintenance mode on a PON port', operationId: 'setPonPortShutdown', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('PortShutdownRequest'), responses: r200('OltPort') },
      },
      '/olt-management/ports/{portId}/xgspon-mode': {
        post: { tags: ['PON Port Management'], summary: 'Configure XGS-PON sub-mode on a dual-mode PON port', operationId: 'configurePonPortXgsPonMode', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('XgsPonModeRequest'), responses: r200('OltPort') },
      },
      '/olt-management/onu-migrations': {
        get: { tags: ['PON Port Management'], summary: 'List ONU port migration jobs', operationId: 'listOnuMigrationJobs', security: [{ bearerAuth: [] }], responses: r200('OnuMigrationJob[]') },
        post: { tags: ['PON Port Management'], summary: 'Create an ONU port migration job (transactional reassignment)', operationId: 'createOnuMigrationJob', security: [{ bearerAuth: [] }], requestBody: jsonBody('onuMigrationJobs_createOnuMigrationJob'), responses: r201('OnuMigrationJob') },
      },
      '/olt-management/onu-migrations/{jobId}': {
        get: { tags: ['PON Port Management'], summary: 'Get an ONU migration job', operationId: 'getOnuMigrationJob', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('OnuMigrationJob') },
        patch: { tags: ['PON Port Management'], summary: 'Update an ONU migration job (cancel, reschedule)', operationId: 'patchOnuMigrationJob', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('onuMigrationJobs_patchOnuMigrationJob'), responses: r200('OnuMigrationJob') },
        delete: { tags: ['PON Port Management'], summary: 'Soft-delete an ONU migration job', operationId: 'deleteOnuMigrationJob', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/olt-management/onu-migrations/{jobId}/cancel': {
        post: { tags: ['PON Port Management'], summary: 'Cancel a pending ONU migration job', operationId: 'cancelOnuMigrationJob', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('OnuMigrationJob') },
      },

      // ---- Fiber Plant Management §7.4 ----
      '/fiber-plant/fiber-routes': {
        get: { tags: ['Fiber Plant Management'], summary: 'List fiber route segments', operationId: 'listFiberRoutes', security: [{ bearerAuth: [] }], responses: r200('FiberRoute[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Create a fiber route segment', operationId: 'createFiberRoute', security: [{ bearerAuth: [] }], requestBody: jsonBody('fiberRoutes_createFiberRoute'), responses: r201('FiberRoute') },
      },
      '/fiber-plant/fiber-routes/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get a fiber route segment', operationId: 'getFiberRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('FiberRoute') },
        put: { tags: ['Fiber Plant Management'], summary: 'Update a fiber route segment', operationId: 'updateFiberRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('fiberRoutes_updateFiberRoute'), responses: r200('FiberRoute') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Partially update a fiber route segment', operationId: 'patchFiberRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('fiberRoutes_patchFiberRoute'), responses: r200('FiberRoute') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete a fiber route segment', operationId: 'deleteFiberRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/fiber-routes/port/{portId}/path': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get the full fiber path for a PON port (trunk → distribution → drop)', operationId: 'getFiberPathForPort', security: [{ bearerAuth: [] }], parameters: [{ name: 'portId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('FiberRoute[]') },
      },
      '/fiber-plant/fiber-routes/onu/{onuDetailId}/path': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get the fiber path leading to a specific ONU', operationId: 'getFiberPathForOnu', security: [{ bearerAuth: [] }], parameters: [{ name: 'onuDetailId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('FiberRoute[]') },
      },
      '/fiber-plant/odf/frames': {
        get: { tags: ['Fiber Plant Management'], summary: 'List ODF frame inventory', operationId: 'listOdfFrames', security: [{ bearerAuth: [] }], responses: r200('OdfFrame[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Create an ODF frame record', operationId: 'createOdfFrame', security: [{ bearerAuth: [] }], requestBody: jsonBody('odfFrames_createOdfFrame'), responses: r201('OdfFrame') },
      },
      '/fiber-plant/odf/frames/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get an ODF frame with its port list', operationId: 'getOdfFrame', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OdfFrameWithPorts') },
        put: { tags: ['Fiber Plant Management'], summary: 'Update an ODF frame', operationId: 'updateOdfFrame', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('odfFrames_updateOdfFrame'), responses: r200('OdfFrame') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Partially update an ODF frame', operationId: 'patchOdfFrame', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('odfFrames_patchOdfFrame'), responses: r200('OdfFrame') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete an ODF frame', operationId: 'deleteOdfFrame', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/odf/ports': {
        get: { tags: ['Fiber Plant Management'], summary: 'List ODF fiber ports', operationId: 'listOdfPorts', security: [{ bearerAuth: [] }], responses: r200('OdfPort[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Create an ODF port record', operationId: 'createOdfPort', security: [{ bearerAuth: [] }], requestBody: jsonBody('odfFrames_createOdfPort'), responses: r201('OdfPort') },
      },
      '/fiber-plant/odf/ports/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get an ODF port', operationId: 'getOdfPort', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OdfPort') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Update ODF port status/label', operationId: 'patchOdfPort', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('odfFrames_patchOdfPort'), responses: r200('OdfPort') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete an ODF port', operationId: 'deleteOdfPort', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/odf/cross-connects': {
        get: { tags: ['Fiber Plant Management'], summary: 'List ODF patch-cord cross-connects', operationId: 'listOdfCrossConnects', security: [{ bearerAuth: [] }], responses: r200('OdfCrossConnect[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Create a cross-connect record', operationId: 'createOdfCrossConnect', security: [{ bearerAuth: [] }], requestBody: jsonBody('odfFrames_createOdfCrossConnect'), responses: r201('OdfCrossConnect') },
      },
      '/fiber-plant/odf/cross-connects/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get a cross-connect record', operationId: 'getOdfCrossConnect', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OdfCrossConnect') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Update a cross-connect record', operationId: 'patchOdfCrossConnect', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('odfFrames_patchOdfCrossConnect'), responses: r200('OdfCrossConnect') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete a cross-connect record', operationId: 'deleteOdfCrossConnect', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/otdr/tests': {
        get: { tags: ['Fiber Plant Management'], summary: 'List OTDR test results', operationId: 'listOtdrTests', security: [{ bearerAuth: [] }], responses: r200('OtdrTestResult[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Create/import an OTDR test result (live I/O stubbed; job_status tracks acquisition)', operationId: 'createOtdrTest', security: [{ bearerAuth: [] }], requestBody: jsonBody('otdrTests_createOtdrTest'), responses: r201('OtdrTestResult') },
      },
      '/fiber-plant/otdr/tests/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get an OTDR test result', operationId: 'getOtdrTest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OtdrTestResult') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Update an OTDR test record (job status, fault info)', operationId: 'patchOtdrTest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('otdrTests_patchOtdrTest'), responses: r200('OtdrTestResult') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete an OTDR test record', operationId: 'deleteOtdrTest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/sfp': {
        get: { tags: ['Fiber Plant Management'], summary: 'List SFP module lifecycle inventory', operationId: 'listSfpInventory', security: [{ bearerAuth: [] }], responses: r200('SfpInventory[]') },
        post: { tags: ['Fiber Plant Management'], summary: 'Add an SFP module record', operationId: 'createSfpInventory', security: [{ bearerAuth: [] }], requestBody: jsonBody('sfpInventory_createSfpInventory'), responses: r201('SfpInventory') },
      },
      '/fiber-plant/sfp/{id}': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get an SFP inventory record', operationId: 'getSfpInventory', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SfpInventory') },
        put: { tags: ['Fiber Plant Management'], summary: 'Update an SFP inventory record', operationId: 'updateSfpInventory', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('sfpInventory_updateSfpInventory'), responses: r200('SfpInventory') },
        patch: { tags: ['Fiber Plant Management'], summary: 'Partial update SFP lifecycle status/port assignment', operationId: 'patchSfpInventory', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('sfpInventory_patchSfpInventory'), responses: r200('SfpInventory') },
        delete: { tags: ['Fiber Plant Management'], summary: 'Soft-delete an SFP inventory record', operationId: 'deleteSfpInventory', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/fiber-plant/sfp/{id}/diagnostics': {
        get: { tags: ['Fiber Plant Management'], summary: 'Get SFP SNMP DDM diagnostics (Tx/Rx power, temperature) for an installed SFP', operationId: 'getSfpDiagnostics', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SfpDiagnostics') },
      },

      // ---- CPE Management §8.1 ----
      '/cpe-management/devices': {
        get: { tags: ['CPE Management'], summary: 'List CPE devices', operationId: 'listCpeDevices', security: [{ bearerAuth: [] }], parameters: [searchParam(), { name: 'status', in: 'query', required: false, schema: { type: 'string' } }, { name: 'manufacturer', in: 'query', required: false, schema: { type: 'string' } }], responses: r200('CpeDevice[]') },
        post: { tags: ['CPE Management'], summary: 'Register a CPE device', operationId: 'createCpeDevice', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeDevices_createCpeDevice'), responses: r201('CpeDevice') },
      },
      '/cpe-management/devices/{id}': {
        get: { tags: ['CPE Management'], summary: 'Get a CPE device with latest parameters', operationId: 'getCpeDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeDevice') },
        put: { tags: ['CPE Management'], summary: 'Update a CPE device', operationId: 'updateCpeDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeDevices_updateCpeDevice'), responses: r200('CpeDevice') },
        delete: { tags: ['CPE Management'], summary: 'Soft-delete a CPE device', operationId: 'deleteCpeDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/cpe-management/devices/{id}/parameters': {
        get: { tags: ['CPE Management'], summary: 'List stored TR-069 parameters for a device', operationId: 'listCpeParameters', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeParameter[]') },
      },
      '/cpe-management/devices/{id}/tasks': {
        get: { tags: ['CPE Management'], summary: 'List pending/completed tasks for a device', operationId: 'listCpeTasks', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeTask[]') },
        post: { tags: ['CPE Management'], summary: 'Queue a task for a device (e.g. GetParameterValues, Reboot)', operationId: 'createCpeTask', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeTasks_createCpeTask'), responses: r201('CpeTask') },
      },
      '/cpe-management/devices/{id}/reboot': {
        post: { tags: ['CPE Management'], summary: 'Queue a Reboot task for a device', operationId: 'rebootCpeDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r201('CpeTask') },
      },
      '/cpe-management/devices/{id}/factory-reset': {
        post: { tags: ['CPE Management'], summary: 'Queue a FactoryReset task for a device', operationId: 'factoryResetCpeDevice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r201('CpeTask') },
      },
      '/cpe-management/batch-parameter-push': {
        post: { tags: ['CPE Management'], summary: 'Push SetParameterValues tasks to multiple devices', operationId: 'batchParameterPush', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeBatchPush'), responses: r200('BatchPushResult') },
      },
      '/cpe-management/firmware-versions': {
        get: { tags: ['CPE Management'], summary: 'List firmware versions', operationId: 'listCpeFirmwareVersions', security: [{ bearerAuth: [] }], responses: r200('CpeFirmwareVersion[]') },
        post: { tags: ['CPE Management'], summary: 'Create a firmware version record', operationId: 'createCpeFirmwareVersion', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeFirmwareVersions_createCpeFirmwareVersion'), responses: r201('CpeFirmwareVersion') },
      },
      '/cpe-management/firmware-versions/{id}': {
        get: { tags: ['CPE Management'], summary: 'Get a firmware version', operationId: 'getCpeFirmwareVersion', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeFirmwareVersion') },
        put: { tags: ['CPE Management'], summary: 'Update a firmware version', operationId: 'updateCpeFirmwareVersion', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeFirmwareVersions_updateCpeFirmwareVersion'), responses: r200('CpeFirmwareVersion') },
        delete: { tags: ['CPE Management'], summary: 'Delete a firmware version', operationId: 'deleteCpeFirmwareVersion', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/cpe-management/firmware-campaigns': {
        get: { tags: ['CPE Management'], summary: 'List firmware upgrade campaigns', operationId: 'listCpeFirmwareCampaigns', security: [{ bearerAuth: [] }], responses: r200('CpeFirmwareCampaign[]') },
        post: { tags: ['CPE Management'], summary: 'Create a firmware upgrade campaign', operationId: 'createCpeFirmwareCampaign', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeFirmwareCampaigns_createCpeFirmwareCampaign'), responses: r201('CpeFirmwareCampaign') },
      },
      '/cpe-management/firmware-campaigns/{id}': {
        get: { tags: ['CPE Management'], summary: 'Get a firmware campaign', operationId: 'getCpeFirmwareCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeFirmwareCampaign') },
        put: { tags: ['CPE Management'], summary: 'Update a firmware campaign', operationId: 'updateCpeFirmwareCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeFirmwareCampaigns_updateCpeFirmwareCampaign'), responses: r200('CpeFirmwareCampaign') },
        delete: { tags: ['CPE Management'], summary: 'Delete a firmware campaign', operationId: 'deleteCpeFirmwareCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/cpe-management/firmware-campaigns/{id}/launch': {
        post: { tags: ['CPE Management'], summary: 'Launch a firmware campaign (queues Download tasks per matching device)', operationId: 'launchCpeFirmwareCampaign', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CampaignLaunchResult') },
      },

      // ---- §8.3 Diagnostics ----
      '/cpe-management/devices/{id}/diagnostics': {
        get: { tags: ['CPE Management'], summary: 'List diagnostic results for a CPE device', operationId: 'listCpeDiagnostics', security: [{ bearerAuth: [] }], parameters: [idParam(), pageParam(), limitParam()], responses: r200('CpeDiagnostic[]') },
        post: { tags: ['CPE Management'], summary: 'Queue a TR-069 diagnostic (ping, traceroute, wifi_snapshot, ethernet_status, wan_diagnostics)', operationId: 'createCpeDiagnostic', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeDiagnostics_create'), responses: r201('CpeDiagnostic') },
      },
      '/cpe-management/devices/{id}/diagnostics/{diagId}': {
        delete: { tags: ['CPE Management'], summary: 'Delete a CPE diagnostic record', operationId: 'deleteCpeDiagnostic', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'diagId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/cpe-management/devices/{id}/session-logs': {
        get: { tags: ['CPE Management'], summary: 'List CWMP session logs for a CPE device', operationId: 'listCpeDeviceSessionLogs', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'event_type', in: 'query', required: false, schema: { type: 'string' } }, pageParam(), limitParam()], responses: r200('CpeSessionLog[]') },
        delete: { tags: ['CPE Management'], summary: 'Delete all session logs for a CPE device', operationId: 'deleteCpeDeviceSessionLogs', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DeletedCount') },
      },
      '/cpe-management/session-logs': {
        get: { tags: ['CPE Management'], summary: 'List CWMP session logs org-wide', operationId: 'listCpeSessionLogs', security: [{ bearerAuth: [] }], parameters: [{ name: 'event_type', in: 'query', required: false, schema: { type: 'string' } }, pageParam(), limitParam()], responses: r200('CpeSessionLog[]') },
      },

      // ---- §8.4 Inventory ----
      '/cpe-management/devices/{id}/lifecycle': {
        get: { tags: ['CPE Management'], summary: 'Get lifecycle state history for a CPE device', operationId: 'getCpeLifecycleHistory', security: [{ bearerAuth: [] }], parameters: [idParam(), pageParam(), limitParam()], responses: r200('CpeLifecycleHistory[]') },
      },
      '/cpe-management/devices/{id}/lifecycle/transition': {
        post: { tags: ['CPE Management'], summary: 'Transition a CPE device lifecycle state', operationId: 'transitionCpeLifecycleState', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeLifecycle_transition'), responses: r200('CpeDevice') },
      },
      '/cpe-management/devices/{id}/subscriber-link': {
        post: { tags: ['CPE Management'], summary: 'Link or unlink a subscriber to a CPE device', operationId: 'linkCpeSubscriber', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeSubscriberLink'), responses: r200('CpeDevice') },
      },
      '/cpe-management/devices/swap': {
        post: { tags: ['CPE Management'], summary: 'Swap an active CPE with a new in-stock device', operationId: 'swapCpeDevice', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeSwap'), responses: r200('CpeSwapResult') },
      },
      '/cpe-management/devices/{id}/depreciation': {
        get: { tags: ['CPE Management'], summary: 'Get computed depreciation/book value for a CPE device', operationId: 'getCpeDepreciation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeDepreciation') },
      },

      // ---- Inventory Phase 3 (migration 391) — serialized equipment ----
      '/cpe-management/devices/register': {
        post: { tags: ['CPE Management'], summary: 'Manually register a serialized unit (legacy devices / catch-up for stock that predates serial_required)', operationId: 'registerCpeSerial', security: [{ bearerAuth: [] }], requestBody: jsonBody('inventorySerials_registerSerial'), responses: r201('CpeDevice') },
      },
      '/cpe-management/devices/install': {
        post: { tags: ['CPE Management'], summary: 'Install a serialized unit on a contract — picks an in-stock serial or registers a new one, decrements stock (rent: ledger only; sold: real invoice line)', operationId: 'installCpeEquipment', security: [{ bearerAuth: [] }], requestBody: jsonBody('inventorySerials_installEquipment'), responses: r201('CpeInstallResult') },
      },
      '/cpe-management/devices/{id}/uninstall': {
        post: { tags: ['CPE Management'], summary: 'Undo a mistaken install on a still-live contract — unassigns the unit, restores stock/ledger for a tracked unit, and voids the (unpaid) sale invoice for a sold unit', operationId: 'uninstallCpeEquipment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('inventorySerials_uninstallEquipment'), responses: r200('CpeUninstallResult') },
      },

      // ---- CPE Profiles §8.2 ----
      '/cpe-profiles': {
        get: { tags: ['CPE Profiles'], summary: 'List CPE provisioning profiles', operationId: 'listCpeProfiles', security: [{ bearerAuth: [] }], responses: r200('CpeProfile[]') },
        post: { tags: ['CPE Profiles'], summary: 'Create a CPE profile', operationId: 'createCpeProfile', security: [{ bearerAuth: [] }], requestBody: jsonBody('cpeProfiles_createCpeProfile'), responses: r201('CpeProfile') },
      },
      '/cpe-profiles/{id}': {
        get: { tags: ['CPE Profiles'], summary: 'Get a CPE profile', operationId: 'getCpeProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeProfile') },
        put: { tags: ['CPE Profiles'], summary: 'Update a CPE profile', operationId: 'updateCpeProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeProfiles_updateCpeProfile'), responses: r200('CpeProfile') },
        delete: { tags: ['CPE Profiles'], summary: 'Soft-delete a CPE profile', operationId: 'deleteCpeProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/cpe-profiles/{id}/resolve': {
        post: { tags: ['CPE Profiles'], summary: 'Resolve the merged parameter set for a profile (inheritance chain + context mappings)', operationId: 'resolveCpeProfile', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeProfiles_resolveCpeProfile'), responses: r200('ResolvedProfile') },
      },
      '/cpe-profiles/{id}/mappings': {
        get: { tags: ['CPE Profiles'], summary: 'List parameter mappings for a profile', operationId: 'listCpeProfileMappings', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeParameterMapping[]') },
        post: { tags: ['CPE Profiles'], summary: 'Add a parameter mapping to a profile', operationId: 'createCpeProfileMapping', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('cpeParameterMappings_createCpeParameterMapping'), responses: r201('CpeParameterMapping') },
      },
      '/cpe-profiles/{id}/mappings/{mappingId}': {
        put: { tags: ['CPE Profiles'], summary: 'Update a parameter mapping', operationId: 'updateCpeProfileMapping', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'mappingId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('cpeParameterMappings_updateCpeParameterMapping'), responses: r200('CpeParameterMapping') },
        delete: { tags: ['CPE Profiles'], summary: 'Delete a parameter mapping', operationId: 'deleteCpeProfileMapping', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'mappingId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },

      // ---- Wireless AP Sectors §9.1 ----
      '/wireless/ap-sectors': {
        get: { tags: ['Wireless AP Sectors'], summary: 'List AP sector configurations', operationId: 'listApSectorConfigs', security: [{ bearerAuth: [] }], responses: r200('ApSectorConfig[]') },
        post: { tags: ['Wireless AP Sectors'], summary: 'Create AP sector configuration', operationId: 'createApSectorConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('wirelessSectors_createApSectorConfig'), responses: r201('ApSectorConfig') },
      },
      '/wireless/ap-sectors/{id}': {
        get: { tags: ['Wireless AP Sectors'], summary: 'Get AP sector configuration', operationId: 'getApSectorConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApSectorConfig') },
        put: { tags: ['Wireless AP Sectors'], summary: 'Update AP sector configuration', operationId: 'updateApSectorConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('wirelessSectors_updateApSectorConfig'), responses: r200('ApSectorConfig') },
        delete: { tags: ['Wireless AP Sectors'], summary: 'Soft-delete AP sector configuration', operationId: 'deleteApSectorConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/wireless/ap-sectors/{id}/restore': {
        post: { tags: ['Wireless AP Sectors'], summary: 'Restore soft-deleted AP sector config', operationId: 'restoreApSectorConfig', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApSectorConfig') },
      },

      // ---- Wireless Channel Plans §9.1 ----
      '/wireless/channel-plans': {
        get: { tags: ['Wireless Channel Plans'], summary: 'List AP channel plans', operationId: 'listApChannelPlans', security: [{ bearerAuth: [] }], responses: r200('ApChannelPlan[]') },
        post: { tags: ['Wireless Channel Plans'], summary: 'Create AP channel plan', operationId: 'createApChannelPlan', security: [{ bearerAuth: [] }], requestBody: jsonBody('wirelessSectors_createApChannelPlan'), responses: r201('ApChannelPlan') },
      },
      '/wireless/channel-plans/{id}': {
        get: { tags: ['Wireless Channel Plans'], summary: 'Get AP channel plan', operationId: 'getApChannelPlan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApChannelPlan') },
        put: { tags: ['Wireless Channel Plans'], summary: 'Update AP channel plan', operationId: 'updateApChannelPlan', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('wirelessSectors_updateApChannelPlan'), responses: r200('ApChannelPlan') },
        delete: { tags: ['Wireless Channel Plans'], summary: 'Soft-delete AP channel plan', operationId: 'deleteApChannelPlan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/wireless/channel-plans/{id}/restore': {
        post: { tags: ['Wireless Channel Plans'], summary: 'Restore soft-deleted AP channel plan', operationId: 'restoreApChannelPlan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApChannelPlan') },
      },
      '/wireless/channel-plans/conflicts/{siteId}': {
        get: { tags: ['Wireless Channel Plans'], summary: 'Detect frequency conflicts within a site', operationId: 'detectChannelConflicts', security: [{ bearerAuth: [] }], parameters: [{ name: 'siteId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('ChannelConflict[]') },
      },

      // ---- Wireless Client Sessions §9.1 ----
      '/wireless/clients': {
        get: { tags: ['Wireless Clients'], summary: 'List wireless client session snapshots', operationId: 'listWirelessClientSessions', security: [{ bearerAuth: [] }], responses: r200('WirelessClientSession[]') },
      },
      '/wireless/clients/batch': {
        post: { tags: ['Wireless Clients'], summary: 'Ingest batch of client session snapshots from AP poll', operationId: 'batchIngestWirelessSessions', security: [{ bearerAuth: [] }], requestBody: jsonBody('sessions[]'), responses: r201('{ recorded: number }') },
      },

      // ---- Wireless Channel Interference §9.1 ----
      '/wireless/channel-interference': {
        get: { tags: ['Wireless Channel Interference'], summary: 'List channel interference records', operationId: 'listChannelInterference', security: [{ bearerAuth: [] }], responses: r200('ChannelInterference[]') },
        post: { tags: ['Wireless Channel Interference'], summary: 'Record channel interference detection', operationId: 'createChannelInterference', security: [{ bearerAuth: [] }], requestBody: jsonBody('wirelessSectors_createChannelInterference'), responses: r201('ChannelInterference') },
      },
      '/wireless/channel-interference/{id}': {
        put: { tags: ['Wireless Channel Interference'], summary: 'Update channel interference record', operationId: 'updateChannelInterference', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('wirelessSectors_updateChannelInterference'), responses: r200('ChannelInterference') },
        delete: { tags: ['Wireless Channel Interference'], summary: 'Soft-delete channel interference record', operationId: 'deleteChannelInterference', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- AP Command Jobs §9.1 ----
      '/wireless/ap-commands': {
        get: { tags: ['AP Command Jobs'], summary: 'List AP remote command jobs', operationId: 'listApCommandJobs', security: [{ bearerAuth: [] }], responses: r200('ApCommandJob[]') },
        post: { tags: ['AP Command Jobs'], summary: 'Create AP remote command job', operationId: 'createApCommandJob', security: [{ bearerAuth: [] }], requestBody: jsonBody('wirelessSectors_createApCommandJob'), responses: r201('ApCommandJob') },
      },
      '/wireless/ap-commands/{id}': {
        get: { tags: ['AP Command Jobs'], summary: 'Get AP command job', operationId: 'getApCommandJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApCommandJob') },
        put: { tags: ['AP Command Jobs'], summary: 'Update AP command job', operationId: 'updateApCommandJob', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('wirelessSectors_updateApCommandJob'), responses: r200('ApCommandJob') },
      },
      '/wireless/ap-commands/{id}/cancel': {
        post: { tags: ['AP Command Jobs'], summary: 'Cancel a pending/queued AP command job', operationId: 'cancelApCommandJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ApCommandJob') },
      },

      // ---- PTP Links §9.2 ----
      '/wireless/network-links/{id}/ptp-metrics': {
        get: { tags: ['PTP Links'], summary: 'Get PTP link signal/modulation/throughput metrics and session history', operationId: 'getPtpLinkMetrics', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'hours', in: 'query', required: false, schema: { type: 'integer', default: 24 }, description: 'Lookback window in hours for session history' }], responses: r200('PtpLinkMetrics') },
      },

      // ---- Link Planning §9.2 ----
      '/wireless/link-planning/calculate': {
        post: { tags: ['Link Planning'], summary: 'Calculate link budget (pure — no DB save)', operationId: 'calculateLinkBudget', security: [{ bearerAuth: [] }], requestBody: jsonBody('lat_a, lon_a, lat_b, lon_b, frequency_mhz, tx_power_dbm, antenna gains, cable_loss_db'), responses: r200('LinkBudgetResult') },
      },
      '/wireless/link-planning': {
        get: { tags: ['Link Planning'], summary: 'List saved link planning calculator runs', operationId: 'listLinkPlanningCalcs', security: [{ bearerAuth: [] }], responses: r200('LinkPlanningCalc[]') },
        post: { tags: ['Link Planning'], summary: 'Save a link planning calculator run', operationId: 'saveLinkPlanningCalc', security: [{ bearerAuth: [] }], requestBody: jsonBody('LinkPlanningCalc input'), responses: r201('LinkPlanningCalc') },
      },
      '/wireless/link-planning/{id}': {
        get: { tags: ['Link Planning'], summary: 'Get a saved link planning calc', operationId: 'getLinkPlanningCalc', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('LinkPlanningCalc') },
        put: { tags: ['Link Planning'], summary: 'Update a saved link planning calc', operationId: 'updateLinkPlanningCalc', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('LinkPlanningCalc update'), responses: r200('LinkPlanningCalc') },
        delete: { tags: ['Link Planning'], summary: 'Delete a saved link planning calc', operationId: 'deleteLinkPlanningCalc', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- RF Metrics §9.3 ----
      '/wireless/clients/signal-distribution': {
        get: { tags: ['RF Metrics'], summary: 'Signal strength histogram bucketed in 10 dBm ranges', operationId: 'getSignalDistribution', security: [{ bearerAuth: [] }], parameters: [{ name: 'device_id', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'hours', in: 'query', required: false, schema: { type: 'integer', default: 24 } }], responses: r200('SignalDistribution') },
      },

      // ---- Spectrum Scans §9.3 ----
      '/wireless/spectrum-scans': {
        get: { tags: ['Spectrum Scans'], summary: 'List spectrum scan results', operationId: 'listSpectrumScans', security: [{ bearerAuth: [] }], parameters: [{ name: 'device_id', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] } }, { name: 'page', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }], responses: r200('SpectrumScan[]') },
        post: { tags: ['Spectrum Scans'], summary: 'Create a spectrum scan record (live scanning requires hardware integration)', operationId: 'createSpectrumScan', security: [{ bearerAuth: [] }], requestBody: jsonBody('SpectrumScan input'), responses: r201('SpectrumScan') },
      },
      '/wireless/spectrum-scans/{id}': {
        get: { tags: ['Spectrum Scans'], summary: 'Get a spectrum scan result', operationId: 'getSpectrumScan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SpectrumScan') },
      },

      // ---- Quality Classes §10.1 ----
      ...crudPaths('quality-classes', 'Quality Classes', 'QualityClass'),
      '/quality-classes/{id}/restore': {
        post: { tags: ['Quality Classes'], summary: 'Restore a soft-deleted quality class', operationId: 'restoreQualityClass', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('QualityClass') },
      },

      // ---- Queue Tree Nodes §10.1 ----
      ...crudPaths('queue-tree-nodes', 'Queue Tree Nodes', 'QueueTreeNode'),
      '/queue-tree-nodes/{id}/restore': {
        post: { tags: ['Queue Tree Nodes'], summary: 'Restore a soft-deleted queue tree node', operationId: 'restoreQueueTreeNode', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('QueueTreeNode') },
      },
      '/queue-tree-nodes/export/config': {
        get: { tags: ['Queue Tree Nodes'], summary: 'Export MikroTik Queue Tree / Simple Queue configuration script', operationId: 'exportQueueTreeConfig', security: [{ bearerAuth: [] }], parameters: [{ name: 'vendor', in: 'query', required: false, schema: { type: 'string', enum: ['mikrotik'], default: 'mikrotik' } }, { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'text'], default: 'json' } }], responses: r200('RouterOS script or JSON with script + node_count') },
      },

      // ---- Rate Limit Templates §10.2 ----
      ...crudPaths('rate-limit-templates', 'Rate Limit Templates', 'RateLimitTemplate'),
      '/rate-limit-templates/{id}/restore': {
        post: { tags: ['Rate Limit Templates'], summary: 'Restore a soft-deleted rate-limit template', operationId: 'restoreRateLimitTemplate', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RateLimitTemplate') },
      },
      '/rate-limit-templates/preview': {
        post: { tags: ['Rate Limit Templates'], summary: 'Preview the rendered vendor rate string for given parameters', operationId: 'previewRateLimitString', security: [{ bearerAuth: [] }], requestBody: jsonBody('RateLimitTemplate params'), responses: r200('{ rate_string: string }') },
      },

      // ---- Protocol Shaping Rules §10.2 ----
      ...crudPaths('protocol-shaping-rules', 'Protocol Shaping Rules', 'ProtocolShapingRule'),
      '/protocol-shaping-rules/{id}/restore': {
        post: { tags: ['Protocol Shaping Rules'], summary: 'Restore a soft-deleted protocol shaping rule', operationId: 'restoreProtocolShapingRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ProtocolShapingRule') },
      },
      '/protocol-shaping-rules/export/config': {
        get: { tags: ['Protocol Shaping Rules'], summary: 'Export MikroTik mangle rules script for active shaping rules', operationId: 'exportShapingRulesConfig', security: [{ bearerAuth: [] }], parameters: [{ name: 'plan_id', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'text'], default: 'json' } }], responses: r200('RouterOS mangle script or JSON with script + rule_count') },
      },

      // ---- Data Packs §10.3 ----
      '/data-packs': {
        get: { tags: ['Data Packs'], summary: 'List available data packs', operationId: 'listDataPacks', security: [{ bearerAuth: [] }], responses: r200('DataPack[]') },
        post: { tags: ['Data Packs'], summary: 'Create a data pack', operationId: 'createDataPack', security: [{ bearerAuth: [] }], requestBody: jsonBody('DataPack'), responses: r201('DataPack') },
      },
      '/data-packs/{id}': {
        put: { tags: ['Data Packs'], summary: 'Update a data pack', operationId: 'updateDataPack', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('DataPack'), responses: r200('DataPack') },
        delete: { tags: ['Data Packs'], summary: 'Soft-delete a data pack', operationId: 'deleteDataPack', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/data-packs/{id}/restore': {
        post: { tags: ['Data Packs'], summary: 'Restore a soft-deleted data pack', operationId: 'restoreDataPack', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DataPack') },
      },
      '/data-packs/{id}/purchases': {
        get: { tags: ['Data Packs'], summary: 'List purchases for a specific data pack', operationId: 'listDataPackPurchases', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DataPackPurchase[]') },
      },
      '/contracts/{contractId}/data-packs': {
        get: { tags: ['Data Packs'], summary: 'Effective data allowance and purchases for a contract', operationId: 'getContractDataPacks', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('{ allowance, purchases }') },
      },
      '/contracts/{contractId}/data-packs/{packId}/purchase': {
        post: { tags: ['Data Packs'], summary: 'Purchase a data pack for a subscriber (admin)', operationId: 'purchaseDataPackAdmin', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'packId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r201('DataPackPurchase') },
      },
      '/data-pack-purchases/{id}/cancel': {
        put: { tags: ['Data Packs'], summary: 'Cancel a data pack purchase', operationId: 'cancelDataPackPurchase', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DataPackPurchase') },
      },

      // ---- Data Rollover §10.3 ----
      '/contracts/{contractId}/rollover': {
        get: { tags: ['Data Rollover'], summary: 'Get rollover balance for a contract', operationId: 'getContractRollover', security: [{ bearerAuth: [] }], parameters: [{ name: 'contractId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('RolloverBalance') },
      },
      '/rollover/accrue': {
        post: { tags: ['Data Rollover'], summary: 'Trigger manual rollover accrual for the org', operationId: 'accrueRollover', security: [{ bearerAuth: [] }], responses: r200('{ processed, rolled_over_contracts }') },
      },
      '/fup/notifications': {
        get: { tags: ['Data Rollover'], summary: 'List recent FUP usage notifications', operationId: 'listFupNotifications', security: [{ bearerAuth: [] }], parameters: [{ name: 'contract_id', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'month', in: 'query', required: false, schema: { type: 'string' } }], responses: r200('FupUsageNotification[]') },
      },
      '/fup/check-thresholds': {
        post: { tags: ['Data Rollover'], summary: 'Manually trigger FUP threshold check and notifications', operationId: 'checkFupThresholds', security: [{ bearerAuth: [] }], responses: r200('{ checked, notified }') },
      },

      // ---- Interface QoS Policies §10.4 ----
      ...crudPaths('interface-qos-policies', 'Interface QoS Policies', 'InterfaceQosPolicy'),
      '/interface-qos-policies/{id}/restore': {
        post: { tags: ['Interface QoS Policies'], summary: 'Restore a soft-deleted interface QoS policy', operationId: 'restoreInterfaceQosPolicy', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('InterfaceQosPolicy') },
      },

      // ---- MPLS VLAN Prioritization §10.4 ----
      ...crudPaths('mpls-vlan-prioritization', 'MPLS VLAN Prioritization', 'MplsVlanPrioritizationRule'),
      '/mpls-vlan-prioritization/{id}/restore': {
        post: { tags: ['MPLS VLAN Prioritization'], summary: 'Restore a soft-deleted MPLS/VLAN prioritization rule', operationId: 'restoreMplsVlanRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('MplsVlanPrioritizationRule') },
      },

      // ---- DSCP Marking Policies §10.4 ----
      ...crudPaths('dscp-marking-policies', 'DSCP Marking Policies', 'DscpMarkingPolicy'),
      '/dscp-marking-policies/{id}/restore': {
        post: { tags: ['DSCP Marking Policies'], summary: 'Restore a soft-deleted DSCP marking policy', operationId: 'restoreDscpMarkingPolicy', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DscpMarkingPolicy') },
      },
      '/dscp-marking-policies/export/config': {
        get: { tags: ['DSCP Marking Policies'], summary: 'Export MikroTik mangle rules for active DSCP policies', operationId: 'exportDscpConfig', security: [{ bearerAuth: [] }], parameters: [{ name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'text'], default: 'json' } }], responses: r200('MikroTik mangle script or JSON array') },
      },

      // ---- Bandwidth Test Servers §10.4 ----
      ...crudPaths('bandwidth-test-servers', 'Bandwidth Test Servers', 'BandwidthTestServer'),
      '/bandwidth-test-servers/{id}/restore': {
        post: { tags: ['Bandwidth Test Servers'], summary: 'Restore a soft-deleted bandwidth test server', operationId: 'restoreBandwidthTestServer', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BandwidthTestServer') },
      },

      // ---- Subscriber Speed Test Jobs §10.4 ----
      '/subscriber-speed-test-jobs': {
        get: { tags: ['Subscriber Speed Test Jobs'], summary: 'List subscriber speed test jobs', operationId: 'listSubscriberSpeedTestJobs', security: [{ bearerAuth: [] }], parameters: [{ name: 'contract_id', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'status', in: 'query', required: false, schema: { type: 'string' } }, pageParam(), limitParam()], responses: r200('SubscriberSpeedTestJob[]') },
        post: { tags: ['Subscriber Speed Test Jobs'], summary: 'Schedule a subscriber speed test job', operationId: 'createSubscriberSpeedTestJob', security: [{ bearerAuth: [] }], requestBody: jsonBody('SubscriberSpeedTestJob'), responses: r201('SubscriberSpeedTestJob') },
      },
      '/subscriber-speed-test-jobs/{id}': {
        get: { tags: ['Subscriber Speed Test Jobs'], summary: 'Get a subscriber speed test job', operationId: 'getSubscriberSpeedTestJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SubscriberSpeedTestJob') },
      },
      '/subscriber-speed-test-jobs/{id}/cancel': {
        post: { tags: ['Subscriber Speed Test Jobs'], summary: 'Cancel a queued or running speed test job', operationId: 'cancelSubscriberSpeedTestJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SubscriberSpeedTestJob') },
      },

      // ---- Portal Data Packs §10.3 ----
      '/portal/data-packs': {
        get: { tags: ['Data Packs'], summary: 'List available data packs (portal)', operationId: 'portalListDataPacks', security: [{ bearerAuth: [] }], responses: r200('DataPack[]') },
      },
      '/portal/data-packs/{packId}/purchase': {
        post: { tags: ['Data Packs'], summary: 'Purchase a data pack via subscriber portal', operationId: 'portalPurchaseDataPack', security: [{ bearerAuth: [] }], parameters: [{ name: 'packId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r201('DataPackPurchase') },
      },
      '/portal/data-packs/my-purchases': {
        get: { tags: ['Data Packs'], summary: 'List subscriber data pack purchases (portal)', operationId: 'portalListMyDataPackPurchases', security: [{ bearerAuth: [] }], responses: r200('DataPackPurchase[]') },
      },
      '/portal/usage/allowance': {
        get: { tags: ['Data Rollover'], summary: 'Effective total data allowance for the authenticated subscriber', operationId: 'portalGetUsageAllowance', security: [{ bearerAuth: [] }], responses: r200('EffectiveAllowance') },
      },

      // ---- Portal Auth §11 ----
      '/portal/auth/login': {
        post: { tags: ['Portal Auth'], summary: 'Client portal login', operationId: 'portalLogin', requestBody: jsonBody('email + password'), responses: r200('AccessToken + RefreshToken') },
      },
      '/portal/auth/refresh': {
        post: { tags: ['Portal Auth'], summary: 'Refresh portal access token', operationId: 'portalRefreshToken', requestBody: jsonBody('refreshToken'), responses: r200('Token pair') },
      },
      '/portal/auth/logout': {
        post: { tags: ['Portal Auth'], summary: 'Portal logout', operationId: 'portalLogout', responses: r200('Message') },
      },
      '/portal/auth/me': {
        get: { tags: ['Portal Auth'], summary: 'Get authenticated portal client profile', operationId: 'portalMe', security: [{ bearerAuth: [] }], responses: r200('Client') },
      },
      '/portal/auth/password': {
        put: { tags: ['Portal Auth'], summary: 'Change portal password', operationId: 'portalChangePassword', security: [{ bearerAuth: [] }], requestBody: jsonBody('currentPassword + newPassword'), responses: r200('Message') },
      },
      '/portal/auth/password-reset/request': {
        post: { tags: ['Portal Auth'], summary: 'Request a portal password reset email', operationId: 'portalRequestPasswordReset', requestBody: jsonBody('email'), responses: r200('Message') },
      },
      '/portal/auth/password-reset': {
        post: { tags: ['Portal Auth'], summary: 'Reset portal password with token', operationId: 'portalResetPassword', requestBody: jsonBody('token + password'), responses: r200('Message') },
      },

      // ---- Portal Dashboard §11.1 ----
      '/portal/dashboard': {
        get: { tags: ['Portal Dashboard'], summary: 'Account overview (plan, balance, session status, usage)', operationId: 'portalDashboard', security: [{ bearerAuth: [] }], responses: r200('DashboardOverview') },
      },
      '/portal/usage/current-month': {
        get: { tags: ['Portal Dashboard'], summary: 'Daily usage data for the current billing month', operationId: 'portalCurrentMonthUsage', security: [{ bearerAuth: [] }], responses: r200('DailyUsage[]') },
      },

      // ---- Portal Billing §11.2 ----
      '/portal/invoices': {
        get: { tags: ['Portal Billing'], summary: 'List own invoices (paginated)', operationId: 'portalListInvoices', security: [{ bearerAuth: [] }], responses: r200('Invoice[]') },
      },
      '/portal/invoices/{id}': {
        get: { tags: ['Portal Billing'], summary: 'Get invoice detail with line items and payments', operationId: 'portalGetInvoice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Invoice') },
      },
      '/portal/invoices/{id}/pdf': {
        get: { tags: ['Portal Billing'], summary: 'Download invoice as PDF', operationId: 'portalDownloadInvoicePdf', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/pdf') },
      },
      '/portal/invoices/{id}/cfdi': {
        get: { tags: ['Portal Billing'], summary: 'Download stamped CFDI XML for an invoice', operationId: 'portalDownloadInvoiceCfdi', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200File('application/xml') },
      },
      '/portal/invoices/{id}/pay': {
        post: { tags: ['Portal Billing'], summary: 'Create a checkout session for online payment', operationId: 'portalPayInvoice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('return_url'), responses: r201('CheckoutSession') },
      },
      '/portal/payments': {
        get: { tags: ['Portal Billing'], summary: 'Payment history (paginated)', operationId: 'portalListPayments', security: [{ bearerAuth: [] }], responses: r200('Payment[]') },
      },

      // ---- Portal Service Requests §11.3 ----
      '/portal/service-requests': {
        get: { tags: ['Portal Service Requests'], summary: 'List own service requests', operationId: 'portalListServiceRequests', security: [{ bearerAuth: [] }], responses: r200('PortalServiceRequest[]') },
        post: { tags: ['Portal Service Requests'], summary: 'Submit a new self-service request', operationId: 'portalCreateServiceRequest', security: [{ bearerAuth: [] }], requestBody: jsonBody('request_type + payload'), responses: r201('PortalServiceRequest') },
      },
      '/portal/service-requests/{id}/cancel': {
        post: { tags: ['Portal Service Requests'], summary: 'Cancel a pending service request', operationId: 'portalCancelServiceRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PortalServiceRequest') },
      },

      // ---- Portal Support §11.4 ----
      '/portal/tickets': {
        get: { tags: ['Portal Support'], summary: 'List own support tickets', operationId: 'portalListTickets', security: [{ bearerAuth: [] }], responses: r200('Ticket[]') },
        post: { tags: ['Portal Support'], summary: 'Open a new support ticket', operationId: 'portalCreateTicket', security: [{ bearerAuth: [] }], requestBody: jsonBody('subject + description + priority + category'), responses: r201('Ticket') },
      },
      '/portal/tickets/{id}': {
        get: { tags: ['Portal Support'], summary: 'Get ticket detail with comments', operationId: 'portalGetTicket', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Ticket') },
      },
      '/portal/tickets/{id}/comments': {
        post: { tags: ['Portal Support'], summary: 'Add a comment to a ticket', operationId: 'portalAddTicketComment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('body'), responses: r201('TicketComment') },
      },
      '/portal/kb': {
        get: { tags: ['Portal Support'], summary: 'List published knowledge-base articles', operationId: 'portalListKbArticles', security: [{ bearerAuth: [] }], responses: r200('KbArticle[]') },
      },
      '/portal/kb/{slugOrId}': {
        get: { tags: ['Portal Support'], summary: 'Get knowledge-base article detail', operationId: 'portalGetKbArticle', security: [{ bearerAuth: [] }], parameters: [{ name: 'slugOrId', in: 'path', required: true, schema: { type: 'string' } }], responses: r200('KbArticle') },
      },
      '/portal/kb/{slugOrId}/rate': {
        post: { tags: ['Portal Support'], summary: 'Rate a KB article helpful or not', operationId: 'portalRateKbArticle', security: [{ bearerAuth: [] }], parameters: [{ name: 'slugOrId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody('helpful: boolean'), responses: r200('Rating result') },
      },
      '/portal/speed-test': {
        post: { tags: ['Portal Support'], summary: 'Queue a speed test job for this subscriber', operationId: 'portalQueueSpeedTest', security: [{ bearerAuth: [] }], responses: r201('SpeedTestJob') },
      },
      '/portal/speed-test/results': {
        get: { tags: ['Portal Support'], summary: 'List speed test results for this subscriber', operationId: 'portalListSpeedTestResults', security: [{ bearerAuth: [] }], responses: r200('SpeedTestJob[]') },
      },
      '/portal/chat/start': {
        post: { tags: ['Portal Support'], summary: 'Start a new AI chat session', operationId: 'portalStartChat', security: [{ bearerAuth: [] }], responses: r201('ChatSession') },
      },
      '/portal/chat/{token}/message': {
        post: { tags: ['Portal Support'], summary: 'Send a message in an AI chat session', operationId: 'portalChatMessage', security: [{ bearerAuth: [] }], parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody('message'), responses: r200('ChatReply') },
      },
      '/portal/callback-request': {
        post: { tags: ['Portal Support'], summary: 'Submit a callback request (creates a support ticket)', operationId: 'portalCallbackRequest', security: [{ bearerAuth: [] }], requestBody: jsonBody('preferred_time + phone + notes'), responses: r201('Ticket') },
      },

      // ---- Portal Push §11.5 ----
      '/portal/push/subscribe': {
        post: { tags: ['Portal Push'], summary: 'Register or update a Web Push subscription', operationId: 'portalPushSubscribe', security: [{ bearerAuth: [] }], requestBody: jsonBody('endpoint + p256dh + auth'), responses: r201('PushSubscription') },
        delete: { tags: ['Portal Push'], summary: 'Remove a Web Push subscription', operationId: 'portalPushUnsubscribe', security: [{ bearerAuth: [] }], requestBody: jsonBody('endpoint'), responses: r200('Message') },
      },

      // ---- Portal KB Admin (staff-side) §11.4 ----
      '/portal-kb': {
        get: { tags: ['Portal Support'], summary: 'List portal knowledge-base articles (admin)', operationId: 'adminListKbArticles', security: [{ bearerAuth: [] }], responses: r200('KbArticle[]') },
        post: { tags: ['Portal Support'], summary: 'Create a knowledge-base article', operationId: 'adminCreateKbArticle', security: [{ bearerAuth: [] }], requestBody: jsonBody('category + title + slug + body + is_published'), responses: r201('KbArticle') },
      },
      '/portal-kb/{id}': {
        get: { tags: ['Portal Support'], summary: 'Get knowledge-base article (admin)', operationId: 'adminGetKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('KbArticle') },
        put: { tags: ['Portal Support'], summary: 'Update knowledge-base article', operationId: 'adminUpdateKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('KbArticle fields'), responses: r200('KbArticle') },
        delete: { tags: ['Portal Support'], summary: 'Delete knowledge-base article', operationId: 'adminDeleteKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Message') },
      },

      // ---- Portal Service Requests Admin (staff-side) §11.3 ----
      '/portal-service-requests': {
        get: { tags: ['Portal Support'], summary: 'List portal service requests (admin)', operationId: 'adminListServiceRequests', security: [{ bearerAuth: [] }], parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'request_type', in: 'query', schema: { type: 'string' } }, { name: 'client_id', in: 'query', schema: { type: 'integer' } }], responses: r200('ServiceRequest[]') },
      },
      '/portal-service-requests/push-subscriptions': {
        get: { tags: ['Portal Push'], summary: 'List active Web Push subscriptions (admin)', operationId: 'adminListPushSubscriptions', security: [{ bearerAuth: [] }], parameters: [{ name: 'client_id', in: 'query', schema: { type: 'integer' } }], responses: r200('PushSubscription[]') },
      },
      '/portal-service-requests/{id}': {
        get: { tags: ['Portal Support'], summary: 'Get portal service request detail (admin)', operationId: 'adminGetServiceRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ServiceRequest') },
      },
      '/portal-service-requests/{id}/approve': {
        post: { tags: ['Portal Support'], summary: 'Approve a service request and execute its action', operationId: 'adminApproveServiceRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('notes (optional)'), responses: r200('ServiceRequest') },
      },
      '/portal-service-requests/{id}/reject': {
        post: { tags: ['Portal Support'], summary: 'Reject a service request', operationId: 'adminRejectServiceRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('notes'), responses: r200('ServiceRequest') },
      },
      '/portal-service-requests/{id}/complete': {
        post: { tags: ['Portal Support'], summary: 'Mark an approved service request as completed', operationId: 'adminCompleteServiceRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('notes (optional)'), responses: r200('ServiceRequest') },
      },

      // ---- Tickets §12 extensions ----
      '/tickets/stats': {
        get: { tags: ['Tickets'], summary: 'Ticket counts grouped by status', operationId: 'getTicketStats', security: [{ bearerAuth: [] }], responses: r200('StatusCount[]') },
      },
      '/tickets/from-alert': {
        post: { tags: ['Tickets'], summary: 'Create a ticket from an alert event', operationId: 'createTicketFromAlert', security: [{ bearerAuth: [] }], requestBody: jsonBody('alert_event_id + client_id + subject + description + priority'), responses: r201('Ticket') },
      },
      '/tickets/{id}/relations': {
        get: { tags: ['Tickets'], summary: 'List ticket relations', operationId: 'listTicketRelations', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TicketRelation[]') },
        post: { tags: ['Tickets'], summary: 'Create a ticket relation', operationId: 'createTicketRelation', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('related_ticket_id + relation_type'), responses: r201('TicketRelation') },
      },
      '/tickets/{id}/relations/{relId}': {
        delete: { tags: ['Tickets'], summary: 'Delete a ticket relation', operationId: 'deleteTicketRelation', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'relId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/tickets/{id}/time-logs': {
        get: { tags: ['Tickets'], summary: 'List time logs for a ticket', operationId: 'listTicketTimeLogs', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TimeLog[]') },
        post: { tags: ['Tickets'], summary: 'Create a time log entry', operationId: 'createTicketTimeLog', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('minutes + work_date + description'), responses: r201('TimeLog') },
      },
      '/tickets/{id}/time-logs/{logId}': {
        put: { tags: ['Tickets'], summary: 'Update a time log entry', operationId: 'updateTicketTimeLog', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'logId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('minutes + work_date + description'), responses: r200('TimeLog') },
        delete: { tags: ['Tickets'], summary: 'Delete a time log entry', operationId: 'deleteTicketTimeLog', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'logId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/tickets/{id}/ai-triage': {
        get: { tags: ['Tickets'], summary: 'Get AI triage result for a ticket', operationId: 'getTicketAiTriage', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AiTriage') },
      },
      '/tickets/{id}/ai-summary': {
        post: { tags: ['Tickets'], summary: 'Generate AI summary for a ticket', operationId: 'generateTicketAiSummary', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AiSummary') },
      },
      '/tickets/{id}/merge': {
        post: { tags: ['Tickets'], summary: 'Merge a source ticket into this ticket', operationId: 'mergeTicket', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('source_ticket_id'), responses: r200('MergeResult') },
      },
      '/tickets/{id}/attachments': {
        get: { tags: ['Tickets'], summary: 'List ticket attachments', operationId: 'listTicketAttachments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TicketAttachment[]') },
        post: { tags: ['Tickets'], summary: 'Upload ticket attachment', operationId: 'uploadTicketAttachment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: r201('TicketAttachment') },
      },
      '/tickets/{ticketId}/attachments/{attachmentId}': {
        delete: { tags: ['Tickets'], summary: 'Delete ticket attachment', operationId: 'deleteTicketAttachment', security: [{ bearerAuth: [] }], parameters: [{ name: 'ticketId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'attachmentId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/tickets/{ticketId}/attachments/{attachmentId}/download': {
        get: { tags: ['Tickets'], summary: 'Download ticket attachment', operationId: 'downloadTicketAttachment', security: [{ bearerAuth: [] }], parameters: [{ name: 'ticketId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'attachmentId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200File('application/octet-stream') },
      },

      // ---- NOC Dashboard §12.2 ----
      '/noc/health': {
        get: { tags: ['NOC Dashboard'], summary: 'Network health rollup — device counts by status + active alert summary', operationId: 'nocHealth', security: [{ bearerAuth: [] }], responses: r200('NetworkHealth') },
      },
      '/noc/alarms': {
        get: { tags: ['NOC Dashboard'], summary: 'Active alarm counts grouped by severity', operationId: 'nocAlarms', security: [{ bearerAuth: [] }], responses: r200('AlarmCounts') },
      },
      '/noc/outages': {
        get: { tags: ['NOC Dashboard'], summary: 'Ongoing outages grouped by site', operationId: 'nocOutages', security: [{ bearerAuth: [] }], responses: r200('Outage[]') },
      },
      '/noc/ticket-queue': {
        get: { tags: ['NOC Dashboard'], summary: 'Open ticket queue ordered by priority', operationId: 'nocTicketQueue', security: [{ bearerAuth: [] }], responses: r200('Ticket[]') },
      },
      '/noc/events': {
        get: { tags: ['NOC Dashboard'], summary: 'Recent 50 events timeline (alerts, outages, tickets)', operationId: 'nocEvents', security: [{ bearerAuth: [] }], responses: r200('Event[]') },
      },
      '/noc/sla-compliance': {
        get: { tags: ['NOC Dashboard'], summary: 'SLA compliance percentage for the last 30 days', operationId: 'nocSlaCompliance', security: [{ bearerAuth: [] }], responses: r200('SlaCompliance') },
      },

      // ---- Work Orders §12.3 ----
      '/work-orders/stats': {
        get: { tags: ['Work Orders'], summary: 'Work order counts grouped by status', operationId: 'getWorkOrderStats', security: [{ bearerAuth: [] }], responses: r200('StatusCount[]') },
      },
      '/work-orders/assignable-users': {
        get: { tags: ['Work Orders'], summary: 'Active users authorized to be assigned work orders (holders of work_orders.update)', operationId: 'listAssignableWorkOrderUsers', security: [{ bearerAuth: [] }], responses: r200('UserSummary[]') },
      },
      ...crudPaths('work-orders', 'Work Orders', 'WorkOrder'),
      // Override list to document ticket_id + service_order_id query filters
      '/work-orders': {
        get: {
          tags: ['Work Orders'], summary: 'List work-orders', operationId: 'listWorkOrders',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ticket_id',         in: 'query', schema: { type: 'integer' }, description: 'Filter by linked ticket' },
            { name: 'service_order_id',  in: 'query', schema: { type: 'integer' }, description: 'Filter by linked service order' },
            { name: 'client_id',         in: 'query', schema: { type: 'integer' }, description: 'Filter by client' },
            { name: 'site_id',           in: 'query', schema: { type: 'integer' }, description: 'Filter by site' },
            { name: 'device_id',         in: 'query', schema: { type: 'integer' }, description: 'Filter by device' },
            { name: 'status',            in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
            { name: 'page',              in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit',             in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: r200('WorkOrder[]'),
        },
        post: { tags: ['Work Orders'], summary: 'Create a WorkOrder', operationId: 'createWorkOrder', security: [{ bearerAuth: [] }], requestBody: jsonBody('WorkOrder'), responses: r201('WorkOrder') },
      },
      '/work-orders/{id}/restore': {
        post: { tags: ['Work Orders'], summary: 'Restore a soft-deleted work order', operationId: 'restoreWorkOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('WorkOrder') },
      },
      '/work-orders/{id}/materials': {
        get: { tags: ['Work Orders'], summary: 'List materials used on a work order', operationId: 'listWorkOrderMaterials', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('WorkOrderMaterial[]') },
        post: { tags: ['Work Orders'], summary: 'Log material usage on a work order', operationId: 'createWorkOrderMaterial', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('item_name + quantity + unit + unit_cost + notes'), responses: r201('WorkOrderMaterial') },
      },
      '/work-orders/{id}/materials/{matId}': {
        delete: { tags: ['Work Orders'], summary: 'Remove a material log entry', operationId: 'deleteWorkOrderMaterial', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'matId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/work-orders/{id}/pickup-items': {
        get: { tags: ['Work Orders'], summary: 'Get the outstanding rented-equipment checklist for a pickup work order (Inventory Phase 3, migration 391)', operationId: 'getWorkOrderPickupItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeDevice[]') },
        post: { tags: ['Work Orders'], summary: 'Resolve one unit\'s pickup disposition (returned -> back in stock; rma -> no stock change)', operationId: 'completeWorkOrderPickupItem', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('inventorySerials_pickupDisposition'), responses: r200('CpeDevice') },
      },
      '/work-orders/{id}/attachments': {
        get: { tags: ['Work Orders'], summary: 'List work order attachments', operationId: 'listWorkOrderAttachments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('WorkOrderAttachment[]') },
        post: { tags: ['Work Orders'], summary: 'Upload work order attachment (installation photo)', operationId: 'uploadWorkOrderAttachment', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: r201('WorkOrderAttachment') },
      },
      '/work-orders/{id}/attachments/{attachmentId}': {
        delete: { tags: ['Work Orders'], summary: 'Delete work order attachment', operationId: 'deleteWorkOrderAttachment', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'attachmentId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/work-orders/{id}/attachments/{attachmentId}/download': {
        get: { tags: ['Work Orders'], summary: 'Download work order attachment', operationId: 'downloadWorkOrderAttachment', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'attachmentId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200File('application/octet-stream') },
      },

      // ---- Technician Tracking §12.3 ----
      '/technician-tracking/breadcrumb': {
        post: { tags: ['Technician Tracking'], summary: 'Ingest a GPS breadcrumb (mobile client)', operationId: 'ingestGpsBreadcrumb', security: [{ bearerAuth: [] }], requestBody: jsonBody('latitude + longitude + accuracy_m + recorded_at'), responses: r201('Ok') },
      },
      '/technician-tracking/positions': {
        get: { tags: ['Technician Tracking'], summary: 'Get last-known GPS position for each technician', operationId: 'getTechnicianPositions', security: [{ bearerAuth: [] }], responses: r200('TechnicianPosition[]') },
      },
      '/technician-tracking/route-optimize': {
        post: { tags: ['Technician Tracking'], summary: 'Compute nearest-neighbor optimized route for a technician', operationId: 'optimizeTechnicianRoute', security: [{ bearerAuth: [] }], requestBody: jsonBody('technician_id + start_lat + start_lng'), responses: r200('OptimizedRoute') },
      },
      '/technician-tracking/{userId}/history': {
        get: { tags: ['Technician Tracking'], summary: 'Get GPS breadcrumb history for a technician', operationId: 'getTechnicianHistory', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }, limitParam()], responses: r200('GpsBreadcrumb[]') },
      },

      // ---- Topology Map §13 ----
      '/topology/map/network': {
        get: { tags: ['Topology Map'], summary: 'Network device graph with link utilization', operationId: 'getNetworkGraph', security: [{ bearerAuth: [] }], parameters: [{ name: 'layer', in: 'query', required: false, schema: { type: 'string', enum: ['l2', 'l3', 'physical'] } }], responses: r200('nodes + edges') },
      },
      '/topology/map/customers': {
        get: { tags: ['Topology Map'], summary: 'Customer location pins with lat/lng', operationId: 'getCustomerLocations', security: [{ bearerAuth: [] }], responses: r200('Customer[]') },
      },
      '/topology/map/coverage': {
        get: { tags: ['Topology Map'], summary: 'Service area polygons and coverage zones', operationId: 'getCoverageData', security: [{ bearerAuth: [] }], responses: r200('service_areas + coverage_zones') },
      },
      '/topology/map/fiber-routes': {
        get: { tags: ['Topology Map'], summary: 'Fiber route polylines with segments', operationId: 'getFiberRoutes', security: [{ bearerAuth: [] }], responses: r200('FiberRoute[]') },
      },
      '/topology/map/infrastructure': {
        get: { tags: ['Topology Map'], summary: 'Infrastructure map pins — combined infrastructure + sites', operationId: 'getInfrastructurePins', security: [{ bearerAuth: [] }], responses: r200('infrastructure + sites') },
      },
      '/topology/map/dual-homed': {
        get: { tags: ['Topology Map'], summary: 'Devices with 2+ upstream links (dual-homed / redundant)', operationId: 'getDualHomedDevices', security: [{ bearerAuth: [] }], responses: r200('Device[]') },
      },
      '/topology/map/impact/{deviceId}': {
        get: { tags: ['Topology Map'], summary: 'Impact analysis — devices impacted by a device failure', operationId: 'getImpactAnalysis', security: [{ bearerAuth: [] }], parameters: [{ name: 'deviceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('device + impacted[]') },
      },
      '/topology/map/cascade/{deviceId}': {
        get: { tags: ['Topology Map'], summary: 'Cascade chain — upstream failure chain for a device', operationId: 'getCascadeChain', security: [{ bearerAuth: [] }], parameters: [{ name: 'deviceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('device + chain[]') },
      },
      '/topology/geofences': {
        get: { tags: ['Topology Map'], summary: 'List geofence zones', operationId: 'listGeofences', security: [{ bearerAuth: [] }], responses: r200('Geofence[]') },
        post: { tags: ['Topology Map'], summary: 'Create a geofence zone', operationId: 'createGeofence', security: [{ bearerAuth: [] }], requestBody: jsonBody('topologyMap_createGeofence'), responses: r201('Geofence') },
      },
      '/topology/geofences/{id}': {
        get: { tags: ['Topology Map'], summary: 'Get a geofence zone', operationId: 'getGeofence', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Geofence') },
        put: { tags: ['Topology Map'], summary: 'Update a geofence zone', operationId: 'updateGeofence', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('topologyMap_updateGeofence'), responses: r200('Geofence') },
        delete: { tags: ['Topology Map'], summary: 'Delete a geofence zone', operationId: 'deleteGeofence', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/topology/infrastructure': {
        get: { tags: ['Topology Map'], summary: 'List infrastructure map pins', operationId: 'listInfrastructure', security: [{ bearerAuth: [] }], responses: r200('InfrastructurePoint[]') },
        post: { tags: ['Topology Map'], summary: 'Create an infrastructure map pin', operationId: 'createInfrastructurePoint', security: [{ bearerAuth: [] }], requestBody: jsonBody('topologyMap_createInfrastructure'), responses: r201('InfrastructurePoint') },
      },
      '/topology/infrastructure/{id}': {
        get: { tags: ['Topology Map'], summary: 'Get an infrastructure map pin', operationId: 'getInfrastructurePoint', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('InfrastructurePoint') },
        put: { tags: ['Topology Map'], summary: 'Update an infrastructure map pin', operationId: 'updateInfrastructurePoint', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('topologyMap_updateInfrastructure'), responses: r200('InfrastructurePoint') },
        delete: { tags: ['Topology Map'], summary: 'Delete an infrastructure map pin', operationId: 'deleteInfrastructurePoint', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/topology/dependencies/{deviceId}': {
        get: { tags: ['Topology Map'], summary: 'Get dependency edges for a device (both parent and child)', operationId: 'getDependencyEdges', security: [{ bearerAuth: [] }], parameters: [{ name: 'deviceId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('DependencyEdge[]') },
      },
      '/topology/dependencies': {
        post: { tags: ['Topology Map'], summary: 'Create a device dependency edge', operationId: 'createDependencyEdge', security: [{ bearerAuth: [] }], requestBody: jsonBody('topologyMap_createDependencyEdge'), responses: r201('DependencyEdge') },
      },
      '/topology/dependencies/{id}': {
        delete: { tags: ['Topology Map'], summary: 'Delete a device dependency edge', operationId: 'deleteDependencyEdge', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- Inventory & Asset Management §14 ----
      ...crudPaths('vendors', 'Inventory & Asset Management', 'Vendor'),
      '/vendors/{id}/restore': { post: { tags: ['Inventory & Asset Management'], summary: 'Restore a soft-deleted vendor', operationId: 'restoreVendor', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Vendor') } },

      ...crudPaths('purchase-orders', 'Inventory & Asset Management', 'PurchaseOrder'),
      '/purchase-orders/{id}/items': {
        get: { tags: ['Inventory & Asset Management'], summary: 'List line items for a purchase order', operationId: 'listPurchaseOrderItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PurchaseOrderItem[]') },
        post: { tags: ['Inventory & Asset Management'], summary: 'Add a line item to a purchase order', operationId: 'createPurchaseOrderItem', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('PurchaseOrderItem'), responses: r201('PurchaseOrderItem') },
      },
      '/purchase-orders/{id}/items/{itemId}': {
        put: { tags: ['Inventory & Asset Management'], summary: 'Update a purchase order line item', operationId: 'updatePurchaseOrderItem', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'itemId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('PurchaseOrderItem'), responses: r200('PurchaseOrderItem') },
        delete: { tags: ['Inventory & Asset Management'], summary: 'Delete a purchase order line item', operationId: 'deletePurchaseOrderItem', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'itemId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/purchase-orders/{id}/receive': { post: { tags: ['Inventory & Asset Management'], summary: 'Mark a purchase order as received and update stock', operationId: 'receivePurchaseOrder', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('received_date (optional)'), responses: r200('PurchaseOrder') } },

      '/assets/stats': { get: { tags: ['Inventory & Asset Management'], summary: 'Aggregate asset lifecycle stats (counts by status)', operationId: 'getAssetStats', security: [{ bearerAuth: [] }], responses: r200('AssetStats') } },
      '/assets/low-stock': { get: { tags: ['Inventory & Asset Management'], summary: 'List inventory items below reorder threshold', operationId: 'getLowStockItems', security: [{ bearerAuth: [] }], responses: r200('InventoryItem[]') } },
      '/assets/scan': { post: { tags: ['Inventory & Asset Management'], summary: 'Lookup an asset by barcode or asset tag', operationId: 'scanAsset', security: [{ bearerAuth: [] }], requestBody: jsonBody('barcode'), responses: r200('Asset') } },
      ...crudPaths('assets', 'Inventory & Asset Management', 'Asset'),
      '/assets/{id}/barcode': { get: { tags: ['Inventory & Asset Management'], summary: 'Get barcode payload and metadata for an asset', operationId: 'getAssetBarcode', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BarcodeData') } },
      '/assets/{id}/depreciation': { get: { tags: ['Inventory & Asset Management'], summary: 'Calculate current book value and depreciation schedule', operationId: 'getAssetDepreciation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DepreciationData') } },
      '/assets/{id}/assign': { post: { tags: ['Inventory & Asset Management'], summary: 'Assign an asset to a client', operationId: 'assignAsset', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('client_id + notes'), responses: r201('AssetAssignment') } },
      '/assets/{id}/unassign': { post: { tags: ['Inventory & Asset Management'], summary: 'Return/unassign an asset from its current holder', operationId: 'unassignAsset', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('notes (optional)'), responses: r200('AssetAssignment') } },
      '/assets/{id}/dispose': { post: { tags: ['Inventory & Asset Management'], summary: 'Dispose of an asset (write-off)', operationId: 'disposeAsset', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('disposal_reason + disposal_notes'), responses: r200('Asset') } },
      '/assets/{id}/assignments': { get: { tags: ['Inventory & Asset Management'], summary: 'List assignment history for an asset', operationId: 'listAssetAssignments', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AssetAssignment[]') } },

      ...crudPaths('rma-requests', 'Inventory & Asset Management', 'RmaRequest'),
      '/rma-requests/{id}/ship': { post: { tags: ['Inventory & Asset Management'], summary: 'Mark RMA as shipped to vendor', operationId: 'shipRmaRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('tracking_number (optional)'), responses: r200('RmaRequest') } },
      '/rma-requests/{id}/receive': { post: { tags: ['Inventory & Asset Management'], summary: 'Mark RMA as received back from vendor', operationId: 'receiveRmaRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RmaRequest') } },
      '/rma-requests/{id}/close': { post: { tags: ['Inventory & Asset Management'], summary: 'Close an RMA request (resolved/cancelled/replaced)', operationId: 'closeRmaRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('status + replacement_asset_id + notes'), responses: r200('RmaRequest') } },

      // ---- ACS / CWMP (outside /api/v1) ----
      '/acs/cwmp': {
        post: { tags: ['CPE Management'], summary: 'CWMP/TR-069 ACS endpoint — CPE-to-server SOAP over HTTP (HTTP Basic auth)', operationId: 'acsCwmp', requestBody: { description: 'CWMP SOAP XML envelope', required: false, content: { 'text/xml': { schema: { type: 'string' } } } }, responses: r200('CWMP SOAP Response XML') },
      },

      // ---- §16 Regulatory Compliance ----
      '/regulatory-compliance/consent': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'List subscriber consents', operationId: 'listSubscriberConsents', security: [{ bearerAuth: [] }], responses: r200('Consent list') },
        post: { tags: ['Regulatory Compliance MX'], summary: 'Record subscriber consent', operationId: 'createSubscriberConsent', security: [{ bearerAuth: [] }], requestBody: jsonBody('regulatoryCompliance_createConsent'), responses: r201('Consent') },
      },
      '/regulatory-compliance/consent/client/{clientId}': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'Get consents for a client', operationId: 'getClientConsents', security: [{ bearerAuth: [] }], parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Consent list') },
      },
      '/regulatory-compliance/consent/{id}/withdraw': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Withdraw consent', operationId: 'withdrawConsent', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/dsar-requests': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'List DSAR requests', operationId: 'listDsarRequests', security: [{ bearerAuth: [] }], responses: r200('DSAR list') },
        post: { tags: ['Regulatory Compliance MX'], summary: 'Create DSAR request', operationId: 'createDsarRequest', security: [{ bearerAuth: [] }], requestBody: jsonBody('regulatoryCompliance_createDsarRequest'), responses: r201('DSAR request') },
      },
      '/regulatory-compliance/dsar-requests/{id}': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'Get DSAR request', operationId: 'getDsarRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('DSAR request') },
      },
      '/regulatory-compliance/dsar-requests/{id}/fulfill': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Fulfill DSAR request', operationId: 'fulfillDsarRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/dsar-requests/{id}/reject': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Reject DSAR request', operationId: 'rejectDsarRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/dsar-requests/{id}/legal-hold': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Set legal hold on DSAR request', operationId: 'legalHoldDsarRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/identity-verification': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'List identity verifications', operationId: 'listIdentityVerifications', security: [{ bearerAuth: [] }], responses: r200('Verification list') },
        post: { tags: ['Regulatory Compliance MX'], summary: 'Create identity verification record', operationId: 'createIdentityVerification', security: [{ bearerAuth: [] }], requestBody: jsonBody('regulatoryCompliance_createIdVerif'), responses: r201('Verification') },
      },
      '/regulatory-compliance/identity-verification/{id}': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'Get identity verification', operationId: 'getIdentityVerification', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Verification') },
      },
      '/regulatory-compliance/identity-verification/{id}/verify': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Mark identity verified', operationId: 'verifyIdentity', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/identity-verification/{id}/reject': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Reject identity verification', operationId: 'rejectIdentityVerification', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/gov-data-requests': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'List government data requests', operationId: 'listGovDataRequests', security: [{ bearerAuth: [] }], responses: r200('Gov data request list') },
        post: { tags: ['Regulatory Compliance MX'], summary: 'Log government data request', operationId: 'createGovDataRequest', security: [{ bearerAuth: [] }], requestBody: jsonBody('regulatoryCompliance_createGovDataRequest'), responses: r201('Gov data request') },
      },
      '/regulatory-compliance/gov-data-requests/{id}': {
        get: { tags: ['Regulatory Compliance MX'], summary: 'Get government data request', operationId: 'getGovDataRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Gov data request') },
      },
      '/regulatory-compliance/gov-data-requests/{id}/fulfill': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Fulfill government data request', operationId: 'fulfillGovDataRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/regulatory-compliance/gov-data-requests/{id}/reject': {
        put: { tags: ['Regulatory Compliance MX'], summary: 'Reject government data request', operationId: 'rejectGovDataRequest', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      // Audit export + report access logs
      '/audit-logs/export': {
        get: { tags: ['Audit Logs'], summary: 'Export audit logs for regulatory inspection', operationId: 'exportAuditLogs', security: [{ bearerAuth: [] }], responses: r200('Audit export') },
      },
      '/audit-logs/report-access-logs': {
        get: { tags: ['Audit Logs'], summary: 'List report access logs', operationId: 'listReportAccessLogs', security: [{ bearerAuth: [] }], responses: r200('Report access log list') },
      },
      '/dsar/requests': {
        get: { tags: ['DSAR'], summary: 'List DSAR requests (convenience)', operationId: 'listDsarRequestsConvenience', security: [{ bearerAuth: [] }], responses: r200('DSAR list') },
      },
      // ---- Numbering Management ----
      ...crudPaths('numbering-management/phone-numbers', 'Numbering Management', 'PhoneNumberInventory'),
      ...crudPaths('numbering-management/portability', 'Numbering Management', 'NumberPortabilityRecord'),
      ...crudPaths('numbering-management/numbering-blocks', 'Numbering Management', 'NumberingBlock'),
      '/numbering-management/portability/{id}/complete': {
        put: { tags: ['Numbering Management'], summary: 'Mark number portability complete', operationId: 'completePortability', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      // ---- Universal Service ----
      ...crudPaths('universal-service/uso-obligations', 'Universal Service', 'UsoObligation'),
      ...crudPaths('universal-service/rural-coverage', 'Universal Service', 'RuralCoverageReport'),
      '/universal-service/uso-obligations/{id}/report': {
        put: { tags: ['Universal Service'], summary: 'Mark USO obligation as reported', operationId: 'reportUsoObligation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      '/universal-service/rural-coverage/summary': {
        get: { tags: ['Universal Service'], summary: 'Get rural coverage aggregate summary', operationId: 'getRuralCoverageSummary', security: [{ bearerAuth: [] }], responses: r200('Summary') },
      },
      // ---- Consumer Protection MX ----
      ...crudPaths('consumer-protection/service-modifications', 'Consumer Protection MX', 'ServiceModificationNotice'),
      ...crudPaths('consumer-protection/contract-templates-mx', 'Consumer Protection MX', 'ContractTemplateMx'),
      '/consumer-protection/service-modifications/{id}/send': {
        put: { tags: ['Consumer Protection MX'], summary: 'Mark service modification notice as sent', operationId: 'sendServiceModificationNotice', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Updated') },
      },
      // ---- Data Residency ----
      '/data-residency': {
        get: { tags: ['Data Residency'], summary: 'Get data residency configuration', operationId: 'getDataResidencyConfig', security: [{ bearerAuth: [] }], responses: r200('Config') },
        post: { tags: ['Data Residency'], summary: 'Create data residency configuration', operationId: 'createDataResidencyConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('dataResidency_createConfig'), responses: r201('Config') },
        put: { tags: ['Data Residency'], summary: 'Update data residency configuration', operationId: 'updateDataResidencyConfig', security: [{ bearerAuth: [] }], requestBody: jsonBody('dataResidency_updateConfig'), responses: r200('Config') },
      },
      '/data-residency/check': {
        post: { tags: ['Data Residency'], summary: 'Run compliance check for data residency', operationId: 'checkDataResidencyCompliance', security: [{ bearerAuth: [] }], responses: r200('Check result') },
      },

      // ---- §17 Security Admin ----
      '/security-admin/webauthn': {
        get: { tags: ['Security'], summary: 'List WebAuthn credentials for current user', operationId: 'listWebAuthnCredentials', security: [{ bearerAuth: [] }], responses: r200('WebAuthnCredential[]') },
        post: { tags: ['Security'], summary: 'Register a WebAuthn credential', operationId: 'createWebAuthnCredential', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createWebAuthn'), responses: r201('WebAuthnCredential') },
      },
      '/security-admin/webauthn/{id}': {
        delete: { tags: ['Security'], summary: 'Revoke a WebAuthn credential', operationId: 'deleteWebAuthnCredential', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/security-admin/admin-ip-allowlist': {
        get: { tags: ['Security'], summary: 'List admin IP allowlist entries', operationId: 'listAdminIpAllowlist', security: [{ bearerAuth: [] }], responses: r200('AdminIpAllowlist[]') },
        post: { tags: ['Security'], summary: 'Add admin IP allowlist entry', operationId: 'createAdminIpAllowlist', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createAdminIpAllowlist'), responses: r201('AdminIpAllowlist') },
      },
      '/security-admin/admin-ip-allowlist/{id}': {
        put: { tags: ['Security'], summary: 'Update admin IP allowlist entry', operationId: 'updateAdminIpAllowlist', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('AdminIpAllowlist'), responses: r200('Success') },
        delete: { tags: ['Security'], summary: 'Delete admin IP allowlist entry', operationId: 'deleteAdminIpAllowlist', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/security-admin/password-policy': {
        get: { tags: ['Security'], summary: 'Get org password policy', operationId: 'getPasswordPolicy', security: [{ bearerAuth: [] }], responses: r200('PasswordPolicy') },
        put: { tags: ['Security'], summary: 'Update org password policy', operationId: 'updatePasswordPolicy', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_updatePasswordPolicy'), responses: r200('Success') },
      },
      '/security-admin/api-key-rate-limits': {
        get: { tags: ['Security'], summary: 'List API key rate limits', operationId: 'listApiKeyRateLimits', security: [{ bearerAuth: [] }], responses: r200('ApiKeyRateLimit[]') },
      },
      '/security-admin/api-key-rate-limits/{tokenId}': {
        put: { tags: ['Security'], summary: 'Set rate limit for an API token', operationId: 'setApiKeyRateLimit', security: [{ bearerAuth: [] }], parameters: [{ name: 'tokenId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('ApiKeyRateLimit'), responses: r200('Success') },
      },

      // ---- §17 Network Security ----
      '/network-security/firewall-rules': {
        get: { tags: ['Security'], summary: 'List firewall rules', operationId: 'listFirewallRules', security: [{ bearerAuth: [] }], responses: r200('FirewallRule[]') },
        post: { tags: ['Security'], summary: 'Create firewall rule', operationId: 'createFirewallRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createFirewallRule'), responses: r201('FirewallRule') },
      },
      '/network-security/firewall-rules/{id}': {
        put: { tags: ['Security'], summary: 'Update firewall rule', operationId: 'updateFirewallRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('FirewallRule'), responses: r200('Success') },
        delete: { tags: ['Security'], summary: 'Delete firewall rule', operationId: 'deleteFirewallRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/network-security/ddos-protection': {
        get: { tags: ['Security'], summary: 'List DDoS protection rules', operationId: 'listDdosProtectionRules', security: [{ bearerAuth: [] }], responses: r200('DdosProtectionRule[]') },
        post: { tags: ['Security'], summary: 'Create DDoS protection rule', operationId: 'createDdosProtectionRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createDdosRule'), responses: r201('DdosProtectionRule') },
      },
      '/network-security/ddos-protection/{id}': {
        put: { tags: ['Security'], summary: 'Update DDoS protection rule', operationId: 'updateDdosProtectionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('DdosProtectionRule'), responses: r200('Success') },
        delete: { tags: ['Security'], summary: 'Delete DDoS protection rule', operationId: 'deleteDdosProtectionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/network-security/ddos-protection/{id}/activate': {
        post: { tags: ['Security'], summary: 'Activate DDoS protection rule', operationId: 'activateDdosProtectionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Activated') },
      },
      '/network-security/ddos-protection/{id}/deactivate': {
        post: { tags: ['Security'], summary: 'Deactivate DDoS protection rule', operationId: 'deactivateDdosProtectionRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Deactivated') },
      },
      '/network-security/blackhole-routes': {
        get: { tags: ['Security'], summary: 'List blackhole routes', operationId: 'listBlackholeRoutes', security: [{ bearerAuth: [] }], responses: r200('BlackholeRoute[]') },
        post: { tags: ['Security'], summary: 'Create/trigger blackhole route', operationId: 'createBlackholeRoute', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createBlackholeRoute'), responses: r201('BlackholeRoute') },
      },
      '/network-security/blackhole-routes/{id}': {
        delete: { tags: ['Security'], summary: 'Delete blackhole route', operationId: 'deleteBlackholeRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/network-security/blackhole-routes/{id}/release': {
        post: { tags: ['Security'], summary: 'Release/deactivate blackhole route', operationId: 'releaseBlackholeRoute', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Released') },
      },
      '/network-security/dns-blocklists': {
        get: { tags: ['Security'], summary: 'List DNS blocklist entries', operationId: 'listDnsBlocklists', security: [{ bearerAuth: [] }], responses: r200('DnsBlocklist[]') },
        post: { tags: ['Security'], summary: 'Add DNS blocklist entry', operationId: 'createDnsBlocklist', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_createDnsBlocklist'), responses: r201('DnsBlocklist') },
      },
      '/network-security/dns-blocklists/{id}': {
        put: { tags: ['Security'], summary: 'Update DNS blocklist entry', operationId: 'updateDnsBlocklist', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('DnsBlocklist'), responses: r200('Success') },
        delete: { tags: ['Security'], summary: 'Delete DNS blocklist entry', operationId: 'deleteDnsBlocklist', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Success') },
      },
      '/network-security/cpe-security-scans': {
        get: { tags: ['Security'], summary: 'List CPE security scans', operationId: 'listCpeSecurityScans', security: [{ bearerAuth: [] }], responses: r200('CpeSecurityScan[]') },
        post: { tags: ['Security'], summary: 'Trigger CPE security scan', operationId: 'triggerCpeSecurityScan', security: [{ bearerAuth: [] }], requestBody: jsonBody('security_triggerCpeScan'), responses: r201('CpeSecurityScan') },
      },
      '/network-security/cpe-security-scans/{id}': {
        get: { tags: ['Security'], summary: 'Get CPE security scan details', operationId: 'getCpeSecurityScan', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('CpeSecurityScan') },
      },

      // ---- §17 Data Security ----
      '/data-security/encryption-keys': {
        get: { tags: ['Security'], summary: 'List encryption key metadata', operationId: 'listEncryptionKeys', security: [{ bearerAuth: [] }], responses: r200('EncryptionKeyMetadata[]') },
        post: { tags: ['Security'], summary: 'Register encryption key metadata', operationId: 'createEncryptionKey', security: [{ bearerAuth: [] }], requestBody: jsonBody('EncryptionKeyMetadata'), responses: r201('EncryptionKeyMetadata') },
      },
      '/data-security/encryption-keys/{id}': {
        put: { tags: ['Security'], summary: 'Update encryption key metadata (supports rotate action)', operationId: 'updateEncryptionKey', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('EncryptionKeyMetadata'), responses: r200('Success') },
      },
      '/data-security/data-masking': {
        get: { tags: ['Security'], summary: 'List data masking rules', operationId: 'listDataMaskingRules', security: [{ bearerAuth: [] }], responses: r200('DataMaskingRule[]') },
        put: { tags: ['Security'], summary: 'Upsert data masking rule', operationId: 'upsertDataMaskingRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('DataMaskingRule'), responses: r200('Success') },
      },
      '/data-security/secure-deletion-log': {
        get: { tags: ['Security'], summary: 'List secure deletion log', operationId: 'listSecureDeletionLog', security: [{ bearerAuth: [] }], responses: r200('SecureDeletionLog[]') },
      },
      '/data-security/secure-deletion': {
        post: { tags: ['Security'], summary: 'Run secure deletion of expired retention data', operationId: 'runSecureDeletion', security: [{ bearerAuth: [] }], responses: r200('Deletion stats') },
      },
      '/data-security/tls-config': {
        get: { tags: ['Security'], summary: 'Get TLS configuration documentation', operationId: 'getTlsConfig', security: [{ bearerAuth: [] }], responses: r200('TLS config docs') },
      },

      // ---- §17 Webhook Security ----
      '/webhook-security/verify-signing': {
        get: { tags: ['Security'], summary: 'Get webhook signing verification docs and status', operationId: 'getWebhookSigningInfo', security: [{ bearerAuth: [] }], responses: r200('Signing info') },
      },
      '/webhook-security/verify-signature': {
        post: { tags: ['Security'], summary: 'Verify a webhook signature', operationId: 'verifyWebhookSignature', security: [{ bearerAuth: [] }], requestBody: jsonBody('signature + secret + payload'), responses: r200('{ valid: boolean }') },
      },
      '/webhook-security/delivery-logs': {
        get: { tags: ['Security'], summary: 'List webhook delivery logs for org', operationId: 'listWebhookDeliveryLogs', security: [{ bearerAuth: [] }], responses: r200('WebhookDelivery[]') },
      },

      // ---- §18.1 Workflow Automation ----
      '/automation-rules': {
        get: { tags: ['Automation'], summary: 'List automation rules', operationId: 'listAutomationRules', security: [{ bearerAuth: [] }], responses: r200('AutomationRule[]') },
        post: { tags: ['Automation'], summary: 'Create automation rule', operationId: 'createAutomationRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('AutomationRule'), responses: r201('AutomationRule') },
      },
      '/automation-rules/{id}': {
        get: { tags: ['Automation'], summary: 'Get automation rule', operationId: 'getAutomationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AutomationRule') },
        put: { tags: ['Automation'], summary: 'Update automation rule', operationId: 'updateAutomationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('AutomationRule'), responses: r200('AutomationRule') },
        delete: { tags: ['Automation'], summary: 'Delete automation rule', operationId: 'deleteAutomationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/automation-rules/{id}/execute': {
        post: { tags: ['Automation'], summary: 'Manually trigger an automation rule', operationId: 'executeAutomationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('payload'), responses: r200('ExecutionResult') },
      },
      '/automation-rules/{id}/executions': {
        get: { tags: ['Automation'], summary: 'List executions for an automation rule', operationId: 'listAutomationRuleExecutions', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AutomationRuleExecution[]') },
      },

      '/batch-jobs': {
        get: { tags: ['Automation'], summary: 'List batch jobs', operationId: 'listBatchJobs', security: [{ bearerAuth: [] }], responses: r200('BatchJob[]') },
        post: { tags: ['Automation'], summary: 'Create and run a batch subscriber job', operationId: 'createBatchJob', security: [{ bearerAuth: [] }], requestBody: jsonBody('BatchJob'), responses: r201('BatchJob') },
      },
      '/batch-jobs/{id}': {
        get: { tags: ['Automation'], summary: 'Get batch job', operationId: 'getBatchJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BatchJob') },
      },
      '/batch-jobs/{id}/items': {
        get: { tags: ['Automation'], summary: 'List batch job items', operationId: 'listBatchJobItems', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BatchJobItem[]') },
      },
      '/batch-jobs/{id}/cancel': {
        post: { tags: ['Automation'], summary: 'Cancel a running batch job', operationId: 'cancelBatchJob', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BatchJob') },
      },

      '/provisioning-pipelines': {
        get: { tags: ['Automation'], summary: 'List provisioning pipeline runs', operationId: 'listProvisioningPipelines', security: [{ bearerAuth: [] }], responses: r200('ProvisioningPipeline[]') },
        post: { tags: ['Automation'], summary: 'Trigger a provisioning pipeline run', operationId: 'createProvisioningPipeline', security: [{ bearerAuth: [] }], requestBody: jsonBody('name + contract_id + client_id'), responses: r201('ProvisioningPipeline') },
      },
      '/provisioning-pipelines/{id}': {
        get: { tags: ['Automation'], summary: 'Get provisioning pipeline with stage details', operationId: 'getProvisioningPipeline', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ProvisioningPipeline') },
      },

      '/remediation-rules': {
        get: { tags: ['Automation'], summary: 'List auto-remediation rules', operationId: 'listRemediationRules', security: [{ bearerAuth: [] }], responses: r200('RemediationRule[]') },
        post: { tags: ['Automation'], summary: 'Create auto-remediation rule', operationId: 'createRemediationRule', security: [{ bearerAuth: [] }], requestBody: jsonBody('RemediationRule'), responses: r201('RemediationRule') },
      },
      '/remediation-rules/{id}': {
        get: { tags: ['Automation'], summary: 'Get remediation rule', operationId: 'getRemediationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RemediationRule') },
        put: { tags: ['Automation'], summary: 'Update remediation rule', operationId: 'updateRemediationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('RemediationRule'), responses: r200('RemediationRule') },
        delete: { tags: ['Automation'], summary: 'Delete remediation rule', operationId: 'deleteRemediationRule', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/remediation-rules/{id}/executions': {
        get: { tags: ['Automation'], summary: 'List executions for a remediation rule', operationId: 'listRemediationExecutions', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RemediationExecution[]') },
      },
      '/remediation-rules/evaluate': {
        post: { tags: ['Automation'], summary: 'Run remediation rule evaluation now', operationId: 'evaluateRemediationRules', security: [{ bearerAuth: [] }], responses: r200('EvaluationResult') },
      },

      // ---- §18.2 Scripting Engine ----
      '/automation-scripts': {
        get: { tags: ['Scripting'], summary: 'List automation scripts (org + shared)', operationId: 'listAutomationScripts', security: [{ bearerAuth: [] }], responses: r200('AutomationScript[]') },
        post: { tags: ['Scripting'], summary: 'Create automation script (admin only)', operationId: 'createAutomationScript', security: [{ bearerAuth: [] }], requestBody: jsonBody('AutomationScript'), responses: r201('AutomationScript') },
      },
      '/automation-scripts/{id}': {
        get: { tags: ['Scripting'], summary: 'Get automation script', operationId: 'getAutomationScript', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AutomationScript') },
        put: { tags: ['Scripting'], summary: 'Update automation script', operationId: 'updateAutomationScript', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('AutomationScript'), responses: r200('AutomationScript') },
        delete: { tags: ['Scripting'], summary: 'Delete automation script', operationId: 'deleteAutomationScript', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/automation-scripts/{id}/execute': {
        post: { tags: ['Scripting'], summary: 'Queue script execution (STUB — sandboxed executor required)', operationId: 'executeAutomationScript', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('input_params'), responses: { 202: { description: 'Queued', content: { 'application/json': { schema: { type: 'object' } } } } } },
      },
      '/automation-scripts/{id}/executions': {
        get: { tags: ['Scripting'], summary: 'List executions for a script', operationId: 'listScriptExecutions', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ScriptExecution[]') },
      },
      '/automation-scripts/executions/list': {
        get: { tags: ['Scripting'], summary: 'List all script executions for org', operationId: 'listAllScriptExecutions', security: [{ bearerAuth: [] }], responses: r200('ScriptExecution[]') },
      },

      // ---- §18.3 Router API Integration ----
      '/router-drivers': {
        get: { tags: ['Router Drivers'], summary: 'List router driver configurations', operationId: 'listRouterDrivers', security: [{ bearerAuth: [] }], responses: r200('RouterDriverConfig[]') },
        post: { tags: ['Router Drivers'], summary: 'Create router driver configuration', operationId: 'createRouterDriver', security: [{ bearerAuth: [] }], requestBody: jsonBody('RouterDriverConfig'), responses: r201('RouterDriverConfig') },
      },
      '/router-drivers/{id}': {
        get: { tags: ['Router Drivers'], summary: 'Get router driver configuration', operationId: 'getRouterDriver', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('RouterDriverConfig') },
        put: { tags: ['Router Drivers'], summary: 'Update router driver configuration', operationId: 'updateRouterDriver', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('RouterDriverConfig'), responses: r200('RouterDriverConfig') },
        delete: { tags: ['Router Drivers'], summary: 'Delete router driver configuration', operationId: 'deleteRouterDriver', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/router-drivers/{id}/test': {
        post: { tags: ['Router Drivers'], summary: 'Test router driver connectivity', operationId: 'testRouterDriver', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TestResult') },
      },
      '/router-drivers/{id}/dispatch': {
        post: { tags: ['Router Drivers'], summary: 'Dispatch command to router (MikroTik live; others STUBBED)', operationId: 'dispatchRouterCommand', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('command + params'), responses: r200('CommandResult') },
      },
      '/router-drivers/command-executions/list': {
        get: { tags: ['Router Drivers'], summary: 'List device command executions', operationId: 'listDeviceCommandExecutions', security: [{ bearerAuth: [] }], responses: r200('DeviceCommandExecution[]') },
      },

      // ---- §18.4 AI/ML Analytics ----
      '/analytics/anomalies': {
        get: { tags: ['Analytics'], summary: 'List detected traffic anomalies (heuristic z-score)', operationId: 'listAnalyticsAnomalies', security: [{ bearerAuth: [] }], responses: r200('Anomaly[]') },
      },
      '/analytics/anomalies/detect': {
        post: { tags: ['Analytics'], summary: 'Run z-score anomaly detection now (heuristic)', operationId: 'detectAnomalies', security: [{ bearerAuth: [] }], responses: r200('AnomalyDetectionResult') },
      },
      '/analytics/anomalies/{id}/acknowledge': {
        post: { tags: ['Analytics'], summary: 'Acknowledge an anomaly detection', operationId: 'acknowledgeAnomaly', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Anomaly') },
      },
      '/analytics/predictive-failure': {
        get: { tags: ['Analytics'], summary: 'SFP degradation + ONU offline analysis (heuristic thresholds)', operationId: 'predictiveFailure', security: [{ bearerAuth: [] }], responses: r200('PredictiveFailureResult') },
      },
      '/analytics/alert-correlation': {
        get: { tags: ['Analytics'], summary: 'Correlated alert groups for noise reduction (reuses §6)', operationId: 'alertCorrelation', security: [{ bearerAuth: [] }], responses: r200('AlertCorrelationResult') },
      },
      '/analytics/bandwidth-forecast': {
        get: { tags: ['Analytics'], summary: 'Bandwidth forecast reusing §15 capacity forecast (linear regression)', operationId: 'bandwidthForecast', security: [{ bearerAuth: [] }], responses: r200('BandwidthForecastResult') },
      },
      '/analytics/churn-scores': {
        get: { tags: ['Analytics'], summary: 'List client churn risk scores (heuristic rule-based)', operationId: 'listChurnScores', security: [{ bearerAuth: [] }], responses: r200('ChurnScore[]') },
      },
      '/analytics/churn-scores/compute': {
        post: { tags: ['Analytics'], summary: 'Run churn score computation for org (heuristic)', operationId: 'computeChurnScores', security: [{ bearerAuth: [] }], responses: r200('ChurnComputeResult') },
      },

      // ---- §19 Resellers ----
      '/resellers': {
        get: { tags: ['Resellers'], summary: 'List resellers', operationId: 'listResellers', security: [{ bearerAuth: [] }], responses: r200('Reseller[]') },
        post: { tags: ['Resellers'], summary: 'Create reseller', operationId: 'createReseller', security: [{ bearerAuth: [] }], requestBody: jsonBody('Reseller'), responses: r201('Reseller') },
      },
      '/resellers/{id}': {
        get: { tags: ['Resellers'], summary: 'Get reseller', operationId: 'getReseller', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Reseller') },
        put: { tags: ['Resellers'], summary: 'Update reseller', operationId: 'updateReseller', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('Reseller'), responses: r200('Reseller') },
        delete: { tags: ['Resellers'], summary: 'Delete reseller', operationId: 'deleteReseller', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/resellers/{id}/suspend': {
        post: { tags: ['Resellers'], summary: 'Toggle reseller suspension', operationId: 'suspendReseller', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Status') },
      },
      '/resellers/{id}/plan-prices': {
        get: { tags: ['Resellers'], summary: 'List custom plan prices', operationId: 'listResellerPlanPrices', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('PlanPrice[]') },
        post: { tags: ['Resellers'], summary: 'Set custom plan price', operationId: 'setResellerPlanPrice', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('PlanPrice'), responses: r201('PlanPrice') },
      },
      '/resellers/{id}/plan-prices/{ppId}': {
        delete: { tags: ['Resellers'], summary: 'Remove custom plan price', operationId: 'deleteResellerPlanPrice', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'ppId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/resellers/{id}/commissions': {
        get: { tags: ['Resellers'], summary: 'List commission records', operationId: 'listResellerCommissions', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Commission[]') },
      },
      '/resellers/{id}/commissions/{cId}/approve': {
        post: { tags: ['Resellers'], summary: 'Approve or mark commission paid', operationId: 'approveResellerCommission', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'cId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('status'), responses: r200('Commission') },
      },
      '/resellers/{id}/ip-pools': {
        get: { tags: ['Resellers'], summary: 'List IP pool allocations', operationId: 'listResellerIpPools', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('IpPoolAllocation[]') },
        post: { tags: ['Resellers'], summary: 'Add IP pool allocation', operationId: 'addResellerIpPool', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('ip_pool_id'), responses: r201('IpPoolAllocation') },
      },
      '/resellers/{id}/ip-pools/{allocId}': {
        delete: { tags: ['Resellers'], summary: 'Remove IP pool allocation', operationId: 'removeResellerIpPool', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'allocId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/resellers/{id}/bandwidth-quota': {
        get: { tags: ['Resellers'], summary: 'Get bandwidth quota', operationId: 'getResellerBandwidthQuota', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BandwidthQuota') },
        put: { tags: ['Resellers'], summary: 'Set bandwidth quota', operationId: 'setResellerBandwidthQuota', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('BandwidthQuota'), responses: r200('BandwidthQuota') },
      },
      '/resellers/{id}/olt-ports': {
        get: { tags: ['Resellers'], summary: 'List OLT port assignments', operationId: 'listResellerOltPorts', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('OltPortAssignment[]') },
        post: { tags: ['Resellers'], summary: 'Add OLT port assignment', operationId: 'addResellerOltPort', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('olt_port_id'), responses: r201('OltPortAssignment') },
      },
      '/resellers/{id}/olt-ports/{aId}': {
        delete: { tags: ['Resellers'], summary: 'Remove OLT port assignment', operationId: 'removeResellerOltPort', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'aId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r204() },
      },
      '/resellers/{id}/billing-entity': {
        get: { tags: ['Resellers'], summary: 'Get billing entity', operationId: 'getResellerBillingEntity', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('BillingEntity') },
        put: { tags: ['Resellers'], summary: 'Upsert billing entity', operationId: 'upsertResellerBillingEntity', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('BillingEntity'), responses: r200('BillingEntity') },
      },

      // ---- §19.3 Reseller Portal ----
      '/reseller-portal/{id}/dashboard': {
        get: { tags: ['Reseller Portal'], summary: 'Reseller dashboard aggregates', operationId: 'getResellerDashboard', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('ResellerDashboard') },
      },
      '/reseller-portal/{id}/clients': {
        get: { tags: ['Reseller Portal'], summary: 'List reseller clients', operationId: 'listResellerPortalClients', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Client[]') },
        post: { tags: ['Reseller Portal'], summary: 'Create client under reseller', operationId: 'createResellerPortalClient', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('Client'), responses: r201('Client') },
      },
      '/reseller-portal/{id}/clients/{cId}/suspend': {
        post: { tags: ['Reseller Portal'], summary: 'Suspend or reactivate client', operationId: 'suspendResellerPortalClient', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'cId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Status') },
      },
      '/reseller-portal/{id}/clients/{cId}/cancel': {
        post: { tags: ['Reseller Portal'], summary: 'Cancel (set inactive) client', operationId: 'cancelResellerPortalClient', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'cId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('Status') },
      },
      '/reseller-portal/{id}/invoices': {
        get: { tags: ['Reseller Portal'], summary: 'List reseller client invoices', operationId: 'listResellerPortalInvoices', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('Invoice[]') },
      },
      '/reseller-portal/{id}/inventory': {
        get: { tags: ['Reseller Portal'], summary: 'List reseller assigned inventory', operationId: 'listResellerPortalInventory', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('AssetAssignment[]') },
      },

      // ---- §20.2 Integration Providers ----
      '/integrations/providers': {
        get: { tags: ['Integration Providers'], summary: 'List available integration providers', operationId: 'listIntegrationProviders', security: [{ bearerAuth: [] }], parameters: [{ name: 'category', in: 'query', schema: { type: 'string', enum: ['accounting', 'payment_gateway', 'communication', 'maps', 'monitoring', 'helpdesk', 'tax_sat', 'lorawan'] } }], responses: r200('IntegrationProvider[]') },
      },
      '/integrations/providers/{id}': {
        get: { tags: ['Integration Providers'], summary: 'Get a single integration provider', operationId: 'getIntegrationProvider', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('IntegrationProvider') },
      },

      // ---- §20.2 Integration Connections ----
      '/integrations/connections': {
        get: { tags: ['Integration Connections'], summary: 'List org integration connections (no credentials returned)', operationId: 'listIntegrationConnections', security: [{ bearerAuth: [] }], parameters: [{ name: 'provider_id', in: 'query', schema: { type: 'integer' } }, { name: 'status', in: 'query', schema: { type: 'string' } }, pageParam(), limitParam()], responses: r200('IntegrationConnection[]') },
        post: { tags: ['Integration Connections'], summary: 'Create integration connection (credentials encrypted at rest)', operationId: 'createIntegrationConnection', security: [{ bearerAuth: [] }], requestBody: jsonBody('IntegrationConnection'), responses: r201('IntegrationConnection') },
      },
      '/integrations/connections/{id}': {
        get: { tags: ['Integration Connections'], summary: 'Get integration connection (no credentials)', operationId: 'getIntegrationConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('IntegrationConnection') },
        put: { tags: ['Integration Connections'], summary: 'Update integration connection', operationId: 'updateIntegrationConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('IntegrationConnection'), responses: r200('IntegrationConnection') },
        delete: { tags: ['Integration Connections'], summary: 'Delete integration connection (destroys credentials)', operationId: 'deleteIntegrationConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/integrations/connections/{id}/test': {
        post: { tags: ['Integration Connections'], summary: 'Test integration connection (stubbed for most providers)', operationId: 'testIntegrationConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('TestResult') },
      },
      '/integrations/connections/{id}/sync': {
        post: { tags: ['Integration Connections'], summary: 'Trigger integration sync (stubbed)', operationId: 'syncIntegrationConnection', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('direction'), responses: r200('SyncResult') },
      },
      '/integrations/connections/{id}/logs': {
        get: { tags: ['Integration Connections'], summary: 'List sync logs for a connection', operationId: 'listIntegrationSyncLogs', security: [{ bearerAuth: [] }], parameters: [idParam(), pageParam(), limitParam()], responses: r200('IntegrationSyncLog[]') },
      },

      // ---- §21 AI Customer Support ----
      '/support/metrics': {
        get: { tags: ['AI Support'], summary: 'Get AI support KPI metrics', operationId: 'getAiSupportMetrics', security: [{ bearerAuth: [] }], parameters: [{ name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } }], responses: r200('AiSupportMetrics') },
      },
      '/support/channels': {
        get: { tags: ['AI Support'], summary: 'List support channel configurations', operationId: 'listSupportChannels', security: [{ bearerAuth: [] }], responses: r200('SupportChannelConfig[]') },
      },
      '/support/channels/{channel}': {
        put: { tags: ['AI Support'], summary: 'Upsert support channel configuration', operationId: 'updateSupportChannel', security: [{ bearerAuth: [] }], parameters: [{ name: 'channel', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody('supportConversations_updateChannelConfig'), responses: r200('SupportChannelConfig') },
      },
      '/support/kb': {
        get:  { tags: ['AI Support'], summary: 'List KB articles', operationId: 'listKbArticles', security: [{ bearerAuth: [] }], parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'locale', in: 'query', schema: { type: 'string' } }, pageParam(), limitParam()], responses: r200('KbArticle[]') },
        post: { tags: ['AI Support'], summary: 'Create KB article', operationId: 'createKbArticle', security: [{ bearerAuth: [] }], requestBody: jsonBody('supportConversations_createKbArticle'), responses: r201('KbArticle') },
      },
      '/support/kb/search': {
        get: { tags: ['AI Support'], summary: 'Search KB articles by keyword', operationId: 'searchKbArticles', security: [{ bearerAuth: [] }], parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }], responses: r200('KbArticle[]') },
      },
      '/support/kb/{id}': {
        get:    { tags: ['AI Support'], summary: 'Get a KB article', operationId: 'getKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('KbArticle') },
        put:    { tags: ['AI Support'], summary: 'Update a KB article', operationId: 'updateKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('supportConversations_updateKbArticle'), responses: r200('KbArticle') },
        delete: { tags: ['AI Support'], summary: 'Delete a KB article', operationId: 'deleteKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/support/kb/{id}/embed': {
        post: { tags: ['AI Support'], summary: 'Trigger embedding for a KB article', operationId: 'embedKbArticle', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('EmbedResult') },
      },
      '/support/kb/{id}/feedback': {
        post: { tags: ['AI Support'], summary: 'Submit feedback on a KB article', operationId: 'submitKbFeedback', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('supportConversations_kbFeedback'), responses: r200('KbFeedback') },
      },
      '/support/conversations': {
        get:  { tags: ['AI Support'], summary: 'List support conversations', operationId: 'listSupportConversations', security: [{ bearerAuth: [] }], parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'escalated', 'closed'] } }, { name: 'client_id', in: 'query', schema: { type: 'integer' } }, pageParam(), limitParam()], responses: r200('SupportConversation[]') },
        post: { tags: ['AI Support'], summary: 'Start a new AI support conversation', operationId: 'startSupportConversation', security: [{ bearerAuth: [] }], requestBody: jsonBody('supportConversations_startConversation'), responses: r201('SupportConversation') },
      },
      '/support/conversations/{id}': {
        get:    { tags: ['AI Support'], summary: 'Get conversation with messages', operationId: 'getSupportConversation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('SupportConversation') },
        delete: { tags: ['AI Support'], summary: 'Close/delete a conversation', operationId: 'deleteSupportConversation', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/support/conversations/{id}/messages': {
        post: { tags: ['AI Support'], summary: 'Send a message in a conversation', operationId: 'sendSupportMessage', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('supportConversations_sendMessage'), responses: r201('SupportConversation') },
      },
      '/support/conversations/{id}/escalate': {
        post: { tags: ['AI Support'], summary: 'Manually escalate a conversation to a human agent', operationId: 'escalateSupportConversation', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('supportConversations_escalateConversation'), responses: r200('SupportConversation') },
      },
      '/support/conversations/{id}/diagnose': {
        post: { tags: ['AI Support'], summary: 'Run a connectivity diagnostic for a conversation', operationId: 'diagnoseSupportConversation', security: [{ bearerAuth: [] }], parameters: [idParam()], requestBody: jsonBody('symptom + accessType'), responses: r200('DiagnosticResult') },
      },

      // ---- §21.11 NOC AI ----
      '/noc-ai/insights': {
        get: { tags: ['NOC AI'], summary: 'List recent NOC AI insights', operationId: 'listNocAiInsights', security: [{ bearerAuth: [] }], parameters: [{ name: 'type', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }], responses: r200('NocAiInsight[]') },
      },
      '/noc-ai/insights/alert-explain': {
        post: { tags: ['NOC AI'], summary: 'Explain an alert with AI', operationId: 'nocAiAlertExplain', security: [{ bearerAuth: [] }], requestBody: jsonBody('nocAi_explainAlert'), responses: r200('NocAiInsight') },
      },
      '/noc-ai/insights/capacity-warning': {
        post: { tags: ['NOC AI'], summary: 'Run capacity warning analysis', operationId: 'nocAiCapacityWarning', security: [{ bearerAuth: [] }], requestBody: jsonBody('providerId (optional)'), responses: r200('NocAiInsight') },
      },
      '/noc-ai/insights/interference': {
        post: { tags: ['NOC AI'], summary: 'Run RF interference detection', operationId: 'nocAiInterference', security: [{ bearerAuth: [] }], requestBody: jsonBody('providerId (optional)'), responses: r200('NocAiInsight') },
      },
      '/noc-ai/insights/alignment-drift': {
        post: { tags: ['NOC AI'], summary: 'Run antenna alignment drift detection', operationId: 'nocAiAlignmentDrift', security: [{ bearerAuth: [] }], requestBody: jsonBody('providerId (optional)'), responses: r200('NocAiInsight') },
      },
      '/noc-ai/insights/shift-summary': {
        post: { tags: ['NOC AI'], summary: 'Generate NOC shift summary', operationId: 'nocAiShiftSummary', security: [{ bearerAuth: [] }], requestBody: jsonBody('providerId (optional)'), responses: r200('NocAiInsight') },
      },
      '/noc-ai/insights/runbook': {
        post: { tags: ['NOC AI'], summary: 'Get runbook suggestion for an alert type', operationId: 'nocAiRunbook', security: [{ bearerAuth: [] }], requestBody: jsonBody('nocAi_runbookSuggestion'), responses: r200('NocAiInsight') },
      },

      // ---- WireGuard Peers — self-service (owner-scoped) ----
      '/wg-peers': {
        get:  { tags: ['WireGuard Peers'], summary: 'List own WireGuard peers (key columns redacted)', operationId: 'listWgPeers', security: [{ bearerAuth: [] }], responses: r200('WgUserPeer[]') },
        post: { tags: ['WireGuard Peers'], summary: 'Create a WireGuard peer — keypair is server-generated; private key and QR SVG returned only here (never again)', operationId: 'createWgPeer', security: [{ bearerAuth: [] }], requestBody: jsonBody('wgPeers_createPeer'), responses: r201('WgUserPeer (redacted) + config + config_base64 + qr_svg') },
      },
      '/wg-peers/{id}/config': {
        get: { tags: ['WireGuard Peers'], summary: 'Persistent profile re-download: return .conf text (default) or SVG QR for the owning user', operationId: 'getWgPeerConfig', security: [{ bearerAuth: [] }], parameters: [idParam(), { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['conf', 'qr'] }, description: 'conf (default) or qr' }, { name: 'download', in: 'query', required: false, schema: { type: 'string', enum: ['1'] }, description: 'If 1, sets Content-Disposition: attachment' }], responses: r200('.conf text or SVG QR') },
      },
      '/wg-peers/{id}': {
        delete: { tags: ['WireGuard Peers'], summary: 'Revoke own WireGuard peer (owner only) — removes kernel peer immediately on next packet', operationId: 'deleteWgPeer', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },

      // ---- WireGuard Peers — admin oversight ----
      '/wg-peers/admin/all': {
        get: { tags: ['WireGuard Peers'], summary: 'List all org WireGuard peers with live handshake stats (admin only — key columns never returned)', operationId: 'adminListWgPeers', security: [{ bearerAuth: [] }], parameters: [pageParam(), limitParam(), { name: 'order_by', in: 'query', required: false, schema: { type: 'string' } }, { name: 'order', in: 'query', required: false, schema: { type: 'string', enum: ['ASC', 'DESC'] } }], responses: r200('WgUserPeer[] + live_stats + meta') },
      },
      '/wg-peers/admin/{id}': {
        delete: { tags: ['WireGuard Peers'], summary: 'Admin revoke any WireGuard peer by id', operationId: 'adminDeleteWgPeer', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r204() },
      },
      '/wg-peers/admin/{id}/rotate': {
        post: { tags: ['WireGuard Peers'], summary: 'Rotate keypair for any peer — owner must re-download /config; admin never receives the key', operationId: 'adminRotateWgPeer', security: [{ bearerAuth: [] }], parameters: [idParam()], responses: r200('WgUserPeer (redacted, new public_key)') },
      },

      // ---- WireGuard Peers — assignment management (admin) ----
      '/wg-peers/admin/assignments/{userId}': {
        get: { tags: ['WireGuard Peers'], summary: 'Get network scope assignments for a user (site/NAS grain) plus computed reachable subnets', operationId: 'getWgAssignments', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }], responses: r200('UserNetworkAssignment[] + computed_subnets') },
        put: { tags: ['WireGuard Peers'], summary: 'Replace network scope assignments for a user; live-refreshes their active WireGuard peers without reconnect', operationId: 'updateWgAssignments', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody('wgPeers_updateAssignments'), responses: r200('UserNetworkAssignment[]') },
      },
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
function pageParam() {
  return { name: 'page', in: 'query', required: false, schema: { type: 'integer' } };
}
function limitParam() {
  return { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } };
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
    if (rules.format) prop.format = rules.format;
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
